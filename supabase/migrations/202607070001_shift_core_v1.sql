-- ============================================================
-- Shift Scheduling System — core schema v1
-- Shares the Supabase project with lab-management-portal.
-- All tables are prefixed shift_ and FK to public.profiles(id).
-- NEVER alters profiles or its RLS. Run in Supabase SQL editor.
-- ============================================================

-- ---------- 1) Teams (rosters) ----------
create table if not exists public.shift_teams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  uses_jobs boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0
);

-- ---------- 2) Team members ----------
create table if not exists public.shift_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.shift_teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  display_label text,
  is_active boolean not null default true,
  joined_at date not null default current_date,
  sort_order int not null default 0,
  unique (team_id, user_id)
);
create index if not exists shift_team_members_team_idx
  on public.shift_team_members (team_id) where is_active;

-- ---------- 3) Shift types ----------
create table if not exists public.shift_shift_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  start_time time not null,
  end_time time not null,
  hours numeric(4,1) not null,
  color text not null default '#0284c7',
  is_active boolean not null default true,
  sort_order int not null default 0
);

-- ---------- 4) Staffing requirements ----------
create table if not exists public.shift_requirements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.shift_teams(id) on delete cascade,
  shift_type_id uuid not null references public.shift_shift_types(id) on delete cascade,
  day_class text not null check (day_class in ('weekday','weekend','holiday')),
  required_count int not null default 0 check (required_count >= 0),
  unique (team_id, shift_type_id, day_class)
);

-- ---------- 5) Job rotation list ----------
create table if not exists public.shift_jobs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.shift_teams(id) on delete cascade,
  code text not null,
  name_th text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  unique (team_id, code)
);

-- ---------- 6) Holidays ----------
create table if not exists public.shift_holidays (
  holiday_date date primary key,
  name_th text not null,
  kind text not null default 'public' check (kind in ('public','special')),
  created_by uuid references public.profiles(id)
);

-- ---------- 7) Schedules (one per team per month) ----------
create table if not exists public.shift_schedules (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.shift_teams(id),
  month date not null,
  status text not null default 'draft' check (status in ('draft','published','locked')),
  generated_at timestamptz,
  generated_by uuid references public.profiles(id),
  published_at timestamptz,
  published_by uuid references public.profiles(id),
  locked_at timestamptz,
  locked_by uuid references public.profiles(id),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (team_id, month)
);

-- ---------- 8) Assignments ----------
create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.shift_schedules(id) on delete cascade,
  work_date date not null,
  shift_type_id uuid not null references public.shift_shift_types(id),
  user_id uuid not null references public.profiles(id),
  job_id uuid references public.shift_jobs(id),
  source text not null default 'auto' check (source in ('auto','manual','swap')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, work_date, shift_type_id, user_id)
);
create index if not exists shift_assignments_user_date_idx on public.shift_assignments (user_id, work_date);
create index if not exists shift_assignments_date_idx on public.shift_assignments (work_date);
create index if not exists shift_assignments_schedule_idx on public.shift_assignments (schedule_id);

create or replace function public.shift_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_shift_assignments_updated on public.shift_assignments;
create trigger trg_shift_assignments_updated
  before update on public.shift_assignments
  for each row execute function public.shift_touch_updated_at();

-- ---------- 9) Leaves ----------
create table if not exists public.shift_leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  leave_type text not null check (leave_type in ('vacation','sick','personal','other')),
  start_date date not null,
  end_date date not null,
  day_part text not null default 'full' check (day_part in ('full','half_am','half_pm')),
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid not null references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (day_part = 'full' or start_date = end_date)
);
create index if not exists shift_leaves_user_idx on public.shift_leaves (user_id, start_date);
create index if not exists shift_leaves_pending_idx on public.shift_leaves (status) where status = 'pending';

-- ---------- 10) Swap requests ----------
create table if not exists public.shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  requester_assignment_id uuid not null references public.shift_assignments(id) on delete cascade,
  target_assignment_id uuid not null references public.shift_assignments(id) on delete cascade,
  requester_id uuid not null references public.profiles(id),
  target_user_id uuid not null references public.profiles(id),
  reason text,
  status text not null default 'pending_counterpart' check (status in
    ('pending_counterpart','pending_approval','approved','declined','rejected','cancelled')),
  counterpart_responded_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shift_swaps_target_idx
  on public.shift_swap_requests (target_user_id) where status = 'pending_counterpart';
