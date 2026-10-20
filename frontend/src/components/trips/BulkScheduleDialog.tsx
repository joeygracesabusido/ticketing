import * as React from "react"
import { addDays, addHours, addMonths, endOfDay, format, parseISO, startOfDay, subDays } from "date-fns"
import { CalendarPlus, CheckCircle2, CircleAlert, Loader2, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import {
  generateDepartures,
  summarize,
  validateProposals,
  fetchExistingTripsForRange,
  type BulkFrequency,
  type ExistingTrip,
  type Proposal,
  type TripRefs,
} from "@/lib/trips"

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
]

const MAX_DEPARTURES = 366

type BulkForm = {
  vesselId: string
  routeId: string
  departureTime: string
  durationMinutes: string
  startDate: string
  endDate: string
  frequency: BulkFrequency
  weekdays: number[]
  turnaroundMinutes: string
}

type BulkResult = { created: number; rejected: number; message: string }

function initialForm(refs: TripRefs): BulkForm {
  const tomorrow = addDays(startOfDay(new Date()), 1)
  const firstRoute = refs.routes[0]
  return {
    vesselId: refs.vessels[0]?.id ?? "",
    routeId: firstRoute?.id ?? "",
    departureTime: "08:00",
    durationMinutes: String(firstRoute?.estimated_duration_minutes ?? 720),
    startDate: format(tomorrow, "yyyy-MM-dd"),
    endDate: format(addMonths(tomorrow, 1), "yyyy-MM-dd"),
    frequency: "weekdays",
    weekdays: [1, 2, 3, 4, 5, 6],
    turnaroundMinutes: "60",
  }
}

function severityBadge(p: Proposal) {
  if (p.severity === "ok")
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        Ready
      </Badge>
    )
  if (p.severity === "warning")
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
        Warning
      </Badge>
    )
  return (
    <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
      Blocked
    </Badge>
  )
}

