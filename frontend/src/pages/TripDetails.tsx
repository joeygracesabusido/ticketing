import * as React from "react"
import { useParams, Link } from "react-router-dom"
import { Header } from "@/components/layout/Header"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import { ArrowLeft, Ship, Clock, MapPin } from "lucide-react"

export function TripDetails() {
  const { id } = useParams<{ id: string }>()
  const [trip, setTrip] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(Boolean(id))
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!id) return
    if (!supabase) {
      setError("Missing Supabase env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).")
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data: t, error: tripError } = await supabase!
          .from("trips")
          .select("id, departure_at, arrival_at, status, fare_from, booking_open, booking_close, route_id, vessel_id, departure_port_id, arrival_port_id")
          .eq("id", id)
          .single()
        if (cancelled) return
        if (tripError) throw new Error(tripError.message)
        if (!t) {
          setTrip(null)
          setLoading(false)
          return
        }
        const [{ data: route }, { data: vessel }, { data: ports }] = await Promise.all([
          supabase!.from("routes").select("id, code, origin_port_id, destination_port_id, distance_km, estimated_duration_minutes").eq("id", t.route_id).single(),
          supabase!.from("vessels").select("id, code, name, capacity, status").eq("id", t.vessel_id).single(),
          supabase!.from("ports").select("id, code, name, city").in("id", [t.departure_port_id, t.arrival_port_id]),
        ])
        if (cancelled) return
        const portById = new Map((ports ?? []).map((p) => [p.id, p]))
        setTrip({
          id: t.id,
          departureAt: t.departure_at,
          arrivalAt: t.arrival_at,
          status: t.status,
          fareFrom: t.fare_from,
          bookingOpen: t.booking_open,
          bookingClose: t.booking_close,
          route: route
            ? {
                id: route.id,
                code: route.code,
                originPort: portById.get(route.origin_port_id),
                destinationPort: portById.get(route.destination_port_id),
                distanceKm: route.distance_km,
                estimatedDurationMinutes: route.estimated_duration_minutes,
              }
            : undefined,
          vessel,
          departurePort: portById.get(t.departure_port_id),
          arrivalPort: portById.get(t.arrival_port_id),
        })
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load trip.")
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <Link to="/trips" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to trips
        </Link>

        {loading && <p className="text-sm text-muted-foreground">Loading trip details...</p>}
        {error && (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-destructive">Failed to load trip: {error}</p>
            </CardContent>
          </Card>
        )}
        {!loading && !error && !trip && (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">Trip not found.</p>
              <Link to="/">
                <Button variant="outline" className="mt-4">
                  Return Home
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
        {trip && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ship className="h-5 w-5 text-primary" />
                    {trip.vessel?.name}
                    <Badge variant="secondary">{trip.vessel?.code}</Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Route {trip.route?.code}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> Departure
                      </p>
                      <p className="font-medium">{trip.departurePort?.name || trip.route?.originPort?.name}</p>
                      <p className="text-sm text-muted-foreground">{trip.departurePort?.city}</p>
                      <p className="text-sm font-medium">{format(new Date(trip.departureAt), "PPp")}</p>
                      <p className="text-sm">{format(new Date(trip.departureAt), "h:mm a")}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> Arrival
                      </p>
                      <p className="font-medium">{trip.arrivalPort?.name || trip.route?.destinationPort?.name}</p>
                      <p className="text-sm text-muted-foreground">{trip.arrivalPort?.city}</p>
                      <p className="text-sm font-medium">{format(new Date(trip.arrivalAt), "PPp")}</p>
                      <p className="text-sm">{format(new Date(trip.arrivalAt), "h:mm a")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Duration:{" "}
                    {trip.route?.estimatedDurationMinutes
                      ? `${Math.floor(trip.route.estimatedDurationMinutes / 60)}h ${trip.route.estimatedDurationMinutes % 60 ? `${trip.route.estimatedDurationMinutes % 60}m` : ""}`
                      : "12h"}
                  </div>
                  <div className="flex gap-2">
                    <Badge>{trip.status}</Badge>
                    {trip.fareFrom && <Badge variant="outline">From ₱{Number(trip.fareFrom).toLocaleString()}</Badge>}
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Booking Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Fare from</span>
                    <span className="font-bold">₱{trip.fareFrom ? Number(trip.fareFrom).toLocaleString() : "--"}</span>
                  </div>
                  <Button className="w-full" disabled>
                    Continue to Booking (coming soon)
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">Booking flow implemented in next phase</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default TripDetails
