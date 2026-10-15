-- Ferry Ticketing — Supabase schema (paste into Supabase Dashboard > SQL Editor > Run)
-- COMPLETE FILE: base tables + full shipping booking system (2026-10-15).
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

-- =============================================================
-- COMPLETE SHIPPING BOOKING SYSTEM (merged from
-- supabase/migrations/20261015_complete_shipping_booking.sql)
-- 4h configurable hold, 12% VAT-inclusive domestic fares (NIRC Sec.108 /
-- RR 16-2005 / RMC 31-2008; international exempt RA 10378 — verify with
-- tax professional), atomic capacity holds, pending->paid via
-- verify_payment() (admin only), single ticket per booking.
-- =============================================================

-- ---------- 0. settings + tax rules ----------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('reservation_hold_hours', '4'),
  ('booking_close_hours_before_departure', '6'),
  ('currency', 'PHP')
on conflict (key) do nothing;

create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  rate numeric(5,4) not null,
  inclusive boolean not null default true,
  effective_from date not null default '2025-01-01',
  effective_to date,
  description text,
  unique (code, effective_from)
);

insert into public.tax_rules (code, rate, inclusive, effective_from, description) values
  ('VAT_DOMESTIC_PASSENGER', 0.1200, true, '2025-01-01',
   'Domestic sea passenger transport, NIRC Sec.108 / RR 16-2005. VAT-inclusive fare. Verify with tax professional.')
on conflict (code, effective_from) do nothing;

-- ---------- 1. vessel accommodations ----------
create table if not exists public.vessel_accommodations (
  id uuid primary key default gen_random_uuid(),
  vessel_id uuid not null references public.vessels (id) on delete cascade,
  code text not null,
  name text not null,
  capacity int not null check (capacity >= 0),
  fare_amount numeric(12,2) not null check (fare_amount >= 0),
  is_active boolean not null default true,
  shared_ok boolean not null default false,
  max_occupancy int not null default 1 check (max_occupancy >= 1),
  unique (vessel_id, code)
);
create index if not exists vessel_accom_vessel_idx on public.vessel_accommodations (vessel_id);

-- ---------- 2. per-voyage inventory (capacity protection) ----------
create table if not exists public.trip_accommodation_inventory (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  accommodation_id uuid not null references public.vessel_accommodations (id) on delete cascade,
  capacity int not null check (capacity >= 0),
  booked int not null default 0 check (booked >= 0),
  held int not null default 0 check (held >= 0),
  fare_amount numeric(12,2) not null check (fare_amount >= 0),
  is_active boolean not null default true,
  unique (trip_id, accommodation_id),
  check (booked + held <= capacity)
);
create index if not exists trip_inv_trip_idx on public.trip_accommodation_inventory (trip_id);

-- ---------- 3. bookings (holds kept for audit, never hard-deleted) ----------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_reference text unique not null,
  trip_id uuid not null references public.trips (id),
  accommodation_id uuid not null references public.vessel_accommodations (id),
  user_id uuid references auth.users (id),
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  pax_count int not null check (pax_count >= 1 and pax_count <= 100),
  base_amount numeric(12,2) not null,
  discount_amount numeric(12,2) not null default 0,
  vat_rate numeric(5,4) not null default 0.1200,
  vat_amount numeric(12,2) not null,
  total_amount numeric(12,2) not null,
  breakdown jsonb not null default '{}',
  status text not null default 'held'
    check (status in ('held','confirmed','expired','cancelled','refunded')),
  expires_at timestamptz not null,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookings_ref_idx on public.bookings (booking_reference);
create index if not exists bookings_trip_idx on public.bookings (trip_id);
create index if not exists bookings_user_idx on public.bookings (user_id);
create index if not exists bookings_expires_idx on public.bookings (expires_at) where status = 'held';

