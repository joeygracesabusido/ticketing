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
import { AdminTable, StatusBadge } from "@/components/admin/AdminTable"

const schema = z.object({
  vessel_id: z.string().min(1, "Select vessel"),
  code: z.string().min(1).max(32),
  name: z.string().min(1),
  capacity: z.coerce.number().int().min(0),
  fare_amount: z.coerce.number().min(0),
  is_active: z.string().optional(),
})

type Form = z.infer<typeof schema>

export function AccommodationsAdmin() {
  const [rows, setRows] = React.useState<any[]>([])
  const [vessels, setVessels] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<any | null>(null)
  const [showForm, setShowForm] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const { register, handleSubmit, reset } = useForm<Form>({ resolver: zodResolver(schema) })

  async function load() {
    setLoading(true); setError(null)
    if (!supabase) { setError(missingSupabaseEnvMessage); setLoading(false); return }
    const [a, v] = await Promise.all([
      supabase.from("vessel_accommodations").select("*, vessels(code,name)").order("code"),
      supabase.from("vessels").select("id, code, name").order("code"),
    ])
    if (a.error) setError(a.error.message); else setRows(a.data ?? [])
    if (!v.error) setVessels(v.data ?? [])
    setLoading(false)
  }
  React.useEffect(() => { load() }, [])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.code, r.name, String(r.capacity ?? ""), String(r.fare_amount ?? ""), String(r.is_active), r.vessels?.code, r.vessels?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
  }, [rows, query])

  const onSubmit = async (f: Form) => {
    if (!supabase) return
    const payload = { vessel_id: f.vessel_id, code: f.code.toUpperCase(), name: f.name, capacity: f.capacity, fare_amount: f.fare_amount, is_active: f.is_active !== "false" };
    const { error } = editing
      ? await supabase.from("vessel_accommodations").update(payload).eq("id", editing.id)
      : await supabase.from("vessel_accommodations").insert(payload)
    if (error) { setError(error.message); return }
    // backfill inventory for that vessel's trips (new category -> voyage rows)
    if (!editing) {
      const { data: trips } = await supabase.from("trips").select("id").eq("vessel_id", f.vessel_id)
      const { data: acc } = await supabase.from("vessel_accommodations").select("id, capacity, fare_amount").eq("vessel_id", f.vessel_id).eq("code", payload.code).single()
      if (trips && acc) {
        const { error: invError } = await supabase.from("trip_accommodation_inventory").upsert(
          trips.map((t) => ({ trip_id: t.id, accommodation_id: acc.id, capacity: payload.capacity, fare_amount: payload.fare_amount })),
          { onConflict: "trip_id,accommodation_id", ignoreDuplicates: true },
        )
        if (invError) setError(`Category saved, but trip inventory sync failed: ${invError.message}`)
      }
    }
    setShowForm(false); load()
  }

  async function onDelete(row: any) {
    if (!window.confirm(`Disable ${row.code}? (kept for audit; set inactive instead of delete)`)) return
    if (!supabase) return
    const { error } = await supabase.from("vessel_accommodations").update({ is_active: false }).eq("id", row.id)
    if (error) setError(error.message); else load()
  }

  return (
    <div className="space-y-4">
      <Input placeholder="Search code, name, vessel…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
      <AdminTable title="Accommodations (per vessel)" columns={[
        { key: "code", label: "Code" }, { key: "name", label: "Name" },
        { key: "vessel", label: "Vessel", render: (r) => (r.vessels ? `${r.vessels.code} — ${r.vessels.name}` : "—") },
        { key: "capacity", label: "Capacity" }, { key: "fare_amount", label: "Fare (VAT-incl)" },
        { key: "is_active", label: "Active", render: (r) => <StatusBadge value={r.is_active} /> },
      ]} rows={filtered} loading={loading} error={error}
        onAdd={() => { setEditing(null); reset({ vessel_id: "", code: "", name: "", capacity: 50, fare_amount: 1200, is_active: "true" }); setShowForm(true) }}
        onEdit={(r) => { setEditing(r); reset({ vessel_id: r.vessel_id, code: r.code, name: r.name, capacity: r.capacity, fare_amount: Number(r.fare_amount), is_active: String(r.is_active) }); setShowForm(true) }}
        onDelete={onDelete} />
      {showForm && (
        <Card><CardContent className="p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Vessel</Label><Select {...register("vessel_id")} defaultValue="">{[<option key="" value="" disabled>Select vessel</option>, ...vessels.map((v) => <option key={v.id} value={v.id}>{v.code} — {v.name}</option>)]}</Select></div>
            <div className="space-y-2"><Label>Code</Label><Input {...register("code")} placeholder="TOURIST" /></div>
            <div className="space-y-2"><Label>Name</Label><Input {...register("name")} placeholder="Tourist Class" /></div>
            <div className="space-y-2"><Label>Capacity</Label><Input type="number" {...register("capacity")} /></div>
            <div className="space-y-2"><Label>Fare per pax (VAT-incl ₱)</Label><Input type="number" step="0.01" {...register("fare_amount")} /></div>
            <div className="space-y-2"><Label>Active</Label><Select {...register("is_active")}><option value="true">true</option><option value="false">false (maintenance)</option></Select></div>
            <div className="md:col-span-2 flex gap-2"><Button type="submit">{editing ? "Save" : "Create"}</Button><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button></div>
          </form>
        </CardContent></Card>
      )}
      <p className="text-xs text-muted-foreground">Capacity counters per voyage live in trip_accommodation_inventory; holds/releases are atomic in SQL. Disable (not delete) for maintenance.</p>
    </div>
  )
}

export default AccommodationsAdmin
