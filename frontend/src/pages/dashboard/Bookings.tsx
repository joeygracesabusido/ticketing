import * as React from "react"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AdminTable, StatusBadge } from "@/components/admin/AdminTable"
import { formatPeso } from "@/lib/fare"

// Admin: verify pending payments (ONLY path to paid) + expire holds.
// Calls SECURITY DEFINER verify_payment() which enforces is_admin().
export function BookingsAdmin() {
  const [bookings, setBookings] = React.useState<any[]>([])
  const [payments, setPayments] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  async function load() {
    setLoading(true); setError(null)
    if (!supabase) { setError(missingSupabaseEnvMessage); setLoading(false); return }
    const [b, p] = await Promise.all([
      supabase.from("bookings").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("payments").select("*").order("created_at", { ascending: false }).limit(50),
    ])
    if (b.error) setError(b.error.message); else setBookings(b.data ?? [])
    if (!p.error) setPayments(p.data ?? [])
    setLoading(false)
  }
  React.useEffect(() => { load() }, [])

  async function verify(id: string, paid: boolean) {
    if (!supabase) return
    if (!window.confirm(paid ? "Mark PAID after confirming funds with provider? (issues ticket once)" : "Mark FAILED?")) return
    const { error } = await supabase.rpc("verify_payment", { p_payment_id: id, p_paid: paid })
    if (error) setError(error.message); else load()
  }

  async function expire() {
    if (!supabase) return
    const { error } = await supabase.rpc("expire_reservations")
    if (error) setError(error.message); else load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary via-blue-600 to-violet-600 bg-clip-text text-transparent">Bookings & Payments</h1>
        <Button variant="outline" onClick={expire}>Expire holds now</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <AdminTable title="Payments (verify to confirm)" columns={[
        { key: "payment_reference", label: "Ref" },
        { key: "amount", label: "Amount", render: (r) => `₱${formatPeso(Number(r.amount))}` },
        { key: "method", label: "Method" },
        { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
      ]} rows={payments} loading={loading} error={null} />
      <div className="space-y-2">
        {payments.filter((p) => p.status === "pending" || p.status === "processing").map((p) => (
          <Card key={p.id}><CardContent className="p-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono">{p.payment_reference} · ₱{formatPeso(Number(p.amount))}</span>
            <span className="flex gap-2 ml-auto">
              <Button size="sm" onClick={() => verify(p.id, true)}>Verify paid (issue ticket)</Button>
              <Button size="sm" variant="outline" onClick={() => verify(p.id, false)}>Mark failed</Button>
            </span>
          </CardContent></Card>
        ))}
      </div>
      <AdminTable title="Recent bookings" columns={[
        { key: "booking_reference", label: "Ref" },
        { key: "pax_count", label: "Pax" },
        { key: "total_amount", label: "Total", render: (r) => `₱${formatPeso(Number(r.total_amount))}` },
        { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
      ]} rows={bookings} loading={loading} error={null} />
      <p className="text-xs text-muted-foreground">No payment gateway connected. Configure provider (e.g. PayMongo/GCash/Xendit) webhook → call verify_payment() with service_role after funds confirm. Never mark paid on button click alone.</p>
    </div>
  )
}

export default BookingsAdmin
