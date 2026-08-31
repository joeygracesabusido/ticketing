import { useNavigate } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, Ship } from "lucide-react"
import { format } from "date-fns"

export type TripCardProps = {
  trip: {
    id: string
    route: {
      code: string
      originPort?: { code: string; city: string }
      destinationPort?: { code: string; city: string }
      estimatedDurationMinutes?: number | null
    }
    vessel: {
      name: string
      code: string
    }
    departureAt: string
    arrivalAt: string
    fareFrom?: string | number | null
    duration?: string
  }
}

function formatTime(dateStr: string) {
  try {
    return format(new Date(dateStr), "h:mm a")
  } catch {
    return dateStr
  }
}

function formatDuration(minutes?: number | null, departureAt?: string, arrivalAt?: string) {
  if (minutes) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m === 0 ? `${h}h` : `${h}h ${m}m`
  }
  if (departureAt && arrivalAt) {
    const diff = new Date(arrivalAt).getTime() - new Date(departureAt).getTime()
    const hours = Math.round(diff / (1000 * 60 * 60))
    return `${hours}h`
  }
  return "12h"
}

export function TripCard({ trip }: TripCardProps) {
  const navigate = useNavigate()
  const departure = formatTime(trip.departureAt)
  const arrival = formatTime(trip.arrivalAt)
  const duration = formatDuration(trip.route?.estimatedDurationMinutes, trip.departureAt, trip.arrivalAt)
  const price = trip.fareFrom != null ? `₱${Number(trip.fareFrom).toLocaleString()}` : "₱--"

  return (
    <Card className="w-full hover:shadow-md transition-shadow">
      <CardContent className="p-4 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Ship className="h-4 w-4 text-primary" />
              <span className="font-semibold">{trip.vessel?.name}</span>
              <Badge variant="secondary" className="text-xs">
                {trip.vessel?.code}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {trip.route?.code}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex flex-col">
                <span className="font-medium text-lg">{departure}</span>
                <span className="text-muted-foreground text-xs">
                  {trip.route?.originPort?.city || trip.route?.originPort?.code || "Origin"}
                </span>
              </div>
              <div className="flex flex-col items-center px-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {duration}
                </span>
                <div className="w-16 md:w-24 h-px bg-border my-1 relative">
                  <div className="absolute -top-1 left-0 h-2 w-2 rounded-full bg-primary" />
                  <div className="absolute -top-1 right-0 h-2 w-2 rounded-full bg-primary" />
                </div>
                <span className="text-xs text-muted-foreground">{trip.route?.code}</span>
              </div>
              <div className="flex flex-col">
                <span className="font-medium text-lg">{arrival}</span>
                <span className="text-muted-foreground text-xs">
                  {trip.route?.destinationPort?.city || trip.route?.destinationPort?.code || "Destination"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center gap-4 border-t md:border-t-0 md:border-l pt-4 md:pt-0 md:pl-6">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">From</p>
              <p className="text-xl font-bold text-primary">{price}</p>
              <p className="text-xs text-muted-foreground">per person</p>
            </div>
            <Button onClick={() => navigate(`/trips/${trip.id}`)} className="px-8">
              SELECT
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default TripCard
