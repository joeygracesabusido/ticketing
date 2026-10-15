import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatPeso } from "@/lib/fare"
import { format } from "date-fns"

// Printable ticket. Verify against backend (booking_reference + ticket_no);
// QR not bundled (no new dep) — ticket_no + reference is the verification key.
export function TicketCard({ booking, payment, ticket, trip, onRefresh }: {
  booking: any; payment: any; ticket: any; trip: any; onRefresh?: () => void
}) {
  if (!booking) return null
  return (
    <Card className="print:shadow-none">
      <CardHeader className="print:hidden">
        <CardTitle className="text-lg flex items-center gap-2">
          Passenger Ticket {ticket && <Badge>{ticket.ticket_no}</Badge>}
          {onRefresh && <Button variant="outline" size="sm" onClick={onRefresh} className="ml-auto print:hidden">Verify status</Button>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm ticket-print">
        <div className="flex justify-between border-b pb-2">
          <div>
            <p className="font-bold text-base">Ferry Ticketing Lines</p>
            <p className="text-muted-foreground text-xs">Domestic passenger service · VAT-inclusive fares</p>
          </div>
          <div className="text-right">
            <p className="font-mono font-bold">{booking.booking_reference}</p>
            {ticket && <p className="font-mono text-xs">{ticket.ticket_no}</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-xs text-muted-foreground">Passenger</p><p className="font-medium">{booking.contact_name} × {booking.pax_count}</p></div>
          <div><p className="text-xs text-muted-foreground">Status</p><p><Badge>{booking.status}</Badge> {payment && <Badge variant="outline">{payment.status}</Badge>}</p></div>
          <div><p className="text-xs text-muted-foreground">Route</p><p className="font-medium">{trip?.route?.code} · {trip?.departurePort?.name} → {trip?.arrivalPort?.name}</p></div>
          <div><p className="text-xs text-muted-foreground">Vessel / Voyage</p><p className="font-medium">{trip?.vessel?.name} · {format(new Date(trip.departureAt), "PPp")}</p></div>
        </div>
        <div className="rounded-lg bg-muted p-3 space-y-1">
          <div className="flex justify-between"><span>Net fare</span><span>₱{formatPeso(Number(booking.base_amount))}</span></div>
          <div className="flex justify-between"><span>VAT 12% (incl.)</span><span>₱{formatPeso(Number(booking.vat_amount))}</span></div>
          <div className="flex justify-between font-bold"><span>Total</span><span>₱{formatPeso(Number(booking.total_amount))}</span></div>
          {payment && <div className="flex justify-between text-xs text-muted-foreground"><span>Payment</span><span>{payment.payment_reference} · {payment.method}</span></div>}
        </div>
        <p className="text-xs text-muted-foreground">
          Boarding closes 1h before departure · Be at terminal 3–4h early ·
          Ticket valid to departure only · Reprint keeps original reference (reprints: {ticket?.reprint_count ?? 0}).
        </p>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()}>Print ticket</Button>
          {booking.status !== "confirmed" && <span className="text-xs text-muted-foreground self-center">Ticket issues after payment verification.</span>}
        </div>
      </CardContent>
      <style>{`@media print { body * { visibility: hidden; } .ticket-print, .ticket-print * { visibility: visible; } .ticket-print { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
    </Card>
  )
}

export default TicketCard
