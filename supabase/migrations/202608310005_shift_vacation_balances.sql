-- ============================================================
-- Vacation entitlement by fiscal year
-- fiscal_year is the Gregorian year in which Oct-Sep ends.
-- Example: fiscal_year 2026 is Thai fiscal year 2569.
-- Run in Supabase SQL Editor after 202608310004.
-- ============================================================

create table if not exists public.shift_vacation_balances (
  user_id uuid not null references public.profiles(id) on delete cascade,
  fiscal_year integer not null check (fiscal_year between 2000 and 2200),
  previous_days numeric(5,1) not null default 0 check (
    previous_days >= 0 and previous_days <= 365 and previous_days * 2 = trunc(previous_days * 2)
  ),
  current_days numeric(5,1) not null default 0 check (
    current_days >= 0 and current_days <= 365 and current_days * 2 = trunc(current_days * 2)
  ),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, fiscal_year)
);

create index if not exists shift_vacation_balances_fiscal_year_idx
  on public.shift_vacation_balances (fiscal_year, user_id);

alter table public.shift_vacation_balances enable row level security;

drop policy if exists shift_vacation_balances_read on public.shift_vacation_balances;
create policy shift_vacation_balances_read on public.shift_vacation_balances
  for select to authenticated using (true);

drop policy if exists shift_vacation_balances_insert on public.shift_vacation_balances;
create policy shift_vacation_balances_insert on public.shift_vacation_balances
  for insert to authenticated
  with check (public.shift_is_leave_recorder());

drop policy if exists shift_vacation_balances_update on public.shift_vacation_balances;
create policy shift_vacation_balances_update on public.shift_vacation_balances
  for update to authenticated
  using (public.shift_is_leave_recorder())
  with check (public.shift_is_leave_recorder());

-- Entitlements are retained for audit; corrections use an upsert, not delete.
drop policy if exists shift_vacation_balances_delete on public.shift_vacation_balances;
