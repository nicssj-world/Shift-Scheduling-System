-- Realtime-safe view of active assignment reservations.
-- Deliberately exposes assignment_id only; request identity and actor details
-- remain service-role-only in shift_assignment_reservations.

begin;

create table if not exists public.shift_assignment_live_locks (
  assignment_id uuid primary key references public.shift_assignments(id) on delete cascade
);

alter table public.shift_assignment_live_locks enable row level security;
revoke all on public.shift_assignment_live_locks from anon, authenticated;
grant select on public.shift_assignment_live_locks to authenticated, service_role;

drop policy if exists shift_assignment_live_locks_read on public.shift_assignment_live_locks;
create policy shift_assignment_live_locks_read
  on public.shift_assignment_live_locks
  for select to authenticated
  using (true);

create or replace function public.shift_sync_assignment_live_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.shift_assignment_live_locks (assignment_id)
    values (new.assignment_id)
    on conflict (assignment_id) do nothing;
    return new;
  end if;

  delete from public.shift_assignment_live_locks
  where assignment_id = old.assignment_id;
  return old;
end;
$$;

drop trigger if exists shift_assignment_reservations_live_lock_insert
  on public.shift_assignment_reservations;
create trigger shift_assignment_reservations_live_lock_insert
after insert on public.shift_assignment_reservations
for each row execute function public.shift_sync_assignment_live_lock();

drop trigger if exists shift_assignment_reservations_live_lock_delete
  on public.shift_assignment_reservations;
create trigger shift_assignment_reservations_live_lock_delete
after delete on public.shift_assignment_reservations
for each row execute function public.shift_sync_assignment_live_lock();

-- Backfill any active reservations created before this migration.
insert into public.shift_assignment_live_locks (assignment_id)
select assignment_id
from public.shift_assignment_reservations
on conflict (assignment_id) do nothing;

do $$
begin
  alter publication supabase_realtime add table public.shift_assignment_live_locks;
exception when duplicate_object then null;
end $$;

commit;
