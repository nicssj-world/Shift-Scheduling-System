-- Per-member Central Lab section preferences.
--
-- The columns live on the team-members roster because the preference belongs
-- to a person's assignment in this scheduling team, not to their shared
-- profile.  They are intentionally present for every team member row so an
-- existing installation can be migrated in place; the scheduler only reads
-- them for MT_CENTRAL.

alter table public.shift_team_members
  add column if not exists chem_sero_weight smallint not null default 50,
  add column if not exists hemato_micros_weight smallint not null default 50;

-- A previous partial/manual attempt must not leave nulls behind before the
-- constraints are installed.  This is a no-op for a fresh migration.
update public.shift_team_members
set chem_sero_weight = coalesce(chem_sero_weight, 50),
    hemato_micros_weight = coalesce(hemato_micros_weight, 50)
where chem_sero_weight is null or hemato_micros_weight is null;

alter table public.shift_team_members
  alter column chem_sero_weight set default 50,
  alter column hemato_micros_weight set default 50,
  alter column chem_sero_weight set not null,
  alter column hemato_micros_weight set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shift_team_members'::regclass
      and conname = 'shift_team_members_chem_sero_weight_range'
  ) then
    alter table public.shift_team_members
      add constraint shift_team_members_chem_sero_weight_range
      check (chem_sero_weight between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shift_team_members'::regclass
      and conname = 'shift_team_members_hemato_micros_weight_range'
  ) then
    alter table public.shift_team_members
      add constraint shift_team_members_hemato_micros_weight_range
      check (hemato_micros_weight between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shift_team_members'::regclass
      and conname = 'shift_team_members_section_weights_sum'
  ) then
    alter table public.shift_team_members
      add constraint shift_team_members_section_weights_sum
      check (chem_sero_weight + hemato_micros_weight = 100);
  end if;
end $$;
