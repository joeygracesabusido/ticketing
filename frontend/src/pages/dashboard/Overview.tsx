import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { supabase } from "@/lib/supabase"

export function Overview() {
  const [counts, setCounts] = React.useState<Record<string, number | null>>({})
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!supabase) {
      setError("Missing Supabase env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).")
      return
    }
    ;(async () => {
      const out: Record<string, number | null> = {}
      for (const t of ["ports", "vessels", "routes", "trips"]) {
        const { count, error } = await supabase!.from(t).select("*", { count: "exact", head: true })
        if (error) {
          setError(error.message)
          return
        }
        out[t] = count
      }
      setCounts(out)
    })()
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Overview</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {["ports", "vessels", "routes", "trips"].map((t) => (
          <Card key={t}>
            <CardHeader>
              <CardTitle className="text-sm capitalize">{t}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{counts[t] ?? "--"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default Overview
