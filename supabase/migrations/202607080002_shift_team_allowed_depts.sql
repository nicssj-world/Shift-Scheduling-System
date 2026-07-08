-- Same idea as allowed_roles: restrict which profiles.dept values are
-- eligible to join each team, configurable per team (not hardcoded).
-- Null/empty = no restriction (shows everyone regardless of dept).

alter table public.shift_teams
  add column if not exists allowed_depts text[];
