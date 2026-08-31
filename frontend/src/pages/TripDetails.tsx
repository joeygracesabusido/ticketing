import { useParams, Link } from "react-router-dom"
import { useQuery } from "@apollo/client"
import { Header } from "@/components/layout/Header"
import { GET_TRIP } from "@/graphql/queries/trips"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"
import { ArrowLeft, Ship, Clock, MapPin } from "lucide-react"

export function TripDetails() {
  const { id } = useParams<{ id: string }>()
  const { data, loading, error } = useQuery(GET_TRIP, {
    variables: { id },
    skip: !id,
  })

  const trip = data?.trip

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <Link to="/trips" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to trips
        </Link>

        {loading && <p className="text-sm text-muted-foreground">Loading trip details...</p>}
        {error && (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-destructive">Failed to load trip: {error.message}</p>
            </CardContent>
          </Card>
        )}
        {!loading && !error && !trip && (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">Trip not found.</p>
              <Link to="/">
                <Button variant="outline" className="mt-4">
                  Return Home
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
        {trip && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Ship className="h-5 w-5 text-primary" />
                    {trip.vessel?.name}
                    <Badge variant="secondary">{trip.vessel?.code}</Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Route {trip.route?.code}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> Departure
                      </p>
                      <p className="font-medium">{trip.departurePort?.name || trip.route?.originPort?.name}</p>
                      <p className="text-sm text-muted-foreground">{trip.departurePort?.city}</p>
                      <p className="text-sm font-medium">{format(new Date(trip.departureAt), "PPp")}</p>
                      <p className="text-sm">{format(new Date(trip.departureAt), "h:mm a")}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> Arrival
                      </p>
                      <p className="font-medium">{trip.arrivalPort?.name || trip.route?.destinationPort?.name}</p>
                      <p className="text-sm text-muted-foreground">{trip.arrivalPort?.city}</p>
                      <p className="text-sm font-medium">{format(new Date(trip.arrivalAt), "PPp")}</p>
                      <p className="text-sm">{format(new Date(trip.arrivalAt), "h:mm a")}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Duration:{" "}
                    {trip.route?.estimatedDurationMinutes
                      ? `${Math.floor(trip.route.estimatedDurationMinutes / 60)}h ${trip.route.estimatedDurationMinutes % 60 ? `${trip.route.estimatedDurationMinutes % 60}m` : ""}`
                      : "12h"}
                  </div>
                  <div className="flex gap-2">
                    <Badge>{trip.status}</Badge>
                    {trip.fareFrom && <Badge variant="outline">From ₱{Number(trip.fareFrom).toLocaleString()}</Badge>}
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Booking Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Fare from</span>
                    <span className="font-bold">₱{trip.fareFrom ? Number(trip.fareFrom).toLocaleString() : "--"}</span>
                  </div>
                  <Button className="w-full" disabled>
                    Continue to Booking (coming soon)
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">Booking flow implemented in next phase</p>
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