create index if not exists shift_swaps_approval_idx
  on public.shift_swap_requests (status) where status = 'pending_approval';

-- ---------- 11) Notifications ----------
create table if not exists public.shift_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shift_notifications_user_idx on public.shift_notifications (user_id, created_at desc);
create index if not exists shift_notifications_unread_idx on public.shift_notifications (user_id) where read_at is null;

-- ---------- 12) Designated schedulers ----------
create table if not exists public.shift_schedulers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- 13) App settings ----------
create table if not exists public.shift_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- ---------- Helper predicates (security definer so policies do
-- ---------- not depend on profiles RLS). Defined after all tables
-- ---------- exist because SQL-language functions are validated
-- ---------- against the catalog at CREATE time. ----------
create or replace function public.shift_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and (role = 'Admin' or lower(role) = 'admin')
  );
$$;

create or replace function public.shift_is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and (role in ('Admin','Manager') or lower(role) in ('admin','staff'))
  );
$$;

create or replace function public.shift_is_scheduler() returns boolean
language sql stable security definer set search_path = public as $$
  select public.shift_is_manager() or exists (
    select 1 from shift_schedulers where user_id = auth.uid()
  );
$$;

-- ============================================================
-- RLS (defense-in-depth; the app reads/writes via service role)
-- ============================================================
alter table public.shift_teams enable row level security;
alter table public.shift_team_members enable row level security;
alter table public.shift_shift_types enable row level security;
alter table public.shift_requirements enable row level security;
alter table public.shift_jobs enable row level security;
alter table public.shift_holidays enable row level security;
alter table public.shift_schedules enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.shift_leaves enable row level security;
alter table public.shift_swap_requests enable row level security;
alter table public.shift_notifications enable row level security;
alter table public.shift_schedulers enable row level security;
alter table public.shift_settings enable row level security;

-- Reference tables: read all authenticated, write managers
do $$
declare t text;
begin
  foreach t in array array['shift_teams','shift_team_members','shift_shift_types',
                           'shift_requirements','shift_jobs','shift_holidays']
  loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.shift_is_manager()) with check (public.shift_is_manager())', t, t);
  end loop;
end $$;

-- Schedules: published/locked visible to all; drafts to schedulers
drop policy if exists shift_schedules_read on public.shift_schedules;
create policy shift_schedules_read on public.shift_schedules for select to authenticated
  using (status in ('published','locked') or public.shift_is_scheduler());
drop policy if exists shift_schedules_write on public.shift_schedules;
create policy shift_schedules_write on public.shift_schedules for all to authenticated
  using (public.shift_is_scheduler()) with check (public.shift_is_scheduler());

drop policy if exists shift_assignments_read on public.shift_assignments;
create policy shift_assignments_read on public.shift_assignments for select to authenticated
  using (
    exists (select 1 from public.shift_schedules s
            where s.id = schedule_id and (s.status in ('published','locked') or public.shift_is_scheduler()))
  );
drop policy if exists shift_assignments_write on public.shift_assignments;
create policy shift_assignments_write on public.shift_assignments for all to authenticated
  using (public.shift_is_scheduler()) with check (public.shift_is_scheduler());

-- Leaves
drop policy if exists shift_leaves_read on public.shift_leaves;
create policy shift_leaves_read on public.shift_leaves for select to authenticated
  using (user_id = auth.uid() or public.shift_is_manager());
drop policy if exists shift_leaves_insert on public.shift_leaves;
create policy shift_leaves_insert on public.shift_leaves for insert to authenticated
  with check ((user_id = auth.uid() and status = 'pending') or public.shift_is_manager());
drop policy if exists shift_leaves_update on public.shift_leaves;
create policy shift_leaves_update on public.shift_leaves for update to authenticated
  using (user_id = auth.uid() or public.shift_is_manager());

-- Swaps
drop policy if exists shift_swaps_read on public.shift_swap_requests;
create policy shift_swaps_read on public.shift_swap_requests for select to authenticated
  using (requester_id = auth.uid() or target_user_id = auth.uid() or public.shift_is_scheduler());
