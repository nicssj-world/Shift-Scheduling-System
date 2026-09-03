-- Map LINE groups to schedule teams and, optionally, individual shift types.
-- The mapping is intentionally separate from shift_teams so one team can
-- have more than one destination in a later rollout.

create table if not exists public.shift_line_group_mappings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.shift_teams(id) on delete cascade,
  shift_type_id uuid references public.shift_shift_types(id) on delete cascade,
  line_group_id uuid not null references public.shift_line_groups(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shift_line_group_mappings_team_idx
  on public.shift_line_group_mappings (team_id, shift_type_id) where is_active;
create index if not exists shift_line_group_mappings_group_idx
  on public.shift_line_group_mappings (line_group_id) where is_active;

-- PostgreSQL treats NULL values as distinct in a normal unique constraint, so
-- partial indexes enforce uniqueness for both team-wide and type-specific rows.
create unique index if not exists shift_line_group_mappings_team_group_unique
  on public.shift_line_group_mappings (team_id, line_group_id)
  where shift_type_id is null;
create unique index if not exists shift_line_group_mappings_type_group_unique
  on public.shift_line_group_mappings (team_id, shift_type_id, line_group_id)
  where shift_type_id is not null;

drop trigger if exists trg_shift_line_group_mappings_updated on public.shift_line_group_mappings;
create trigger trg_shift_line_group_mappings_updated
  before update on public.shift_line_group_mappings
  for each row execute function public.shift_touch_updated_at();

alter table public.shift_line_group_mappings enable row level security;
revoke all on public.shift_line_group_mappings from public, anon, authenticated;
grant select, insert, update, delete on public.shift_line_group_mappings to service_role;