export function BulkScheduleDialog(props: {
  open: boolean
  refs: TripRefs
  onClose: () => void
  onCreated: (count: number) => void
}) {
  const { open, refs, onClose, onCreated } = props
  const [form, setForm] = React.useState<BulkForm>(() => initialForm(refs))
  const [removed, setRemoved] = React.useState<Set<string>>(new Set())
  const [existing, setExisting] = React.useState<ExistingTrip[]>([])
  const [existingLoading, setExistingLoading] = React.useState(false)
  const [existingError, setExistingError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<BulkResult | null>(null)
  const submitting = React.useRef(false)
  const dialogRef = React.useRef<HTMLDivElement>(null)

  const vessel = refs.vessels.find((v) => v.id === form.vesselId) ?? null
  const route = refs.routes.find((r) => r.id === form.routeId) ?? null
  const origin = route ? refs.ports.find((p) => p.id === route.origin_port_id) ?? null : null
  const destination = route ? refs.ports.find((p) => p.id === route.destination_port_id) ?? null : null
  const vesselAccommodations = refs.accommodations.filter((a) => a.vessel_id === form.vesselId)
  const duration = Number(form.durationMinutes)
  const turnaround = Math.max(0, Number(form.turnaroundMinutes) || 0)

  React.useEffect(() => {
    if (!open) return
    setForm(initialForm(refs))
    setRemoved(new Set())
    setResult(null)
    setError(null)
    setExisting([])
    const t = setTimeout(() => dialogRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open, refs])

  React.useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, busy, onClose])

  const configError = React.useMemo(() => {
    if (!vessel) return "Select a vessel."
    if (!route) return "Select a route."
    if (!form.startDate || !form.endDate) return "Select a start and end date."
    const start = parseISO(form.startDate)
    const end = parseISO(form.endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Select valid start and end dates."
    if (start > end) return "End date must be on or after the start date."
    if (!Number.isFinite(duration) || duration <= 0) return "Travel duration must be greater than zero."
    if (!/^\d{2}:\d{2}$/.test(form.departureTime)) return "Select a valid departure time."
    if (form.frequency === "weekdays" && form.weekdays.length === 0) return "Select at least one operating weekday."
    return null
  }, [vessel, route, form, duration])

  const startDateValid = !Number.isNaN(parseISO(form.startDate).getTime())

  const departures = React.useMemo(() => {
    if (configError) return []
    return generateDepartures({
      startDate: form.startDate,
      endDate: form.endDate,
      departureTime: form.departureTime,
      durationMinutes: duration,
      frequency: form.frequency,
      weekdays: form.weekdays,
    })
  }, [configError, form, duration])

  const tooMany = departures.length > MAX_DEPARTURES

  // Refresh existing trips whenever the vessel/range changes so the preview is
  // checked against the database, not just the rows already on screen.
  React.useEffect(() => {
    if (!open || configError || tooMany || !vessel || !route) {
      setExistingLoading(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setExistingLoading(true)
      setExistingError(null)
      const buffer = Math.max(duration, turnaround) + 1440
      const { rows, error: loadError } = await fetchExistingTripsForRange({
        from: startOfDay(parseISO(form.startDate)),
        to: endOfDay(parseISO(form.endDate)),
        bufferMinutes: buffer,
      })
      if (cancelled) return
      if (loadError) setExistingError(loadError)
      else setExisting(rows)
      setExistingLoading(false)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, configError, tooMany, vessel, route, form.startDate, form.endDate, duration, turnaround])

  const proposals = React.useMemo(() => {
    if (configError || tooMany) return []
    return validateProposals({
      departures,
      durationMinutes: duration,
      turnaroundMinutes: turnaround,
      existing,
      vesselId: form.vesselId,
      routeId: form.routeId,
      vesselActive: vessel?.status === "active",
      portsActive: origin?.active !== false && destination?.active !== false,
    })
  }, [
    configError,
    tooMany,
    departures,
    duration,
    turnaround,
    existing,
    form.vesselId,
    form.routeId,
    vessel,
    origin,
    destination,
  ])

  const kept = proposals.filter((p) => !removed.has(p.key))
  const summary = summarize(kept)
  const insertable = kept.filter((p) => p.severity !== "error")
  const hasNoAccommodations = Boolean(vessel) && vesselAccommodations.length === 0

  function update(patch: Partial<BulkForm>) {
    setForm((prev) => ({ ...prev, ...patch }))
    setResult(null)
    setError(null)
    setRemoved(new Set())
  }

  function setRangePreset(preset: "week" | "month" | "custom") {
    if (preset === "custom") return
    const start = parseISO(form.startDate)
    if (Number.isNaN(start.getTime())) return
    update({ endDate: format(preset === "week" ? addDays(start, 6) : subDays(addMonths(start, 1), 1), "yyyy-MM-dd") })
  }

  async function confirm() {
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      return
    }
    if (!vessel || !route || configError) {
      setError(configError ?? "Complete the schedule.")
      return
    }
    if (submitting.current || insertable.length === 0) return
    if (insertable.length > MAX_DEPARTURES) {
      setError(`A single batch is limited to ${MAX_DEPARTURES} departures.`)
      return
    }
    if (summary.warnings > 0 && !window.confirm(`${summary.warnings} trip(s) have warnings. Create them anyway?`)) return

    submitting.current = true
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      // Re-check against the database immediately before writing: another
      // scheduler may have inserted a departure while the preview was open.
      const buffer = Math.max(duration, turnaround) + 1440
      const fresh = await fetchExistingTripsForRange({
        from: startOfDay(parseISO(form.startDate)),
        to: endOfDay(parseISO(form.endDate)),
        bufferMinutes: buffer,
      })
      if (fresh.error) {
        setError(`Could not verify conflicts: ${fresh.error}`)
        return
      }
      const freshProposals = validateProposals({
        departures: insertable.map((p) => p.departureAt),
        durationMinutes: duration,
        turnaroundMinutes: turnaround,
        existing: fresh.rows,
        vesselId: form.vesselId,
        routeId: form.routeId,
        vesselActive: vessel.status === "active",
        portsActive: origin?.active !== false && destination?.active !== false,
      })
      if (freshProposals.some((p) => p.severity === "error")) {
        setExisting(fresh.rows)
        setError("A conflict appeared while you were reviewing. Fix the blocked rows and try again.")
        return
      }

      const now = new Date()
      const fares = vesselAccommodations.map((a) => Number(a.fare_amount)).filter((n) => Number.isFinite(n))
      const payload = insertable.map((p) => {
        const close = addHours(p.departureAt, -refs.bookingCloseHours)
        return {
          route_id: form.routeId,
          vessel_id: form.vesselId,
          departure_port_id: route.origin_port_id,
          arrival_port_id: route.destination_port_id,
          departure_at: p.departureAt.toISOString(),
          arrival_at: p.arrivalAt.toISOString(),
          status: "scheduled",
          fare_from: fares.length ? Math.min(...fares) : null,
          booking_open: now.toISOString(),
          booking_close: close.toISOString(),
        }
      })

      const { data, error: insertError } = await supabase.from("trips").insert(payload).select("id")
      if (insertError) {
        setResult({ created: 0, rejected: payload.length, message: insertError.message })
        return
      }
      const created = data?.length ?? 0
      setResult({
        created,
        rejected: payload.length - created,
        message: created === payload.length ? "All departures were created." : "Some departures were rejected.",
      })
      if (created > 0) onCreated(created)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (!open) return null

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
        aria-labelledby="bulk-schedule-title"
        className="mx-auto my-2 w-full max-w-5xl rounded-2xl border bg-card shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-600 text-white">
              <CalendarPlus className="h-5 w-5" />
            </span>
            <div>
              <h2 id="bulk-schedule-title" className="text-lg font-bold">
                Bulk schedule trips
              </h2>
              <p className="text-sm text-muted-foreground">
                Generate one dated trip per departure. Nothing is saved until you confirm the preview.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close bulk schedule" onClick={onClose} disabled={busy}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[calc(100vh-10rem)] space-y-5 overflow-y-auto p-5">
          {result ? (
            <div className="space-y-4">
              <div
                role="status"
                className={`rounded-xl border p-4 ${
                  result.created > 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-rose-200 bg-rose-50 text-rose-800"
                }`}
              >
                <p className="flex items-center gap-2 font-semibold">
                  {result.created > 0 ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                  {result.created} trip{result.created === 1 ? "" : "s"} created
                  {result.rejected > 0 ? ` · ${result.rejected} rejected` : ""}
                </p>
                <p className="mt-1 text-sm">{result.message}</p>
                {result.rejected > 0 && result.created > 0 && (
                  <p className="mt-1 text-sm">
                    Created records are already saved. Fix the rejected rows before scheduling them again.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={onClose}>Done</Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setResult(null)
                    setRemoved(new Set())
                    setForm(initialForm(refs))
                  }}
                >
                  Schedule another batch
                </Button>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {error}
                </p>
              )}
              {existingError && (
                <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Conflict check unavailable: {existingError}. You can still preview, but saving is not allowed without a
                  fresh check.
                </p>
              )}

              <Card>
                <CardContent className="space-y-4 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">1. Schedule</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-vessel">Vessel</Label>
                      <Select
                        id="bulk-vessel"
                        value={form.vesselId}
                        onChange={(e) => update({ vesselId: e.target.value })}
                      >
                        {refs.vessels.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.code} · {v.name} ({v.status})
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-route">Route</Label>
                      <Select
                        id="bulk-route"
                        value={form.routeId}
                        onChange={(e) => {
                          const next = refs.routes.find((r) => r.id === e.target.value)
                          update({
                            routeId: e.target.value,
                            durationMinutes: String(next?.estimated_duration_minutes ?? duration),
                          })
                        }}
                      >
                        {refs.routes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.code}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Ports (from route)</Label>
                      <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">
                        {origin?.code ?? "--"} → {destination?.code ?? "--"}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-departure-time">Departure time</Label>
                      <Input
                        id="bulk-departure-time"
                        type="time"
                        value={form.departureTime}
                        onChange={(e) => update({ departureTime: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-duration">Travel duration (minutes)</Label>
                      <Input
                        id="bulk-duration"
                        type="number"
                        min={1}
                        value={form.durationMinutes}
                        onChange={(e) => update({ durationMinutes: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-turnaround">Turnaround buffer (minutes)</Label>
                      <Input
                        id="bulk-turnaround"
                        type="number"
                        min={0}
                        value={form.turnaroundMinutes}
                        onChange={(e) => update({ turnaroundMinutes: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-start">Schedule start</Label>
                      <Input
                        id="bulk-start"
                        type="date"
                        value={form.startDate}
                        onChange={(e) => update({ startDate: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bulk-end">Schedule end</Label>
                      <Input
                        id="bulk-end"
                        type="date"
                        value={form.endDate}
                        onChange={(e) => update({ endDate: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Range preset</Label>
                      <div className="flex h-10 flex-wrap items-center gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => setRangePreset("week")}>
                          One week
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setRangePreset("month")}>
                          One month
                        </Button>
                      </div>
                    </div>
                  </div>
                  {vessel && (
                    <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                      <p>
                        {vessel.code} · {vessel.name} · {origin?.name ?? "Origin?"} → {destination?.name ?? "Destination?"}
                      </p>
                      {hasNoAccommodations ? (
                        <p className="mt-1 font-medium text-amber-700">
                          No active accommodation classes are configured for this vessel. Trips can be created, but they
                          will not be bookable until accommodations exist.
                        </p>
                      ) : (
                        <p className="mt-1">
                          Capacity per trip: {vesselAccommodations.map((a) => `${a.name} ${a.capacity}`).join(" · ")}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-4 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">2. Recurrence</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    {(
                      [
                        ["once", "One-time"],
                        ["daily", "Daily"],
                        ["weekly", "Weekly"],
                        ["weekdays", "Selected weekdays"],
                      ] as [BulkFrequency, string][]
                    ).map(([value, label]) => (
                      <label
                        key={value}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${
                          form.frequency === value ? "border-primary bg-primary/5 font-semibold text-primary" : ""
                        }`}
                      >
                        <input
                          type="radio"
                          name="bulk-frequency"
                          value={value}
                          checked={form.frequency === value}
                          onChange={() => update({ frequency: value })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {form.frequency === "weekdays" && (
                    <div className="space-y-2">
                      <Label>Operating weekdays</Label>
                      <div className="flex flex-wrap gap-2">
                        {WEEKDAYS.map((d) => {
                          const on = form.weekdays.includes(d.value)
                          return (
                            <label
                              key={d.value}
                              className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
                                on ? "border-primary bg-primary/5 text-primary" : "text-muted-foreground"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) =>
                                  update({
                                    weekdays: e.target.checked
                                      ? [...form.weekdays, d.value].sort()
                                      : form.weekdays.filter((x) => x !== d.value),
                                  })
                                }
                              />
                              {d.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {form.frequency === "weekly" && startDateValid && (
                    <p className="text-sm text-muted-foreground">
                      Repeats every {format(parseISO(form.startDate), "EEEE")} between the start and end dates.
                    </p>
                  )}
                  {configError && <p className="text-sm text-destructive">{configError}</p>}
                  {tooMany && (
                    <p className="text-sm text-destructive">
                      This range generates {departures.length} departures. The limit is {MAX_DEPARTURES} per batch.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">3. Preview</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        {summary.valid} ready
                      </Badge>
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                        {summary.warnings} warning{summary.warnings === 1 ? "" : "s"}
                      </Badge>
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                        {summary.invalid} blocked
                      </Badge>
                      {existingLoading && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> checking conflicts
                        </span>
                      )}
                    </div>
                  </div>

                  {proposals.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      {configError ? "Complete the schedule to preview departures." : "No departures match this recurrence."}
                    </p>
                  ) : (
                    <div className="max-h-80 overflow-auto rounded-lg border">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead className="sticky top-0 bg-primary/5">
                          <tr className="border-b">
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                              Departure
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                              Arrival
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                              Vessel / route
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                              Status
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                              Reasons
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-primary">
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {proposals.map((p) => {
                            const isRemoved = removed.has(p.key)
                            return (
                              <tr key={p.key} className={`border-b last:border-0 ${isRemoved ? "opacity-40" : ""}`}>
                                <td className="px-3 py-2 whitespace-nowrap font-medium">
                                  {format(p.departureAt, "dd MMM yyyy, HH:mm")}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {format(p.arrivalAt, "dd MMM yyyy, HH:mm")}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {vessel?.code} · {route?.code}
                                </td>
                                <td className="px-3 py-2">{severityBadge(p)}</td>
                                <td className="px-3 py-2 text-xs text-muted-foreground">
                                  {p.reasons.length ? p.reasons.join("; ") : "—"}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {isRemoved ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        const next = new Set(removed)
                                        next.delete(p.key)
                                        setRemoved(next)
                                      }}
                                    >
                                      Restore
                                    </Button>
                                  ) : (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      aria-label={`Remove departure ${format(p.departureAt, "dd MMM yyyy HH:mm")}`}
                                      onClick={() => setRemoved(new Set(removed).add(p.key))}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <p className="text-sm text-muted-foreground">
                      {insertable.length} of {kept.length} selected departure{kept.length === 1 ? "" : "s"} will be created.
                      Blocked rows are never inserted.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={onClose} disabled={busy}>
                        Cancel
                      </Button>
                      <Button
                        onClick={confirm}
                        disabled={busy || existingLoading || insertable.length === 0 || Boolean(existingError)}
                      >
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {busy ? "Creating..." : `Create ${insertable.length} trip${insertable.length === 1 ? "" : "s"}`}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default BulkScheduleDialog
