-- Scheduler rule hardening: explicit night-rest metadata, rolling fairness,
-- and atomic roster mutations. Run this file in the Supabase SQL Editor after
-- the existing migrations. It is idempotent.

begin;

-- Preserve the legacy meaning of the seeded N shift while allowing Admin to
-- change the flag explicitly for any future shift type. The backfill runs only
-- when this migration actually creates the column, so a re-run never resets a
-- deliberate Admin override back to true.
do $$
declare
  already_exists boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shift_shift_types'
      and column_name = 'triggers_rest_after_night'
  ) into already_exists;
  if not already_exists then
    alter table public.shift_shift_types
      add column triggers_rest_after_night boolean not null default false;
    update public.shift_shift_types
    set triggers_rest_after_night = true
    where upper(code) = 'N';
  end if;
end;
$$;

-- Fairness history is deliberately bounded to six completed calendar months.
create or replace function public.shift_rolling_totals(
  p_team_id uuid,
  p_from_month date,
  p_to_month date
)
returns table(user_id uuid, total bigint)
language sql stable security definer set search_path = public as $$
  select sa.user_id, count(*)::bigint as total
  from public.shift_assignments sa
  join public.shift_schedules ss on ss.id = sa.schedule_id
  where ss.team_id = p_team_id
    and ss.month >= p_from_month
    and ss.month < p_to_month
    and ss.status in ('published', 'locked')
  group by sa.user_id;
$$;

revoke all on function public.shift_rolling_totals(uuid, date, date) from public;
grant execute on function public.shift_rolling_totals(uuid, date, date) to service_role;

-- Return every fairness dimension from the same bounded window in one
-- database aggregation. The application still fetches only the small
-- previous/next-month boundary slices for hard continuity checks.
create or replace function public.shift_rolling_fairness(
  p_team_id uuid,
  p_from_month date,
  p_to_month date
)
returns table(
  user_id uuid,
  total bigint,
  shift_type_counts jsonb,
  job_counts jsonb,
  weekend_holiday bigint,
  pair_counts jsonb
)
language sql stable security definer set search_path = public as $$
with scoped as (
  select sa.schedule_id, sa.work_date, sa.shift_type_id, sa.user_id, sa.job_id
  from public.shift_assignments sa
  join public.shift_schedules ss on ss.id = sa.schedule_id
  where ss.team_id = p_team_id
    and ss.month >= p_from_month
    and ss.month < p_to_month
    and ss.status in ('published', 'locked')
), people as (
  select distinct user_id from scoped
), totals as (
  select user_id, count(*)::bigint as total
  from scoped
  group by user_id
), type_rows as (
  select s.user_id, st.code, count(*)::bigint as item_count
  from scoped s
  join public.shift_shift_types st on st.id = s.shift_type_id
  group by s.user_id, st.code
), type_totals as (
  select user_id, jsonb_object_agg(code, item_count) as counts
  from type_rows
  group by user_id
), job_rows as (
  select s.user_id, j.code, count(*)::bigint as item_count
  from scoped s
  join public.shift_jobs j on j.id = s.job_id
  where s.job_id is not null
  group by s.user_id, j.code
), job_totals as (
  select user_id, jsonb_object_agg(code, item_count) as counts
  from job_rows
  group by user_id
), weekend_totals as (
  select s.user_id,
    count(*) filter (
      where extract(isodow from s.work_date) in (6, 7)
         or h.holiday_date is not null
    )::bigint as weekend_count
  from scoped s
  left join public.shift_holidays h on h.holiday_date = s.work_date
  group by s.user_id
), pair_rows as (
  select a.user_id, b.user_id as other_user
  from scoped a
  join scoped b
    on b.schedule_id = a.schedule_id
   and b.work_date = a.work_date
   and b.shift_type_id = a.shift_type_id
   and b.user_id <> a.user_id
  group by a.schedule_id, a.work_date, a.shift_type_id, a.user_id, b.user_id
), pair_counts_rows as (
  select user_id, other_user, count(*)::bigint as pair_count
  from pair_rows
  group by user_id, other_user
), pair_totals as (
  select user_id, jsonb_object_agg(other_user::text, pair_count) as counts
  from pair_counts_rows
  group by user_id
)
select p.user_id,
  coalesce(t.total, 0)::bigint,
  coalesce(tt.counts, '{}'::jsonb),
  coalesce(jt.counts, '{}'::jsonb),
  coalesce(wt.weekend_count, 0)::bigint,
  coalesce(pt.counts, '{}'::jsonb)
from people p
left join totals t on t.user_id = p.user_id
left join type_totals tt on tt.user_id = p.user_id
left join job_totals jt on jt.user_id = p.user_id
left join weekend_totals wt on wt.user_id = p.user_id
left join pair_totals pt on pt.user_id = p.user_id;
$$;

