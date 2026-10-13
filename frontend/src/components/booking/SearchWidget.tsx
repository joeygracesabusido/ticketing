import * as React from "react"
import { useNavigate } from "react-router-dom"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Search, Ship } from "lucide-react"

const searchSchema = z.object({
  origin: z.string().min(1, "Select origin"),
  destination: z.string().min(1, "Select destination"),
  date: z.string().min(1, "Select date"),
  pax: z.string().min(1, "Select passengers"),
}).refine((data) => data.origin !== data.destination, {
  message: "Origin and destination must be different",
  path: ["destination"],
})

type SearchForm = z.infer<typeof searchSchema>

type Port = {
  id: string
  code: string
  name: string
  city: string
}

const FALLBACK_PORTS: Port[] = [
  { id: "MNL", code: "MNL", name: "Manila North Harbor", city: "Manila" },
  { id: "CEB", code: "CEB", name: "Cebu Port", city: "Cebu City" },
  { id: "ILO", code: "ILO", name: "Iloilo Port", city: "Iloilo City" },
  { id: "BCD", code: "BCD", name: "Bacolod Port", city: "Bacolod City" },
  { id: "CGY", code: "CGY", name: "Cagayan de Oro Port", city: "Cagayan de Oro" },
  { id: "DVO", code: "DVO", name: "Davao Port", city: "Davao City" },
  { id: "BTG", code: "BTG", name: "Batangas Port", city: "Batangas City" },
  { id: "TAG", code: "TAG", name: "Tagbilaran Port", city: "Tagbilaran City" },
]

export function SearchWidget() {
  const navigate = useNavigate()
  const [sbPorts, setSbPorts] = React.useState<Port[] | null>(null)

  React.useEffect(() => {
    if (!supabase) return
    supabase
      .from("ports")
      .select("id, code, name, city")
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) setSbPorts(data as Port[])
      })
  }, [])

  const ports: Port[] = React.useMemo(() => {
    if (sbPorts && sbPorts.length > 0) return sbPorts
    return FALLBACK_PORTS
  }, [sbPorts])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SearchForm>({
    resolver: zodResolver(searchSchema),
    defaultValues: {
      origin: "",
      destination: "",
      date: new Date().toISOString().split("T")[0],
      pax: "1",
    },
  })

  const onSubmit = (values: SearchForm) => {
    const params = new URLSearchParams({
      origin: values.origin,
      destination: values.destination,
      date: values.date,
      pax: values.pax,
    })
    navigate(`/trips?${params.toString()}`)
  }

  return (
    <Card className="w-full max-w-5xl mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Ship className="h-5 w-5 text-primary" />
          Search Ferry Trips
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="space-y-2">
            <Label htmlFor="origin">From</Label>
            <Select id="origin" {...register("origin")} defaultValue="">
              <option value="" disabled>
                Select origin
              </option>
              {ports.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.city}
                </option>
              ))}
            </Select>
            {errors.origin && <p className="text-sm text-destructive">{errors.origin.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="destination">To</Label>
            <Select id="destination" {...register("destination")} defaultValue="">
              <option value="" disabled>
                Select destination
              </option>
              {ports.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.city}
                </option>
              ))}
            </Select>
            {errors.destination && <p className="text-sm text-destructive">{errors.destination.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Departure Date</Label>
            <Input id="date" type="date" {...register("date")} />
            {errors.date && <p className="text-sm text-destructive">{errors.date.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pax">Passengers</Label>
            <Select id="pax" {...register("pax")} defaultValue="1">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={String(n)}>
                  {n} {n === 1 ? "Passenger" : "Passengers"}
                </option>
              ))}
            </Select>
            {errors.pax && <p className="text-sm text-destructive">{errors.pax.message}</p>}
          </div>

          <div className="flex items-end">
            <Button type="submit" className="w-full gap-2">
              <Search className="h-4 w-4" />
              Search Trips
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export default SearchWidget
