-- Admin User Management RBAC (2026-10-16)
-- Reuses public.profiles + public.is_admin() + public.audit_logs. No second project.
-- Safe / re-runnable. Apply in order after 20261015 migration.
-- Bootstrap: insert app_settings bootstrap_admin_email, register/login, select claim_first_admin().

-- ---------- 1. profiles: extend for user management ----------
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Widen role set (keep manager for backward compat), default new users to client.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('client', 'staff', 'manager', 'admin'));
alter table public.profiles alter column role set default 'client';

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_active_idx on public.profiles (is_active);
create index if not exists profiles_email_idx on public.profiles (email);

-- Keep updated_at fresh.
create or replace function public.touch_profiles_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

-- ---------- 2. registration: default client, copy identity, never trust client role ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, email, first_name, last_name, is_active)
  values (
    new.id,
    'client',
    new.email,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', '')
    , true
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- 3. RLS: admin read, no direct writes (RPC-only) ----------
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "admin read all profiles" on public.profiles;
create policy "admin read all profiles" on public.profiles
  for select using (public.is_admin());

-- Remove legacy direct-write-all so role changes must go through guarded RPCs
-- (which enforce last-admin protection + audit). SECURITY DEFINER functions
-- bypass RLS, so they keep working after this drop.
drop policy if exists "admin write profiles" on public.profiles;

-- ---------- 4. secure role assignment (admin only, audited, last-admin safe) ----------
create or replace function public.set_user_role(p_target uuid, p_role text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_old public.profiles%rowtype;
  v_others int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_role not in ('client', 'staff', 'manager', 'admin') then
    raise exception 'Invalid role: %', p_role;
  end if;
  select * into v_old from public.profiles where id = p_target;
  if not found then raise exception 'Profile not found'; end if;
  if v_old.role = p_role then return v_old; end if;
  -- Never demote the last active administrator.
  if v_old.role = 'admin' and p_role <> 'admin' and v_old.is_active then
    select count(*) into v_others from public.profiles
      where role = 'admin' and is_active = true and id <> p_target;
    if v_others = 0 then raise exception 'Cannot demote the last active administrator'; end if;
  end if;
  update public.profiles set role = p_role where id = p_target
    returning * into v_old;
  insert into public.audit_logs (actor, action, entity, entity_id, meta)
    values (auth.uid(), 'role.changed', 'profiles', p_target,
      jsonb_build_object('old_role', v_old.role, 'new_role', p_role));
  -- Note: meta stores the requested new role; row holds the applied role.
  return v_old;
end $$;

-- ---------- 5. secure activation (admin only, last-admin safe) ----------
create or replace function public.set_user_active(p_target uuid, p_active boolean)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_p public.profiles%rowtype;
  v_others int;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into v_p from public.profiles where id = p_target;
  if not found then raise exception 'Profile not found'; end if;
  if v_p.is_active = p_active then return v_p; end if;
  -- Never deactivate the last active administrator.
  if v_p.role = 'admin' and not p_active then
    select count(*) into v_others from public.profiles
      where role = 'admin' and is_active = true and id <> p_target;
    if v_others = 0 then raise exception 'Cannot deactivate the last active administrator'; end if;
  end if;
  update public.profiles set is_active = p_active where id = p_target
    returning * into v_p;
  insert into public.audit_logs (actor, action, entity, entity_id, meta)
    values (auth.uid(),
      case when p_active then 'user.activated' else 'user.deactivated' end,
      'profiles', p_target, jsonb_build_object('is_active', p_active));
  return v_p;
end $$;

-- ---------- 6. first-admin bootstrap (one-time, email-allowlisted, auto-disabled) ----------
-- Setup (Supabase SQL Editor, as project owner):
--   insert into public.app_settings (key, value) values ('bootstrap_admin_email', 'you@example.com')
--   on conflict (key) do update set value = excluded.value;
-- Then register/login as that email and run: select public.claim_first_admin();
-- The function deletes the setting on success so it cannot be reused.
create or replace function public.claim_first_admin()
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_allow text;
  v_admins int;
  v_p public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then raise exception 'Account not found'; end if;
  select value into v_allow from public.app_settings where key = 'bootstrap_admin_email';
  if v_allow is null or btrim(v_allow) = '' then
    raise exception 'Bootstrap disabled (no bootstrap_admin_email configured)';
  end if;
  if lower(btrim(v_email)) <> lower(btrim(v_allow)) then
    raise exception 'This account is not the configured bootstrap administrator';
  end if;
  select count(*) into v_admins from public.profiles where role = 'admin' and is_active = true;
  if v_admins > 0 then raise exception 'Administrator already exists'; end if;
  insert into public.profiles (id, role, email, is_active)
    values (auth.uid(), 'admin', v_email, true)
    on conflict (id) do update set role = 'admin', is_active = true, email = excluded.email
    returning * into v_p;
  insert into public.audit_logs (actor, action, entity, entity_id, meta)
    values (auth.uid(), 'role.changed', 'profiles', auth.uid(),
      jsonb_build_object('old_role', 'bootstrap', 'new_role', 'admin'));
  delete from public.app_settings where key = 'bootstrap_admin_email';
  return v_p;
end $$;
