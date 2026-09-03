-- LINE integration foundation.
-- This project shares its Supabase database with lab-management-portal:
-- never alter profiles or its RLS policies. All new objects are shift_*
-- namespaced and are private to the server/service role.

create extension if not exists pgcrypto;

-- Existing direct-sale rows remain direct and keep their current behaviour.
alter table public.shift_sale_requests
  add column if not exists sale_mode text not null default 'direct';
alter table public.shift_sale_requests
  add column if not exists claimed_at timestamptz;
alter table public.shift_sale_requests
  add column if not exists accepted_by uuid references public.profiles(id);
alter table public.shift_sale_requests
  alter column buyer_id drop not null;
alter table public.shift_sale_requests drop constraint if exists shift_sale_requests_sale_mode_check;
alter table public.shift_sale_requests add constraint shift_sale_requests_sale_mode_check
  check (sale_mode in ('direct', 'open'));
alter table public.shift_sale_requests drop constraint if exists shift_sale_requests_status_check;
alter table public.shift_sale_requests add constraint shift_sale_requests_status_check
  check (status in ('open','pending_buyer','pending_approval','approved','declined','rejected','cancelled'));
create index if not exists shift_sales_open_idx
  on public.shift_sale_requests (created_at desc) where sale_mode = 'open' and status = 'open';

