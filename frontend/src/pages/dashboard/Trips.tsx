import * as React from "react"
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns"
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { StatusBadge } from "@/components/admin/AdminTable"
import { BulkScheduleDialog } from "@/components/trips/BulkScheduleDialog"
import { TripCalendar, type CalendarView } from "@/components/trips/TripCalendar"
import { TripEditorDialog } from "@/components/trips/TripEditorDialog"
import { missingSupabaseEnvMessage } from "@/lib/supabase"
import {
  EMPTY_FILTERS,
  TRIP_STATUSES,
  fetchAvailability,
  fetchBookingCounts,
  fetchTripRefs,
  fetchTrips,
  formatTripDate,
  formatTripDateTime,
  formatTripTime,
  resolveTripSearch,
  statusTone,
  tripReference,
  type Availability,
  type TripFilters,
  type TripRefs,
  type TripRow,
} from "@/lib/trips"

const PAGE_SIZE = 10
const CAPACITY_SCAN_LIMIT = 500

type View = "list" | CalendarView

const VIEWS: { value: View; label: string; icon: React.ElementType }[] = [
  { value: "list", label: "List", icon: List },
  { value: "day", label: "Day", icon: CalendarDays },
  { value: "week", label: "Week", icon: CalendarDays },
  { value: "month", label: "Month", icon: CalendarDays },
]

