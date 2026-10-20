import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { addMinutes, format, parseISO } from "date-fns"
import { CircleAlert, Loader2, Ship, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import {
  TRIP_STATUSES,
  findTripConflict,
  formatTripDateTime,
  statusTone,
  tripReference,
  type TripRefs,
  type TripRow,
} from "@/lib/trips"

const schema = z
  .object({
    route_id: z.string().min(1, "Select a route"),
    vessel_id: z.string().min(1, "Select a vessel"),
    departure_at: z.string().min(1, "Select a departure"),
    arrival_at: z.string().min(1, "Select an arrival"),
    status: z.string().min(1, "Select a status"),
    fare_from: z.string().optional(),
  })
  .refine((v) => new Date(v.arrival_at) > new Date(v.departure_at), {
    message: "Arrival must be after departure",
    path: ["arrival_at"],
  })
  .refine((v) => v.fare_from === undefined || v.fare_from === "" || !Number.isNaN(Number(v.fare_from)), {
    message: "Fare must be a number",
    path: ["fare_from"],
  })
  .refine((v) => v.fare_from === undefined || v.fare_from === "" || Number(v.fare_from) >= 0, {
    message: "Fare cannot be negative",
    path: ["fare_from"],
  })

type Form = z.infer<typeof schema>

function toLocal(iso: string) {
  return format(new Date(iso), "yyyy-MM-dd'T'HH:mm")
}

function createDefaults(refs: TripRefs): Form {
  const route = refs.routes[0]
  const departure = new Date()
  departure.setDate(departure.getDate() + 1)
  departure.setHours(8, 0, 0, 0)
  return {
    route_id: route?.id ?? "",
    vessel_id: refs.vessels[0]?.id ?? "",
    departure_at: format(departure, "yyyy-MM-dd'T'HH:mm"),
    arrival_at: format(addMinutes(departure, route?.estimated_duration_minutes ?? 720), "yyyy-MM-dd'T'HH:mm"),
    status: "scheduled",
    fare_from: "",
  }
}

export function TripEditorDialog(props: {
  mode: "create" | "edit"
  trip?: TripRow | null
  refs: TripRefs
  bookingCount?: number | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { mode, trip, refs, bookingCount = 0, onClose, onSaved } = props
  const bookingsLoading = mode === "edit" && bookingCount === null
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const dialogRef = React.useRef<HTMLDivElement>(null)
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: mode === "edit" && trip ? {
      route_id: trip.route_id,
      vessel_id: trip.vessel_id,
      departure_at: toLocal(trip.departure_at),
      arrival_at: toLocal(trip.arrival_at),
      status: trip.status,
      fare_from: trip.fare_from == null ? "" : String(trip.fare_from),
    } : createDefaults(refs),
  })

  React.useEffect(() => {
    if (mode === "edit" && trip) {
      reset({
        route_id: trip.route_id,
        vessel_id: trip.vessel_id,
        departure_at: toLocal(trip.departure_at),
        arrival_at: toLocal(trip.arrival_at),
        status: trip.status,
        fare_from: trip.fare_from == null ? "" : String(trip.fare_from),
      })
    } else if (mode === "create") {
      reset(createDefaults(refs))
    }
    setError(null)
    const t = setTimeout(() => dialogRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [mode, trip, refs, reset])

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [busy, onClose])

  const routeId = watch("route_id")
  const vesselId = watch("vessel_id")
  const departureAt = watch("departure_at")
  const route = refs.routes.find((r) => r.id === routeId) ?? null
  const vessel = refs.vessels.find((v) => v.id === vesselId) ?? null
  const origin = route ? refs.ports.find((p) => p.id === route.origin_port_id) ?? null : null
  const destination = route ? refs.ports.find((p) => p.id === route.destination_port_id) ?? null : null

  const onSubmit = async (values: Form) => {
    setError(null)
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      return
    }
    if (!route) {
      setError("Select a route.")
      return
    }
    if (!vessel) {
      setError("Select a vessel.")
      return
    }
    const departure = new Date(values.departure_at)
    const arrival = new Date(values.arrival_at)
    if (!(arrival > departure)) {
      setError("Arrival must be after departure.")
      return
    }
    if (mode === "create" && departure.getTime() <= Date.now()) {
      setError("Departure must be in the future.")
      return
    }
    if (vessel.status !== "active") {
      setError("This vessel is not active.")
      return
    }
    if (origin?.active === false || destination?.active === false) {
      setError("Origin or destination port is inactive.")
      return
    }
    if (bookingsLoading) {
      setError("Still checking existing bookings. Try again in a moment.")
      return
    }
    if (mode === "edit" && trip && (bookingCount ?? 0) > 0) {
      const timesChanged =
        departure.getTime() !== new Date(trip.departure_at).getTime() ||
        arrival.getTime() !== new Date(trip.arrival_at).getTime()
      if (timesChanged && !window.confirm(
        `This trip has ${bookingCount} active booking(s). Changing the schedule affects booked passengers. Continue?`
      )) {
        return
      }
    }
    setBusy(true)
    try {
      const conflict = await findTripConflict({
        vesselId: values.vessel_id,
        routeId: values.route_id,
        departureAt: departure,
        arrivalAt: arrival,
        excludeId: trip?.id,
      })
      if (conflict) {
        setError(conflict)
        return
      }
      const payload: Record<string, unknown> = {
        departure_at: departure.toISOString(),
        arrival_at: arrival.toISOString(),
        status: values.status,
        fare_from: values.fare_from === "" || values.fare_from === undefined ? null : Number(values.fare_from),
      }
      payload.booking_close = addMinutes(departure, -refs.bookingCloseHours * 60).toISOString()
      if (mode === "create") {
        payload.route_id = values.route_id
        payload.vessel_id = values.vessel_id
        payload.departure_port_id = route.origin_port_id
        payload.arrival_port_id = route.destination_port_id
        payload.booking_open = new Date().toISOString()
      }
      const { error: saveError } =
        mode === "edit" && trip
          ? await supabase.from("trips").update(payload).eq("id", trip.id)
          : await supabase.from("trips").insert(payload)
      if (saveError) {
        setError(saveError.message)
        return
      }
      onSaved(mode === "edit" ? "Trip schedule updated." : "Trip created.")
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!supabase || !trip) return
    setError(null)
    const { count, error: countError } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", trip.id)
    if (countError) {
      setError(`Could not verify bookings, so deletion is blocked: ${countError.message}`)
      return
    }
    if ((count ?? 0) > 0) {
      setError(`This trip has ${count} booking record(s). Cancel the trip instead; deletion would break booking history.`)
      return
    }
    if (!window.confirm("Delete this trip? It has no bookings.")) return
    setBusy(true)
    try {
      const { error: deleteError } = await supabase.from("trips").delete().eq("id", trip.id)
      if (deleteError) setError(deleteError.message)
      else onSaved("Trip deleted.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-3 sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-editor-title"
        className="mx-auto my-4 w-full max-w-3xl rounded-2xl border bg-card shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div>
            <h2 id="trip-editor-title" className="text-lg font-bold">
              {mode === "edit" ? "Trip details" : "Create trip"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "edit" && trip
                ? `${tripReference(trip)} · ${formatTripDateTime(trip.departure_at)}`
                : "Create one dated departure. Use bulk schedule for recurring departures."}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close trip editor" onClick={onClose} disabled={busy}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4 p-5">
            {error && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {error}
              </p>
            )}
            {mode === "edit" && trip && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className={statusTone(trip.status)}>
                  {trip.status}
                </Badge>
                <span className="text-muted-foreground">
                  {trip.vessels?.name ?? trip.vessels?.code} · {trip.routes?.code}
                </span>
                {bookingsLoading ? (
                  <span className="rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Checking bookings...
                  </span>
                ) : (
                  (bookingCount ?? 0) > 0 && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      {bookingCount} active booking{bookingCount === 1 ? "" : "s"}
                    </span>
                  )
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="trip-route">Route</Label>
                <Select id="trip-route" disabled={mode === "edit"} {...register("route_id")}>
                  {refs.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code}
                    </option>
                  ))}
                </Select>
                {errors.route_id && <p className="text-xs text-destructive">{errors.route_id.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trip-vessel">Vessel</Label>
                <Select id="trip-vessel" disabled={mode === "edit"} {...register("vessel_id")}>
                  {refs.vessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} · {v.name}
                    </option>
                  ))}
                </Select>
                {errors.vessel_id && <p className="text-xs text-destructive">{errors.vessel_id.message}</p>}
                {mode === "edit" && (
                  <p className="text-[11px] text-muted-foreground">
                    Vessel and route are locked on existing trips so booking inventory stays intact.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trip-departure">Departure</Label>
                <Input id="trip-departure" type="datetime-local" {...register("departure_at")} />
                {errors.departure_at && <p className="text-xs text-destructive">{errors.departure_at.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trip-arrival">Arrival</Label>
                <Input id="trip-arrival" type="datetime-local" {...register("arrival_at")} />
                {errors.arrival_at && <p className="text-xs text-destructive">{errors.arrival_at.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trip-status">Status</Label>
                <Select id="trip-status" {...register("status")}>
                  {TRIP_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="trip-fare">Fare from (optional)</Label>
                <Input id="trip-fare" type="number" step="0.01" min={0} {...register("fare_from")} />
                {errors.fare_from && <p className="text-xs text-destructive">{errors.fare_from.message}</p>}
              </div>
            </div>

            {route && (
              <Card>
                <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <Ship className="h-4 w-4 text-primary" />
                  <span className="font-medium">
                    {origin?.code ?? "?"} → {destination?.code ?? "?"}
                  </span>
                  <span className="text-muted-foreground">
                    {origin?.name ?? "Origin"} → {destination?.name ?? "Destination"}
                  </span>
                  {departureAt && !Number.isNaN(parseISO(departureAt).getTime()) && (
                    <span className="text-xs text-muted-foreground">
                      Departs {format(parseISO(departureAt), "dd MMM yyyy, HH:mm")}
                    </span>
                  )}
                </CardContent>
              </Card>
            )}

            {mode === "edit" && trip && trip.status !== "cancelled" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="flex items-center gap-1.5 font-semibold">
                  <CircleAlert className="h-3.5 w-3.5" /> Cancelling or deleting affects operations.
                </p>
                <p className="mt-1">
                  Cancelling preserves booking references and financial records. Deleting is blocked whenever any booking
                  record exists.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-5">
            <div>
              {mode === "edit" && trip && (
                <Button type="button" variant="outline" onClick={onDelete} disabled={busy}>
                  Delete trip
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || bookingsLoading}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {busy ? "Saving..." : bookingsLoading ? "Checking bookings..." : mode === "edit" ? "Save schedule" : "Create trip"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default TripEditorDialog
