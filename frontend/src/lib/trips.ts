import { addDays, addMinutes, eachDayOfInterval, format, getDay, parseISO, set, startOfDay } from "date-fns"
import { supabase } from "@/lib/supabase"

// Existing trip status model (dashboard form + DB defaults). Do not invent new ones.
export const TRIP_STATUSES = ["scheduled", "boarding", "departed", "cancelled"] as const
export type TripStatus = (typeof TRIP_STATUSES)[number]

export const TRIP_SELECT =
  "id, route_id, vessel_id, departure_port_id, arrival_port_id, departure_at, arrival_at, status, fare_from, booking_open, booking_close, routes(code, estimated_duration_minutes, origin_port_id, destination_port_id), vessels(code, name, status)"

const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VOYAGE_REF_RE = /^(.+)-(\d{8})-(\d{4})$/

export type TripRow = {
  id: string
  route_id: string
  vessel_id: string
  departure_port_id: string
  arrival_port_id: string
  departure_at: string
  arrival_at: string
  status: string
  fare_from: number | null
  booking_open?: string | null
  booking_close?: string | null
  routes?: {
    code: string
    estimated_duration_minutes: number | null
    origin_port_id: string
    destination_port_id: string
  } | null
  vessels?: { code: string; name: string; status: string } | null
}

export type VesselOption = { id: string; code: string; name: string; status: string; capacity: number | null }
export type RouteOption = {
  id: string
  code: string
  origin_port_id: string
  destination_port_id: string
  estimated_duration_minutes: number | null
  distance_km: number | null
}
export type PortOption = { id: string; code: string; name: string; city: string; active: boolean }
export type AccommodationOption = {
  id: string
  vessel_id: string
  code: string
  name: string
  capacity: number
  fare_amount: number
  is_active: boolean
}

export type TripRefs = {
  vessels: VesselOption[]
  routes: RouteOption[]
  ports: PortOption[]
  accommodations: AccommodationOption[]
  bookingCloseHours: number
}

export type AvailabilityClass = { name: string; capacity: number; available: number }
export type Availability = {
  capacity: number
  booked: number
  held: number
  available: number
  classes: AvailabilityClass[]
}

export type TripFilters = {
  q: string
  status: string
  vesselId: string
  routeId: string
  from: string // yyyy-MM-dd (inclusive)
  to: string // yyyy-MM-dd (inclusive)
  capacity: "" | "available" | "low" | "full"
}

export const EMPTY_FILTERS: TripFilters = {
  q: "",
  status: "all",
  vesselId: "all",
  routeId: "all",
  from: "",
  to: "",
  capacity: "",
}

export function tripReference(trip: Pick<TripRow, "departure_at" | "routes">): string {
  if (!trip.routes?.code) return "TRIP"
  return `${trip.routes.code}-${format(new Date(trip.departure_at), "yyyyMMdd-HHmm")}`
}

export function formatTripDate(iso: string) {
  return format(new Date(iso), "dd MMM yyyy")
}

export function formatTripTime(iso: string) {
  return format(new Date(iso), "HH:mm")
}

export function formatTripDateTime(iso: string) {
  return format(new Date(iso), "dd MMM yyyy, HH:mm")
}

export function statusTone(status: string) {
  switch (status) {
    case "scheduled":
      return "border-sky-200 bg-sky-50 text-sky-700"
    case "boarding":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "departed":
      return "border-violet-200 bg-violet-50 text-violet-700"
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-700"
    default:
      return "border-primary/20 bg-primary/5 text-primary"
  }
}

/* ------------------------------------------------------------------ */
/* Recurrence generation + conflict validation (pure, unit-tested)    */
/* ------------------------------------------------------------------ */

export type BulkFrequency = "once" | "daily" | "weekly" | "weekdays"

export type BulkConfig = {
  startDate: string // yyyy-MM-dd (local)
  endDate: string
  departureTime: string // HH:mm
  durationMinutes: number
  frequency: BulkFrequency
  weekdays: number[] // 0 = Sunday .. 6 = Saturday
}

