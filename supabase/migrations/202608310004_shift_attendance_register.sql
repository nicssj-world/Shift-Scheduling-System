-- ============================================================
-- Attendance / leave register
-- Informational daily register maintained by designated recorders.
-- Shares the Supabase project with lab-management-portal.
-- Never alters profiles or its RLS.
-- Run in Supabase SQL Editor after the existing shift migrations.
-- ============================================================

create table if not exists public.shift_attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  record_date date not null,
  code text not null check (code in (
    'vacation', 'sick', 'sick_half', 'personal', 'personal_half',
    'absent', 'late', 'early', 'vacation_half', 'maternity'
  )),
  note text,
  source text not null default 'manual' check (source in ('manual', 'excel')),
  source_ref text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  deleted_by uuid references public.profiles(id),
  deleted_at timestamptz
);

create index if not exists shift_attendance_records_date_idx
  on public.shift_attendance_records (record_date, user_id)
  where deleted_at is null;
create index if not exists shift_attendance_records_user_idx
  on public.shift_attendance_records (user_id, record_date desc)
  where deleted_at is null;
create unique index if not exists shift_attendance_records_active_key
  on public.shift_attendance_records (user_id, record_date, code)
  where deleted_at is null;
drop index if exists public.shift_attendance_records_source_ref_key;
create unique index shift_attendance_records_source_ref_key
  on public.shift_attendance_records (source_ref);

create table if not exists public.shift_leave_recorders (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Explicit membership for the shared monthly register.  This is separate
-- from profiles so a clerk can add/remove a person from this register later
-- without changing the person's account or deleting attendance history.
create table if not exists public.shift_leave_roster (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  removed_by uuid references public.profiles(id),
  removed_at timestamptz
);

create index if not exists shift_leave_roster_active_idx
  on public.shift_leave_roster (user_id)
  where removed_at is null;

-- Keep the current active staff visible on first install.  ON CONFLICT DO
-- NOTHING makes rerunning this migration safe and preserves an intentional
-- later removal from the register.
insert into public.shift_leave_roster (user_id)
select p.id
from public.profiles p
where coalesce(lower(p.status), 'active') = 'active'
  and p.deleted_at is null
on conflict (user_id) do nothing;

create or replace function public.shift_is_leave_recorder() returns boolean
language sql stable security definer set search_path = public as $$
  select public.shift_is_admin() or exists (
    select 1 from public.shift_leave_recorders
    where user_id = auth.uid()
  );
$$;

alter table public.shift_attendance_records enable row level security;
alter table public.shift_leave_recorders enable row level security;
alter table public.shift_leave_roster enable row level security;

drop policy if exists shift_attendance_records_read on public.shift_attendance_records;
create policy shift_attendance_records_read on public.shift_attendance_records
  for select to authenticated using (true);
drop policy if exists shift_attendance_records_insert on public.shift_attendance_records;
create policy shift_attendance_records_insert on public.shift_attendance_records
  for insert to authenticated
  with check (public.shift_is_leave_recorder());
drop policy if exists shift_attendance_records_update on public.shift_attendance_records;
create policy shift_attendance_records_update on public.shift_attendance_records
  for update to authenticated
  using (public.shift_is_leave_recorder())
  with check (public.shift_is_leave_recorder());
-- Deliberately no authenticated DELETE policy: application deletes are
-- soft-deletes via the API update route, so a recorder cannot hard-delete a
-- historical row even if they call Supabase directly.
drop policy if exists shift_attendance_records_delete on public.shift_attendance_records;

drop policy if exists shift_leave_recorders_read on public.shift_leave_recorders;
create policy shift_leave_recorders_read on public.shift_leave_recorders
  for select to authenticated using (public.shift_is_admin());
drop policy if exists shift_leave_recorders_write on public.shift_leave_recorders;
create policy shift_leave_recorders_write on public.shift_leave_recorders
  for all to authenticated
  using (public.shift_is_admin())
  with check (public.shift_is_admin());

drop policy if exists shift_leave_roster_read on public.shift_leave_roster;
create policy shift_leave_roster_read on public.shift_leave_roster
  for select to authenticated using (true);
drop policy if exists shift_leave_roster_insert on public.shift_leave_roster;
create policy shift_leave_roster_insert on public.shift_leave_roster
  for insert to authenticated
  with check (public.shift_is_leave_recorder());
drop policy if exists shift_leave_roster_update on public.shift_leave_roster;
create policy shift_leave_roster_update on public.shift_leave_roster
  for update to authenticated
  using (public.shift_is_leave_recorder())
  with check (public.shift_is_leave_recorder());
-- Removing a person is a soft update so the roster membership and audit trail
-- can be restored without touching profile data or attendance records.
drop policy if exists shift_leave_roster_delete on public.shift_leave_roster;

-- Aggregate the report in Postgres. Active people are always included; an
-- inactive person is retained when they have a record in the requested range.
create or replace function public.shift_attendance_report(p_from date, p_to date)
returns table (
  user_id uuid,
  name text,
  dept text,
  position_title text,
  employment_type text,
  vacation numeric,
  sick numeric,
  personal numeric,
  absent numeric,
  late numeric,
  early numeric,
  maternity numeric
)
language sql stable security definer set search_path = public as $$
  with people as (
    select p.id, p.name, p.dept, p.position_title, p.employment_type
    from public.profiles p
    where (
      (coalesce(lower(p.status), 'active') = 'active' and p.deleted_at is null)
      or exists (
        select 1
        from public.shift_attendance_records r0
        where r0.user_id = p.id
          and r0.deleted_at is null
          and r0.record_date between p_from and p_to
      )
    )
  )
  select
    p.id,
    p.name,
    p.dept,
    p.position_title,
    p.employment_type,
    coalesce(sum(case when r.code = 'vacation' then 1 when r.code = 'vacation_half' then 0.5 else 0 end), 0),
    coalesce(sum(case when r.code = 'sick' then 1 when r.code = 'sick_half' then 0.5 else 0 end), 0),
    coalesce(sum(case when r.code = 'personal' then 1 when r.code = 'personal_half' then 0.5 else 0 end), 0),
    coalesce(sum(case when r.code = 'absent' then 1 else 0 end), 0),
    coalesce(sum(case when r.code = 'late' then 1 else 0 end), 0),
    coalesce(sum(case when r.code = 'early' then 1 else 0 end), 0),
    coalesce(sum(case when r.code = 'maternity' then 1 else 0 end), 0)
  from people p
  left join public.shift_attendance_records r
    on r.user_id = p.id
   and r.deleted_at is null
   and r.record_date between p_from and p_to
  group by p.id, p.name, p.dept, p.position_title, p.employment_type
  order by p.dept nulls last, p.name;
$$;

create or replace function public.shift_attendance_monthly_totals(p_from date, p_to date)
returns table (
  month date,
  total bigint,
  late bigint,
  early bigint
)
language sql stable security definer set search_path = public as $$
  select
    date_trunc('month', record_date)::date,
    count(*)::bigint,
    count(*) filter (where code = 'late')::bigint,
    count(*) filter (where code = 'early')::bigint
  from public.shift_attendance_records
  where deleted_at is null
    and record_date between p_from and p_to
  group by date_trunc('month', record_date)::date
  order by date_trunc('month', record_date)::date;
$$;
