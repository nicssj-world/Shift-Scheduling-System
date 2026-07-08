-- Restrict which profiles.role values are eligible to join each team, so
-- the "add member" picker only offers relevant staff. Configurable per team
-- (not hardcoded) so it keeps working the same way for teams added later —
-- an admin just sets allowed_roles when creating/editing a team. Null/empty
-- means "no restriction" (shows everyone), so existing rows stay safe by
-- default until backfilled below.

alter table public.shift_teams
  add column if not exists allowed_roles text[];

update public.shift_teams set allowed_roles = array['Medical Technologist','Medical Science Technician','Manager']
  where code = 'MT_CENTRAL';
update public.shift_teams set allowed_roles = array['Assistant']
  where code = 'AST_CENTRAL';
