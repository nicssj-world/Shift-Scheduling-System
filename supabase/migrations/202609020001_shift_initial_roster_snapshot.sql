-- Keep the roster as it was immediately before its first publication so it
-- remains downloadable after later swaps, sales, or manual corrections.
-- Run this migration in the Supabase SQL Editor before publishing schedules
-- with the new initial-roster PDF feature.

begin;

alter table public.shift_schedules
  add column if not exists initial_assignments jsonb;

comment on column public.shift_schedules.initial_assignments is
  'Immutable JSON snapshot of assignments captured immediately before first publication';

commit;
