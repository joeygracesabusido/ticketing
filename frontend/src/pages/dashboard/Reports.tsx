import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { supabase } from "@/lib/supabase"

type Row = {
  id: string
  departure_at: string
  status: string
  routeCode: string
  from: string
  to: string
  vesselName: string
  capacity: number | null
  bookingState: "Open" | "Closed" | "Not yet open" | "--"
}

function bookingState(open: string | null, close: string | null, now: number): Row["bookingState"] {
  if (!open && !close) return "--"
  if (open && new Date(open).getTime() > now) return "Not yet open"
  if (close && new Date(close).getTime() < now) return "Closed"
  return "Open"
}

const fmtInt = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 })

export function Reports() {
  const [rows, setRows] = React.useState<Row[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!supabase) {
      setError("Missing Supabase env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).")
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data: trips, error: tripsError } = await supabase!
          .from("trips")
          .select("id, departure_at, status, route_id, vessel_id, booking_open, booking_close")
          .gte("departure_at", new Date().toISOString())
          .order("departure_at")
          .limit(20)
        if (tripsError) throw new Error(tripsError.message)
        const list = trips ?? []
        if (list.length === 0) {
          if (!cancelled) {
            setRows([])
            setLoading(false)
          }
          return
        }
        const routeIds = [...new Set(list.map((t) => t.route_id))]
        const vesselIds = [...new Set(list.map((t) => t.vessel_id))]
        const [{ data: routes }, { data: vessels }] = await Promise.all([
          supabase!.from("routes").select("id, code, origin_port_id, destination_port_id").in("id", routeIds),
          supabase!.from("vessels").select("id, name, capacity").in("id", vesselIds),
        ])
        const portIds = [...new Set([...(routes ?? []).flatMap((r) => [r.origin_port_id, r.destination_port_id])])]
        const { data: ports } = portIds.length > 0
          ? await supabase!.from("ports").select("id, code").in("id", portIds)
          : { data: [] as any[] }
        if (cancelled) return
        const now = Date.now()
        const portById = new Map((ports ?? []).map((p) => [p.id, p.code]))
        const routeById = new Map((routes ?? []).map((r) => [r.id, r]))
        const vesselById = new Map((vessels ?? []).map((v) => [v.id, v]))
        setRows(
          list.map((t) => {
            const route = routeById.get(t.route_id)
            const vessel = vesselById.get(t.vessel_id)
            return {
              id: t.id,
              departure_at: t.departure_at,
              status: t.status,
              routeCode: route?.code ?? "--",
              from: portById.get(route?.origin_port_id) ?? "--",
              to: portById.get(route?.destination_port_id) ?? "--",
              vesselName: vessel?.name ?? "--",
              capacity: (vessel?.capacity as number | null) ?? null,
              bookingState: bookingState(t.booking_open, t.booking_close, now),
            }
          })
        )
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load reports.")
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const openCount = rows.filter((r) => r.bookingState === "Open").length
  const seats = rows.reduce((sum, r) => sum + (r.capacity ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-primary via-blue-600 to-violet-600 bg-clip-text text-transparent">Reports</h1>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-sky-600">Upcoming trips</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-sky-600">{loading ? "--" : rows.length}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-600">Open for booking</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-emerald-600">{loading ? "--" : openCount}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-violet-600">Seats available</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-violet-600">{loading ? "--" : fmtInt.format(seats)}</p>
            <CardDescription>Sum of vessel capacity · no bookings table yet</CardDescription>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">Seat availability</CardTitle>
          <CardDescription>Next 20 departures · available = full capacity (sales not tracked yet)</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <p className="text-sm text-muted-foreground px-6 py-4">Loading...</p>}
          {!loading && rows.length === 0 && !error && (
            <p className="text-sm text-muted-foreground px-6 py-4">No upcoming trips.</p>
          )}
          {rows.length > 0 && (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-sm">
                  <Badge variant="secondary">{r.routeCode}</Badge>
                  <span className="font-medium">
                    {r.from} → {r.to}
                  </span>
                  <span className="text-muted-foreground">{r.vesselName}</span>
                  <span className="text-muted-foreground">
                    {r.capacity !== null ? `${fmtInt.format(r.capacity)} seats` : "Capacity --"}
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {new Date(r.departure_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                  <Badge>{r.bookingState}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Reports
