import * as React from "react"
import { Link } from "react-router-dom"
import { SearchWidget } from "@/components/booking/SearchWidget"
import { Header } from "@/components/layout/Header"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"
import {
  Ship,
  Anchor,
  CalendarDays,
  BedDouble,
  Armchair,
  Users,
  Star,
  Crown,
  Sparkles,
  ArrowRight,
  MapPin,
} from "lucide-react"

// Fallback list (matches supabase.sql seed) so the page advertises even without env
const SEED_PORTS = [
  { code: "MNL", name: "Manila North Harbor", city: "Manila" },
  { code: "CEB", name: "Cebu Port", city: "Cebu City" },
  { code: "ILO", name: "Iloilo Port", city: "Iloilo City" },
  { code: "BCD", name: "Bacolod Port", city: "Bacolod City" },
  { code: "CGY", name: "Cagayan de Oro Port", city: "Cagayan de Oro" },
  { code: "DVO", name: "Davao Port", city: "Davao City" },
  { code: "BTG", name: "Batangas Port", city: "Batangas City" },
  { code: "TAG", name: "Tagbilaran Port", city: "Tagbilaran City" },
]

const ACCOMMODATIONS = [
  { name: "Super Value", desc: "Open-air bunks at the lowest fare. Best for budget trips.", icon: Armchair, accent: "text-sky-600 bg-sky-50" },
  { name: "Tourist Class", desc: "Air-conditioned reclining seats with ample legroom.", icon: Users, accent: "text-emerald-600 bg-emerald-50" },
  { name: "Economy Cabin", desc: "Shared 4-berth cabins. Sleep through the crossing.", icon: BedDouble, accent: "text-violet-600 bg-violet-50" },
  { name: "Business Class", desc: "Wide leather seats, priority boarding, hot meals.", icon: Star, accent: "text-amber-600 bg-amber-50" },
  { name: "Family Suite", desc: "Private room for 4 with bunks and entertainment.", icon: Sparkles, accent: "text-pink-600 bg-pink-50" },
  { name: "Private Suite", desc: "Your own cabin with bath, bed, and ocean view.", icon: Crown, accent: "text-indigo-600 bg-indigo-50" },
]

const fmtPeso = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Departure = {
  id: string
  departure_at: string
  fare_from: number | null
  routeCode: string
  vesselName: string
  from: string
  to: string
}

