-- Restrict project-management writes to Admin and explicitly designated
-- schedulers.  Manager remains view-only unless an Admin adds that person to
-- shift_schedulers.

-- Keep the legacy helper from granting Manager write access to old policies.
-- Scheduling policies use shift_is_scheduler below; leave policies that still
-- reference this helper therefore remain Admin-only, as attendance has its
-- own recorder permission list.
create or replace function public.shift_is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select public.shift_is_admin();
$$;

create or replace function public.shift_is_scheduler() returns boolean
language sql stable security definer set search_path = public as $$
  select public.shift_is_admin() or exists (
    select 1 from public.shift_schedulers where user_id = auth.uid()
  );
$$;

-- Reference-data administration is part of project management.  Recreate the
-- policies because the original core migration used shift_is_manager(), which
-- historically included the Manager profile role.
do $$
declare t text;
begin
  foreach t in array array[
    'shift_teams', 'shift_team_members', 'shift_shift_types',
    'shift_requirements', 'shift_jobs', 'shift_holidays'
  ] loop
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated using (public.shift_is_scheduler()) with check (public.shift_is_scheduler())',
      t, t
    );
  end loop;
end $$;

-- System settings (including scheduler/sale rules and the delegation lists)
-- remain reserved for the actual Admin role.
drop policy if exists shift_settings_write on public.shift_settings;
create policy shift_settings_write on public.shift_settings for all to authenticated
  using (public.shift_is_admin()) with check (public.shift_is_admin());

-- Do not expose the system-settings values or scheduler delegation list to a
-- designated scheduler through a direct Supabase client either.
drop policy if exists shift_settings_read on public.shift_settings;
create policy shift_settings_read on public.shift_settings for select to authenticated
  using (public.shift_is_admin());

drop policy if exists shift_schedulers_read on public.shift_schedulers;
create policy shift_schedulers_read on public.shift_schedulers for select to authenticated
  using (public.shift_is_admin());
