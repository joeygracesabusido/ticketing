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

const schema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1),
  capacity: z.coerce.number().int().positive().optional(),
  status: z.string().optional(),
})

type Form = z.infer<typeof schema>

export function VesselsAdmin() {
  const [rows, setRows] = React.useState<any[]>([])
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
    const { data, error } = await supabase.from("vessels").select("*").order("code")
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }

  React.useEffect(() => {
    load()
  }, [])

  function openAdd() {
    setEditing(null)
    reset({ code: "", name: "", capacity: undefined, status: "active" })
    setShowForm(true)
  }

  function openEdit(row: any) {
    setEditing(row)
    reset({ code: row.code, name: row.name, capacity: row.capacity ?? undefined, status: row.status })
    setShowForm(true)
  }

  const onSubmit = async (v: Form) => {
    if (!supabase) return
    const payload = { code: v.code, name: v.name, capacity: v.capacity ?? null, status: v.status || "active" }
    const { error } = editing
      ? await supabase.from("vessels").update(payload).eq("id", editing.id)
      : await supabase.from("vessels").insert(payload)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    load()
  }

  async function onDelete(row: any) {
    if (!window.confirm(`Delete vessel ${row.code}?`)) return
    if (!supabase) return
    const { error } = await supabase.from("vessels").delete().eq("id", row.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="space-y-4">
      <AdminTable
        title="Vessels"
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "capacity", label: "Capacity" },
          { key: "status", label: "Status" },
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
                <Label htmlFor="name">Name</Label>
                <Input id="name" {...register("name")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="capacity">Capacity</Label>
                <Input id="capacity" type="number" {...register("capacity")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select id="status" {...register("status")}>
                  <option value="active">active</option>
                  <option value="maintenance">maintenance</option>
                  <option value="retired">retired</option>
                </Select>
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

export default VesselsAdmin