export function TripsAdmin() {
  const [refs, setRefs] = React.useState<TripRefs | null>(null)
  const [refsLoading, setRefsLoading] = React.useState(true)
  const [refsError, setRefsError] = React.useState<string | null>(null)

  const [filters, setFilters] = React.useState<TripFilters>(EMPTY_FILTERS)
  const [qInput, setQInput] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [page, setPage] = React.useState(0)
  const [rows, setRows] = React.useState<TripRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [availability, setAvailability] = React.useState<Map<string, Availability>>(new Map())
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [capacityCapped, setCapacityCapped] = React.useState(false)
  const [refreshKey, setRefreshKey] = React.useState(0)

  const [view, setView] = React.useState<View>("list")
  const [cursor, setCursor] = React.useState(() => new Date())
  const [calRows, setCalRows] = React.useState<TripRow[]>([])
  const [calAvailability, setCalAvailability] = React.useState<Map<string, Availability>>(new Map())
  const [calLoading, setCalLoading] = React.useState(false)
  const [calError, setCalError] = React.useState<string | null>(null)
  const [calCapped, setCalCapped] = React.useState(false)

  const [editor, setEditor] = React.useState<{
    mode: "create" | "edit"
    trip?: TripRow
    bookingCount: number | null
  } | null>(null)
  const [bulkOpen, setBulkOpen] = React.useState(false)
  const [notice, setNotice] = React.useState<{ text: string; tone: "success" | "error" } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      setRefsLoading(true)
      const { refs: data, error: loadError } = await fetchTripRefs()
      if (cancelled) return
      if (loadError) setRefsError(loadError)
      else setRefs(data)
      setRefsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(qInput)
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [qInput])

  const rangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to)

  React.useEffect(() => {
    if (rangeInvalid) {
      setLoading(false)
      setRows([])
      setTotal(0)
      setAvailability(new Map())
      setCapacityCapped(false)
      setError(null)
      return
    }
    if (!refs) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      setCapacityCapped(false)
      const effectiveFilters: TripFilters = { ...filters, q: debouncedQ }
      const search = debouncedQ.trim() ? await resolveTripSearch(debouncedQ) : null
      if (cancelled) return

      if (filters.capacity) {
        const result = await fetchTrips({
          filters: effectiveFilters,
          search,
          limit: CAPACITY_SCAN_LIMIT,
        })
        if (cancelled) return
        if (result.error) {
          setError(result.error)
          setRows([])
          setTotal(0)
          setLoading(false)
          return
        }
        const { byTrip, error: availabilityError } = await fetchAvailability(result.rows.map((r) => r.id))
        if (cancelled) return
        if (availabilityError) {
          setError(`Could not load seat availability: ${availabilityError}`)
          setRows([])
          setTotal(0)
          setLoading(false)
          return
        }
        const filtered = result.rows.filter((trip) => {
          const a = byTrip.get(trip.id)
          if (filters.capacity === "available") return Boolean(a && a.available > 0)
          if (filters.capacity === "low") return Boolean(a && a.available > 0 && a.available <= 20)
          return Boolean(a && a.available === 0)
        })
        setCapacityCapped(result.count > CAPACITY_SCAN_LIMIT)
        setRows(filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE))
        setTotal(filtered.length)
        setAvailability(byTrip)
      } else {
        const result = await fetchTrips({
          filters: effectiveFilters,
          search,
          page,
          pageSize: PAGE_SIZE,
        })
        if (cancelled) return
        if (result.error) {
          setError(result.error)
          setRows([])
          setTotal(0)
          setLoading(false)
          return
        }
        const { byTrip, error: availabilityError } = await fetchAvailability(result.rows.map((r) => r.id))
        if (cancelled) return
        if (availabilityError) setNotice({ text: `Seat availability unavailable: ${availabilityError}`, tone: "error" })
        setRows(result.rows)
        setTotal(result.count)
        setAvailability(byTrip)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [refs, filters, debouncedQ, page, rangeInvalid, refreshKey])

  React.useEffect(() => {
    if (!refs || view === "list") return
    let cancelled = false
    ;(async () => {
      setCalLoading(true)
      setCalError(null)
      let from: Date
      let to: Date
      if (view === "day") {
        from = startOfDay(cursor)
        to = addDays(from, 1)
      } else if (view === "week") {
        from = startOfWeek(cursor, { weekStartsOn: 0 })
        to = addDays(endOfWeek(cursor, { weekStartsOn: 0 }), 1)
      } else {
        from = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
        to = addDays(endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 }), 1)
      }
      const calendarFilters: TripFilters = {
        ...EMPTY_FILTERS,
        status: filters.status,
        vesselId: filters.vesselId,
        routeId: filters.routeId,
        from: format(from, "yyyy-MM-dd"),
        to: format(subDays(to, 1), "yyyy-MM-dd"),
      }
      const search = debouncedQ.trim() ? await resolveTripSearch(debouncedQ) : null
      if (cancelled) return
      const result = await fetchTrips({ filters: calendarFilters, search, limit: CAPACITY_SCAN_LIMIT })
      if (cancelled) return
      if (result.error) {
        setCalError(result.error)
        setCalRows([])
        setCalCapped(false)
      } else {
        const { byTrip, error: availabilityError } = await fetchAvailability(result.rows.map((r) => r.id))
        if (cancelled) return
        if (availabilityError) {
          setCalError(`Could not load seat availability: ${availabilityError}`)
          setCalRows([])
          setCalCapped(false)
        } else {
          const rows = filters.capacity
            ? result.rows.filter((trip) => {
                const a = byTrip.get(trip.id)
                if (filters.capacity === "available") return Boolean(a && a.available > 0)
                if (filters.capacity === "low") return Boolean(a && a.available > 0 && a.available <= 20)
                return Boolean(a && a.available === 0)
              })
            : result.rows
          setCalRows(rows)
          setCalAvailability(byTrip)
          setCalCapped(result.count > CAPACITY_SCAN_LIMIT)
        }
      }
      setCalLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [refs, view, cursor, filters.status, filters.vesselId, filters.routeId, filters.capacity, debouncedQ, refreshKey])

  function setFilter(patch: Partial<TripFilters>) {
    setFilters((prev) => ({ ...prev, ...patch }))
    setPage(0)
  }

  function clearFilters() {
    setQInput("")
    setDebouncedQ("")
    setFilters(EMPTY_FILTERS)
    setPage(0)
  }

  function refresh() {
    setRefreshKey((k) => k + 1)
  }

  function shiftPeriod(direction: -1 | 1) {
    setCursor((prev) => {
      if (view === "day") return addDays(prev, direction)
      if (view === "week") return addWeeks(prev, direction)
      return addMonths(prev, direction)
    })
  }

  function periodLabel() {
    if (view === "day") return format(cursor, "EEEE, dd MMM yyyy")
    if (view === "week") {
      const start = startOfWeek(cursor, { weekStartsOn: 0 })
      return `${format(start, "dd MMM")} – ${format(addDays(start, 6), "dd MMM yyyy")}`
    }
    return format(cursor, "MMMM yyyy")
  }

  async function openTrip(trip: TripRow) {
    setEditor({ mode: "edit", trip, bookingCount: null })
    const { counts, error: countError } = await fetchBookingCounts([trip.id])
    if (countError) {
      setNotice({ text: `Trip opened, but booking check failed: ${countError}`, tone: "error" })
      setEditor((prev) => (prev?.trip?.id === trip.id ? { ...prev, bookingCount: 0 } : prev))
      return
    }
    setEditor((prev) => (prev?.trip?.id === trip.id ? { ...prev, bookingCount: counts.get(trip.id) ?? 0 } : prev))
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  React.useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
    if (page > lastPage) setPage(lastPage)
  }, [page, total])
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1
  const showingTo = page * PAGE_SIZE + rows.length

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Operations</p>
          <h1 className="bg-gradient-to-r from-primary via-blue-600 to-violet-600 bg-clip-text text-2xl font-bold text-transparent">
            Trip scheduling
          </h1>
          <p className="text-sm text-muted-foreground">
            Search departures, review the calendar, and generate recurring schedules without duplicating trips.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refresh} disabled={loading || refsLoading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => setEditor({ mode: "create", bookingCount: 0 })} disabled={!refs}>
            Create trip
          </Button>
          <Button
            onClick={() => setBulkOpen(true)}
            disabled={!refs}
            className="bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90"
          >
            <CalendarPlus className="h-4 w-4" />
            Bulk schedule trips
          </Button>
        </div>
      </div>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${
            notice.tone === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            className={`rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              notice.tone === "error" ? "hover:bg-rose-100" : "hover:bg-emerald-100"
            }`}
            onClick={() => setNotice(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {refsError && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Could not load vessels/routes/ports: {refsError}
          </CardContent>
        </Card>
      )}
      {refsLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading schedule data...
        </p>
      )}

      {refs && (
        <>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="trip-search">Search trips</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="trip-search"
                      className="pl-9"
                      placeholder="Voyage ref (MNL-CEB-20261014-2000), vessel, route, port, date, or trip ID"
                      value={qInput}
                      onChange={(e) => setQInput(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trip-status-filter">Status</Label>
                  <Select
                    id="trip-status-filter"
                    value={filters.status}
                    onChange={(e) => setFilter({ status: e.target.value })}
                  >
                    <option value="all">All statuses</option>
                    {TRIP_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trip-vessel-filter">Vessel</Label>
                  <Select
                    id="trip-vessel-filter"
                    value={filters.vesselId}
                    onChange={(e) => setFilter({ vesselId: e.target.value })}
                  >
                    <option value="all">All vessels</option>
                    {refs.vessels.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.code} · {v.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <div className="space-y-1.5">
                  <Label htmlFor="trip-route-filter">Route</Label>
                  <Select
                    id="trip-route-filter"
                    value={filters.routeId}
                    onChange={(e) => setFilter({ routeId: e.target.value })}
                  >
                    <option value="all">All routes</option>
                    {refs.routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.code}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trip-from">From</Label>
                  <Input
                    id="trip-from"
                    type="date"
                    value={filters.from}
                    onChange={(e) => setFilter({ from: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trip-to">To</Label>
                  <Input
                    id="trip-to"
                    type="date"
                    value={filters.to}
                    onChange={(e) => setFilter({ to: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="trip-capacity-filter">Availability</Label>
                  <Select
                    id="trip-capacity-filter"
                    value={filters.capacity}
                    onChange={(e) => setFilter({ capacity: e.target.value as TripFilters["capacity"] })}
                  >
                    <option value="">Any capacity</option>
                    <option value="available">Seats available</option>
                    <option value="low">Low (≤ 20 left)</option>
                    <option value="full">Sold out</option>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button variant="outline" className="w-full" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{debouncedQ ? `Searching for “${debouncedQ}”` : "Search updates as you type"}</span>
                {loading && (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> updating results
                  </span>
                )}
                {rangeInvalid && <span className="text-destructive">“From” must be on or before “To”.</span>}
                {capacityCapped && (
                  <span className="text-amber-700">
                    Availability filter checked the first {CAPACITY_SCAN_LIMIT} matching trips.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              role="tablist"
              aria-label="Trip views"
              className="inline-flex w-fit flex-wrap gap-1 rounded-xl border bg-card p-1 shadow-sm"
            >
              {VIEWS.map((v) => (
                <button
                  key={v.value}
                  type="button"
                  role="tab"
                  aria-selected={view === v.value}
                  onClick={() => setView(v.value)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    view === v.value
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-primary/5 hover:text-primary"
                  }`}
                >
                  <v.icon className="h-3.5 w-3.5" />
                  {v.label}
                </button>
              ))}
            </div>

            {view !== "list" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => shiftPeriod(-1)} aria-label="Previous period">
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
                  Today
                </Button>
                <Button variant="outline" size="sm" onClick={() => shiftPeriod(1)} aria-label="Next period">
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <span className="min-w-40 text-center text-sm font-medium">{periodLabel()}</span>
                <Input
                  type="date"
                  aria-label="Jump to date"
                  className="h-9 w-40"
                  value={format(cursor, "yyyy-MM-dd")}
                  onChange={(e) => {
                    if (e.target.value) setCursor(new Date(`${e.target.value}T12:00:00`))
                  }}
                />
              </div>
            )}
          </div>

          {view === "list" ? (
            <Card>
              <CardContent className="p-0">
                {error ? (
                  <div role="alert" className="space-y-3 p-6 text-sm">
                    <p className="text-destructive">Could not load trips: {error}</p>
                    <Button variant="outline" size="sm" onClick={refresh}>
                      Retry
                    </Button>
                  </div>
                ) : loading ? (
                  <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading trips...
                  </p>
                ) : rows.length === 0 ? (
                  <div className="space-y-3 p-6 text-sm text-muted-foreground">
                    <p>{debouncedQ || filters.status !== "all" || filters.vesselId !== "all" || filters.routeId !== "all" || filters.from || filters.to || filters.capacity ? "No trips match these filters." : "No trips scheduled yet."}</p>
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[860px] text-sm">
                      <thead>
                        <tr className="border-b bg-primary/5">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                            Voyage / departure
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                            Vessel
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                            Route
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                            Ports
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                            Status
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-primary">
                            Seats left
                          </th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-primary">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((trip) => {
                          const a = availability.get(trip.id)
                          return (
                            <tr key={trip.id} className="border-b last:border-0 transition-colors hover:bg-primary/5">
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => openTrip(trip)}
                                  className="text-left font-mono text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {tripReference(trip)}
                                </button>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {formatTripDate(trip.departure_at)} · {formatTripTime(trip.departure_at)}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-medium">{trip.vessels?.name ?? "—"}</p>
                                <p className="text-xs text-muted-foreground">{trip.vessels?.code ?? "—"}</p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-medium">{trip.routes?.code ?? "—"}</p>
                                <p className="text-xs text-muted-foreground">
                                  Arrives {formatTripDateTime(trip.arrival_at)}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-xs">
                                {refs.ports.find((p) => p.id === trip.departure_port_id)?.code ?? "?"} →{" "}
                                {refs.ports.find((p) => p.id === trip.arrival_port_id)?.code ?? "?"}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge value={trip.status} />
                              </td>
                              <td className="px-4 py-3">
                                {a ? (
                                  <span
                                    className={`font-medium ${
                                      a.available === 0 ? "text-destructive" : a.available <= 20 ? "text-amber-700" : ""
                                    }`}
                                  >
                                    {a.available} / {a.capacity}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button variant="ghost" size="sm" onClick={() => openTrip(trip)}>
                                  Details
                                </Button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {calCapped && (
                <p className="text-xs text-amber-700">
                  The calendar checked the first {CAPACITY_SCAN_LIMIT} matching trips in this period.
                </p>
              )}
              <TripCalendar
                view={view}
                cursor={cursor}
                trips={calRows}
                availability={calAvailability}
                loading={calLoading}
                error={calError}
                onOpenTrip={openTrip}
                onOpenDay={(day) => {
                  setCursor(day)
                  setView("day")
                }}
              />
            </>
          )}

          {view === "list" && !error && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>
                Showing {showingFrom}–{showingTo} of {total}
              </span>
              <span className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0 || loading}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Prev
                </Button>
                <span className="px-1">
                  Page {page + 1} of {pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className={statusTone("scheduled")}>
              scheduled
            </Badge>
            <Badge variant="outline" className={statusTone("boarding")}>
              boarding
            </Badge>
            <Badge variant="outline" className={statusTone("departed")}>
              departed
            </Badge>
            <Badge variant="outline" className={statusTone("cancelled")}>
              cancelled
            </Badge>
            <span>· Existing status model; no new statuses were added.</span>
          </div>
        </>
      )}

      {bulkOpen && refs && (
        <BulkScheduleDialog
          open={bulkOpen}
          refs={refs}
          onClose={() => setBulkOpen(false)}
          onCreated={(count) => {
            setNotice({
              text: `${count} trip${count === 1 ? "" : "s"} created. Search results and calendar refreshed.`,
              tone: "success",
            })
            refresh()
          }}
        />
      )}

      {editor && refs && (
        <TripEditorDialog
          mode={editor.mode}
          trip={editor.trip}
          refs={refs}
          bookingCount={editor.bookingCount}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null)
            setNotice({ text: message, tone: "success" })
            refresh()
          }}
        />
      )}

      {!refsLoading && !refs && !refsError && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{missingSupabaseEnvMessage}</CardContent>
        </Card>
      )}
    </div>
  )
}

export default TripsAdmin
