-- Race-safe vessel schedule invariant. The client checks overlaps before every
-- write, but two schedulers can still insert concurrently; this constraint is
-- the database backstop. Cancelled trips are excluded so history can remain.
-- Requires btree_gist for the uuid equality operator in a GiST index.
-- Apply in the Supabase SQL Editor. This will fail if existing non-cancelled
-- trips for the same vessel already overlap; resolve those rows first.
create extension if not exists btree_gist;

alter table public.trips drop constraint if exists trips_vessel_time_no_overlap;
alter table public.trips
  add constraint trips_vessel_time_no_overlap
  exclude using gist (
    vessel_id with =,
    tstzrange(departure_at, arrival_at, '[)') with &&
  )
  where (status <> 'cancelled');
