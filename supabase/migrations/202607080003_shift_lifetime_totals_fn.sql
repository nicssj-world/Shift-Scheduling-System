-- Sum lifetime shift counts per person inside Postgres instead of fetching
-- every historical assignment row over the network and counting in the app.
-- Cost stays flat (one aggregation query, ~N-team-members rows returned)
-- regardless of how many months of history accumulate — without this, the
-- carry-in query for total-shift fairness would grow linearly forever as
-- more schedules pile up.
create or replace function public.shift_lifetime_totals(p_team_id uuid, p_exclude_month date)
returns table(user_id uuid, total bigint)
language sql stable security definer set search_path = public as $$
  select sa.user_id, count(*)::bigint as total
  from shift_assignments sa
  join shift_schedules ss on ss.id = sa.schedule_id
  where ss.team_id = p_team_id and ss.month <> p_exclude_month
  group by sa.user_id;
$$;

-- Service-role only (called from server-side carry-in code) — not a public
-- RPC endpoint, so it shouldn't be callable by ordinary authenticated users.
revoke all on function public.shift_lifetime_totals(uuid, date) from public;
grant execute on function public.shift_lifetime_totals(uuid, date) to service_role;
