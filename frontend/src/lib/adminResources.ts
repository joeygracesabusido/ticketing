import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"

// Server-side list/search layer for the shipping admin pages.
// Every mutation is still performed by the page so RLS stays the only authority.

export const PAGE_SIZE = 10

export type ListResult<T> = { rows: T[]; total: number; error: string | null }

export type Port = {
  id: string
  code: string
  name: string
  city: string
  province: string | null
  country: string
  active: boolean
}

export type Vessel = {
  id: string
  code: string
  name: string
  capacity: number | null
  status: string
}

export type PortOption = { id: string; code: string; name: string; city: string }
export type VesselOption = { id: string; code: string; name: string; status: string }

export type RouteRow = {
  id: string
  code: string
  origin_port_id: string
  destination_port_id: string
  distance_km: number | null
  estimated_duration_minutes: number | null
  origin: PortOption | null
  destination: PortOption | null
}

export type Accommodation = {
  id: string
  vessel_id: string
  code: string
  name: string
  capacity: number
  fare_amount: number
  is_active: boolean
  vessels: { id: string; code: string; name: string } | null
}

export type PortStatus = "all" | "active" | "inactive"
export type AccommodationStatus = "all" | "active" | "inactive"

// PostgREST treats , ( ) as filter syntax; strip them so user input can never
// break the or= expression.
export function sanitizeSearch(value: string) {
  return value
    .replace(/[%(),"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function ilikePattern(value: string) {
  return `%${sanitizeSearch(value)}%`
}

export function pageRange(page: number, pageSize = PAGE_SIZE) {
  const safePage = Math.max(0, Math.floor(page) || 0)
  const from = safePage * pageSize
  return { from, to: from + pageSize - 1 }
}

export function pageCount(total: number, pageSize = PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function clampPage(page: number, total: number, pageSize = PAGE_SIZE) {
  return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1)
}

export function friendlyDbError(message: string, entity: string) {
  if (/duplicate key|unique constraint/i.test(message)) {
    return `A ${entity} with this code already exists.`
  }
  if (/foreign key/i.test(message)) {
    return `This ${entity} is still referenced by other records. Remove those references first.`
  }
  return message
}

function fail<T>(error: string): ListResult<T> {
  return { rows: [], total: 0, error }
}

async function runList<T>(query: any): Promise<ListResult<T>> {
  const { data, error, count } = await query
  if (error) return fail<T>(error.message)
  return { rows: (data ?? []) as T[], total: count ?? 0, error: null }
}

export async function listPorts(opts: {
  search?: string
  status?: PortStatus
  page?: number
  pageSize?: number
} = {}): Promise<ListResult<Port>> {
  if (!supabase) return fail<Port>(missingSupabaseEnvMessage)
  const { search = "", status = "all", page = 0, pageSize = PAGE_SIZE } = opts
  let query: any = supabase.from("ports").select("*", { count: "exact" }).order("code")
  if (status === "active") query = query.eq("active", true)
  if (status === "inactive") query = query.eq("active", false)
  if (sanitizeSearch(search)) {
    const p = ilikePattern(search)
    query = query.or(
      `code.ilike.${p},name.ilike.${p},city.ilike.${p},province.ilike.${p},country.ilike.${p}`
    )
  }
  const { from, to } = pageRange(page, pageSize)
  return runList<Port>(query.range(from, to))
}

export async function listVessels(opts: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
} = {}): Promise<ListResult<Vessel>> {
  if (!supabase) return fail<Vessel>(missingSupabaseEnvMessage)
  const { search = "", status = "all", page = 0, pageSize = PAGE_SIZE } = opts
  let query: any = supabase.from("vessels").select("*", { count: "exact" }).order("code")
  if (status !== "all") query = query.eq("status", status)
  if (sanitizeSearch(search)) {
    const p = ilikePattern(search)
    query = query.or(`code.ilike.${p},name.ilike.${p}`)
  }
  const { from, to } = pageRange(page, pageSize)
  return runList<Vessel>(query.range(from, to))
}

export async function listRoutes(opts: {
  search?: string
  originId?: string
  destinationId?: string
  page?: number
  pageSize?: number
} = {}): Promise<ListResult<RouteRow>> {
  if (!supabase) return fail<RouteRow>(missingSupabaseEnvMessage)
  const { search = "", originId = "", destinationId = "", page = 0, pageSize = PAGE_SIZE } = opts
  let query: any = supabase
    .from("routes")
    .select(
      "*, origin:ports!routes_origin_port_id_fkey(id,code,name,city), destination:ports!routes_destination_port_id_fkey(id,code,name,city)",
      { count: "exact" }
    )
    .order("code")
  if (originId) query = query.eq("origin_port_id", originId)
  if (destinationId) query = query.eq("destination_port_id", destinationId)

  if (sanitizeSearch(search)) {
    const p = ilikePattern(search)
    const { data: ports, error } = await supabase
      .from("ports")
      .select("id")
      .or(`code.ilike.${p},name.ilike.${p},city.ilike.${p}`)
    if (error) return fail<RouteRow>(error.message)
    const ids = (ports ?? []).map((port: { id: string }) => port.id)
    const filters = [`code.ilike.${p}`]
    if (ids.length > 0) {
      filters.push(`origin_port_id.in.(${ids.join(",")})`, `destination_port_id.in.(${ids.join(",")})`)
    }
    query = query.or(filters.join(","))
  }

  const { from, to } = pageRange(page, pageSize)
  return runList<RouteRow>(query.range(from, to))
}

export async function listAccommodations(opts: {
  search?: string
  vesselId?: string
  status?: AccommodationStatus
  page?: number
  pageSize?: number
} = {}): Promise<ListResult<Accommodation>> {
  if (!supabase) return fail<Accommodation>(missingSupabaseEnvMessage)
  const { search = "", vesselId = "", status = "all", page = 0, pageSize = PAGE_SIZE } = opts
  let query: any = supabase
    .from("vessel_accommodations")
    .select("*, vessels(id,code,name)", { count: "exact" })
    .order("code")
  if (vesselId) query = query.eq("vessel_id", vesselId)
  if (status === "active") query = query.eq("is_active", true)
  if (status === "inactive") query = query.eq("is_active", false)

  if (sanitizeSearch(search)) {
    const p = ilikePattern(search)
    const { data: vessels, error } = await supabase
      .from("vessels")
      .select("id")
      .or(`code.ilike.${p},name.ilike.${p}`)
    if (error) return fail<Accommodation>(error.message)
    const ids = (vessels ?? []).map((vessel: { id: string }) => vessel.id)
    const filters = [`code.ilike.${p}`, `name.ilike.${p}`]
    if (ids.length > 0) filters.push(`vessel_id.in.(${ids.join(",")})`)
    query = query.or(filters.join(","))
  }

  const { from, to } = pageRange(page, pageSize)
  return runList<Accommodation>(query.range(from, to))
}

export async function listPortOptions(): Promise<{ rows: PortOption[]; error: string | null }> {
  if (!supabase) return { rows: [], error: missingSupabaseEnvMessage }
  const { data, error } = await supabase.from("ports").select("id,code,name,city").order("code")
  return error ? { rows: [], error: error.message } : { rows: (data ?? []) as PortOption[], error: null }
}

export async function listVesselOptions(): Promise<{ rows: VesselOption[]; error: string | null }> {
  if (!supabase) return { rows: [], error: missingSupabaseEnvMessage }
  const { data, error } = await supabase.from("vessels").select("id,code,name,status").order("code")
  return error ? { rows: [], error: error.message } : { rows: (data ?? []) as VesselOption[], error: null }
}

async function codeTaken(
  table: "ports" | "vessels" | "routes",
  code: string,
  excludeId?: string
): Promise<{ taken: boolean; error: string | null }> {
  if (!supabase) return { taken: false, error: missingSupabaseEnvMessage }
  let query: any = supabase.from(table).select("id").eq("code", code.trim().toUpperCase()).limit(1)
  if (excludeId) query = query.neq("id", excludeId)
  const { data, error } = await query
  return { taken: Boolean(data && data.length > 0), error: error?.message ?? null }
}

export const portCodeExists = (code: string, excludeId?: string) => codeTaken("ports", code, excludeId)
export const vesselCodeExists = (code: string, excludeId?: string) => codeTaken("vessels", code, excludeId)
export const routeCodeExists = (code: string, excludeId?: string) => codeTaken("routes", code, excludeId)

export async function accommodationCodeExists(
  vesselId: string,
  code: string,
  excludeId?: string
): Promise<{ taken: boolean; error: string | null }> {
  if (!supabase) return { taken: false, error: missingSupabaseEnvMessage }
  let query: any = supabase
    .from("vessel_accommodations")
    .select("id")
    .eq("vessel_id", vesselId)
    .eq("code", code.trim().toUpperCase())
    .limit(1)
  if (excludeId) query = query.neq("id", excludeId)
  const { data, error } = await query
  return { taken: Boolean(data && data.length > 0), error: error?.message ?? null }
}

export async function portReferences(
  id: string
): Promise<{ routes: number; trips: number; error: string | null }> {
  if (!supabase) return { routes: 0, trips: 0, error: missingSupabaseEnvMessage }
  const [routes, trips] = await Promise.all([
    supabase
      .from("routes")
      .select("id", { count: "exact", head: true })
      .or(`origin_port_id.eq.${id},destination_port_id.eq.${id}`),
    supabase
      .from("trips")
      .select("id", { count: "exact", head: true })
      .or(`departure_port_id.eq.${id},arrival_port_id.eq.${id}`),
  ])
  if (routes.error) return { routes: 0, trips: 0, error: routes.error.message }
  if (trips.error) return { routes: 0, trips: 0, error: trips.error.message }
  return { routes: routes.count ?? 0, trips: trips.count ?? 0, error: null }
}

export async function vesselReferences(
  id: string
): Promise<{ trips: number; bookings: number; accommodations: number; error: string | null }> {
  if (!supabase)
    return { trips: 0, bookings: 0, accommodations: 0, error: missingSupabaseEnvMessage }
  const { data: accommodations, error: accommodationError } = await supabase
    .from("vessel_accommodations")
    .select("id")
    .eq("vessel_id", id)
  if (accommodationError)
    return { trips: 0, bookings: 0, accommodations: 0, error: accommodationError.message }
  const ids = (accommodations ?? []).map((row: { id: string }) => row.id)
  const [trips, bookings] = await Promise.all([
    supabase.from("trips").select("id", { count: "exact", head: true }).eq("vessel_id", id),
    ids.length > 0
      ? supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .in("accommodation_id", ids)
      : Promise.resolve({ count: 0, error: null }),
  ])
  if (trips.error) return { trips: 0, bookings: 0, accommodations: ids.length, error: trips.error.message }
  if (bookings.error)
    return { trips: 0, bookings: 0, accommodations: ids.length, error: bookings.error.message }
  return {
    trips: trips.count ?? 0,
    bookings: bookings.count ?? 0,
    accommodations: ids.length,
    error: null,
  }
}

export async function routeReferences(
  id: string
): Promise<{ trips: number; error: string | null }> {
  if (!supabase) return { trips: 0, error: missingSupabaseEnvMessage }
  const { count, error } = await supabase
    .from("trips")
    .select("id", { count: "exact", head: true })
    .eq("route_id", id)
  return error ? { trips: 0, error: error.message } : { trips: count ?? 0, error: null }
}
