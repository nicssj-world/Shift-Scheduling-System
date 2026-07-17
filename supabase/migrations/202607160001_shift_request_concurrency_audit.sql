-- Atomic swap/sale reservations, transactional apply, and durable audit history.
-- This migration is intentionally idempotent and safe to re-run.

begin;

-- Every assignment mutation bumps the containing roster version. Approval code
-- validates against a version and the RPC refuses to apply stale validation.
alter table public.shift_schedules
  add column if not exists assignment_version bigint not null default 0;

create or replace function public.shift_bump_assignment_version_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.shift_schedules s
  set assignment_version = s.assignment_version + 1
  where s.id in (select distinct n.schedule_id from new_assignment_rows n);
  return null;
end;
$$;

create or replace function public.shift_bump_assignment_version_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.shift_schedules s
  set assignment_version = s.assignment_version + 1
  where s.id in (
    select schedule_id from new_assignment_rows
    union
    select schedule_id from old_assignment_rows
  );
  return null;
end;
$$;

create or replace function public.shift_bump_assignment_version_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.shift_schedules s
  set assignment_version = s.assignment_version + 1
  where s.id in (select distinct o.schedule_id from old_assignment_rows o);
  return null;
end;
$$;

drop trigger if exists shift_assignments_version_insert on public.shift_assignments;
create trigger shift_assignments_version_insert
after insert on public.shift_assignments
referencing new table as new_assignment_rows
for each statement execute function public.shift_bump_assignment_version_insert();

drop trigger if exists shift_assignments_version_update on public.shift_assignments;
create trigger shift_assignments_version_update
after update on public.shift_assignments
referencing old table as old_assignment_rows new table as new_assignment_rows
for each statement execute function public.shift_bump_assignment_version_update();

drop trigger if exists shift_assignments_version_delete on public.shift_assignments;
create trigger shift_assignments_version_delete
after delete on public.shift_assignments
referencing old table as old_assignment_rows
for each statement execute function public.shift_bump_assignment_version_delete();

