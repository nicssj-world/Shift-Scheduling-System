-- Open-sale marketplace: one listing may contain up to 31 future assignments
-- across months, provided every assignment belongs to the same team.
-- Run this migration manually in the Supabase SQL editor. Every statement is
-- intentionally idempotent so it is safe to paste/run again.

begin;

-- The feature is disabled by default. Preserve any existing sale settings and
-- only add the missing flag on older installations.
insert into public.shift_settings (key, value)
values ('sale', '{"requiresApproval": true, "openEnabled": false}'::jsonb)
on conflict (key) do update
set value = jsonb_set(
  coalesce(shift_settings.value, '{}'::jsonb),
  '{openEnabled}',
  coalesce(shift_settings.value->'openEnabled', 'false'::jsonb),
  true
);

alter table public.shift_sale_requests
  drop constraint if exists shift_sale_requests_status_check;
alter table public.shift_sale_requests
  add constraint shift_sale_requests_status_check
  check (status in ('open','pending_buyer','pending_approval','approved','declined','rejected','cancelled','expired'));

alter table public.shift_sale_items
  add column if not exists status text not null default 'active';
alter table public.shift_sale_items
  add column if not exists expired_at timestamptz;
alter table public.shift_sale_items
  drop constraint if exists shift_sale_items_status_check;
alter table public.shift_sale_items
  add constraint shift_sale_items_status_check
  check (status in ('active','expired'));
create index if not exists shift_sale_items_active_idx
  on public.shift_sale_items (sale_request_id, assignment_id)
  where status = 'active';

alter table public.shift_request_events
  drop constraint if exists shift_request_events_event_type_check;
alter table public.shift_request_events
  add constraint shift_request_events_event_type_check
  check (event_type in ('created','status_changed','backfilled','item_expired'));

-- Create an open sale atomically. Assignment and schedule locks are acquired in
-- UUID order so concurrent creates/claims cannot deadlock one another.
create or replace function public.shift_create_open_sale_request(
  p_assignment_ids uuid[],
  p_seller_id uuid,
  p_reason text default null
)
returns public.shift_sale_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sale_row public.shift_sale_requests%rowtype;
  assignment_count integer;
  schedule_ids uuid[];
  team_ids uuid[];
begin
  if p_assignment_ids is null or cardinality(p_assignment_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'ต้องเลือกเวรอย่างน้อยหนึ่งรายการ';
  end if;
  if cardinality(p_assignment_ids) > 31 then
    raise exception using errcode = 'P0001', message = 'เลือกเวรได้ไม่เกิน 31 รายการต่อประกาศ';
  end if;
  if exists (select 1 from unnest(p_assignment_ids) x group by x having count(*) > 1) then
    raise exception using errcode = 'P0001', message = 'มีรายการเวรซ้ำกัน';
  end if;

  select count(*) into assignment_count
  from public.shift_assignments a
  where a.id = any(p_assignment_ids);
  if assignment_count <> cardinality(p_assignment_ids) then
    raise exception using errcode = 'P0001', message = 'ไม่พบเวรที่เลือกบางรายการ';
  end if;

  perform a.id
  from public.shift_assignments a
  where a.id = any(p_assignment_ids)
  order by a.id
  for update;

  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(p_assignment_ids) and a.user_id <> p_seller_id
  ) then
    raise exception using errcode = 'P0001', message = 'เลือกได้เฉพาะเวรของผู้ขาย';
  end if;
  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(p_assignment_ids)
      and a.work_date < (now() at time zone 'Asia/Bangkok')::date
  ) then
    raise exception using errcode = 'P0001', message = 'ไม่สามารถประกาศเวรที่ผ่านไปแล้ว';
  end if;
  if exists (
    select 1 from public.shift_assignment_reservations r
    where r.assignment_id = any(p_assignment_ids)
  ) then
    raise exception using errcode = '23505', message = 'มีเวรบางรายการอยู่ในคำขออื่นแล้ว';
  end if;

  select array_agg(distinct a.schedule_id order by a.schedule_id)
    into schedule_ids
  from public.shift_assignments a
  where a.id = any(p_assignment_ids);
  select array_agg(distinct s.team_id order by s.team_id)
    into team_ids
  from public.shift_schedules s
  where s.id = any(schedule_ids);
  if coalesce(cardinality(team_ids), 0) <> 1 then
    raise exception using errcode = 'P0001', message = 'ประกาศหนึ่งรายการต้องอยู่ในทีมเดียวกัน';
  end if;

  if exists (
    select 1 from public.shift_schedules s
    where s.id = any(schedule_ids) and s.status <> 'published'
  ) then
    raise exception using errcode = 'P0001', message = 'ประกาศได้เฉพาะตารางเวรที่เผยแพร่แล้ว';
  end if;
  perform s.id
  from public.shift_schedules s
  where s.id = any(schedule_ids)
  order by s.id
  for update;

  insert into public.shift_sale_requests (seller_id, buyer_id, reason, status, sale_mode)
  values (p_seller_id, null, p_reason, 'open', 'open')
  returning * into sale_row;
  insert into public.shift_sale_items (sale_request_id, assignment_id, status)
  select sale_row.id, x, 'active' from unnest(p_assignment_ids) x order by x;
  insert into public.shift_assignment_reservations
    (assignment_id, request_kind, request_id, reserved_by)
  select x, 'sale', sale_row.id, p_seller_id
  from unnest(p_assignment_ids) x
  order by x;
  return sale_row;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'มีเวรบางรายการถูกจองในคำขออื่นแล้ว';
