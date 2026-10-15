import * as React from "react"
import { Link } from "react-router-dom"
import { Header } from "@/components/layout/Header"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatPeso } from "@/lib/fare"
import { formatCountdown, msRemaining } from "@/lib/booking"

export function MyBookings() {
  const [rows, setRows] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    if (!supabase) { setError(missingSupabaseEnvMessage); setLoading(false); return }
    const { data, error } = await supabase.from("bookings").select("*").order("created_at", { ascending: false }).limit(20)
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }
  React.useEffect(() => { load() }, [])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-4">
        <h1 className="text-2xl font-bold">My bookings</h1>
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <Card><CardContent className="p-6"><p className="text-sm text-destructive">{error}</p></CardContent></Card>}
        {!loading && !error && rows.length === 0 && (
          <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">No bookings yet.</p><Link to="/trips"><Button className="mt-3">Find a trip</Button></Link></CardContent></Card>
        )}
        <div className="space-y-3">
          {rows.map((b) => (
            <Card key={b.id}>
              <CardContent className="p-4 flex flex-wrap items-center gap-3 text-sm">
                <span className="font-mono font-bold">{b.booking_reference}</span>
                <Badge>{b.status}</Badge>
                <span className="text-muted-foreground">₱{formatPeso(Number(b.total_amount))} · {b.pax_count} pax</span>
                {b.status === "held" && <span className="text-muted-foreground">Expires in {formatCountdown(msRemaining(b.expires_at))}</span>}
                <Link to={`/trips/${b.trip_id}`} className="ml-auto"><Button variant="outline" size="sm">View trip</Button></Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}

export default MyBookings
