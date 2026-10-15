import * as React from "react"
import { useParams, Link } from "react-router-dom"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Header } from "@/components/layout/Header"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { format } from "date-fns"
import { ArrowLeft, Ship, Clock, MapPin } from "lucide-react"
import { computeFare, formatPeso } from "@/lib/fare"
import { createBooking, createPaymentIntent, cancelBooking, msRemaining, formatCountdown, isExpired, buildPassengerNames, missingPassengerIndex } from "@/lib/booking"
import { TicketCard } from "@/components/booking/TicketCard"

const bookingSchema = z.object({
  fullName: z.string().min(2, "Enter your full name"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().min(7, "Enter a valid phone number"),
  passengers: z.coerce.number().int().min(1, "At least 1 passenger").max(100, "Max 100 per booking"),
  accommodationId: z.string().min(1, "Select accommodation"),
  payMethod: z.string().default("manual"),
})

type BookingForm = z.infer<typeof bookingSchema>

export function TripDetails() {
  const { id } = useParams<{ id: string }>()
  const [trip, setTrip] = React.useState<any | null>(null)
  const [inventory, setInventory] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(Boolean(id))
  const [error, setError] = React.useState<string | null>(null)
  const [bookingError, setBookingError] = React.useState<string | null>(null)
  const [booking, setBooking] = React.useState<any | null>(null)
  const [payment, setPayment] = React.useState<any | null>(null)
  const [ticket, setTicket] = React.useState<any | null>(null)
  const [now, setNow] = React.useState(Date.now())
  const [placing, setPlacing] = React.useState(false)

  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<BookingForm>({
    resolver: zodResolver(bookingSchema),
    defaultValues: { passengers: 1, payMethod: "manual" },
  })
  const watchedAccom = watch("accommodationId")
  const watchedPax = watch("passengers")
  const paxCount = Math.max(1, Number(watchedPax) || 1)

  // Extra name inputs for passengers 2..N (passenger 1 = full name field).
  const [extraNames, setExtraNames] = React.useState<string[]>([])
  React.useEffect(() => {
    setExtraNames((prev) => {
      const need = Math.max(0, paxCount - 1)
      if (prev.length === need) return prev
      const next = prev.slice(0, need)
      while (next.length < need) next.push("")
      return next
    })
  }, [paxCount])

  // countdown ticker
  React.useEffect(() => {
    if (!booking || booking.status !== "held") return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [booking])

  React.useEffect(() => {
    if (!id) return
    if (!supabase) { setError(missingSupabaseEnvMessage); setLoading(false); return }
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const { data: t, error: tripError } = await supabase!
          .from("trips")
          .select("id, departure_at, arrival_at, status, fare_from, booking_open, booking_close, route_id, vessel_id, departure_port_id, arrival_port_id")
          .eq("id", id).single()
        if (cancelled) return
        if (tripError) throw new Error(tripError.message)
        if (!t) { setTrip(null); setLoading(false); return }
        const [{ data: route }, { data: vessel }, { data: ports }] = await Promise.all([
          supabase!.from("routes").select("id, code, origin_port_id, destination_port_id, distance_km, estimated_duration_minutes").eq("id", t.route_id).single(),
          supabase!.from("vessels").select("id, code, name, capacity, status").eq("id", t.vessel_id).single(),
          supabase!.from("ports").select("id, code, name, city").in("id", [t.departure_port_id, t.arrival_port_id]),
        ])
        if (cancelled) return
        const portById = new Map((ports ?? []).map((p) => [p.id, p]))
        setTrip({
          id: t.id, departureAt: t.departure_at, arrivalAt: t.arrival_at, status: t.status,
          fareFrom: t.fare_from, bookingOpen: t.booking_open, bookingClose: t.booking_close,
          route: route ? { id: route.id, code: route.code, originPort: portById.get(route.origin_port_id), destinationPort: portById.get(route.destination_port_id), distanceKm: route.distance_km, estimatedDurationMinutes: route.estimated_duration_minutes } : undefined,
          vessel, departurePort: portById.get(t.departure_port_id), arrivalPort: portById.get(t.arrival_port_id),
        })
        // inventory (graceful if migration not yet applied)
        const { data: inv, error: invError } = await supabase!.from("trip_accommodation_inventory")
          .select("id, capacity, booked, held, fare_amount, is_active, accommodation_id, vessel_accommodations(id, code, name, max_occupancy)")
          .eq("trip_id", t.id).eq("is_active", true)
        if (invError) console.warn("Accommodation inventory unavailable:", invError.message)
        if (!cancelled && inv) setInventory(inv)
        setLoading(false)
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : "Failed to load trip."); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [id])

  const selectedInv = inventory.find((i) => String(i.accommodation_id) === String(watchedAccom))
  const preview = selectedInv ? computeFare({ farePerPax: Number(selectedInv.fare_amount), pax: Number(watchedPax) || 1 }) : null
  void now

  async function refreshBookingStatus(bookingId: string) {
    if (!supabase) return
    const { data: b } = await supabase.from("bookings").select("*").eq("id", bookingId).single()
    if (b) setBooking(b)
    const { data: pays } = await supabase.from("payments").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false }).limit(1)
    if (pays && pays[0]) setPayment(pays[0])
    const { data: tkt } = await supabase.from("tickets").select("*").eq("booking_id", bookingId).maybeSingle()
    if (tkt) setTicket(tkt)
  }

  const onReserve = async (v: BookingForm) => {
    setBookingError(null); setPlacing(true)
    try {
      const names = buildPassengerNames(v.fullName, v.passengers, extraNames)
      const bad = missingPassengerIndex(names)
      if (bad >= 0) throw new Error(`Enter the name of passenger ${bad + 1}.`)
      const b = await createBooking({
        tripId: id!, accommodationId: v.accommodationId, pax: v.passengers,
        name: v.fullName, email: v.email, phone: v.phone, passengerNames: names,
      })
      setBooking(b); setPayment(null); setTicket(null)
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Reservation failed.")
    } finally { setPlacing(false) }
  }

  const onPay = async () => {
    if (!booking) return
    setBookingError(null); setPlacing(true)
    try {
      const method = (watch("payMethod") as string) || "manual"
      const p = await createPaymentIntent(booking.id, method)
      setPayment(p)
      // Re-read: if an admin verifies, ticket appears. Poll once after short delay.
      setTimeout(() => refreshBookingStatus(booking.id), 1500)
    } catch (e) {
      setBookingError(e instanceof Error ? e.message : "Payment failed.")
    } finally { setPlacing(false) }
  }

  const onCancel = async () => {
    if (!booking || !window.confirm("Cancel this reservation and release capacity?")) return
    try { const b = await cancelBooking(booking.id); setBooking(b); setPayment(null) }
    catch (e) { setBookingError(e instanceof Error ? e.message : "Cancel failed.") }
  }

  const expired = booking && booking.status === "held" && isExpired(booking.expires_at)

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <Link to="/trips" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to trips
        </Link>
        {loading && <p className="text-sm text-muted-foreground">Loading trip details...</p>}
        {error && <Card><CardContent className="p-6"><p className="text-sm text-destructive">Failed to load trip: {error}</p></CardContent></Card>}
        {!loading && !error && !trip && <Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">Trip not found.</p></CardContent></Card>}
        {trip && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ship className="h-5 w-5 text-primary" /> {trip.vessel?.name}
                    <Badge variant="secondary">{trip.vessel?.code}</Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Route {trip.route?.code}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Departure</p>
                      <p className="font-medium">{trip.departurePort?.name}</p>
                      <p className="text-sm text-muted-foreground">{trip.departurePort?.city}</p>
                      <p className="text-sm font-medium">{format(new Date(trip.departureAt), "PPp")}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> Arrival</p>
                      <p className="font-medium">{trip.arrivalPort?.name}</p>
                      <p className="text-sm text-muted-foreground">{trip.arrivalPort?.city}</p>
                      <p className="text-sm font-medium">{format(new Date(trip.arrivalAt), "PPp")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" /> Duration: {trip.route?.estimatedDurationMinutes ? `${Math.floor(trip.route.estimatedDurationMinutes / 60)}h` : "12h"}
                  </div>
                  <div className="flex gap-2"><Badge>{trip.status}</Badge>{trip.fareFrom && <Badge variant="outline">From ₱{Number(trip.fareFrom).toLocaleString()}</Badge>}</div>
                  {inventory.length > 0 && (
                    <div className="rounded-xl border p-3 text-sm">
                      <p className="font-semibold mb-2">Availability (live, excludes expired holds)</p>
                      <ul className="space-y-1">
                        {inventory.map((i) => {
                          const left = i.capacity - i.booked - i.held
                          return <li key={i.id} className="flex justify-between"><span>{(i as any).vessel_accommodations?.name}</span><span className={left <= 0 ? "text-destructive font-bold" : ""}>{left <= 0 ? "Full" : `${left} left · ₱${formatPeso(Number(i.fare_amount))}`}</span></li>
                        })}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
              {(booking || ticket) && (
                <TicketCard booking={booking} payment={payment} ticket={ticket} trip={trip} onRefresh={() => booking && refreshBookingStatus(booking.id)} />
              )}
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle className="text-lg">Book this trip</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const tnow = Date.now()
                    if (trip.status === "cancelled") return <p className="text-sm text-destructive">This trip is cancelled.</p>
                    if (trip.bookingClose && new Date(trip.bookingClose).getTime() < tnow) return <p className="text-sm text-destructive">Booking is closed for this trip (sales close 6h before departure).</p>
                    return null
                  })()}
                  {!booking && (
                    <form onSubmit={handleSubmit(onReserve)} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="accommodationId">Accommodation</Label>
                        <Select id="accommodationId" {...register("accommodationId")} defaultValue="">
                          <option value="" disabled>{inventory.length === 0 ? "No accommodations configured for this vessel yet — add them in Dashboard → Accommodations" : "Select accommodation"}</option>
                          {inventory.map((i) => {
                            const left = i.capacity - i.booked - i.held
                            return <option key={i.accommodation_id} value={i.accommodation_id} disabled={left <= 0}>{(i as any).vessel_accommodations?.name} — ₱{formatPeso(Number(i.fare_amount))} ({left} left)</option>
                          })}
                        </Select>
                        {errors.accommodationId && <p className="text-xs text-destructive">{errors.accommodationId.message}</p>}
                      </div>
                      <div className="space-y-1.5"><Label htmlFor="fullName">Full name</Label><Input id="fullName" placeholder="Juan Dela Cruz" {...register("fullName")} />{errors.fullName && <p className="text-xs text-destructive">{errors.fullName.message}</p>}</div>
                      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" placeholder="you@example.com" {...register("email")} />{errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}</div>
                      <div className="space-y-1.5"><Label htmlFor="phone">Phone</Label><Input id="phone" placeholder="0917 123 4567" {...register("phone")} />{errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}</div>
                      <div className="space-y-1.5"><Label htmlFor="passengers">Passengers</Label><Input id="passengers" type="number" min={1} max={100} {...register("passengers")} />{errors.passengers && <p className="text-xs text-destructive">{errors.passengers.message}</p>}</div>
                      {extraNames.length > 0 && (
                        <div className="space-y-1.5">
                          <Label>Passenger names</Label>
                          {extraNames.map((n, i) => (
                            <Input
                              key={i}
                              placeholder={`Passenger ${i + 2} full name`}
                              value={n}
                              onChange={(e) => setExtraNames((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                            />
                          ))}
                          <p className="text-xs text-muted-foreground">Passenger 1 is the full name above.</p>
                        </div>
                      )}
                      {preview && (
                        <div className="rounded-xl bg-muted p-3 text-sm space-y-1">
                          <div className="flex justify-between"><span>Fare × {preview.pax}</span><span>₱{formatPeso(preview.gross)}</span></div>
                          <div className="flex justify-between text-muted-foreground"><span>Net (VAT-excl)</span><span>₱{formatPeso(preview.net)}</span></div>
                          <div className="flex justify-between text-muted-foreground"><span>VAT 12% (incl)</span><span>₱{formatPeso(preview.vat)}</span></div>
                          <div className="flex justify-between font-bold"><span>Total payable</span><span>₱{formatPeso(preview.total)}</span></div>
                        </div>
                      )}
                      {bookingError && <p className="text-xs text-destructive">{bookingError}</p>}
                      <Button className="w-full" disabled={isSubmitting || placing}>{placing ? "Reserving..." : "Reserve seats (4h hold)"}</Button>
                    </form>
                  )}
                  {booking && booking.status === "held" && !expired && (
                    <div className="space-y-3 text-sm">
                      <div className="rounded-xl bg-muted p-4 space-y-1">
                        <p className="font-bold">Reserved ({booking.booking_reference})</p>
                        <p className="text-muted-foreground">Expires {format(new Date(booking.expires_at), "PPp")}</p>
                        <p className="font-semibold">Remaining: {formatCountdown(msRemaining(booking.expires_at))}</p>
                        <div className="flex justify-between"><span>Net</span><span>₱{formatPeso(Number(booking.base_amount))}</span></div>
                        <div className="flex justify-between"><span>VAT 12%</span><span>₱{formatPeso(Number(booking.vat_amount))}</span></div>
                        <div className="flex justify-between font-bold"><span>Total</span><span>₱{formatPeso(Number(booking.total_amount))}</span></div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="payMethod">Payment method</Label>
                        <Select id="payMethod" {...register("payMethod")}>
                          <option value="manual">Manual / OTC (pending verification)</option>
                          <option value="gcash">GCash (pending — no gateway connected)</option>
                          <option value="maya">Maya (pending — no gateway connected)</option>
                          <option value="card">Card (pending — no gateway connected)</option>
                          <option value="bank">Bank transfer (pending verification)</option>
                        </Select>
                      </div>
                      {payment && <p className="text-xs">Payment {payment.payment_reference} — <Badge>{payment.status}</Badge> (paid only after admin verification; duplicates blocked)</p>}
                      <Button className="w-full" onClick={onPay} disabled={placing}>{placing ? "Processing..." : "Proceed to Payment"}</Button>
                      <Button variant="outline" className="w-full" onClick={onCancel}>Cancel reservation</Button>
                      <Button variant="ghost" className="w-full" onClick={() => { setBooking(null); setPayment(null); setTicket(null); reset() }}>New booking</Button>
                      {bookingError && <p className="text-xs text-destructive">{bookingError}</p>}
                    </div>
                  )}
                  {booking && (expired || booking.status === "expired") && (
                    <div className="space-y-3 text-sm">
                      <p className="text-destructive font-semibold">Reservation expired. Capacity released. Start a new booking to renew.</p>
                      <Button className="w-full" variant="outline" onClick={() => { setBooking(null); setPayment(null); reset() }}>New booking</Button>
                    </div>
                  )}
                  {booking && booking.status === "confirmed" && (
                    <div className="space-y-3 text-sm">
                      <p className="font-bold text-emerald-600">Confirmed ({booking.booking_reference})</p>
                      <Button variant="outline" className="w-full" onClick={() => booking && refreshBookingStatus(booking.id)}>Refresh ticket</Button>
                      <Button variant="ghost" className="w-full" onClick={() => { setBooking(null); setPayment(null); setTicket(null); reset() }}>New booking</Button>
                    </div>
                  )}
                  {booking && booking.status === "cancelled" && (
                    <div className="space-y-3 text-sm">
                      <p className="font-semibold">Booking cancelled. Capacity released.</p>
                      <Button className="w-full" variant="outline" onClick={() => { setBooking(null); setPayment(null); reset() }}>New booking</Button>
                    </div>
                  )}
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
