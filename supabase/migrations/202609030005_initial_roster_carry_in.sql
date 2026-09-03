-- Use the immutable pre-publication roster for cross-month scheduler carry-in.
-- Run after 202609020001_shift_initial_roster_snapshot.sql (safe to run on its
-- own because the column is also guarded below). This migration is idempotent.

begin;

alter table public.shift_schedules
  add column if not exists initial_assignments jsonb;

-- A NULL/non-array snapshot means this is an older schedule. Those schedules
-- intentionally fall back to their current assignments for compatibility.
-- An empty array is a valid baseline and must not fall back to post-sale rows.
create or replace function public.shift_roster_baseline_assignments(
  p_schedule_id uuid
)
returns table(
  schedule_id uuid,
  work_date date,
  shift_type_id uuid,
  user_id uuid,
  job_id uuid
)
language sql stable security definer set search_path = public as $$
with roster as (
  select
    ss.id,
    ss.initial_assignments,
    coalesce(jsonb_typeof(ss.initial_assignments) = 'array', false) as has_snapshot
  from public.shift_schedules ss
  where ss.id = p_schedule_id
)
select
  r.id,
  row_data.work_date,
  row_data.shift_type_id,
  row_data.user_id,
  row_data.job_id
from roster r
cross join lateral jsonb_to_recordset(
  case when r.has_snapshot then r.initial_assignments else '[]'::jsonb end
) as row_data(
  work_date date,
  shift_type_id uuid,
  user_id uuid,
  job_id uuid
)
where r.has_snapshot
union all
select
  sa.schedule_id,
  sa.work_date,
  sa.shift_type_id,
  sa.user_id,
  sa.job_id
from public.shift_assignments sa
join roster r on r.id = sa.schedule_id
where not r.has_snapshot;
$$;

revoke all on function public.shift_roster_baseline_assignments(uuid) from public, anon, authenticated;
grant execute on function public.shift_roster_baseline_assignments(uuid) to service_role;

-- Keep the legacy totals RPC aligned with the fairness RPC for callers that
-- still use it directly.
create or replace function public.shift_rolling_totals(
  p_team_id uuid,
  p_from_month date,
  p_to_month date
)
returns table(user_id uuid, total bigint)
language sql stable security definer set search_path = public as $$
with scoped as (
  select baseline.user_id
  from public.shift_schedules ss
  cross join lateral public.shift_roster_baseline_assignments(ss.id) baseline
  where ss.team_id = p_team_id
    and ss.month >= p_from_month
    and ss.month < p_to_month
    and ss.status in ('published', 'locked')
)
select user_id, count(*)::bigint as total
from scoped
group by user_id;
$$;

revoke all on function public.shift_rolling_totals(uuid, date, date) from public, anon, authenticated;
grant execute on function public.shift_rolling_totals(uuid, date, date) to service_role;

-- Return every fairness dimension from the same bounded window, using the
-- roster that existed before swaps, sales, or later manual corrections.
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
  select
    baseline.schedule_id,
    baseline.work_date,
    baseline.shift_type_id,
    baseline.user_id,
    baseline.job_id
  from public.shift_schedules ss
  cross join lateral public.shift_roster_baseline_assignments(ss.id) baseline
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

revoke all on function public.shift_rolling_fairness(uuid, date, date) from public, anon, authenticated;
grant execute on function public.shift_rolling_fairness(uuid, date, date) to service_role;

commit;