/**
 * One Date per eligible departure day, at the configured local departure time.
 * "once" uses startDate only; "daily"/"weekdays"/"weekly" walk the inclusive range.
 */
export function generateDepartures(cfg: BulkConfig): Date[] {
  const [h, m] = cfg.departureTime.split(":").map(Number)
  const start = parseISO(cfg.startDate)
  const end = parseISO(cfg.endDate)
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return []
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return []
  const days = eachDayOfInterval({ start, end }).map((d) =>
    set(d, { hours: h, minutes: m, seconds: 0, milliseconds: 0 })
  )
  if (cfg.frequency === "once") return days.slice(0, 1)
  if (cfg.frequency === "daily") return days
  if (cfg.frequency === "weekly") {
    const weekday = getDay(start)
    return days.filter((d) => getDay(d) === weekday)
  }
  const picked = new Set(cfg.weekdays)
  return days.filter((d) => picked.has(getDay(d)))
}

export type ExistingTrip = {
  id?: string
  vessel_id: string
  route_id: string
  departure_at: string
  arrival_at: string
  status: string
}

export type Proposal = {
  key: string
  departureAt: Date
  arrivalAt: Date
  severity: "ok" | "warning" | "error"
  reasons: string[]
}

const fmt = (d: Date) =>
  d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

/**
 * Classifies each proposed departure against existing trips and the rest of the batch.
 * Overlaps/duplicates for the same vessel are errors; a gap under the configured
 * turnaround is a warning. Cancelled trips never block a slot.
 */
export function validateProposals(opts: {
  departures: Date[]
  durationMinutes: number
  turnaroundMinutes: number
  existing: ExistingTrip[]
  vesselId: string
  routeId: string
  vesselActive?: boolean
  portsActive?: boolean
  now?: Date
}): Proposal[] {
  const {
    departures,
    durationMinutes,
    turnaroundMinutes,
    existing,
    vesselId,
    routeId,
    vesselActive = true,
    portsActive = true,
  } = opts
  const now = opts.now ?? new Date()
  const live = existing.filter((t) => t.status !== "cancelled")
  const intervals = live.map((t) => ({
    trip: t,
    start: new Date(t.departure_at).getTime(),
    end: new Date(t.arrival_at).getTime(),
  }))
  const batchCounts = new Map<number, number>()
  for (const d of departures) batchCounts.set(d.getTime(), (batchCounts.get(d.getTime()) ?? 0) + 1)
  const proposed = departures.map((departureAt, index) => ({
    index,
    start: departureAt.getTime(),
    end: addMinutes(departureAt, durationMinutes).getTime(),
  }))
  const durationValid = Number.isFinite(durationMinutes) && durationMinutes > 0

  return departures.map((departureAt, index) => {
    const arrivalAt = addMinutes(departureAt, durationMinutes)
    const reasons = new Set<string>()
    let severity: Proposal["severity"] = "ok"

    const flag = (level: Proposal["severity"], reason: string) => {
      if (level === "error" || (level === "warning" && severity === "ok")) severity = level
      reasons.add(reason)
    }

    if (!vesselActive) flag("error", "Vessel is not active")
    if (!portsActive) flag("error", "Origin or destination port is inactive")
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) flag("error", "Travel duration must be positive")
    if (departureAt.getTime() <= now.getTime()) flag("error", "Departure is in the past")
    if ((batchCounts.get(departureAt.getTime()) ?? 0) > 1) flag("error", "Duplicate departure generated in this batch")

    const startMs = departureAt.getTime()
    const endMs = arrivalAt.getTime()

    // Generated departures must also clear each other, not just the database.
    if (durationValid) {
      for (const other of proposed) {
        if (other.index === index) continue
        if (startMs < other.end && other.start < endMs) {
          flag("error", `Overlaps another generated departure at ${fmt(new Date(other.start))}`)
          continue
        }
        const gaps = [other.start - endMs, startMs - other.end].filter((g) => g >= 0)
        if (turnaroundMinutes > 0 && gaps.some((g) => g < turnaroundMinutes * 60_000)) {
          flag("warning", `Less than ${turnaroundMinutes} min turnaround around another generated departure`)
        }
      }
    }

    for (const { trip: t, start: eStart, end: eEnd } of intervals) {
      const sameVessel = t.vessel_id === vesselId
      const sameDeparture = eStart === startMs
      if (sameVessel && sameDeparture) {
        flag("error", `Duplicate: this vessel already departs at ${fmt(new Date(eStart))}`)
        continue
      }
      if (!sameVessel && sameDeparture && t.route_id === routeId) {
        flag("warning", `Another vessel already departs this route at ${fmt(new Date(eStart))}`)
      }
      if (!sameVessel) continue
      if (startMs < eEnd && eStart < endMs) {
        flag("error", `Vessel conflict with the trip departing ${fmt(new Date(eStart))}`)
        continue
      }
      const gapAfter = startMs - eEnd
      const gapBefore = eStart - endMs
      const gaps = [gapAfter, gapBefore].filter((g) => g >= 0)
      if (turnaroundMinutes > 0 && gaps.some((g) => g < turnaroundMinutes * 60_000)) {
        flag("warning", `Less than ${turnaroundMinutes} min turnaround around ${fmt(new Date(eStart))}`)
      }
    }

    return { key: departureAt.toISOString(), departureAt, arrivalAt, severity, reasons: [...reasons] }
  })
}