create table if not exists public.booking_passengers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  full_name text not null,
  passenger_type text not null default 'adult' check (passenger_type in ('adult','child','infant','senior','pwd','student')),
  fare_share numeric(12,2) not null default 0
);
create index if not exists booking_pax_booking_idx on public.booking_passengers (booking_id);

-- ---------- 4. payments ----------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_reference text unique not null,
  booking_id uuid not null references public.bookings (id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'manual' check (method in ('manual','card','gcash','maya','bank','otc')),
  status text not null default 'pending'
    check (status in ('pending','processing','paid','failed','cancelled','refunded')),
  provider text,
  provider_ref text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists payments_booking_idx on public.payments (booking_id);
create index if not exists payments_ref_idx on public.payments (payment_reference);

-- ---------- 5. tickets ----------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text unique not null,
  booking_id uuid unique not null references public.bookings (id),
  issued_at timestamptz not null default now(),
  reprint_count int not null default 0,
  status text not null default 'valid' check (status in ('valid','void','refunded'))
);
create index if not exists tickets_booking_idx on public.tickets (booking_id);

-- ---------- 6. audit ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor uuid references auth.users (id),
  action text not null,
  entity text not null,
  entity_id uuid,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_entity_idx on public.audit_logs (entity, entity_id);

-- ---------- helpers ----------
create or replace function public.booking_hold_hours()
returns numeric language sql stable as
$$ select coalesce(nullif((select value from public.app_settings where key='reservation_hold_hours'),''), '4')::numeric $$;

