import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import { AdminTable } from "@/components/admin/AdminTable"

const schema = z
  .object({
    route_id: z.string().min(1, "Select route"),
    vessel_id: z.string().min(1, "Select vessel"),
    departure_at: z.string().min(1, "Select departure"),
    arrival_at: z.string().min(1, "Select arrival"),
    status: z.string().optional(),
    fare_from: z.coerce.number().nonnegative().optional(),
  })
  .refine((v) => new Date(v.arrival_at) > new Date(v.departure_at), {
    message: "Arrival must be after departure",
    path: ["arrival_at"],
  })

type Form = z.infer<typeof schema>

function toLocal(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TripsAdmin() {
  const [rows, setRows] = React.useState<any[]>([])
  const [routes, setRoutes] = React.useState<any[]>([])
  const [vessels, setVessels] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<any | null>(null)
  const [showForm, setShowForm] = React.useState(false)
  const { register, handleSubmit, reset } = useForm<Form>({ resolver: zodResolver(schema) })

  async function load() {
    setLoading(true)
    setError(null)
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      setLoading(false)
      return
    }
    const [t, r, v] = await Promise.all([
      supabase.from("trips").select("id, route_id, vessel_id, departure_at, arrival_at, status, fare_from, routes(code)").order("departure_at"),
      supabase.from("routes").select("id, code").order("code"),
      supabase.from("vessels").select("id, code").order("code"),
    ])
    if (t.error) setError(t.error.message)
    else setRows(t.data ?? [])
    if (r.error) setError(r.error.message)
    else setRoutes(r.data ?? [])
    if (v.error) setError(v.error.message)
    else setVessels(v.data ?? [])
    setLoading(false)
  }

  React.useEffect(() => {
    load()
  }, [])

  function openAdd() {
    setEditing(null)
    reset({ route_id: "", vessel_id: "", departure_at: "", arrival_at: "", status: "scheduled" })
    setShowForm(true)
  }

  function openEdit(row: any) {
    setEditing(row)
    reset({
      route_id: row.route_id ?? "",
      vessel_id: row.vessel_id ?? "",
      departure_at: row.departure_at ? toLocal(row.departure_at) : "",
      arrival_at: row.arrival_at ? toLocal(row.arrival_at) : "",
      status: row.status,
      fare_from: row.fare_from ?? undefined,
    })
    setShowForm(true)
  }

  const onSubmit = async (v: Form) => {
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      return
    }
    const route = routes.find((r) => r.id === v.route_id)
    if (!route && !editing) {
      setError("Select a route.")
      return
    }
    const payload: any = {
      departure_at: new Date(v.departure_at).toISOString(),
      arrival_at: new Date(v.arrival_at).toISOString(),
      status: v.status || "scheduled",
      fare_from: v.fare_from ?? null,
    }
    if (!editing) {
      const { data: full, error: routeError } = await supabase.from("routes").select("origin_port_id, destination_port_id").eq("id", v.route_id).single()
      if (routeError || !full) {
        setError(routeError?.message ?? "Could not load route ports.")
        return
      }
      Object.assign(payload, {
        route_id: v.route_id,
        vessel_id: v.vessel_id,
        departure_port_id: full?.origin_port_id,
        arrival_port_id: full?.destination_port_id,
      })
    } else {
      const { data: full, error: routeError } = await supabase.from("routes").select("origin_port_id, destination_port_id").eq("id", v.route_id).single()
      if (routeError || !full) {
        setError(routeError?.message ?? "Could not load route ports.")
        return
      }
      Object.assign(payload, {
        route_id: v.route_id,
        vessel_id: v.vessel_id,
        departure_port_id: full?.origin_port_id,
        arrival_port_id: full?.destination_port_id,
      })
    }
    const { error } = editing
      ? await supabase.from("trips").update(payload).eq("id", editing.id)
      : await supabase.from("trips").insert(payload)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    load()
  }

  async function onDelete(row: any) {
    if (!window.confirm("Delete this trip?")) return
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      return
    }
    const { error } = await supabase.from("trips").delete().eq("id", row.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="space-y-4">
      <AdminTable
        title="Trips"
        columns={[
          { key: "departure_at", label: "Departure", render: (r) => new Date(r.departure_at).toLocaleString() },
          { key: "arrival_at", label: "Arrival", render: (r) => new Date(r.arrival_at).toLocaleString() },
          { key: "status", label: "Status" },
          {
            key: "fare_from",
            label: "Fare",
            render: (r) =>
              r.fare_from === null || r.fare_from === undefined || Number.isNaN(Number(r.fare_from))
                ? "--"
                : new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                    Number(r.fare_from)
                  ),
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        onAdd={openAdd}
        onEdit={openEdit}
        onDelete={onDelete}
      />
      {showForm && (
        <Card>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="route_id">Route</Label>
                <Select id="route_id" {...register("route_id")} defaultValue="">
                  <option value="" disabled>
                    Select route
                  </option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vessel_id">Vessel</Label>
                <Select id="vessel_id" {...register("vessel_id")} defaultValue="">
                  <option value="" disabled>
                    Select vessel
                  </option>
                  {vessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="departure_at">Departure</Label>
                <Input id="departure_at" type="datetime-local" {...register("departure_at")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="arrival_at">Arrival</Label>
                <Input id="arrival_at" type="datetime-local" {...register("arrival_at")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select id="status" {...register("status")}>
                  <option value="scheduled">scheduled</option>
                  <option value="boarding">boarding</option>
                  <option value="departed">departed</option>
                  <option value="cancelled">cancelled</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fare_from">Fare from</Label>
                <Input id="fare_from" type="number" step="0.01" {...register("fare_from")} />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit">{editing ? "Save" : "Create"}</Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default TripsAdmin
