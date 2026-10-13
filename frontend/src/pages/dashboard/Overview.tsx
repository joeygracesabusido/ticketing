import * as React from "react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Ship, Anchor, Route as RouteIcon, CalendarDays, ArrowRight, Plus } from "lucide-react"
import { supabase } from "@/lib/supabase"

type UpcomingTrip = {
  id: string
  departure_at: string
  status: string
  fare_from: number | null
  routeCode: string
  vesselName: string
  from: string
  to: string
}

const STATS = [
  { key: "ports", label: "Ports", icon: Anchor },
  { key: "vessels", label: "Vessels", icon: Ship },
  { key: "routes", label: "Routes", icon: RouteIcon },
  { key: "trips", label: "Trips", icon: CalendarDays },
]

export function Overview() {
  const [counts, setCounts] = React.useState<Record<string, number | null>>({})
  const [upcoming, setUpcoming] = React.useState<UpcomingTrip[]>([])
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
        const out: Record<string, number | null> = {}
        for (const t of ["ports", "vessels", "routes", "trips"]) {
          const { count, error } = await supabase!.from(t).select("*", { count: "exact", head: true })
          if (error) throw new Error(error.message)
          out[t] = count
        }
        if (cancelled) return
        setCounts(out)
        const { data: rows, error: tripsError } = await supabase!
          .from("trips")
          .select("id, departure_at, status, fare_from, route_id, vessel_id")
          .gte("departure_at", new Date().toISOString())
          .order("departure_at")
          .limit(5)
        if (tripsError) throw new Error(tripsError.message)
        const list = rows ?? []
        if (list.length > 0) {
          const routeIds = [...new Set(list.map((t) => t.route_id))]
          const vesselIds = [...new Set(list.map((t) => t.vessel_id))]
          const [{ data: routes }, { data: vessels }] = await Promise.all([
            supabase!.from("routes").select("id, code, origin_port_id, destination_port_id").in("id", routeIds),
            supabase!.from("vessels").select("id, name").in("id", vesselIds),
          ])
          const portIds = [...new Set([...(routes ?? []).flatMap((r) => [r.origin_port_id, r.destination_port_id])])]
          const { data: ports } = portIds.length > 0
            ? await supabase!.from("ports").select("id, code").in("id", portIds)
            : { data: [] as any[] }
          if (cancelled) return
          const portById = new Map((ports ?? []).map((p) => [p.id, p.code]))
          const routeById = new Map((routes ?? []).map((r) => [r.id, r]))
          const vesselById = new Map((vessels ?? []).map((v) => [v.id, v.name]))
          setUpcoming(
            list.map((t) => {
              const route = routeById.get(t.route_id)
              return {
                id: t.id,
                departure_at: t.departure_at,
                status: t.status,
                fare_from: t.fare_from,
                routeCode: route?.code ?? "--",
                vesselName: vesselById.get(t.vessel_id) ?? "--",
                from: portById.get(route?.origin_port_id) ?? "--",
                to: portById.get(route?.destination_port_id) ?? "--",
              }
            })
          )
        }
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load dashboard.")
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ferry operations at a glance
          </p>
        </div>
        <Link to="/dashboard/trips">
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> New trip
          </Button>
        </Link>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((s) => (
          <Card key={s.key}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{loading ? "--" : (counts[s.key] ?? "--")}</p>
              <Link to={`/dashboard/${s.key}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1">
                Manage <ArrowRight className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming departures</CardTitle>
          <CardDescription>Next 5 scheduled trips across all routes</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && <p className="text-sm text-muted-foreground px-6 py-4">Loading...</p>}
          {!loading && upcoming.length === 0 && !error && (
            <p className="text-sm text-muted-foreground px-6 py-4">No upcoming trips. Add one to get started.</p>
          )}
          {upcoming.length > 0 && (
            <ul className="divide-y">
              {upcoming.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-sm">
                  <Badge variant="secondary">{t.routeCode}</Badge>
                  <span className="font-medium">
                    {t.from} → {t.to}
                  </span>
                  <span className="text-muted-foreground">{t.vesselName}</span>
                  <span className="ml-auto text-muted-foreground">
                    {new Date(t.departure_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                  <Badge>{t.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Overview