/** Counts used by the preview summary. */
export function summarize(rows: Proposal[]) {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.severity === "ok").length,
    warnings: rows.filter((r) => r.severity === "warning").length,
    invalid: rows.filter((r) => r.severity === "error").length,
  }
}

/* ------------------------------------------------------------------ */
/* Supabase data access                                               */
/* ------------------------------------------------------------------ */

function esc(v: string) {
  return v.replace(/[%(),]/g, " ").trim()
}

export type SearchIds = {
  vesselIds: string[]
  routeIds: string[]
  portIds: string[]
  tripId: string | null
  status: string | null
  date: string | null
  exactDepartureAt: string | null
}

/** Resolves free text to server-side filterable ids. Never filters only visible rows. */
export async function resolveTripSearch(raw: string): Promise<SearchIds> {
  const empty: SearchIds = {
    vesselIds: [],
    routeIds: [],
    portIds: [],
    tripId: null,
    status: null,
    date: null,
    exactDepartureAt: null,
  }
  const q = raw.trim()
  if (!supabase || !q) return empty

  const voyage = q.match(VOYAGE_REF_RE)
  if (voyage) {
    const [, routeCode, day, time] = voyage
    const y = Number(day.slice(0, 4))
    const mo = Number(day.slice(4, 6))
    const d = Number(day.slice(6, 8))
    const h = Number(time.slice(0, 2))
    const mi = Number(time.slice(2, 4))
    const { data: routes } = await supabase.from("routes").select("id").ilike("code", routeCode.trim())
    if (!routes?.length) return { ...empty, tripId: NO_MATCH_ID }
    return {
      ...empty,
      routeIds: routes.map((r: any) => r.id),
      exactDepartureAt: new Date(y, mo - 1, d, h, mi).toISOString(),
    }
  }

  const ids: SearchIds = { ...empty }
  if (UUID_RE.test(q)) ids.tripId = q
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) ids.date = q
  const status = TRIP_STATUSES.find((s) => s === q.toLowerCase())
  if (status) ids.status = status

  const needle = esc(q)
  if (!needle) return ids
  const [v, r, p] = await Promise.all([
    supabase.from("vessels").select("id").or(`name.ilike.%${needle}%,code.ilike.%${needle}%`),
    supabase.from("routes").select("id").ilike("code", `%${needle}%`),
    supabase.from("ports").select("id").or(`name.ilike.%${needle}%,city.ilike.%${needle}%,code.ilike.%${needle}%`),
  ])
  ids.vesselIds = (v.data ?? []).map((x: any) => x.id)
  ids.routeIds = (r.data ?? []).map((x: any) => x.id)
  ids.portIds = (p.data ?? []).map((x: any) => x.id)
  return ids
}