end;
$$;

-- Claim an open sale. p_expected_schedule_versions is a JSON object keyed by
-- schedule UUID; every schedule represented by an active item is checked.
drop function if exists public.shift_claim_open_sale(uuid, uuid, bigint, boolean, uuid);
create or replace function public.shift_claim_open_sale(
  p_request_id uuid,
  p_buyer_id uuid,
  p_expected_schedule_versions jsonb,
  p_requires_approval boolean,
  p_actor_id uuid
)
returns public.shift_sale_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sale_row public.shift_sale_requests%rowtype;
  assignment_ids uuid[];
  schedule_ids uuid[];
  team_ids uuid[];
  schedule_row public.shift_schedules%rowtype;
begin
  select * into sale_row
  from public.shift_sale_requests
  where id = p_request_id
  for update;
  if sale_row.id is null then
    raise exception using errcode = 'P0001', message = 'ไม่พบประกาศขายเวร';
  end if;
  if sale_row.sale_mode <> 'open' or sale_row.status <> 'open' or sale_row.buyer_id is not null then
    raise exception using errcode = '40001', message = 'รายการนี้มีผู้รับไปแล้วหรือหมดอายุ';
  end if;
  if sale_row.seller_id = p_buyer_id or p_actor_id <> p_buyer_id then
    raise exception using errcode = 'P0001', message = 'ผู้ขายรับเวรของตัวเองไม่ได้';
  end if;

  select array_agg(i.assignment_id order by i.assignment_id) into assignment_ids
  from public.shift_sale_items i
  where i.sale_request_id = sale_row.id and i.status = 'active';
  if coalesce(cardinality(assignment_ids), 0) = 0 then
    update public.shift_sale_requests set status = 'expired'
      where id = sale_row.id and status = 'open';
    raise exception using errcode = 'P0001', message = 'ประกาศนี้หมดอายุแล้ว';
  end if;

  perform a.id
  from public.shift_assignments a
  where a.id = any(assignment_ids)
  order by a.id
  for update;
  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(assignment_ids) and a.user_id <> sale_row.seller_id
  ) then
    raise exception using errcode = '40001', message = 'เจ้าของเวรมีการเปลี่ยนแปลง กรุณาโหลดรายการใหม่';
  end if;
  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(assignment_ids)
      and a.work_date < (now() at time zone 'Asia/Bangkok')::date
  ) then
    raise exception using errcode = 'P0001', message = 'ประกาศนี้มีเวรหมดอายุแล้ว กรุณาโหลดรายการใหม่';
  end if;

  select array_agg(distinct a.schedule_id order by a.schedule_id)
    into schedule_ids
  from public.shift_assignments a where a.id = any(assignment_ids);
  select array_agg(distinct s.team_id order by s.team_id)
    into team_ids
  from public.shift_schedules s where s.id = any(schedule_ids);
  if coalesce(cardinality(team_ids), 0) <> 1 then
    raise exception using errcode = 'P0001', message = 'ประกาศนี้มีมากกว่าหนึ่งทีม';
  end if;
  for schedule_row in
    select * from public.shift_schedules s
    where s.id = any(schedule_ids) order by s.id for update
  loop
    if schedule_row.status <> 'published' then
      raise exception using errcode = 'P0001', message = 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่';
    end if;
    if p_expected_schedule_versions is null
      or not (p_expected_schedule_versions ? schedule_row.id::text)
      or (p_expected_schedule_versions->>schedule_row.id::text)::bigint <> schedule_row.assignment_version then
      raise exception using errcode = '40001', message = 'ตารางเวรมีการเปลี่ยนแปลงระหว่างตรวจสอบ กรุณาลองใหม่';
    end if;
  end loop;
  if not exists (
    select 1 from public.shift_team_members tm
    where tm.team_id = team_ids[1] and tm.user_id = p_buyer_id and tm.is_active
  ) then
    raise exception using errcode = '42501', message = 'ผู้รับต้องเป็นสมาชิกทีมของเวรนี้';
  end if;

  perform set_config('shift.request_actor', p_actor_id::text, true);
  if p_requires_approval then
    update public.shift_sale_requests
    set buyer_id = p_buyer_id, accepted_by = p_buyer_id, claimed_at = now(),
        buyer_responded_at = now(), status = 'pending_approval'
    where id = sale_row.id and status = 'open' and buyer_id is null
    returning * into sale_row;
  else
    update public.shift_assignments
    set user_id = p_buyer_id, source = 'sale', updated_at = now()
    where id = any(assignment_ids);
    update public.shift_sale_requests
    set buyer_id = p_buyer_id, accepted_by = p_buyer_id, claimed_at = now(),
        buyer_responded_at = now(), status = 'approved', decided_by = p_actor_id,
        decided_at = now()
    where id = sale_row.id and status = 'open' and buyer_id is null
    returning * into sale_row;
  end if;
  if sale_row.id is null then
    raise exception using errcode = '40001', message = 'มีคนรับประกาศนี้ไปแล้ว กรุณาโหลดรายการใหม่';
  end if;
  return sale_row;