revoke all on function public.shift_rolling_fairness(uuid, date, date) from public;
grant execute on function public.shift_rolling_fairness(uuid, date, date) to service_role;

-- Apply one manual assignment mutation only after the application has
-- validated the proposed roster. The schedule row lock and expected version
-- make that validation race-safe.
drop function if exists public.shift_apply_manual_assignment(uuid, bigint, text, uuid, date, uuid, uuid, uuid, uuid);
create or replace function public.shift_apply_manual_assignment(
  p_schedule_id uuid,
  p_expected_version bigint,
  p_operation text,
  p_assignment_id uuid default null,
  p_work_date date default null,
  p_shift_type_id uuid default null,
  p_user_id uuid default null,
  p_job_id uuid default null,
  p_actor_id uuid default null,
  p_expected_status text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  roster record;
  existing_assignment record;
  result_id uuid;
begin
  select id, team_id, month, status, assignment_version
  into roster
  from public.shift_schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'ไม่พบตารางเวร' using errcode = 'P0001';
  end if;
  if p_expected_version is null then
    raise exception 'ต้องระบุ assignment version ที่คาดหวัง' using errcode = '40001';
  end if;
  if p_expected_status is null or roster.status is distinct from p_expected_status then
    raise exception 'สถานะตารางเวรมีการเปลี่ยนแปลง กรุณารีเฟรช' using errcode = '40001';
  end if;
  if roster.status = 'locked' then
    raise exception 'ตารางเวรถูกล็อคแล้ว' using errcode = 'P0001';
  end if;
  if roster.assignment_version <> p_expected_version then
    raise exception 'ตารางมีการเปลี่ยนแปลงพร้อมกัน กรุณารีเฟรชแล้วลองใหม่' using errcode = '40001';
  end if;

  if p_operation in ('insert', 'replace') then
    if p_work_date is null or p_shift_type_id is null or p_user_id is null then
      raise exception 'ข้อมูล assignment ไม่ครบ' using errcode = 'P0001';
    end if;
    if p_work_date < date_trunc('month', roster.month)::date
       or p_work_date >= (date_trunc('month', roster.month) + interval '1 month')::date then
      raise exception 'วันที่อยู่นอกเดือนของตาราง' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.shift_shift_types st
      where st.id = p_shift_type_id and st.is_active
    ) then
      raise exception 'ประเภทเวรไม่พร้อมใช้งาน' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.shift_team_members tm
      where tm.team_id = roster.team_id and tm.user_id = p_user_id and tm.is_active
    ) then
      raise exception 'ผู้รับเวรไม่ได้เป็นสมาชิกทีมที่ใช้งานอยู่' using errcode = 'P0001';
    end if;
    if p_job_id is not null and not exists (
      select 1 from public.shift_jobs j
      where j.id = p_job_id and j.team_id = roster.team_id and j.is_active
    ) then
      raise exception 'Job ไม่อยู่ในทีม หรือปิดใช้งานแล้ว' using errcode = 'P0001';
    end if;
    if p_operation = 'replace' then
      select id, work_date, shift_type_id
      into existing_assignment
      from public.shift_assignments
      where id = p_assignment_id and schedule_id = p_schedule_id
      for update;
      if not found then
        raise exception 'ไม่พบเวรที่ต้องการแทนที่ในตารางนี้' using errcode = 'P0001';
      end if;
      if existing_assignment.work_date is distinct from p_work_date
         or existing_assignment.shift_type_id is distinct from p_shift_type_id then
        raise exception 'assignment ที่ต้องการแทนที่ไม่ตรงกับช่องตารางปัจจุบัน' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if p_operation = 'insert' then
    insert into public.shift_assignments
      (schedule_id, work_date, shift_type_id, user_id, job_id, source)
    values
      (p_schedule_id, p_work_date, p_shift_type_id, p_user_id, p_job_id, 'manual')
    returning id into result_id;
  elsif p_operation = 'replace' then
    update public.shift_assignments
    set user_id = p_user_id, job_id = p_job_id, source = 'manual'
    where id = p_assignment_id and schedule_id = p_schedule_id
    returning id into result_id;
    if not found then
      raise exception 'ไม่พบเวรที่ต้องการแทนที่ในตารางนี้' using errcode = 'P0001';
    end if;
  elsif p_operation = 'delete' then
    delete from public.shift_assignments
    where id = p_assignment_id and schedule_id = p_schedule_id
    returning id into result_id;
    if not found then
      raise exception 'ไม่พบเวรนี้ในตาราง' using errcode = 'P0001';
    end if;
  elsif p_operation = 'set_job' then
    if p_job_id is not null and not exists (
      select 1
      from public.shift_jobs j
      join public.shift_assignments a on a.id = p_assignment_id
      where j.id = p_job_id and j.team_id = roster.team_id and j.is_active
    ) then
      raise exception 'Job ไม่อยู่ในทีม หรือปิดใช้งานแล้ว' using errcode = 'P0001';
    end if;
    update public.shift_assignments
    set job_id = p_job_id, source = 'manual'
    where id = p_assignment_id and schedule_id = p_schedule_id
    returning id into result_id;
    if not found then
      raise exception 'ไม่พบเวรนี้ในตาราง' using errcode = 'P0001';
    end if;
  else
    raise exception 'operation ไม่ถูกต้อง' using errcode = 'P0001';
  end if;

  return result_id;