export async function fetchTrips(opts: {
  filters: TripFilters
  search?: SearchIds | null
  page?: number
  pageSize?: number
  limit?: number
  order?: "asc" | "desc"
}): Promise<{ rows: TripRow[]; count: number; error: string | null }> {
  if (!supabase) return { rows: [], count: 0, error: "Supabase is not configured." }
  const { filters, search, page = 0, pageSize = 10, limit, order = "asc" } = opts
  let query = supabase.from("trips").select(TRIP_SELECT, { count: "exact" })

  let from = filters.from ? startOfDay(parseISO(filters.from)).toISOString() : null
  let to = filters.to ? startOfDay(addDays(parseISO(filters.to), 1)).toISOString() : null
  if (search?.date) {
    from = startOfDay(parseISO(search.date)).toISOString()
    to = startOfDay(addDays(parseISO(search.date), 1)).toISOString()
  }
  if (search?.exactDepartureAt) query = query.eq("departure_at", search.exactDepartureAt)
  if (from) query = query.gte("departure_at", from)
  if (to) query = query.lt("departure_at", to)
  if (filters.status !== "all") query = query.eq("status", filters.status)
  if (filters.vesselId !== "all") query = query.eq("vessel_id", filters.vesselId)
  if (filters.routeId !== "all") query = query.eq("route_id", filters.routeId)

  const ors: string[] = []
  if (search) {
    if (search.vesselIds.length) ors.push(`vessel_id.in.(${search.vesselIds.join(",")})`)
    if (search.routeIds.length) ors.push(`route_id.in.(${search.routeIds.join(",")})`)
    if (search.portIds.length) {
      ors.push(`departure_port_id.in.(${search.portIds.join(",")})`)
      ors.push(`arrival_port_id.in.(${search.portIds.join(",")})`)
    }
    if (search.tripId) ors.push(`id.eq.${search.tripId}`)
    if (search.status) ors.push(`status.eq.${search.status}`)
    if (ors.length) query = query.or(ors.join(","))
    else if (filters.q.trim() && !search.date && !search.exactDepartureAt) query = query.eq("id", NO_MATCH_ID)
  }

  query = query.order("departure_at", { ascending: order === "asc" })
  if (limit != null) query = query.limit(limit)
  else query = query.range(page * pageSize, page * pageSize + pageSize - 1)

  const { data, error, count } = await query
  if (error) return { rows: [], count: 0, error: error.message }
  return { rows: (data ?? []) as unknown as TripRow[], count: count ?? 0, error: null }
}

export async function fetchAvailability(tripIds: string[]): Promise<{
  byTrip: Map<string, Availability>
  error: string | null
}> {
  const byTrip = new Map<string, Availability>()
  if (!supabase || tripIds.length === 0) return { byTrip, error: null }
  // PostgREST in.(...) lives in the URL; keep batches small enough to stay under gateway limits.
  const batches: string[][] = []
  for (let i = 0; i < tripIds.length; i += 100) batches.push(tripIds.slice(i, i + 100))
  const responses = await Promise.all(
    batches.map((ids) =>
      supabase!
        .from("trip_accommodation_inventory")
        .select("trip_id, capacity, booked, held, is_active, vessel_accommodations(name)")
        .in("trip_id", ids)
        .eq("is_active", true)
    )
  )
  const failed = responses.find((r) => r.error)
  if (failed) return { byTrip, error: failed.error?.message ?? "Could not load availability." }

  for (const row of responses.flatMap((r) => (r.data ?? []) as any[])) {
    const current =
      byTrip.get(row.trip_id) ??
      ({ capacity: 0, booked: 0, held: 0, available: 0, classes: [] } as Availability)
    const capacity = Number(row.capacity) || 0
    const booked = Number(row.booked) || 0
    const held = Number(row.held) || 0
    const available = Math.max(0, capacity - booked - held)
    current.capacity += capacity
    current.booked += booked
    current.held += held
    current.available += available
    current.classes.push({
      name: row.vessel_accommodations?.name ?? "Accommodation",
      capacity,
      available,
    })
    byTrip.set(row.trip_id, current)
  }
  return { byTrip, error: null }
}

