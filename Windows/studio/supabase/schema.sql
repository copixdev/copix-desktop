-- Copix profiles — run once in Supabase SQL Editor
-- Project: vifdyvcxhfqmcrmrtkwp

create table if not exists public.copix_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  plan text not null default 'free'
    check (plan in ('free', 'pro', 'max')),
  plan_status text not null default 'inactive'
    check (plan_status in ('active', 'inactive', 'trial')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.copix_profiles enable row level security;

drop policy if exists "Users read own profile" on public.copix_profiles;
drop policy if exists "Users insert own profile" on public.copix_profiles;
drop policy if exists "Users update own profile" on public.copix_profiles;

create policy "Users read own profile"
  on public.copix_profiles for select
  using (auth.uid() = id);

create policy "Users insert own profile"
  on public.copix_profiles for insert
  with check (auth.uid() = id);

create policy "Users update own profile"
  on public.copix_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.copix_profiles (id, email, display_name, plan, plan_status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, 'user'), '@', 1)),
    'free',
    'inactive'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant select, insert, update on public.copix_profiles to authenticated;
grant select on public.copix_profiles to anon;
