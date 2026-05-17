-- Smash Pairing - Supabase schema
--
-- Run this once in the Supabase SQL editor for your project.
-- Safe to re-run: every statement is idempotent.

create table if not exists public.user_data (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  key        text        not null,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_data enable row level security;

drop policy if exists "user_data_select_own" on public.user_data;
create policy "user_data_select_own" on public.user_data
  for select using (auth.uid() = user_id);

drop policy if exists "user_data_insert_own" on public.user_data;
create policy "user_data_insert_own" on public.user_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_data_update_own" on public.user_data;
create policy "user_data_update_own" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_data_delete_own" on public.user_data;
create policy "user_data_delete_own" on public.user_data
  for delete using (auth.uid() = user_id);

-- Keep updated_at fresh on every write so sync can compare timestamps.
create or replace function public.touch_user_data_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_data_touch_updated_at on public.user_data;
create trigger user_data_touch_updated_at
  before update on public.user_data
  for each row execute function public.touch_user_data_updated_at();
