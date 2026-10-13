import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { supabase } from "@/lib/supabase"
import { AdminTable } from "@/components/admin/AdminTable"

const schema = z
  .object({
    code: z.string().min(1).max(16),
    origin_port_id: z.string().min(1, "Select origin"),
    destination_port_id: z.string().min(1, "Select destination"),
    distance_km: z.coerce.number().positive().optional(),
    estimated_duration_minutes: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.origin_port_id !== v.destination_port_id, {
    message: "Origin and destination must differ",
    path: ["destination_port_id"],
  })

type Form = z.infer<typeof schema>

export function RoutesAdmin() {
  const [rows, setRows] = React.useState<any[]>([])
  const [ports, setPorts] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<any | null>(null)
  const [showForm, setShowForm] = React.useState(false)
  const { register, handleSubmit, reset } = useForm<Form>({ resolver: zodResolver(schema) })

  async function load() {
    setLoading(true)
    setError(null)
    if (!supabase) {
      setError("Missing Supabase env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).")
      setLoading(false)
      return
    }
    const [r, p] = await Promise.all([
      supabase.from("routes").select("*").order("code"),
      supabase.from("ports").select("id, code, city").order("code"),
    ])
    if (r.error) setError(r.error.message)
    else setRows(r.data ?? [])
    if (p.error) setError(p.error.message)
    else setPorts(p.data ?? [])
    setLoading(false)
  }

  React.useEffect(() => {
    load()
  }, [])

  function openAdd() {
    setEditing(null)
    reset({ code: "", origin_port_id: "", destination_port_id: "" })
    setShowForm(true)
  }

  function openEdit(row: any) {
    setEditing(row)
    reset({
      code: row.code,
      origin_port_id: row.origin_port_id,
      destination_port_id: row.destination_port_id,
      distance_km: row.distance_km ?? undefined,
      estimated_duration_minutes: row.estimated_duration_minutes ?? undefined,
    })
    setShowForm(true)
  }

  const onSubmit = async (v: Form) => {
    if (!supabase) {
      setError("Missing Supabase env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).")
      return
    }
    const payload = {
      code: v.code.toUpperCase(),
      origin_port_id: v.origin_port_id,
      destination_port_id: v.destination_port_id,
      distance_km: v.distance_km ?? null,
      estimated_duration_minutes: v.estimated_duration_minutes ?? null,
    }
    const { error } = editing
      ? await supabase.from("routes").update(payload).eq("id", editing.id)
      : await supabase.from("routes").insert(payload)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    load()
  }

  async function onDelete(row: any) {
    if (!window.confirm(`Delete route ${row.code}?`)) return
    if (!supabase) {
      setError("Missing Supabase env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).")
      return
    }
    const { error } = await supabase.from("routes").delete().eq("id", row.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="space-y-4">
      <AdminTable
        title="Routes"
        columns={[
          { key: "code", label: "Code" },
          { key: "distance_km", label: "Distance (km)" },
          { key: "estimated_duration_minutes", label: "Duration (min)" },
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
                <Label htmlFor="code">Code</Label>
                <Input id="code" {...register("code")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="origin_port_id">Origin port</Label>
                <Select id="origin_port_id" {...register("origin_port_id")} defaultValue="">
                  <option value="" disabled>
                    Select origin
                  </option>
                  {ports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} - {p.city}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="destination_port_id">Destination port</Label>
                <Select id="destination_port_id" {...register("destination_port_id")} defaultValue="">
                  <option value="" disabled>
                    Select destination
                  </option>
                  {ports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} - {p.city}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="distance_km">Distance (km)</Label>
                <Input id="distance_km" type="number" step="0.01" {...register("distance_km")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimated_duration_minutes">Duration (min)</Label>
                <Input id="estimated_duration_minutes" type="number" {...register("estimated_duration_minutes")} />
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

export default RoutesAdmin