drop policy if exists shift_swaps_insert on public.shift_swap_requests;
create policy shift_swaps_insert on public.shift_swap_requests for insert to authenticated
  with check (requester_id = auth.uid() or public.shift_is_scheduler());
drop policy if exists shift_swaps_update on public.shift_swap_requests;
create policy shift_swaps_update on public.shift_swap_requests for update to authenticated
  using (requester_id = auth.uid() or target_user_id = auth.uid() or public.shift_is_scheduler());

-- Notifications: self only; inserts happen via service role (no insert policy)
drop policy if exists shift_notifications_read on public.shift_notifications;
create policy shift_notifications_read on public.shift_notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists shift_notifications_update on public.shift_notifications;
create policy shift_notifications_update on public.shift_notifications for update to authenticated
  using (user_id = auth.uid());

-- Schedulers & settings
drop policy if exists shift_schedulers_read on public.shift_schedulers;
create policy shift_schedulers_read on public.shift_schedulers for select to authenticated using (true);
drop policy if exists shift_schedulers_write on public.shift_schedulers;
create policy shift_schedulers_write on public.shift_schedulers for all to authenticated
  using (public.shift_is_admin()) with check (public.shift_is_admin());

drop policy if exists shift_settings_read on public.shift_settings;
create policy shift_settings_read on public.shift_settings for select to authenticated using (true);
drop policy if exists shift_settings_write on public.shift_settings;
create policy shift_settings_write on public.shift_settings for all to authenticated
  using (public.shift_is_admin()) with check (public.shift_is_admin());

-- Realtime for the notification bell (only this table is added)
do $$
begin
  alter publication supabase_realtime add table public.shift_notifications;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- Seeds
-- ============================================================
insert into public.shift_teams (code, name_th, uses_jobs, sort_order) values
  ('MT_CENTRAL', 'เจ้าหน้าที่ Central Lab', true, 1),
  ('AST_CENTRAL', 'ผู้ช่วย Central Lab', false, 2)
on conflict (code) do nothing;

insert into public.shift_shift_types (code, name_th, start_time, end_time, hours, color, sort_order) values
  ('M',  'เวรเช้า',          '08:00', '16:00', 8, '#f59e0b', 1),
  ('A',  'เวรบ่าย',          '16:00', '24:00', 8, '#0ea5e9', 2),
  ('N',  'เวรดึก',           '00:00', '08:00', 8, '#6366f1', 3),
  ('A4', 'เวรบ่าย(ครึ่งเวร)', '16:00', '20:00', 4, '#10b981', 4)
on conflict (code) do nothing;

insert into public.shift_jobs (team_id, code, name_th, sort_order)
select t.id, j.code, j.name_th, j.sort_order
from public.shift_teams t,
  (values ('CHEM','Chem',1),('SERO','Sero',2),('HEMATO','Hemato',3),('MICROSS','Micros',4)) as j(code,name_th,sort_order)
where t.code = 'MT_CENTRAL'
on conflict (team_id, code) do nothing;

-- MT: A/N ×4 every day class, M ×4 weekend+holiday; AST: same with ×2
insert into public.shift_requirements (team_id, shift_type_id, day_class, required_count)
select t.id, st.id, dc.day_class,
  case
    when st.code = 'M'  and dc.day_class = 'weekday' then 0
    when st.code = 'A4' then 0
    when t.code = 'MT_CENTRAL' then 4
    else 2
  end
from public.shift_teams t
cross join public.shift_shift_types st
cross join (values ('weekday'),('weekend'),('holiday')) as dc(day_class)
where st.code in ('M','A','N','A4')
on conflict (team_id, shift_type_id, day_class) do nothing;

insert into public.shift_settings (key, value) values
  ('scheduler', '{"maxShiftsPerMonth": 24, "allowAfternoonNightDouble": true, "minRestHoursAfterNight": 8, "requireWeeklyDayOff": true, "weights": {"total": 10, "type": 4, "weekend": 6, "consecutive": 3}}'::jsonb),
  ('swap', '{"requiresApproval": true}'::jsonb)
on conflict (key) do nothing;