-- ---------- RPC: create_booking (atomic hold) ----------
create or replace function public.create_booking(
  p_trip_id uuid, p_accommodation_id uuid, p_pax int,
  p_name text, p_email text, p_phone text,
  p_idempotency text default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_inv trip_accommodation_inventory%rowtype;
  v_trip trips%rowtype;
  v_hold numeric;
  v_total numeric(12,2);
  v_net numeric(12,2);
  v_vat numeric(12,2);
  v_ref text;
  v_b bookings%rowtype;
  i int;
begin
  if p_pax < 1 or p_pax > 100 then raise exception 'Pax must be 1-100'; end if;
  if p_name is null or length(trim(p_name)) < 2 then raise exception 'Full name required'; end if;
  if p_email is null or p_email !~ '.+@.+\..+' then raise exception 'Valid email required'; end if;
  if p_idempotency is not null then
    select * into v_b from bookings where idempotency_key = p_idempotency;
    if found then return v_b; end if;
  end if;
  select * into v_trip from trips where id = p_trip_id;
  if not found then raise exception 'Trip not found'; end if;
  if v_trip.status = 'cancelled' then raise exception 'Trip cancelled'; end if;
  if v_trip.departure_at <= now() then raise exception 'Trip already departed'; end if;
  if v_trip.booking_close is not null and v_trip.booking_close < now() then raise exception 'Booking closed'; end if;
  select * into v_inv from trip_accommodation_inventory
   where trip_id = p_trip_id and accommodation_id = p_accommodation_id
   for update;
  if not found then raise exception 'Accommodation not offered on this voyage'; end if;
  if not v_inv.is_active then raise exception 'Accommodation unavailable'; end if;
  if (v_inv.capacity - v_inv.booked - v_inv.held) < p_pax then raise exception 'Not enough capacity'; end if;
  v_hold := public.booking_hold_hours();
  v_total := round((v_inv.fare_amount * p_pax)::numeric, 2);
  v_net := round((v_total / 1.12)::numeric, 2);
  v_vat := round((v_total - v_net)::numeric, 2);
  v_ref := 'BK-' || upper(substr(md5(gen_random_uuid()::text || now()::text), 1, 8));
  insert into bookings (booking_reference, trip_id, accommodation_id, user_id,
    contact_name, contact_email, contact_phone, pax_count,
    base_amount, discount_amount, vat_rate, vat_amount, total_amount,
    breakdown, status, expires_at, idempotency_key)
  values (v_ref, p_trip_id, p_accommodation_id, auth.uid(),
    trim(p_name), trim(p_email), trim(p_phone), p_pax,
    v_net, 0, 0.1200, v_vat, v_total,
    jsonb_build_object('fare_per_pax', v_inv.fare_amount, 'pax', p_pax,
      'total_inclusive', v_total, 'net', v_net, 'vat_rate', 0.12, 'vat', v_vat,
      'pricing', 'VAT-inclusive domestic passenger fare'),
    'held', now() + (v_hold || ' hours')::interval, p_idempotency)
  returning * into v_b;
  for i in 1..p_pax loop
    insert into booking_passengers (booking_id, full_name, passenger_type, fare_share)
    values (v_b.id, case when i = 1 then trim(p_name) else 'Passenger ' || i end,
      'adult', round((v_total / p_pax)::numeric, 2));
  end loop;
  update trip_accommodation_inventory set held = held + p_pax where id = v_inv.id;
  insert into audit_logs (actor, action, entity, entity_id, meta)
  values (auth.uid(), 'booking.held', 'bookings', v_b.id,
    jsonb_build_object('ref', v_ref, 'pax', p_pax));
  return v_b;
end $$;

-- ---------- RPC: expire_reservations (cron / manual) ----------
create or replace function public.expire_reservations()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; n int := 0;
begin
  for r in select id, trip_id, accommodation_id, pax_count
             from bookings where status='held' and expires_at < now()
             for update skip locked loop
    update bookings set status='expired', updated_at=now() where id=r.id;
    update trip_accommodation_inventory
       set held = greatest(0, held - r.pax_count)
     where trip_id=r.trip_id and accommodation_id=r.accommodation_id;
    insert into audit_logs (actor, action, entity, entity_id, meta)
    values (null, 'booking.expired', 'bookings', r.id, jsonb_build_object('released', r.pax_count));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- RPC: create_payment_intent (customer: pending only) ----------
create or replace function public.create_payment_intent(
  p_booking_id uuid, p_method text, p_idempotency text default null
) returns public.payments
language plpgsql security definer set search_path = public as $$
declare v_b bookings%rowtype; v_p payments%rowtype;
begin
  if p_idempotency is not null then
    select * into v_p from payments where idempotency_key = p_idempotency;
    if found then return v_p; end if;
  end if;
  select * into v_b from bookings where id = p_booking_id;
  if not found then raise exception 'Booking not found'; end if;
  if v_b.status = 'expired' then raise exception 'Reservation expired - renew before paying'; end if;
  if v_b.status = 'cancelled' then raise exception 'Booking cancelled'; end if;
  if v_b.status = 'confirmed' then raise exception 'Already confirmed'; end if;
  if v_b.expires_at < now() then
    perform public.expire_reservations();
    raise exception 'Reservation expired - renew before paying';
  end if;
  if v_b.user_id is not null and v_b.user_id <> auth.uid() then raise exception 'Not your booking'; end if;
  insert into payments (payment_reference, booking_id, amount, method, status, idempotency_key)
  values ('PAY-' || upper(substr(md5(gen_random_uuid()::text),1,10)),
    p_booking_id, v_b.total_amount, coalesce(p_method,'manual'), 'pending', p_idempotency)
  returning * into v_p;
  return v_p;
end $$;

-- ---------- RPC: verify_payment (ADMIN only — sole path to paid) ----------
create or replace function public.verify_payment(
  p_payment_id uuid, p_paid boolean, p_provider_ref text default null
) returns public.payments
language plpgsql security definer set search_path = public as $$
declare v_p payments%rowtype; v_b bookings%rowtype; v_inv trip_accommodation_inventory%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into v_p from payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if v_p.status = 'paid' then return v_p; end if;
  select * into v_b from bookings where id = v_p.booking_id for update;
  if p_paid then
    if v_b.status = 'expired' or v_b.expires_at < now() then raise exception 'Reservation expired'; end if;
    if v_b.total_amount <> v_p.amount then raise exception 'Amount mismatch: revalidate fare'; end if;
    select * into v_inv from trip_accommodation_inventory
     where trip_id=v_b.trip_id and accommodation_id=v_b.accommodation_id for update;
    update trip_accommodation_inventory
       set held = greatest(0, held - v_b.pax_count), booked = booked + v_b.pax_count
     where trip_id=v_b.trip_id and accommodation_id=v_b.accommodation_id;
    update payments set status='paid', verified_at=now(), provider_ref=coalesce(p_provider_ref, provider_ref)
     where id=v_p.id returning * into v_p;
    update bookings set status='confirmed', updated_at=now() where id=v_b.id;
    insert into tickets (ticket_no, booking_id)
    values ('TKT-' || upper(substr(md5(v_b.id::text),1,10)), v_b.id)
    on conflict (booking_id) do nothing;
    insert into audit_logs (actor, action, entity, entity_id, meta)
    values (auth.uid(), 'payment.paid', 'payments', v_p.id, jsonb_build_object('booking', v_b.booking_reference));
  else
    update payments set status='failed', verified_at=now() where id=v_p.id returning * into v_p;
  end if;
  return v_p;
end $$;

-- ---------- RPC: cancel_booking (releases capacity) ----------
create or replace function public.cancel_booking(p_booking_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare v_b bookings%rowtype;
begin
  select * into v_b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if v_b.user_id is not null and v_b.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Not your booking';
  end if;
  if v_b.status in ('cancelled','refunded','expired') then return v_b; end if;
  if v_b.status = 'held' then
    update trip_accommodation_inventory set held = greatest(0, held - v_b.pax_count)
     where trip_id=v_b.trip_id and accommodation_id=v_b.accommodation_id;
    update bookings set status='cancelled', updated_at=now() where id=v_b.id returning * into v_b;
  elsif v_b.status = 'confirmed' then
    update trip_accommodation_inventory set booked = greatest(0, booked - v_b.pax_count)
     where trip_id=v_b.trip_id and accommodation_id=v_b.accommodation_id;
    update bookings set status='cancelled', updated_at=now() where id=v_b.id returning * into v_b;
    update tickets set status='void' where booking_id=v_b.id;
  end if;
  insert into audit_logs (actor, action, entity, entity_id, meta)
  values (auth.uid(), 'booking.cancelled', 'bookings', v_b.id, '{}');
  return v_b;
end $$;

-- ---------- RLS (booking system) ----------
alter table public.app_settings enable row level security;
alter table public.tax_rules enable row level security;
alter table public.vessel_accommodations enable row level security;
alter table public.trip_accommodation_inventory enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_passengers enable row level security;
alter table public.payments enable row level security;
alter table public.tickets enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "public read" on public.app_settings;
create policy "public read" on public.app_settings for select using (true);
drop policy if exists "admin write" on public.app_settings;
create policy "admin write" on public.app_settings for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read" on public.tax_rules;
create policy "public read" on public.tax_rules for select using (true);
drop policy if exists "admin write" on public.tax_rules;
create policy "admin write" on public.tax_rules for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read active" on public.vessel_accommodations;
create policy "public read active" on public.vessel_accommodations for select using (is_active = true);
drop policy if exists "admin all" on public.vessel_accommodations;
create policy "admin all" on public.vessel_accommodations for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read active" on public.trip_accommodation_inventory;
create policy "public read active" on public.trip_accommodation_inventory for select using (is_active = true);
drop policy if exists "admin all" on public.trip_accommodation_inventory;
create policy "admin all" on public.trip_accommodation_inventory for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own bookings" on public.bookings;
create policy "own bookings" on public.bookings for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admin all bookings" on public.bookings;
create policy "admin all bookings" on public.bookings for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own passengers" on public.booking_passengers;
create policy "own passengers" on public.booking_passengers for select using (
  exists (select 1 from public.bookings b where b.id = booking_id and (b.user_id = auth.uid() or public.is_admin())));
drop policy if exists "admin all passengers" on public.booking_passengers;
create policy "admin all passengers" on public.booking_passengers for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments for select using (
  exists (select 1 from public.bookings b where b.id = booking_id and (b.user_id = auth.uid() or public.is_admin())));
drop policy if exists "admin all payments" on public.payments;
create policy "admin all payments" on public.payments for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "own tickets" on public.tickets;
create policy "own tickets" on public.tickets for select using (
  exists (select 1 from public.bookings b where b.id = booking_id and (b.user_id = auth.uid() or public.is_admin())));
drop policy if exists "admin all tickets" on public.tickets;
create policy "admin all tickets" on public.tickets for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin read audit" on public.audit_logs;
create policy "admin read audit" on public.audit_logs for select using (public.is_admin());

-- ---------- seed: accommodations for MV-001 ----------
insert into public.vessel_accommodations (vessel_id, code, name, capacity, fare_amount, shared_ok, max_occupancy)
select v.id, x.code, x.name, x.cap, x.fare, x.shared_ok, x.max_occ
from public.vessels v cross join (values
  ('SUPER_VALUE','Super Value',200, 950.00, false, 1),
  ('TOURIST','Tourist Class',120, 1200.00, false, 1),
  ('ECONOMY_CABIN','Economy Cabin',60, 1650.00, true, 4),
  ('BUSINESS','Business Class',40, 2200.00, false, 1),
  ('FAMILY_SUITE','Family Suite',20, 4800.00, true, 4),
  ('PRIVATE_SUITE','Private Suite',10, 7500.00, true, 2)
) as x(code,name,cap,fare,shared_ok,max_occ)
where v.code = 'MV-001'
on conflict (vessel_id, code) do nothing;

insert into public.trip_accommodation_inventory (trip_id, accommodation_id, capacity, fare_amount)
select t.id, a.id, a.capacity, a.fare_amount
from public.trips t join public.vessel_accommodations a on a.vessel_id = t.vessel_id
on conflict (trip_id, accommodation_id) do nothing;

-- ---------- auto-backfill inventory for trips created AFTER the seed ----------
-- Root cause of empty accommodation dropdowns: TripsAdmin/dashboard inserts
-- never created trip_accommodation_inventory rows. This trigger covers every
-- writer (dashboard, SQL, API) in one place.
create or replace function public.backfill_trip_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_accommodation_inventory (trip_id, accommodation_id, capacity, fare_amount)
  select NEW.id, a.id, a.capacity, a.fare_amount
  from public.vessel_accommodations a
  where a.vessel_id = NEW.vessel_id and a.is_active = true
  on conflict (trip_id, accommodation_id) do nothing;
  return NEW;
end $$;

drop trigger if exists trg_trips_backfill_inventory on public.trips;
create trigger trg_trips_backfill_inventory
  after insert on public.trips
  for each row execute function public.backfill_trip_inventory();

-- Mirror trigger: new accommodation category -> inventory rows for that
-- vessel's existing trips. (The dashboard also upserts these, but that call
-- failed silently at least once — the DB is the reliable shared layer.)
create or replace function public.backfill_accommodation_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.is_active then
    insert into public.trip_accommodation_inventory (trip_id, accommodation_id, capacity, fare_amount)
    select t.id, NEW.id, NEW.capacity, NEW.fare_amount
    from public.trips t
    where t.vessel_id = NEW.vessel_id
    on conflict (trip_id, accommodation_id) do nothing;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_accommodations_backfill_inventory on public.vessel_accommodations;
create trigger trg_accommodations_backfill_inventory
  after insert on public.vessel_accommodations
  for each row execute function public.backfill_accommodation_inventory();