end;
$$;

-- Apply approval for direct sales and open-sale claims. Open requests transfer
-- only active items, leaving expired item history untouched.
drop function if exists public.shift_apply_sale_request(uuid, text, bigint, uuid, uuid, timestamptz);
create or replace function public.shift_apply_sale_request(
  p_request_id uuid,
  p_expected_status text,
  p_expected_schedule_versions jsonb,
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
  schedule_ids uuid[];
  team_ids uuid[];
  schedule_row public.shift_schedules%rowtype;
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
  from public.shift_sale_items i
  where i.sale_request_id = p_request_id
    and (request_row.sale_mode <> 'open' or i.status = 'active');
  if coalesce(cardinality(assignment_ids), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'ไม่มีเวรที่ยังใช้งานได้ในคำขอนี้';
  end if;
  perform a.id from public.shift_assignments a
    where a.id = any(assignment_ids) order by a.id for update;
  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(assignment_ids) and a.user_id <> request_row.seller_id
  ) then
    raise exception using errcode = '40001', message = 'เจ้าของเวรมีการเปลี่ยนแปลง กรุณาสร้างคำขอใหม่';
  end if;
  if exists (
    select 1 from public.shift_assignments a
    where a.id = any(assignment_ids)
      and a.work_date < (now() at time zone 'Asia/Bangkok')::date
  ) then
    raise exception using errcode = 'P0001', message = 'ไม่สามารถโอนเวรที่ผ่านไปแล้ว';
  end if;

  select array_agg(distinct a.schedule_id order by a.schedule_id) into schedule_ids
    from public.shift_assignments a where a.id = any(assignment_ids);
  select array_agg(distinct s.team_id order by s.team_id) into team_ids
    from public.shift_schedules s where s.id = any(schedule_ids);
  if coalesce(cardinality(team_ids), 0) <> 1 then
    raise exception using errcode = 'P0001', message = 'เวรที่ขายต้องอยู่ในทีมเดียวกัน';
  end if;
  for schedule_row in
    select * from public.shift_schedules s
    where s.id = any(schedule_ids) order by s.id for update
  loop
    if schedule_row.status <> 'published' then
      raise exception using errcode = 'P0001', message = 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่';
    end if;
    if p_expected_schedule_versions is null
      or not (p_expected_schedule_versions ? schedule_row.id::text)
      or (p_expected_schedule_versions->>schedule_row.id::text)::bigint <> schedule_row.assignment_version then
      raise exception using errcode = '40001', message = 'ตารางเวรมีการเปลี่ยนแปลงระหว่างตรวจสอบ กรุณาลองใหม่';
    end if;
  end loop;
  if request_row.buyer_id is null then
    raise exception using errcode = 'P0001', message = 'ไม่พบผู้รับเวร';
  end if;
  if not exists (
    select 1 from public.shift_team_members tm
    where tm.team_id = team_ids[1] and tm.user_id = request_row.buyer_id and tm.is_active
  ) then
    raise exception using errcode = '42501', message = 'ผู้รับต้องเป็นสมาชิกทีมของเวรนี้';
  end if;

  perform set_config('shift.request_actor', p_actor_id::text, true);
  update public.shift_assignments
  set user_id = request_row.buyer_id, source = 'sale', updated_at = now()
  where id = any(assignment_ids);
  update public.shift_sale_requests
  set status = 'approved', buyer_responded_at = coalesce(p_responded_at, buyer_responded_at),
      decided_by = coalesce(p_decided_by, decided_by), decided_at = now()
  where id = p_request_id and status = p_expected_status
  returning id into result_id;
  if result_id is null then
    raise exception using errcode = '40001', message = 'สถานะคำขอมีการเปลี่ยนแปลง กรุณารีเฟรช';
  end if;
  return result_id;
end;
$$;

-- Mark only past open-sale items as expired. The request and item rows remain
-- available for audit/history; reservations for expired items are released.
create or replace function public.shift_expire_open_sale_items(
  p_as_of_date date default (now() at time zone 'Asia/Bangkok')::date
)
returns table(expired_items integer, expired_requests integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sale_row record;
  expired_ids uuid[];
  item_count integer;
  request_count integer := 0;
begin
  for sale_row in
    select r.id, r.status
    from public.shift_sale_requests r
    where r.sale_mode = 'open' and r.status in ('open', 'pending_approval')
      and exists (
        select 1 from public.shift_sale_items i
        join public.shift_assignments a on a.id = i.assignment_id
        where i.sale_request_id = r.id and i.status = 'active' and a.work_date < p_as_of_date
      )
    order by r.id
    for update of r
  loop
    select array_agg(i.assignment_id order by i.assignment_id) into expired_ids
    from public.shift_sale_items i
    join public.shift_assignments a on a.id = i.assignment_id
    where i.sale_request_id = sale_row.id and i.status = 'active' and a.work_date < p_as_of_date;
    if coalesce(cardinality(expired_ids), 0) = 0 then continue; end if;

    update public.shift_sale_items
    set status = 'expired', expired_at = now()
    where sale_request_id = sale_row.id and assignment_id = any(expired_ids) and status = 'active';
    get diagnostics item_count = row_count;
    expired_items := coalesce(expired_items, 0) + item_count;
    delete from public.shift_assignment_reservations
    where request_kind = 'sale' and request_id = sale_row.id and assignment_id = any(expired_ids);
    insert into public.shift_request_events
      (request_kind, request_id, event_type, actor_id, from_status, to_status, metadata)
    values
      ('sale', sale_row.id, 'item_expired', null, sale_row.status, sale_row.status,
       jsonb_build_object('assignment_ids', expired_ids, 'expired_count', item_count, 'as_of_date', p_as_of_date));

    if not exists (
      select 1 from public.shift_sale_items i
      where i.sale_request_id = sale_row.id and i.status = 'active'
    ) then
      update public.shift_sale_requests
      set status = 'expired', decided_at = now()
      where id = sale_row.id and status in ('open', 'pending_approval');
      request_count := request_count + 1;
    end if;
  end loop;
  return query select coalesce(expired_items, 0), request_count;
end;
$$;

revoke execute on function public.shift_create_open_sale_request(uuid[], uuid, text) from public, anon, authenticated;
revoke execute on function public.shift_claim_open_sale(uuid, uuid, jsonb, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.shift_apply_sale_request(uuid, text, jsonb, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.shift_expire_open_sale_items(date) from public, anon, authenticated;
grant execute on function public.shift_create_open_sale_request(uuid[], uuid, text) to service_role;
grant execute on function public.shift_claim_open_sale(uuid, uuid, jsonb, boolean, uuid) to service_role;
grant execute on function public.shift_apply_sale_request(uuid, text, jsonb, uuid, uuid, timestamptz) to service_role;
grant execute on function public.shift_expire_open_sale_items(date) to service_role;

commit;
