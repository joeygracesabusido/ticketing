-- Ferry Ticketing — Supabase schema (paste into Supabase Dashboard > SQL Editor > Run)
-- Re-runnable: tables use IF NOT EXISTS, seeds use ON CONFLICT DO NOTHING.
-- Auth uses Supabase Auth (auth.users), no custom users table needed.

-- ---------- tables ----------
create table if not exists public.ports (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  city text not null,
  province text,
  country text not null default 'Philippines',
  active boolean not null default true
);

create table if not exists public.vessels (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  capacity int,
  status text not null default 'active'
);

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  origin_port_id uuid not null references public.ports (id),
  destination_port_id uuid not null references public.ports (id),
  distance_km numeric,
  estimated_duration_minutes int,
  check (origin_port_id <> destination_port_id)
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id),
  vessel_id uuid not null references public.vessels (id),
  departure_port_id uuid not null references public.ports (id),
  arrival_port_id uuid not null references public.ports (id),
  departure_at timestamptz not null,
  arrival_at timestamptz not null,
  status text not null default 'scheduled',
  fare_from numeric(10, 2),
  booking_open timestamptz,
  booking_close timestamptz,
  check (arrival_at > departure_at)
);

create index if not exists trips_departure_at_idx on public.trips (departure_at);
create index if not exists trips_ports_idx on public.trips (departure_port_id, arrival_port_id);
create index if not exists routes_ports_idx on public.routes (origin_port_id, destination_port_id);

-- ---------- public read (schedules are public) ----------
alter table public.ports enable row level security;
alter table public.vessels enable row level security;
alter table public.routes enable row level security;
alter table public.trips enable row level security;

drop policy if exists "public read" on public.ports;
create policy "public read" on public.ports for select using (true);

drop policy if exists "public read" on public.vessels;
create policy "public read" on public.vessels for select using (true);

drop policy if exists "public read" on public.routes;
create policy "public read" on public.routes for select using (true);

drop policy if exists "public read" on public.trips;
create policy "public read" on public.trips for select using (true);

-- ---------- seed: 8 ports (matches app fallback list) ----------
insert into public.ports (code, name, city) values
  ('MNL', 'Manila North Harbor', 'Manila'),
  ('CEB', 'Cebu Port', 'Cebu City'),
  ('ILO', 'Iloilo Port', 'Iloilo City'),
  ('BCD', 'Bacolod Port', 'Bacolod City'),
  ('CGY', 'Cagayan de Oro Port', 'Cagayan de Oro'),
  ('DVO', 'Davao Port', 'Davao City'),
  ('BTG', 'Batangas Port', 'Batangas City'),
  ('TAG', 'Tagbilaran Port', 'Tagbilaran City')
on conflict (code) do nothing;

-- ---------- seed: 1 vessel, 1 route (MNL -> CEB), 3 trips ----------
insert into public.vessels (code, name, capacity, status) values
  ('MV-001', 'MV Sampaguita', 500, 'active')
on conflict (code) do nothing;

insert into public.routes (code, origin_port_id, destination_port_id, distance_km, estimated_duration_minutes)
select 'MNL-CEB',
  (select id from public.ports where code = 'MNL'),
  (select id from public.ports where code = 'CEB'),
  650, 720
where not exists (select 1 from public.routes where code = 'MNL-CEB');

-- 3 evening departures (8 PM Manila = 12:00 UTC) so demo search finds trips
insert into public.trips (
  route_id, vessel_id, departure_port_id, arrival_port_id,
  departure_at, arrival_at, status, fare_from, booking_open, booking_close
)
select
  r.id, v.id, r.origin_port_id, r.destination_port_id,
  d.dep, d.dep + interval '12 hours', 'scheduled', 1200.00,
  now(), d.dep - interval '2 hours'
from public.routes r
cross join public.vessels v
cross join lateral (
  values
    ((date_trunc('day', now() + interval '1 day') + interval '12 hours')),
    ((date_trunc('day', now() + interval '2 days') + interval '12 hours')),
    ((date_trunc('day', now() + interval '3 days') + interval '12 hours'))
) as d (dep)
where r.code = 'MNL-CEB' and v.code = 'MV-001'
  and not exists (
    select 1 from public.trips t
    where t.route_id = r.id and t.departure_at = d.dep
  );

-- ---------- roles: admin / manager ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'manager' check (role in ('admin', 'manager'))
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "admin write profiles" on public.profiles;
create policy "admin write profiles" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as
  $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as
  $$ begin insert into public.profiles (id) values (new.id) on conflict (id) do nothing; return new; end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- admin-only writes on ferry tables (public read unchanged) ----------
drop policy if exists "admin write" on public.ports;
create policy "admin write" on public.ports for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin write" on public.vessels;
create policy "admin write" on public.vessels for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin write" on public.routes;
create policy "admin write" on public.routes for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin write" on public.trips;
create policy "admin write" on public.trips for all using (public.is_admin()) with check (public.is_admin());
