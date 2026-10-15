-- Per-passenger names for multi-pax bookings (2026-10-16)
-- Before: create_booking() auto-named pax 2+ as 'Passenger 2..N' with no way
-- to enter real names. Now accepts optional p_passenger_names (text[]).
-- Backward compatible: omitted/null/empty keeps the old behavior.
-- Apply in Supabase SQL Editor after 20261016. Re-runnable.

drop function if exists public.create_booking(uuid, uuid, int, text, text, text, text);

create function public.create_booking(
  p_trip_id uuid, p_accommodation_id uuid, p_pax int,
  p_name text, p_email text, p_phone text,
  p_idempotency text default null,
  p_passenger_names text[] default null
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
  v_pname text;
  i int;
begin
  if p_pax < 1 or p_pax > 100 then raise exception 'Pax must be 1-100'; end if;
  if p_name is null or length(trim(p_name)) < 2 then raise exception 'Full name required'; end if;
  if p_email is null or p_email !~ '.+@.+\..+' then raise exception 'Valid email required'; end if;
  if p_passenger_names is not null and array_length(p_passenger_names, 1) <> p_pax then
    raise exception 'Passenger names count must match pax';
  end if;
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
    if p_passenger_names is not null then
      v_pname := trim(coalesce(p_passenger_names[i], ''));
      if length(v_pname) < 2 then raise exception 'Passenger % name required', i; end if;
    else
      v_pname := case when i = 1 then trim(p_name) else 'Passenger ' || i end;
    end if;
    insert into booking_passengers (booking_id, full_name, passenger_type, fare_share)
    values (v_b.id, v_pname, 'adult', round((v_total / p_pax)::numeric, 2));
  end loop;
  update trip_accommodation_inventory set held = held + p_pax where id = v_inv.id;
  insert into audit_logs (actor, action, entity, entity_id, meta)
  values (auth.uid(), 'booking.held', 'bookings', v_b.id,
    jsonb_build_object('ref', v_ref, 'pax', p_pax));
  return v_b;
end $$;
