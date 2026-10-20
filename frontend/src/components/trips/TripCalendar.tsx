import * as React from "react"
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { CalendarDays, Loader2, Ship } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  formatTripDateTime,
  formatTripTime,
  statusTone,
  tripReference,
  type Availability,
  type TripRow,
} from "@/lib/trips"

export type CalendarView = "day" | "week" | "month"

const dayKey = (d: Date) => format(d, "yyyy-MM-dd")

function chipClass(status: string) {
  switch (status) {
    case "scheduled":
      return "border-l-sky-500"
    case "boarding":
      return "border-l-amber-500"
    case "departed":
      return "border-l-violet-500"
    case "cancelled":
      return "border-l-rose-500"
    default:
      return "border-l-primary"
  }
}

function TripChip(props: {
  trip: TripRow
  onOpen: (trip: TripRow) => void
  availability?: Availability
  showDate?: boolean
}) {
  const { trip, onOpen, availability, showDate } = props
  return (
    <button
      type="button"
      onClick={() => onOpen(trip)}
      aria-label={`Open ${tripReference(trip)} on ${formatTripDateTime(trip.departure_at)}`}
      className={`w-full rounded-md border border-l-4 bg-card px-2 py-1.5 text-left text-[11px] shadow-sm transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${chipClass(
        trip.status
      )}`}
    >
      <span className="flex items-center justify-between gap-1 font-semibold">
        <span>
          {showDate ? `${format(new Date(trip.departure_at), "dd MMM")} · ` : ""}
          {formatTripTime(trip.departure_at)}
        </span>
        <span className="truncate text-muted-foreground">{trip.vessels?.code ?? "Vessel"}</span>
      </span>
      <span className="block truncate text-muted-foreground">
        {trip.routes?.code ?? "Route"} · {trip.status}
      </span>
      {availability && (
        <span className="mt-0.5 block truncate text-muted-foreground">
          {availability.available} / {availability.capacity} seats left
        </span>
      )}
    </button>
  )
}

export function TripCalendar(props: {
  view: CalendarView
  cursor: Date
  trips: TripRow[]
  availability: Map<string, Availability>
  loading: boolean
  error: string | null
  onOpenTrip: (trip: TripRow) => void
  onOpenDay: (day: Date) => void
}) {
  const { view, cursor, trips, availability, loading, error, onOpenTrip, onOpenDay } = props

  const byDay = React.useMemo(() => {
    const map = new Map<string, TripRow[]>()
    for (const trip of trips) {
      const key = dayKey(new Date(trip.departure_at))
      const list = map.get(key) ?? []
      list.push(trip)
      map.set(key, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.departure_at.localeCompare(b.departure_at))
    return map
  }, [trips])

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-destructive">Could not load the calendar: {error}</CardContent>
      </Card>
    )
  }

  if (view === "day") {
    const dayTrips = byDay.get(dayKey(cursor)) ?? []
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{format(cursor, "EEEE, dd MMMM yyyy")}</h2>
          <Badge variant="outline">{dayTrips.length} departure{dayTrips.length === 1 ? "" : "s"}</Badge>
        </div>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading departures...
          </p>
        ) : dayTrips.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">No departures on this day.</CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {dayTrips.map((trip) => {
              const a = availability.get(trip.id)
              return (
                <Card key={trip.id} className="overflow-hidden">
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => onOpenTrip(trip)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Ship className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{formatTripTime(trip.departure_at)}</span>
                          <Badge variant="outline" className={statusTone(trip.status)}>
                            {trip.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{tripReference(trip)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm">
                          {trip.vessels?.name ?? trip.vessels?.code ?? "Vessel"} · {trip.routes?.code ?? "Route"}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Arrives {formatTripDateTime(trip.arrival_at)}
                          {a ? ` · ${a.available} / ${a.capacity} seats left` : ""}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenTrip(trip)}
                      className="self-start rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
                    >
                      Details
                    </button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (view === "week") {
    const start = startOfWeek(cursor, { weekStartsOn: 0 })
    const days = eachDayOfInterval({ start, end: endOfWeek(cursor, { weekStartsOn: 0 }) })
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">
            {format(start, "dd MMM")} – {format(days[6], "dd MMM yyyy")}
          </h2>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
          {days.map((day) => {
            const list = byDay.get(dayKey(day)) ?? []
            return (
              <div
                key={day.toISOString()}
                className={`rounded-xl border bg-card p-2 ${isSameDay(day, new Date()) ? "border-primary/50" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className="mb-2 flex w-full items-baseline justify-between rounded px-1 py-0.5 text-left hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`View ${format(day, "EEEE dd MMMM")}`}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {format(day, "EEE")}
                  </span>
                  <span className={`text-sm font-bold ${isSameDay(day, new Date()) ? "text-primary" : ""}`}>
                    {format(day, "d")}
                  </span>
                </button>
                <div className="space-y-1.5">
                  {list.map((trip) => (
                    <TripChip key={trip.id} trip={trip} onOpen={onOpenTrip} availability={availability.get(trip.id)} />
                  ))}
                  {list.length === 0 && <p className="px-1 py-2 text-[11px] text-muted-foreground">No departures</p>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const monthStart = startOfMonth(cursor)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{format(cursor, "MMMM yyyy")}</h2>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 border-b bg-primary/5">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-primary">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const list = byDay.get(dayKey(day)) ?? []
              const outside = !isSameMonth(day, monthStart)
              return (
                <div
                  key={day.toISOString()}
                  className={`min-h-28 border-b border-r p-1.5 last:border-r-0 ${
                    outside ? "bg-muted/30" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenDay(day)}
                    className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isSameDay(day, new Date()) ? "bg-primary text-primary-foreground" : outside ? "text-muted-foreground" : ""
                    }`}
                    aria-label={`View departures on ${format(day, "dd MMMM yyyy")}`}
                  >
                    {format(day, "d")}
                  </button>
                  <div className="space-y-1">
                    {list.slice(0, 3).map((trip) => (
                      <TripChip key={trip.id} trip={trip} onOpen={onOpenTrip} />
                    ))}
                    {list.length > 3 && (
                      <button
                        type="button"
                        onClick={() => onOpenDay(day)}
                        className="w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-primary hover:bg-primary/5"
                      >
                        +{list.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TripCalendar
