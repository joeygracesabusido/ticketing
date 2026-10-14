import * as React from "react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Ship, Anchor, Route as RouteIcon, CalendarDays, ArrowRight, Plus } from "lucide-react"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { isAdmin } from "@/lib/roles"

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
  { key: "ports", label: "Ports", icon: Anchor, accent: "text-sky-600" },
  { key: "vessels", label: "Vessels", icon: Ship, accent: "text-emerald-600" },
  { key: "routes", label: "Routes", icon: RouteIcon, accent: "text-violet-600" },
  { key: "trips", label: "Trips", icon: CalendarDays, accent: "text-amber-600" },
]

export function Overview() {
  const { role } = useAuth()
  const admin = isAdmin(role) || role === null // default to admin view while role loads
  const [counts, setCounts] = React.useState<Record<string, number | null>>({})
  const [upcoming, setUpcoming] = React.useState<UpcomingTrip[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-primary via-blue-600 to-violet-600 bg-clip-text text-transparent">{admin ? "Dashboard" : "Operations"}</h1>
        </div>
        <Link to="/dashboard/trips">
          <Button className="gap-2 shadow-sm bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90">
            <Plus className="h-4 w-4" /> New trip
          </Button>
        </Link>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATS.map((s) => (
          <Link key={s.key} to={`/dashboard/${s.key}`} className="block rounded-lg transition-shadow hover:shadow-md">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className={`text-sm font-medium ${s.accent}`}>{s.label}</CardTitle>
              <s.icon className={`h-4 w-4 ${s.accent}`} />
            </CardHeader>
            <CardContent>
              <p className={`text-3xl font-bold ${s.accent}`}>{loading ? "--" : (counts[s.key] ?? "--")}</p>
              <span className="text-xs text-primary inline-flex items-center gap-1 mt-1">
                Manage <ArrowRight className="h-3 w-3" />
              </span>
            </CardContent>
          </Card>
          </Link>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">{admin ? "Upcoming departures" : "Today's operations"}</CardTitle>
          <CardDescription>{admin ? "Next 5 scheduled trips across all routes" : "Next departures — today first"}</CardDescription>
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
