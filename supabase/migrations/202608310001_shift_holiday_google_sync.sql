-- Track where a holiday came from so Google sync can update/remove only its
-- own rows and preserve holidays entered by an administrator.

alter table public.shift_holidays
  add column if not exists source text;

update public.shift_holidays
set source = 'manual'
where source is null;

alter table public.shift_holidays
  alter column source set default 'manual',
  alter column source set not null;

alter table public.shift_holidays
  add column if not exists source_event_id text,
  add column if not exists synced_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shift_holidays_source_check'
      and conrelid = 'public.shift_holidays'::regclass
  ) then
    alter table public.shift_holidays
      add constraint shift_holidays_source_check
      check (source in ('manual', 'google_th_holidays'));
  end if;
end $$;

create index if not exists shift_holidays_google_source_idx
  on public.shift_holidays (source, source_event_id)
  where source = 'google_th_holidays';