end;
$$;

revoke all on function public.shift_apply_manual_assignment(uuid, bigint, text, uuid, date, uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.shift_apply_manual_assignment(uuid, bigint, text, uuid, date, uuid, uuid, uuid, uuid, text) to service_role;

-- Replace a generated Draft atomically. If any insert fails, the old roster
-- remains intact because the delete and insert share one transaction.
create or replace function public.shift_replace_schedule_assignments(
  p_schedule_id uuid,
  p_expected_version bigint,
  p_rows jsonb,
  p_generated_by uuid,
  p_config jsonb
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  roster record;
  inserted_count integer;
begin
  select id, team_id, month, status, assignment_version
  into roster
  from public.shift_schedules
  where id = p_schedule_id
  for update;

  if not found then
    raise exception 'ไม่พบตารางเวร' using errcode = 'P0001';
  end if;
  if p_expected_version is null then
    raise exception 'ต้องระบุ assignment version ที่คาดหวัง' using errcode = '40001';
  end if;
  if roster.status <> 'draft' then
    raise exception 'สร้างตารางอัตโนมัติได้เฉพาะฉบับร่าง' using errcode = 'P0001';
  end if;
  if roster.assignment_version <> p_expected_version then
    raise exception 'ตารางมีการเปลี่ยนแปลงพร้อมกัน กรุณารีเฟรชแล้วลองใหม่' using errcode = '40001';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'ข้อมูล assignment ไม่ถูกต้อง' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
      work_date date, shift_type_id uuid, user_id uuid, job_id uuid, source text
    )
    where row_data.work_date < date_trunc('month', roster.month)::date
       or row_data.work_date >= (date_trunc('month', roster.month) + interval '1 month')::date
  ) then
    raise exception 'assignment อยู่นอกเดือนของตาราง' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
      work_date date, shift_type_id uuid, user_id uuid, job_id uuid, source text
    )
    where not exists (
      select 1 from public.shift_shift_types st
      where st.id = row_data.shift_type_id and st.is_active
    )
  ) then
    raise exception 'มีประเภทเวรที่ไม่พร้อมใช้งาน' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
      work_date date, shift_type_id uuid, user_id uuid, job_id uuid, source text
    )
    where not exists (
      select 1 from public.shift_team_members tm
      where tm.team_id = roster.team_id and tm.user_id = row_data.user_id and tm.is_active
    )
  ) then
    raise exception 'มีผู้รับเวรที่ไม่ได้เป็นสมาชิกทีม' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
      work_date date, shift_type_id uuid, user_id uuid, job_id uuid, source text
    )
    where row_data.job_id is not null
      and not exists (
        select 1 from public.shift_jobs j
        where j.id = row_data.job_id and j.team_id = roster.team_id and j.is_active
      )
  ) then
    raise exception 'มี Job ที่ไม่อยู่ในทีม หรือปิดใช้งานแล้ว' using errcode = 'P0001';
  end if;

  delete from public.shift_assignments where schedule_id = p_schedule_id;

  insert into public.shift_assignments
    (schedule_id, work_date, shift_type_id, user_id, job_id, source)
  select
    p_schedule_id,
    row_data.work_date,
    row_data.shift_type_id,
    row_data.user_id,
    row_data.job_id,
    coalesce(nullif(row_data.source, ''), 'auto')
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row_data(
    work_date date,
    shift_type_id uuid,
    user_id uuid,
    job_id uuid,
    source text
  );

  get diagnostics inserted_count = row_count;
  update public.shift_schedules
  set generated_at = now(), generated_by = p_generated_by, config = coalesce(p_config, '{}'::jsonb)
  where id = p_schedule_id;
  return inserted_count;
end;
$$;

revoke all on function public.shift_replace_schedule_assignments(uuid, bigint, jsonb, uuid, jsonb) from public;
grant execute on function public.shift_replace_schedule_assignments(uuid, bigint, jsonb, uuid, jsonb) to service_role;

commit;