create table if not exists public.shift_line_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  line_user_id text not null unique,
  status text not null default 'active' check (status in ('active','disabled','blocked')),
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shift_line_account_link_nonces (
  id uuid primary key default gen_random_uuid(),
  nonce_hash text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  link_token text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shift_line_link_nonce_expiry_idx
  on public.shift_line_account_link_nonces (expires_at) where used_at is null;

create table if not exists public.shift_line_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.shift_line_accounts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  line_user_id text not null,
  token_hash text not null unique,
  csrf_hash text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shift_line_sessions_user_idx
  on public.shift_line_sessions (user_id) where revoked_at is null;
create index if not exists shift_line_sessions_expiry_idx
  on public.shift_line_sessions (expires_at) where revoked_at is null;

create table if not exists public.shift_line_groups (
  id uuid primary key default gen_random_uuid(),
  line_group_id text not null unique,
  name text,
  group_type text not null default 'group' check (group_type in ('user','group','room')),
  is_approved boolean not null default false,
  is_active boolean not null default false,
  daily_roster_enabled boolean not null default false,
  show_phone_in_daily_roster boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shift_line_notification_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  shift_reminder_enabled boolean not null default true,
  swap_notification_enabled boolean not null default true,
  sale_notification_enabled boolean not null default true,
  daily_summary_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.shift_line_webhook_events (
  id uuid primary key default gen_random_uuid(),
  webhook_event_id text not null unique,
  event_type text,
  source_type text,
  line_user_id text,
  line_group_id text,
  status text not null default 'pending' check (status in ('pending','processing','processed','failed')),
  attempts int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  error_code text,
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.shift_line_webhook_events add column if not exists updated_at timestamptz not null default now();
create index if not exists shift_line_webhook_pending_idx
  on public.shift_line_webhook_events (created_at) where status in ('pending','failed');

create table if not exists public.shift_line_message_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_type text not null check (recipient_type in ('user','group','room')),
  line_user_id text,
  line_group_id text,
  message_type text not null,
  reference_type text,
  reference_id text,
  dedupe_key text unique,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','dead')),
  payload jsonb,
  response_status int,
  error_code text,
  error_message text,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shift_line_message_queue_idx
  on public.shift_line_message_logs (next_attempt_at, created_at) where status in ('queued','failed');
create index if not exists shift_line_message_reference_idx
  on public.shift_line_message_logs (reference_type, reference_id, created_at desc);

create table if not exists public.shift_line_audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  source text not null check (source in ('web','line','admin','system')),
  action text not null,
  reference_type text,
  reference_id text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index if not exists shift_line_audit_created_idx
  on public.shift_line_audit_events (created_at desc, id desc);

create table if not exists public.shift_line_rate_limits (
  key_hash text primary key,
  window_start timestamptz not null,
  request_count int not null default 0,
  expires_at timestamptz not null
);

-- Private integration tables: all reads/writes go through server routes.
do $$
declare t text;
begin
  foreach t in array array[
    'shift_line_accounts', 'shift_line_account_link_nonces', 'shift_line_sessions',
    'shift_line_groups', 'shift_line_notification_settings', 'shift_line_webhook_events',
    'shift_line_message_logs', 'shift_line_audit_events', 'shift_line_rate_limits'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.shift_line_audit_events_id_seq from anon, authenticated;
grant usage, select on sequence public.shift_line_audit_events_id_seq to service_role;

-- The reservation trigger must retain reservations for open listings and
-- release them for every terminal status, including open -> approved.
create or replace function public.shift_release_request_reservations()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare kind text;
begin
  kind := case tg_table_name
    when 'shift_swap_requests' then 'swap'
    when 'shift_sale_requests' then 'sale'
  end;
  if old.status in ('open','pending_buyer','pending_counterpart','pending_approval')
     and new.status not in ('open','pending_buyer','pending_counterpart','pending_approval') then
    delete from public.shift_assignment_reservations
    where request_kind = kind and request_id = new.id;
  end if;
  return new;
end;
$$;

-- Atomically create an open sale and reserve every assignment.
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
  a record;
  schedule_id uuid;
  schedule_row public.shift_schedules%rowtype;
  sale_row public.shift_sale_requests%rowtype;
  seen_count int := 0;
begin
  if p_assignment_ids is null or cardinality(p_assignment_ids) = 0 then
    raise exception 'ต้องเลือกเวรอย่างน้อยหนึ่งรายการ';
  end if;
  if exists (select 1 from unnest(p_assignment_ids) x group by x having count(*) > 1) then
    raise exception 'มีรายการเวรซ้ำกัน';
  end if;

  for a in
    select id, user_id, schedule_id, work_date
    from public.shift_assignments
    where id = any(p_assignment_ids)
    order by id
    for update
  loop
    seen_count := seen_count + 1;
    if a.user_id <> p_seller_id then raise exception 'เลือกได้เฉพาะเวรของผู้ขาย'; end if;
    if a.work_date < (now() at time zone 'Asia/Bangkok')::date then raise exception 'ไม่สามารถขายเวรที่ผ่านมาแล้ว'; end if;
    if schedule_id is null then schedule_id := a.schedule_id;
    elsif schedule_id <> a.schedule_id then raise exception 'ขายเวรได้เฉพาะภายในตารางเดียวกัน'; end if;
  end loop;
  if seen_count <> cardinality(p_assignment_ids) then raise exception 'ไม่พบเวรที่เลือกบางรายการ'; end if;

  select * into schedule_row from public.shift_schedules where id = schedule_id for update;
  if schedule_row.id is null or schedule_row.status <> 'published' then raise exception 'ขายได้เฉพาะตารางที่เผยแพร่แล้ว'; end if;

  insert into public.shift_sale_requests (seller_id, buyer_id, reason, status, sale_mode)
  values (p_seller_id, null, p_reason, 'open', 'open')
  returning * into sale_row;
  insert into public.shift_sale_items (sale_request_id, assignment_id)
  select sale_row.id, x from unnest(p_assignment_ids) x;
  insert into public.shift_assignment_reservations (assignment_id, request_kind, request_id, reserved_by)
  select x, 'sale', sale_row.id, p_seller_id from unnest(p_assignment_ids) x;
  return sale_row;
end;
$$;

-- First claimant wins. With approval enabled the claim reserves the buyer and
-- moves the listing to pending_approval; otherwise it transfers assignments
-- and closes the sale in the same transaction.
create or replace function public.shift_claim_open_sale(
  p_request_id uuid,
  p_buyer_id uuid,
  p_expected_schedule_version bigint,
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
  a record;
  schedule_row public.shift_schedules%rowtype;
  assignment_ids uuid[];
begin
  select * into sale_row from public.shift_sale_requests where id = p_request_id for update;
  if sale_row.id is null then raise exception 'ไม่พบประกาศขายเวร'; end if;
  if sale_row.sale_mode <> 'open' or sale_row.status <> 'open' or sale_row.buyer_id is not null then raise exception 'เวรนี้มีผู้รับแล้ว'; end if;
  if sale_row.seller_id = p_buyer_id then raise exception 'ผู้ขายรับเวรของตัวเองไม่ได้'; end if;
  if p_actor_id <> p_buyer_id then raise exception 'ผู้ดำเนินการไม่ตรงกับผู้รับเวร'; end if;

  select array_agg(assignment_id order by assignment_id) into assignment_ids
  from public.shift_sale_items where sale_request_id = sale_row.id;
  if assignment_ids is null or cardinality(assignment_ids) = 0 then raise exception 'ประกาศนี้ไม่มีเวร'; end if;

  for a in
    select id, user_id, schedule_id, work_date
    from public.shift_assignments where id = any(assignment_ids) order by id for update
  loop
    if a.user_id <> sale_row.seller_id then raise exception 'เจ้าของเวรมีการเปลี่ยนแปลงแล้ว'; end if;
    if a.work_date < (now() at time zone 'Asia/Bangkok')::date then raise exception 'ไม่สามารถรับเวรที่ผ่านมาแล้ว'; end if;
    if schedule_row.id is null then
      select * into schedule_row from public.shift_schedules where id = a.schedule_id for update;
    elsif schedule_row.id <> a.schedule_id then raise exception 'ประกาศขายเวรข้ามตารางไม่ได้'; end if;
  end loop;
  if schedule_row.status <> 'published' then raise exception 'ตารางเวรไม่ได้อยู่ในสถานะเผยแพร่'; end if;
  if schedule_row.assignment_version <> p_expected_schedule_version then raise serialization_failure using message = 'ตารางเวรมีการเปลี่ยนแปลงพร้อมกัน'; end if;
  if not exists (
    select 1 from public.shift_team_members tm
    where tm.team_id = schedule_row.team_id and tm.user_id = p_buyer_id and tm.is_active
  ) then raise exception 'ผู้รับเวรไม่มีสิทธิ์ในทีมนี้'; end if;

  perform set_config('shift.request_actor', p_actor_id::text, true);
  if p_requires_approval then
    update public.shift_sale_requests
      set buyer_id = p_buyer_id, accepted_by = p_buyer_id, claimed_at = now(),
          buyer_responded_at = now(), status = 'pending_approval'
      where id = sale_row.id and status = 'open' and buyer_id is null
      returning * into sale_row;
  else
    update public.shift_assignments set user_id = p_buyer_id, source = 'sale', updated_at = now()
      where id = any(assignment_ids);
    update public.shift_sale_requests
      set buyer_id = p_buyer_id, accepted_by = p_buyer_id, claimed_at = now(),
          buyer_responded_at = now(), status = 'approved', decided_by = p_actor_id, decided_at = now()
      where id = sale_row.id and status = 'open' and buyer_id is null
      returning * into sale_row;
  end if;
  if sale_row.id is null then raise exception 'เวรนี้มีผู้รับแล้ว'; end if;
  return sale_row;
end;
$$;

-- Reopen a claimed open listing atomically when an approver rejects it. This
-- keeps the reservation and buyer fields consistent with the status change.
create or replace function public.shift_reopen_open_sale(
  p_request_id uuid,
  p_actor_id uuid
)
returns public.shift_sale_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare sale_row public.shift_sale_requests%rowtype;
begin
  perform set_config('shift.request_actor', p_actor_id::text, true);
  update public.shift_sale_requests
    set status = 'open', buyer_id = null, accepted_by = null, claimed_at = null,
        buyer_responded_at = null, decided_by = null, decided_at = null
    where id = p_request_id and sale_mode = 'open' and status = 'pending_approval'
    returning * into sale_row;
  if sale_row.id is null then raise exception using errcode = '40001', message = 'สถานะคำขอมีการเปลี่ยนแปลง กรุณารีเฟรช'; end if;
  return sale_row;
end;
$$;

-- Complete an account link from the accountLink webhook. The nonce row is
-- locked before checking or writing either unique mapping.
create or replace function public.shift_link_line_account(
  p_line_user_id text,
  p_nonce_hash text
)
returns table(account_id uuid, user_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare n public.shift_line_account_link_nonces%rowtype;
declare existing_line public.shift_line_accounts%rowtype;
declare existing_user public.shift_line_accounts%rowtype;
declare profile_status text;
begin
  select * into n from public.shift_line_account_link_nonces
    where nonce_hash = p_nonce_hash and used_at is null and expires_at > now() for update;
  if n.id is null then raise exception 'คำขอเชื่อมบัญชีหมดอายุหรือถูกใช้ไปแล้ว'; end if;
  select lower(coalesce(status, 'active')) into profile_status from public.profiles where id = n.user_id;
  if profile_status is null or profile_status <> 'active' then raise exception 'บัญชีระบบไม่พร้อมใช้งาน'; end if;

  select * into existing_line from public.shift_line_accounts where line_user_id = p_line_user_id for update;
  if existing_line.id is not null and existing_line.user_id <> n.user_id then raise exception 'LINE บัญชีนี้เชื่อมกับผู้ใช้อื่นแล้ว'; end if;
  select * into existing_user from public.shift_line_accounts where user_id = n.user_id for update;
  if existing_user.id is not null and existing_user.line_user_id <> p_line_user_id then raise exception 'บัญชีระบบนี้เชื่อมกับ LINE อื่นอยู่แล้ว'; end if;

  if existing_user.id is null then
    insert into public.shift_line_accounts (user_id, line_user_id, status, linked_at, unlinked_at, last_seen_at)
      values (n.user_id, p_line_user_id, 'active', now(), null, now())
      returning public.shift_line_accounts.id, public.shift_line_accounts.user_id into account_id, user_id;
  else
    update public.shift_line_accounts set status = 'active', linked_at = now(), unlinked_at = null, last_seen_at = now(), updated_at = now()
      where id = existing_user.id returning public.shift_line_accounts.id, public.shift_line_accounts.user_id into account_id, user_id;
  end if;
  update public.shift_line_account_link_nonces set used_at = now() where id = n.id;
  return next;
end;
$$;

revoke execute on function public.shift_create_open_sale_request(uuid[], uuid, text) from public, anon, authenticated;
revoke execute on function public.shift_claim_open_sale(uuid, uuid, bigint, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.shift_link_line_account(text, text) from public, anon, authenticated;
revoke execute on function public.shift_reopen_open_sale(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shift_create_open_sale_request(uuid[], uuid, text) to service_role;
grant execute on function public.shift_claim_open_sale(uuid, uuid, bigint, boolean, uuid) to service_role;
grant execute on function public.shift_link_line_account(text, text) to service_role;
grant execute on function public.shift_reopen_open_sale(uuid, uuid) to service_role;

insert into public.shift_settings (key, value) values
  ('line', '{"enabled":false,"swapEnabled":false,"saleEnabled":false,"openSaleEnabled":false,"dailyRosterEnabled":false,"personalReminderEnabled":false,"showPhoneInDailyRoster":false,"dailyRosterHour":6,"personalReminderHour":20}'::jsonb)
on conflict (key) do nothing;
