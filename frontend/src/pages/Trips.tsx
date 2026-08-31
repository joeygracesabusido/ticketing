import { useSearchParams } from "react-router-dom"
import { useQuery } from "@apollo/client"
import { Header } from "@/components/layout/Header"
import { TripCard } from "@/components/trips/TripCard"
import { SEARCH_TRIPS } from "@/graphql/queries/trips"
import { Card, CardContent } from "@/components/ui/card"
import { SearchWidget } from "@/components/booking/SearchWidget"

export function Trips() {
  const [searchParams] = useSearchParams()
  const origin = searchParams.get("origin")
  const destination = searchParams.get("destination")
  const date = searchParams.get("date")
  const pax = searchParams.get("pax") || "1"

  const shouldQuery = Boolean(origin && destination && date)

  const { data, loading, error } = useQuery(SEARCH_TRIPS, {
    variables: {
      originPortId: origin,
      destinationPortId: destination,
      departureDate: date,
    },
    skip: !shouldQuery,
    fetchPolicy: "cache-and-network",
  })

  const trips = data?.searchTrips ?? []

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Available Trips</h1>
          {shouldQuery ? (
            <p className="text-sm text-muted-foreground">
              Showing trips from {origin} to {destination} on {date} for {pax} passenger(s)
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Use the search widget to find trips</p>
          )}
        </div>

        {!shouldQuery && (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground mb-4">No search parameters. Try searching below:</p>
              <SearchWidget />
            </CardContent>
          </Card>
        )}

        {shouldQuery && (
          <>
            {loading && <p className="text-sm text-muted-foreground">Loading trips...</p>}
            {error && (
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-destructive">Failed to load trips: {error.message}</p>
                  <p className="text-sm text-muted-foreground mt-2">Please check backend is running at http://localhost:8000/graphql</p>
                </CardContent>
              </Card>
            )}
            {!loading && !error && trips.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center">
                  <p className="text-sm text-muted-foreground">No trips found for the selected route and date.</p>
                  <p className="text-sm text-muted-foreground">Try a different date or check seeded data (MNL → CEB).</p>
                </CardContent>
              </Card>
            )}
            {!loading && trips.length > 0 && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{trips.length} trip(s) found</p>
                {trips.map((trip: any) => (
                  <TripCard key={trip.id} trip={trip} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default Trips