export function Home() {
  const [ports, setPorts] = React.useState(SEED_PORTS)
  const [departures, setDepartures] = React.useState<Departure[]>([])

  React.useEffect(() => {
    if (!supabase) return
    let cancelled = false
    ;(async () => {
      try {
        const { data: p } = await supabase!.from("ports").select("code, name, city").eq("active", true).order("name").limit(8)
        if (!cancelled && p && p.length > 0) setPorts(p)
        const { data: trips } = await supabase!
          .from("trips")
          .select("id, departure_at, fare_from, route_id, vessel_id")
          .gte("departure_at", new Date().toISOString())
          .order("departure_at")
          .limit(3)
        if (!cancelled && trips && trips.length > 0) {
          const routeIds = [...new Set(trips.map((t) => t.route_id))]
          const vesselIds = [...new Set(trips.map((t) => t.vessel_id))]
          const [{ data: routes }, { data: vessels }] = await Promise.all([
            supabase!.from("routes").select("id, code, origin_port_id, destination_port_id").in("id", routeIds),
            supabase!.from("vessels").select("id, name").in("id", vesselIds),
          ])
          const portIds = [...new Set([...(routes ?? []).flatMap((r) => [r.origin_port_id, r.destination_port_id])])]
          const { data: dp } = portIds.length > 0
            ? await supabase!.from("ports").select("id, code").in("id", portIds)
            : { data: [] as any[] }
          if (cancelled) return
          const portById = new Map((dp ?? []).map((x) => [x.id, x.code]))
          const routeById = new Map((routes ?? []).map((r) => [r.id, r]))
          const vesselById = new Map((vessels ?? []).map((v) => [v.id, v.name]))
          setDepartures(
            trips.map((t) => {
              const route = routeById.get(t.route_id)
              return {
                id: t.id,
                departure_at: t.departure_at,
                fare_from: t.fare_from,
                routeCode: route?.code ?? "--",
                vesselName: vesselById.get(t.vessel_id) ?? "--",
                from: portById.get(route?.origin_port_id) ?? "--",
                to: portById.get(route?.destination_port_id) ?? "--",
              }
            })
          )
        }
      } catch {
        // keep seed/fallback content
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-br from-primary via-blue-700 to-violet-800 py-14 md:py-24">
          <div className="absolute inset-0 opacity-10">
            <Ship className="absolute -right-10 -top-10 h-72 w-72 text-white" />
            <Anchor className="absolute left-10 bottom-0 h-40 w-40 text-white" />
          </div>
          <div className="relative container mx-auto px-4 text-center space-y-4 mb-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1 text-sm text-white backdrop-blur">
              <Ship className="h-4 w-4" />
              Ferry Travel Made Simple
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-white">
              Sail Across the Philippines
            </h1>
            <p className="text-lg text-blue-100 max-w-2xl mx-auto">
              Book your ferry trip with ease. Search routes, compare fares, and secure your seat in minutes.
            </p>
          </div>
          <div className="relative container mx-auto px-4">
            <SearchWidget />
          </div>
        </section>

        {/* Ports */}
        <section className="container mx-auto px-4 py-12">
          <div className="flex items-end justify-between mb-6">
            <div>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-primary via-blue-600 to-violet-600 bg-clip-text text-transparent">
                8 Major Ports
              </h2>
              <p className="text-muted-foreground mt-1">Manila, Cebu, Iloilo, Bacolod and more destinations</p>
            </div>
            <Link to="/trips" className="hidden sm:inline-flex items-center gap-1 text-sm text-primary hover:underline">
              All trips <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {ports.map((p) => (
              <Card key={p.code} className="shadow-sm transition-shadow hover:shadow-md">
                <CardContent className="p-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-600 text-xs font-bold text-white">
                    {p.code}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {p.city}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Departures */}
        <section className="bg-muted/40 border-y">
          <div className="container mx-auto px-4 py-12">
            <div className="flex items-center gap-2 mb-1">
              <CalendarDays className="h-5 w-5 text-emerald-600" />
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">
                Daily Departures
              </h2>
            </div>
            <p className="text-muted-foreground mb-6">Evening departures at 8 PM, arrive by 8 AM next day</p>
            {departures.length === 0 ? (
              <Card className="shadow-sm">
                <CardContent className="p-6 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">New schedules are posted daily — search any route to plan ahead.</p>
                  <Link to="/trips">
                    <Button className="gap-2 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-600/90 hover:to-blue-600/90">
                      Browse trips <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-3 gap-4">
                {departures.map((d) => (
                  <Card key={d.id} className="shadow-sm transition-shadow hover:shadow-md">
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">{d.routeCode}</Badge>
                        <span className="text-sm font-bold text-primary">
                          ₱{d.fare_from !== null ? fmtPeso.format(Number(d.fare_from)) : "--"}
                        </span>
                      </div>
                      <p className="text-lg font-bold">
                        {d.from} → {d.to}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {d.vesselName} · {new Date(d.departure_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </p>
                      <Link to={`/trips/${d.id}`}>
                        <Button className="w-full gap-2 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-600/90 hover:to-blue-600/90">
                          Book now <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Accommodations */}
        <section className="container mx-auto px-4 py-12">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight bg-gradient-to-r from-amber-600 via-pink-600 to-violet-600 bg-clip-text text-transparent">
            6 Accommodation Types
          </h2>
          <p className="text-muted-foreground mt-1 mb-6">From Super Value to Private Suite for every budget</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ACCOMMODATIONS.map((a) => (
              <Card key={a.name} className="shadow-sm transition-shadow hover:shadow-md overflow-hidden">
                <CardContent className="p-5 space-y-2">
                  <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${a.accent}`}>
                    <a.icon className="h-5 w-5" />
                  </span>
                  <p className="font-bold">{a.name}</p>
                  <p className="text-sm text-muted-foreground">{a.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="container mx-auto px-4 pb-14">
          <div className="rounded-2xl bg-gradient-to-r from-primary via-blue-700 to-violet-800 p-8 md:p-10 text-center space-y-4 shadow-lg">
            <h2 className="text-2xl md:text-3xl font-bold text-white">Ready to sail tonight?</h2>
            <p className="text-blue-100 max-w-xl mx-auto">Evening departures fill fast. Reserve your seat in under two minutes.</p>
            <Link to="/trips">
              <Button size="lg" className="bg-white text-primary hover:bg-blue-50 font-bold">
                Find your trip <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}

export default Home
