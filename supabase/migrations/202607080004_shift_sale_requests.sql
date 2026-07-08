-- ขายเวร (sell shift): one-way transfer of one or more of the seller's own
-- shifts to a buyer — unlike a swap, only one side's assignments move, and
-- the seller's total shift count goes down while the buyer's goes up.

create table if not exists public.shift_sale_requests (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id),
  buyer_id uuid not null references public.profiles(id),
  reason text,
  status text not null default 'pending_buyer' check (status in
    ('pending_buyer','pending_approval','approved','declined','rejected','cancelled')),
  buyer_responded_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shift_sales_buyer_idx
  on public.shift_sale_requests (buyer_id) where status = 'pending_buyer';
create index if not exists shift_sales_approval_idx
  on public.shift_sale_requests (status) where status = 'pending_approval';

create table if not exists public.shift_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_request_id uuid not null references public.shift_sale_requests(id) on delete cascade,
  assignment_id uuid not null references public.shift_assignments(id) on delete cascade,
  unique (sale_request_id, assignment_id)
);
create index if not exists shift_sale_items_request_idx
  on public.shift_sale_items (sale_request_id);

-- allow 'sale' as an assignment source alongside auto/manual/swap
alter table public.shift_assignments drop constraint if exists shift_assignments_source_check;
alter table public.shift_assignments add constraint shift_assignments_source_check
  check (source in ('auto','manual','swap','sale'));

alter table public.shift_sale_requests enable row level security;
alter table public.shift_sale_items enable row level security;

drop policy if exists shift_sale_requests_read on public.shift_sale_requests;
create policy shift_sale_requests_read on public.shift_sale_requests for select to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.shift_is_scheduler());
drop policy if exists shift_sale_requests_insert on public.shift_sale_requests;
create policy shift_sale_requests_insert on public.shift_sale_requests for insert to authenticated
  with check (seller_id = auth.uid() or public.shift_is_scheduler());
drop policy if exists shift_sale_requests_update on public.shift_sale_requests;
create policy shift_sale_requests_update on public.shift_sale_requests for update to authenticated
  using (seller_id = auth.uid() or buyer_id = auth.uid() or public.shift_is_scheduler());

drop policy if exists shift_sale_items_read on public.shift_sale_items;
create policy shift_sale_items_read on public.shift_sale_items for select to authenticated
  using (
    exists (
      select 1 from public.shift_sale_requests r
      where r.id = sale_request_id and (r.seller_id = auth.uid() or r.buyer_id = auth.uid() or public.shift_is_scheduler())
    )
  );
drop policy if exists shift_sale_items_write on public.shift_sale_items;
create policy shift_sale_items_write on public.shift_sale_items for all to authenticated
  using (
    exists (select 1 from public.shift_sale_requests r where r.id = sale_request_id and r.seller_id = auth.uid())
    or public.shift_is_scheduler()
  );

insert into public.shift_settings (key, value) values
  ('sale', '{"requiresApproval": true}'::jsonb)
on conflict (key) do nothing;
