import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { Header } from "@/components/layout/Header"
import { TripCard } from "@/components/trips/TripCard"
import { supabase } from "@/lib/supabase"
import { Card, CardContent } from "@/components/ui/card"
import { SearchWidget } from "@/components/booking/SearchWidget"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolvePortId(ref: string): Promise<string | null> {
  if (!supabase) return null
  if (UUID_RE.test(ref)) return ref
  const { data } = await supabase.from("ports").select("id").eq("code", ref.toUpperCase()).single()
  return data?.id ?? null
}

export function Trips() {
  const [searchParams] = useSearchParams()
  const origin = searchParams.get("origin")
  const destination = searchParams.get("destination")
  const date = searchParams.get("date")
  const pax = searchParams.get("pax") || "1"

  const shouldQuery = Boolean(origin && destination && date)

  const [trips, setTrips] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!shouldQuery || !origin || !destination || !date) return
    if (!supabase) {
      setError("Missing Supabase env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).")
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const [originId, destinationId] = await Promise.all([resolvePortId(origin), resolvePortId(destination)])
        if (cancelled) return
        if (!originId || !destinationId) {
          setTrips([])
          setLoading(false)
          return
        }
        const start = new Date(`${date}T00:00:00`)
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
        const { data: rows, error: tripsError } = await supabase!
          .from("trips")
          .select("id, departure_at, arrival_at, status, fare_from, route_id, vessel_id")
          .eq("departure_port_id", originId)
          .eq("arrival_port_id", destinationId)
          .gte("departure_at", start.toISOString())
          .lt("departure_at", end.toISOString())
          .order("departure_at")
        if (cancelled) return
        if (tripsError) throw new Error(tripsError.message)
        const list = rows ?? []
        if (list.length === 0) {
          setTrips([])
          setLoading(false)
          return
        }
        const routeIds = [...new Set(list.map((t) => t.route_id))]
        const vesselIds = [...new Set(list.map((t) => t.vessel_id))]
        const [{ data: routes }, { data: vessels }] = await Promise.all([
          supabase!.from("routes").select("id, code, origin_port_id, destination_port_id, estimated_duration_minutes").in("id", routeIds),
          supabase!.from("vessels").select("id, code, name, status").in("id", vesselIds),
        ])
        if (cancelled) return
        const portIds = [...new Set([...(routes ?? []).flatMap((r) => [r.origin_port_id, r.destination_port_id])])]
        const { data: ports } = await supabase!.from("ports").select("id, code, name, city").in("id", portIds)
        if (cancelled) return
        const portById = new Map((ports ?? []).map((p) => [p.id, p]))
        const routeById = new Map((routes ?? []).map((r) => [r.id, r]))
        const vesselById = new Map((vessels ?? []).map((v) => [v.id, v]))
        setTrips(
          list.map((t) => {
            const route = routeById.get(t.route_id)
            return {
              id: t.id,
              departureAt: t.departure_at,
              arrivalAt: t.arrival_at,
              status: t.status,
              fareFrom: t.fare_from,
              route: route
                ? {
                    code: route.code,
                    originPort: portById.get(route.origin_port_id),
                    destinationPort: portById.get(route.destination_port_id),
                    estimatedDurationMinutes: route.estimated_duration_minutes,
                  }
                : undefined,
              vessel: vesselById.get(t.vessel_id),
            }
          })
        )
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load trips.")
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [shouldQuery, origin, destination, date])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Available Trips</h1>
          {shouldQuery ? (
            <p className="text-sm text-muted-foreground">
              Showing trips from {origin} to {destination} on {date} for {pax} passenger(s)
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Use the search widget to find trips</p>
          )}
        </div>

        {!shouldQuery && (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground mb-4">No search parameters. Try searching below:</p>
              <SearchWidget />
            </CardContent>
          </Card>
        )}

        {shouldQuery && (
          <>
            {loading && <p className="text-sm text-muted-foreground">Loading trips...</p>}
            {error && (
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-destructive">Failed to load trips: {error}</p>
                </CardContent>
              </Card>
            )}
            {!loading && !error && trips.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center">
                  <p className="text-sm text-muted-foreground">No trips found for the selected route and date.</p>
                  <p className="text-sm text-muted-foreground">Try a different date or check seeded data (MNL → CEB).</p>
                </CardContent>
              </Card>
            )}
            {!loading && trips.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{trips.length} trip(s) found</p>
                {trips.map((trip: any) => (
                  <TripCard key={trip.id} trip={trip} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default Trips