export async function fetchBookingCounts(tripIds: string[]): Promise<{
  counts: Map<string, number>
  error: string | null
}> {
  const counts = new Map<string, number>()
  if (!supabase || tripIds.length === 0) return { counts, error: null }
  const { data, error } = await supabase
    .from("bookings")
    .select("trip_id, status")
    .in("trip_id", tripIds)
    .in("status", ["held", "confirmed"])
  if (error) return { counts, error: error.message }
  for (const row of (data ?? []) as any[]) counts.set(row.trip_id, (counts.get(row.trip_id) ?? 0) + 1)
  return { counts, error: null }
}

export async function fetchTripRefs(): Promise<{ refs: TripRefs | null; error: string | null }> {
  if (!supabase) return { refs: null, error: "Supabase is not configured." }
  const [v, r, p, a, s] = await Promise.all([
    supabase.from("vessels").select("id, code, name, status, capacity").order("name"),
    supabase
      .from("routes")
      .select("id, code, origin_port_id, destination_port_id, estimated_duration_minutes, distance_km")
      .order("code"),
    supabase.from("ports").select("id, code, name, city, active").order("name"),
    supabase
      .from("vessel_accommodations")
      .select("id, vessel_id, code, name, capacity, fare_amount, is_active")
      .eq("is_active", true)
      .order("fare_amount"),
    supabase
      .from("app_settings")
      .select("key, value")
      .eq("key", "booking_close_hours_before_departure")
      .maybeSingle(),
  ])
  const error = v.error || r.error || p.error || a.error || null
  if (error) return { refs: null, error: error.message }
  return {
    refs: {
      vessels: (v.data ?? []) as VesselOption[],
      routes: (r.data ?? []) as RouteOption[],
      ports: (p.data ?? []) as PortOption[],
      accommodations: (a.data ?? []) as AccommodationOption[],
      bookingCloseHours: Math.max(0, Number((s.data as any)?.value ?? 6) || 6),
    },
    error: null,
  }
}

/** Fetches trips that could overlap a proposed vessel schedule. */
export async function fetchExistingTripsForRange(opts: {
  from: Date
  to: Date
  bufferMinutes?: number
}): Promise<{ rows: ExistingTrip[]; error: string | null }> {
  if (!supabase) return { rows: [], error: "Supabase is not configured." }
  const buffer = opts.bufferMinutes ?? 0
  const { data, error, count } = await supabase
    .from("trips")
    .select("id, vessel_id, route_id, departure_at, arrival_at, status", { count: "exact" })
    .neq("status", "cancelled")
    .gte("arrival_at", addMinutes(opts.from, -buffer).toISOString())
    .lte("departure_at", addMinutes(opts.to, buffer).toISOString())
    .limit(1000)
  if (error) return { rows: [], error: error.message }
  const rows = (data ?? []) as ExistingTrip[]
  // Fail closed: a truncated conflict check is worse than refusing the batch.
  if (count != null && count > rows.length) {
    return { rows: [], error: "Too many trips in this range to verify conflicts. Narrow the date range." }
  }
  return { rows, error: null }
}

/** Single-trip conflict check for create/edit. */
export async function findTripConflict(opts: {
  vesselId: string
  routeId: string
  departureAt: Date
  arrivalAt: Date
  excludeId?: string
}): Promise<string | null> {
  const { rows, error } = await fetchExistingTripsForRange({
    from: addMinutes(opts.departureAt, -1440),
    to: addMinutes(opts.arrivalAt, 1440),
  })
  if (error) return `Could not check conflicts: ${error}`
  const start = opts.departureAt.getTime()
  const end = opts.arrivalAt.getTime()
  for (const t of rows) {
    if (opts.excludeId && t.id === opts.excludeId) continue
    if (t.vessel_id !== opts.vesselId) continue
    const eStart = new Date(t.departure_at).getTime()
    const eEnd = new Date(t.arrival_at).getTime()
    if (eStart === start) return `This vessel already departs at ${formatTripDateTime(t.departure_at)}.`
    if (start < eEnd && eStart < end) return `Vessel conflict with the trip departing ${formatTripDateTime(t.departure_at)}.`
  }
  return null
}
