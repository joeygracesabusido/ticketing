import { useLocation } from "react-router-dom"
import { SearchWidget } from "@/components/booking/SearchWidget"
import { Header } from "@/components/layout/Header"
import { Ship } from "lucide-react"

export function Home() {
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="bg-gradient-to-b from-primary/10 to-background py-12 md:py-20">
          {notice && <p className="text-sm text-muted-foreground text-center">{notice}</p>}
          <div className="container mx-auto px-4 text-center space-y-4 mb-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1 text-sm text-primary">
              <Ship className="h-4 w-4" />
              Ferry Travel Made Simple
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
              Sail Across the Philippines
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Book your ferry trip with ease. Search routes, compare fares, and secure your seat in minutes.
            </p>
          </div>
          <div className="container mx-auto px-4">
            <SearchWidget />
          </div>
        </section>

        <section className="container mx-auto px-4 py-12">
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center space-y-2">
              <h3 className="font-semibold">8 Major Ports</h3>
              <p className="text-sm text-muted-foreground">Manila, Cebu, Iloilo, Bacolod and more destinations</p>
            </div>
            <div className="text-center space-y-2">
              <h3 className="font-semibold">Daily Departures</h3>
              <p className="text-sm text-muted-foreground">Evening departures at 8 PM, arrive by 8 AM next day</p>
            </div>
            <div className="text-center space-y-2">
              <h3 className="font-semibold">6 Accommodation Types</h3>
              <p className="text-sm text-muted-foreground">From Super Value to Private Suite for every budget</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

export default Home