-- Contains active reservations only. The assignment PK is the concurrency
-- gate: exactly one pending swap/sale can own an assignment at a time.
create table if not exists public.shift_assignment_reservations (
  assignment_id uuid primary key references public.shift_assignments(id) on delete cascade,
  request_kind text not null check (request_kind in ('swap', 'sale')),
  request_id uuid not null,
  reserved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists shift_assignment_reservations_request_idx
  on public.shift_assignment_reservations (request_kind, request_id);

alter table public.shift_assignment_reservations enable row level security;
revoke all on public.shift_assignment_reservations from anon, authenticated;
grant select, insert, update, delete on public.shift_assignment_reservations to service_role;

-- Append-only audit trail. Request rows remain the current snapshot; this
-- table records every status transition and survives independently.
create table if not exists public.shift_request_events (
  id bigint generated always as identity primary key,
  request_kind text not null check (request_kind in ('swap', 'sale')),
  request_id uuid not null,
  event_type text not null check (event_type in ('created', 'status_changed', 'backfilled')),
  actor_id uuid references public.profiles(id) on delete set null,
  from_status text,
  to_status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists shift_request_events_request_idx
  on public.shift_request_events (request_kind, request_id, created_at, id);
create index if not exists shift_request_events_created_idx
  on public.shift_request_events (created_at desc, id desc);

alter table public.shift_request_events enable row level security;
revoke all on public.shift_request_events from anon, authenticated;
grant select, insert on public.shift_request_events to service_role;
grant usage, select on sequence public.shift_request_events_id_seq to service_role;

create or replace function public.shift_request_actor(fallback_actor uuid)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  actor_setting text;
begin
  actor_setting := current_setting('shift.request_actor', true);
  if actor_setting is not null and actor_setting <> '' then
    return actor_setting::uuid;
  end if;
  return fallback_actor;
exception when invalid_text_representation then
  return fallback_actor;
end;
$$;

create or replace function public.shift_audit_swap_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fallback_actor uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.shift_request_events
      (request_kind, request_id, event_type, actor_id, from_status, to_status, metadata, created_at)
    values
      ('swap', new.id, 'created', public.shift_request_actor(new.requester_id), null, new.status,
       jsonb_build_object(
         'requester_assignment_id', new.requester_assignment_id,
         'target_assignment_id', new.target_assignment_id,
         'requester_id', new.requester_id,
         'target_user_id', new.target_user_id
       ), new.created_at);
    return new;
  end if;

  if old.status is not distinct from new.status then return new; end if;
  fallback_actor := case
    when new.decided_by is distinct from old.decided_by then new.decided_by
    when new.status in ('pending_approval', 'declined') then new.target_user_id
    when new.status = 'cancelled' then new.requester_id
    else null
  end;
  insert into public.shift_request_events
    (request_kind, request_id, event_type, actor_id, from_status, to_status)
  values
    ('swap', new.id, 'status_changed', public.shift_request_actor(fallback_actor), old.status, new.status);
  return new;
end;
$$;

create or replace function public.shift_audit_sale_request()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fallback_actor uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.shift_request_events
      (request_kind, request_id, event_type, actor_id, from_status, to_status, metadata, created_at)
    values
      ('sale', new.id, 'created', public.shift_request_actor(new.seller_id), null, new.status,
       jsonb_build_object('seller_id', new.seller_id, 'buyer_id', new.buyer_id), new.created_at);
    return new;
  end if;

  if old.status is not distinct from new.status then return new; end if;
  fallback_actor := case
    when new.decided_by is distinct from old.decided_by then new.decided_by
    when new.status in ('pending_approval', 'declined') then new.buyer_id
    when new.status = 'cancelled' then new.seller_id
    else null
  end;
  insert into public.shift_request_events
    (request_kind, request_id, event_type, actor_id, from_status, to_status)
  values
    ('sale', new.id, 'status_changed', public.shift_request_actor(fallback_actor), old.status, new.status);
  return new;
end;
$$;

drop trigger if exists shift_swap_requests_audit on public.shift_swap_requests;
create trigger shift_swap_requests_audit
after insert or update of status on public.shift_swap_requests
for each row execute function public.shift_audit_swap_request();

drop trigger if exists shift_sale_requests_audit on public.shift_sale_requests;
create trigger shift_sale_requests_audit
after insert or update of status on public.shift_sale_requests
for each row execute function public.shift_audit_sale_request();

create or replace function public.shift_release_request_reservations()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  kind text;
begin
  kind := case tg_table_name
    when 'shift_swap_requests' then 'swap'
    when 'shift_sale_requests' then 'sale'
  end;
  if old.status like 'pending_%' and new.status not like 'pending_%' then
    delete from public.shift_assignment_reservations
    where request_kind = kind and request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists shift_swap_requests_release_reservations on public.shift_swap_requests;
create trigger shift_swap_requests_release_reservations
after update of status on public.shift_swap_requests
for each row execute function public.shift_release_request_reservations();

drop trigger if exists shift_sale_requests_release_reservations on public.shift_sale_requests;
create trigger shift_sale_requests_release_reservations
after update of status on public.shift_sale_requests
for each row execute function public.shift_release_request_reservations();

-- Historical requests must never disappear because an assignment is deleted.
alter table public.shift_swap_requests
  drop constraint if exists shift_swap_requests_requester_assignment_id_fkey;
alter table public.shift_swap_requests
  add constraint shift_swap_requests_requester_assignment_id_fkey
  foreign key (requester_assignment_id) references public.shift_assignments(id) on delete restrict;
alter table public.shift_swap_requests
  drop constraint if exists shift_swap_requests_target_assignment_id_fkey;
alter table public.shift_swap_requests
  add constraint shift_swap_requests_target_assignment_id_fkey
  foreign key (target_assignment_id) references public.shift_assignments(id) on delete restrict;
alter table public.shift_sale_items
  drop constraint if exists shift_sale_items_assignment_id_fkey;
alter table public.shift_sale_items
  add constraint shift_sale_items_assignment_id_fkey
  foreign key (assignment_id) references public.shift_assignments(id) on delete restrict;

create or replace function public.shift_prevent_request_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'ประวัติคำขอแลก/ขายเวรห้ามลบ ให้เปลี่ยนสถานะแทน';
end;
$$;

drop trigger if exists shift_swap_requests_prevent_delete on public.shift_swap_requests;
create trigger shift_swap_requests_prevent_delete
before delete on public.shift_swap_requests
for each row execute function public.shift_prevent_request_delete();
drop trigger if exists shift_sale_requests_prevent_delete on public.shift_sale_requests;
create trigger shift_sale_requests_prevent_delete
before delete on public.shift_sale_requests
for each row execute function public.shift_prevent_request_delete();

-- History indexes match the participant filters and descending time order used
-- by the API. They remain compact enough for long-term retention.
create index if not exists shift_swaps_requester_history_idx
  on public.shift_swap_requests (requester_id, created_at desc, id);
create index if not exists shift_swaps_target_history_idx
  on public.shift_swap_requests (target_user_id, created_at desc, id);
create index if not exists shift_swaps_created_history_idx
  on public.shift_swap_requests (created_at desc, id);
create index if not exists shift_sales_seller_history_idx
  on public.shift_sale_requests (seller_id, created_at desc, id);
create index if not exists shift_sales_buyer_history_idx
  on public.shift_sale_requests (buyer_id, created_at desc, id);
create index if not exists shift_sales_created_history_idx
  on public.shift_sale_requests (created_at desc, id);

-- Atomically create a swap and reserve both assignments. Sorted lock/insert
-- order prevents A<->B and B<->A requests from deadlocking.
create or replace function public.shift_create_swap_request(
  p_requester_assignment_id uuid,
  p_target_assignment_id uuid,
  p_requester_id uuid,
  p_target_user_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requester_assignment public.shift_assignments%rowtype;
  target_assignment public.shift_assignments%rowtype;
  request_row public.shift_swap_requests%rowtype;
  schedule_status text;
begin
  if p_requester_assignment_id = p_target_assignment_id then
    raise exception using errcode = 'P0001', message = 'ต้องเลือกเวรคนละรายการ';
  end if;

  perform a.id from public.shift_assignments a
  where a.id in (p_requester_assignment_id, p_target_assignment_id)
  order by a.id for update;
  select * into requester_assignment from public.shift_assignments where id = p_requester_assignment_id;
  select * into target_assignment from public.shift_assignments where id = p_target_assignment_id;
  if requester_assignment.id is null or target_assignment.id is null then
    raise exception using errcode = 'P0001', message = 'ไม่พบเวรที่เลือก';
  end if;
  if requester_assignment.user_id <> p_requester_id or target_assignment.user_id <> p_target_user_id then
    raise exception using errcode = '40001', message = 'เจ้าของเวรมีการเปลี่ยนแปลง กรุณารีเฟรช';
  end if;
  if requester_assignment.schedule_id <> target_assignment.schedule_id then
    raise exception using errcode = 'P0001', message = 'แลกเวรได้เฉพาะตารางเดือนเดียวกัน';
  end if;
  if requester_assignment.work_date < (now() at time zone 'Asia/Bangkok')::date
     or target_assignment.work_date < (now() at time zone 'Asia/Bangkok')::date then
    raise exception using errcode = 'P0001', message = 'ไม่สามารถแลกเวรที่ผ่านมาแล้ว';
  end if;
  select status into schedule_status from public.shift_schedules
  where id = requester_assignment.schedule_id for key share;
  if schedule_status is distinct from 'published' then
    raise exception using errcode = 'P0001', message = 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่';
  end if;

  perform set_config('shift.request_actor', p_requester_id::text, true);
  insert into public.shift_swap_requests
    (requester_assignment_id, target_assignment_id, requester_id, target_user_id, reason)
  values
    (p_requester_assignment_id, p_target_assignment_id, p_requester_id, p_target_user_id, p_reason)
  returning * into request_row;

  insert into public.shift_assignment_reservations
    (assignment_id, request_kind, request_id, reserved_by)
  select assignment_id, 'swap', request_row.id, p_requester_id
  from unnest(array[p_requester_assignment_id, p_target_assignment_id]) as u(assignment_id)
  order by assignment_id;

  return request_row.id;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'มีเวรอย่างน้อยหนึ่งรายการอยู่ในคำขอที่รอดำเนินการแล้ว';
end;
$$;

-- Atomically create a sale, its items, and every assignment reservation.
create or replace function public.shift_create_sale_request(
  p_assignment_ids uuid[],
  p_seller_id uuid,
  p_buyer_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_row public.shift_sale_requests%rowtype;
  assignment_count integer;
  distinct_assignment_count integer;
  selected_schedule_id uuid;
  selected_team_id uuid;
  schedule_status text;
begin
  assignment_count := coalesce(cardinality(p_assignment_ids), 0);
  select count(distinct assignment_id) into distinct_assignment_count
  from unnest(p_assignment_ids) as u(assignment_id);
  if assignment_count < 1 or assignment_count > 31 or distinct_assignment_count <> assignment_count then
    raise exception using errcode = 'P0001', message = 'รายการเวรไม่ถูกต้อง';
  end if;
  if p_seller_id = p_buyer_id then
    raise exception using errcode = 'P0001', message = 'ผู้ซื้อต้องไม่ใช่ผู้ขาย';
  end if;

  perform a.id from public.shift_assignments a
  where a.id = any(p_assignment_ids)
  order by a.id for update;
  select count(*), min(a.schedule_id::text)::uuid
  into assignment_count, selected_schedule_id
  from public.shift_assignments a where a.id = any(p_assignment_ids);
  if assignment_count <> cardinality(p_assignment_ids) then
    raise exception using errcode = 'P0001', message = 'ไม่พบเวรที่เลือกบางรายการ';
  end if;
  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(p_assignment_ids) and a.user_id <> p_seller_id
  ) then
    raise exception using errcode = '40001', message = 'เจ้าของเวรมีการเปลี่ยนแปลง กรุณารีเฟรช';
  end if;
  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(p_assignment_ids) and a.schedule_id <> selected_schedule_id
  ) then
    raise exception using errcode = 'P0001', message = 'ขายเวรได้เฉพาะตารางเดือนเดียวกันต่อคำขอ';
  end if;
  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(p_assignment_ids)
      and a.work_date < (now() at time zone 'Asia/Bangkok')::date
  ) then
    raise exception using errcode = 'P0001', message = 'ไม่สามารถขายเวรที่ผ่านมาแล้ว';
  end if;
  select status, team_id into schedule_status, selected_team_id
  from public.shift_schedules where id = selected_schedule_id for key share;
  if schedule_status is distinct from 'published' then
    raise exception using errcode = 'P0001', message = 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่';
  end if;
  if not exists (
    select 1 from public.shift_team_members
    where team_id = selected_team_id and user_id = p_buyer_id and is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'ผู้ซื้อต้องเป็นสมาชิกทีมเดียวกัน';
  end if;

  perform set_config('shift.request_actor', p_seller_id::text, true);
  insert into public.shift_sale_requests (seller_id, buyer_id, reason)
  values (p_seller_id, p_buyer_id, p_reason)
  returning * into request_row;

  insert into public.shift_sale_items (sale_request_id, assignment_id)
  select request_row.id, assignment_id
  from unnest(p_assignment_ids) as u(assignment_id)
  order by assignment_id;

  insert into public.shift_assignment_reservations
    (assignment_id, request_kind, request_id, reserved_by)
  select assignment_id, 'sale', request_row.id, p_seller_id
  from unnest(p_assignment_ids) as u(assignment_id)
  order by assignment_id;

  return request_row.id;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'มีเวรอย่างน้อยหนึ่งรายการอยู่ในคำขอที่รอดำเนินการแล้ว';
end;
$$;

-- Single-statement status transition used for cancel/accept/decline/reject.
-- The expected status predicate makes repeated clicks and concurrent replies
-- idempotent; the status trigger releases reservations on terminal states.
create or replace function public.shift_transition_request(
  p_request_kind text,
  p_request_id uuid,
  p_expected_status text,
  p_new_status text,
  p_actor_id uuid,
  p_responded_at timestamptz default null,
  p_decided_by uuid default null,
  p_decided_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result_id uuid;
begin
  perform set_config('shift.request_actor', p_actor_id::text, true);
  if p_request_kind = 'swap' then
    update public.shift_swap_requests
    set status = p_new_status,
        counterpart_responded_at = coalesce(p_responded_at, counterpart_responded_at),
        decided_by = coalesce(p_decided_by, decided_by),
        decided_at = coalesce(p_decided_at, decided_at)
    where id = p_request_id and status = p_expected_status
    returning id into result_id;
  elsif p_request_kind = 'sale' then
    update public.shift_sale_requests
    set status = p_new_status,
        buyer_responded_at = coalesce(p_responded_at, buyer_responded_at),
        decided_by = coalesce(p_decided_by, decided_by),
        decided_at = coalesce(p_decided_at, decided_at)
    where id = p_request_id and status = p_expected_status
    returning id into result_id;
  else
    raise exception using errcode = 'P0001', message = 'ประเภทคำขอไม่ถูกต้อง';
  end if;
  if result_id is null then
    raise exception using errcode = '40001', message = 'สถานะคำขอมีการเปลี่ยนแปลง กรุณารีเฟรช';
  end if;
  return result_id;
end;
$$;

-- Apply and approve a swap in one database transaction. Assignment rows are
-- locked in UUID order; the schedule version protects the preceding hard-rule
-- validation from becoming stale while 31 users act concurrently.
create or replace function public.shift_apply_swap_request(
  p_request_id uuid,
  p_expected_status text,
  p_expected_schedule_version bigint,
  p_actor_id uuid,
  p_decided_by uuid default null,
  p_responded_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_row public.shift_swap_requests%rowtype;
  requester_assignment public.shift_assignments%rowtype;
  target_assignment public.shift_assignments%rowtype;
  current_version bigint;
  schedule_status text;
  result_id uuid;
begin
  select * into request_row from public.shift_swap_requests
  where id = p_request_id for update;
  if request_row.id is null then
    raise exception using errcode = 'P0001', message = 'ไม่พบคำขอแลกเวร';
  end if;
  if request_row.status <> p_expected_status then
    raise exception using errcode = '40001', message = 'สถานะคำขอมีการเปลี่ยนแปลง กรุณารีเฟรช';
  end if;

  perform a.id from public.shift_assignments a
  where a.id in (request_row.requester_assignment_id, request_row.target_assignment_id)
  order by a.id for update;
  select * into requester_assignment from public.shift_assignments where id = request_row.requester_assignment_id;
  select * into target_assignment from public.shift_assignments where id = request_row.target_assignment_id;
  if requester_assignment.id is null or target_assignment.id is null then
    raise exception using errcode = 'P0001', message = 'เวรที่ขอแลกไม่อยู่ในตารางแล้ว';
  end if;
  if requester_assignment.user_id <> request_row.requester_id
     or target_assignment.user_id <> request_row.target_user_id then
    raise exception using errcode = '40001', message = 'เจ้าของเวรมีการเปลี่ยนแปลง กรุณาสร้างคำขอใหม่';
  end if;
  if requester_assignment.schedule_id <> target_assignment.schedule_id then
    raise exception using errcode = 'P0001', message = 'เวรคู่แลกไม่ได้อยู่ในตารางเดียวกัน';
  end if;
  if requester_assignment.work_date < (now() at time zone 'Asia/Bangkok')::date
     or target_assignment.work_date < (now() at time zone 'Asia/Bangkok')::date then
    raise exception using errcode = 'P0001', message = 'ไม่สามารถแลกเวรที่ผ่านมาแล้ว';
  end if;

  select assignment_version, status into current_version, schedule_status
  from public.shift_schedules where id = requester_assignment.schedule_id for update;
  if schedule_status is distinct from 'published' then
    raise exception using errcode = 'P0001', message = 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่';
  end if;
  if current_version <> p_expected_schedule_version then
    raise exception using errcode = '40001', message = 'ตารางเวรมีการเปลี่ยนแปลงระหว่างตรวจสอบ กรุณาลองใหม่';
  end if;

  perform set_config('shift.request_actor', p_actor_id::text, true);
  update public.shift_assignments
  set user_id = case id
        when request_row.requester_assignment_id then request_row.target_user_id
        when request_row.target_assignment_id then request_row.requester_id
      end,
      source = 'swap', updated_at = now()
  where id in (request_row.requester_assignment_id, request_row.target_assignment_id);

  update public.shift_swap_requests
  set status = 'approved',
      counterpart_responded_at = coalesce(p_responded_at, counterpart_responded_at),
      decided_by = coalesce(p_decided_by, decided_by),
      decided_at = now()
  where id = p_request_id and status = p_expected_status
  returning id into result_id;
  if result_id is null then
    raise exception using errcode = '40001', message = 'สถานะคำขอมีการเปลี่ยนแปลง กรุณารีเฟรช';
  end if;
  return result_id;
end;
$$;

create or replace function public.shift_apply_sale_request(
  p_request_id uuid,
  p_expected_status text,
  p_expected_schedule_version bigint,
  p_actor_id uuid,
  p_decided_by uuid default null,
  p_responded_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_row public.shift_sale_requests%rowtype;
  assignment_ids uuid[];
  selected_schedule_id uuid;
  current_version bigint;
  schedule_status text;
  result_id uuid;
begin
  select * into request_row from public.shift_sale_requests
  where id = p_request_id for update;
  if request_row.id is null then
    raise exception using errcode = 'P0001', message = 'ไม่พบคำขอขายเวร';
  end if;
  if request_row.status <> p_expected_status then
    raise exception using errcode = '40001', message = 'สถานะคำขอมีการเปลี่ยนแปลง กรุณารีเฟรช';
  end if;

  select array_agg(i.assignment_id order by i.assignment_id) into assignment_ids
  from public.shift_sale_items i where i.sale_request_id = p_request_id;
  if coalesce(cardinality(assignment_ids), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'ไม่มีเวรในคำขอนี้';
  end if;
  perform a.id from public.shift_assignments a
  where a.id = any(assignment_ids) order by a.id for update;
  if (select count(*) from public.shift_assignments where id = any(assignment_ids)) <> cardinality(assignment_ids) then
    raise exception using errcode = 'P0001', message = 'เวรบางรายการไม่อยู่ในตารางแล้ว';
  end if;
  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(assignment_ids) and a.user_id <> request_row.seller_id
  ) then
    raise exception using errcode = '40001', message = 'เจ้าของเวรมีการเปลี่ยนแปลง กรุณาสร้างคำขอใหม่';
  end if;
  select min(schedule_id::text)::uuid into selected_schedule_id
  from public.shift_assignments where id = any(assignment_ids);
  if exists (
    select 1 from public.shift_assignments
    where id = any(assignment_ids) and schedule_id <> selected_schedule_id
  ) then
    raise exception using errcode = 'P0001', message = 'เวรที่ขายไม่ได้อยู่ในตารางเดียวกัน';
  end if;
  if exists (
    select 1 from public.shift_assignments
    where id = any(assignment_ids) and work_date < (now() at time zone 'Asia/Bangkok')::date
  ) then
    raise exception using errcode = 'P0001', message = 'ไม่สามารถขายเวรที่ผ่านมาแล้ว';
  end if;

  select assignment_version, status into current_version, schedule_status
  from public.shift_schedules where id = selected_schedule_id for update;
  if schedule_status is distinct from 'published' then
    raise exception using errcode = 'P0001', message = 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่';
  end if;
  if current_version <> p_expected_schedule_version then
    raise exception using errcode = '40001', message = 'ตารางเวรมีการเปลี่ยนแปลงระหว่างตรวจสอบ กรุณาลองใหม่';
  end if;

  perform set_config('shift.request_actor', p_actor_id::text, true);
  update public.shift_assignments
  set user_id = request_row.buyer_id, source = 'sale', updated_at = now()
  where id = any(assignment_ids);

  update public.shift_sale_requests
  set status = 'approved',
      buyer_responded_at = coalesce(p_responded_at, buyer_responded_at),
      decided_by = coalesce(p_decided_by, decided_by),
      decided_at = now()
  where id = p_request_id and status = p_expected_status
  returning id into result_id;
  if result_id is null then
    raise exception using errcode = '40001', message = 'สถานะคำขอมีการเปลี่ยนแปลง กรุณารีเฟรช';
  end if;
  return result_id;
end;
$$;

-- Functions are server-only. Explicit grants are required by newer Supabase
-- Data API defaults and prevent browser clients from bypassing API checks.
revoke execute on function public.shift_request_actor(uuid) from public, anon, authenticated;
revoke execute on function public.shift_create_swap_request(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.shift_create_sale_request(uuid[], uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.shift_transition_request(text, uuid, text, text, uuid, timestamptz, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.shift_apply_swap_request(uuid, text, bigint, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.shift_apply_sale_request(uuid, text, bigint, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.shift_request_actor(uuid) to service_role;
grant execute on function public.shift_create_swap_request(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.shift_create_sale_request(uuid[], uuid, uuid, text) to service_role;
grant execute on function public.shift_transition_request(text, uuid, text, text, uuid, timestamptz, uuid, timestamptz) to service_role;
grant execute on function public.shift_apply_swap_request(uuid, text, bigint, uuid, uuid, timestamptz) to service_role;
grant execute on function public.shift_apply_sale_request(uuid, text, bigint, uuid, uuid, timestamptz) to service_role;

-- Preserve existing history and seed audit events once for pre-migration rows.
insert into public.shift_request_events
  (request_kind, request_id, event_type, actor_id, from_status, to_status, metadata, created_at)
select 'swap', r.id, 'backfilled', r.requester_id, null, r.status, '{"pre_migration":true}'::jsonb, r.created_at
from public.shift_swap_requests r
where not exists (
  select 1 from public.shift_request_events e
  where e.request_kind = 'swap' and e.request_id = r.id
);
insert into public.shift_request_events
  (request_kind, request_id, event_type, actor_id, from_status, to_status, metadata, created_at)
select 'sale', r.id, 'backfilled', r.seller_id, null, r.status, '{"pre_migration":true}'::jsonb, r.created_at
from public.shift_sale_requests r
where not exists (
  select 1 from public.shift_request_events e
  where e.request_kind = 'sale' and e.request_id = r.id
);

-- Backfill active reservations. The verification block refuses to silently
-- accept any conflict created before this migration.
insert into public.shift_assignment_reservations (assignment_id, request_kind, request_id, reserved_by, created_at)
select assignment_id, 'swap', request_id, requester_id, created_at
from (
  select r.requester_assignment_id assignment_id, r.id request_id, r.requester_id, r.created_at
  from public.shift_swap_requests r where r.status in ('pending_counterpart', 'pending_approval')
  union all
  select r.target_assignment_id, r.id, r.requester_id, r.created_at
  from public.shift_swap_requests r where r.status in ('pending_counterpart', 'pending_approval')
) active_swaps
order by created_at, assignment_id
on conflict (assignment_id) do nothing;

insert into public.shift_assignment_reservations (assignment_id, request_kind, request_id, reserved_by, created_at)
select i.assignment_id, 'sale', r.id, r.seller_id, r.created_at
from public.shift_sale_requests r
join public.shift_sale_items i on i.sale_request_id = r.id
where r.status in ('pending_buyer', 'pending_approval')
order by r.created_at, i.assignment_id
on conflict (assignment_id) do nothing;

do $$
begin
  if exists (
    select 1
    from (
      select r.id request_id, 'swap' kind, r.requester_assignment_id assignment_id
      from public.shift_swap_requests r where r.status in ('pending_counterpart', 'pending_approval')
      union all
      select r.id, 'swap', r.target_assignment_id
      from public.shift_swap_requests r where r.status in ('pending_counterpart', 'pending_approval')
      union all
      select r.id, 'sale', i.assignment_id
      from public.shift_sale_requests r join public.shift_sale_items i on i.sale_request_id = r.id
      where r.status in ('pending_buyer', 'pending_approval')
    ) pending
    left join public.shift_assignment_reservations ar
      on ar.assignment_id = pending.assignment_id
     and ar.request_kind = pending.kind
     and ar.request_id = pending.request_id
    where ar.assignment_id is null
  ) then
    raise exception 'พบเวรซ้ำในคำขอที่กำลังรอดำเนินการ กรุณายกเลิกคำขอซ้ำก่อนรัน migration';
  end if;
end;
$$;

commit;
