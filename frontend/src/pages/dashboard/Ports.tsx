import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import { AdminTable } from "@/components/admin/AdminTable"

const schema = z.object({
  code: z.string().min(2).max(8),
  name: z.string().min(1),
  city: z.string().min(1),
  province: z.string().optional(),
  country: z.string().optional(),
  active: z.boolean().optional(),
})

type Form = z.infer<typeof schema>

export function PortsAdmin() {
  const [rows, setRows] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<any | null>(null)
  const [showForm, setShowForm] = React.useState(false)
  const { register, handleSubmit, reset, formState } = useForm<Form>({ resolver: zodResolver(schema) })

  async function load() {
    setLoading(true)
    setError(null)
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      setLoading(false)
      return
    }
    const { data, error } = await supabase.from("ports").select("*").order("code")
    if (error) setError(error.message)
    else setRows(data ?? [])
    setLoading(false)
  }

  React.useEffect(() => {
    load()
  }, [])

  function openAdd() {
    setEditing(null)
    reset({ code: "", name: "", city: "", province: "", country: "Philippines" })
    setShowForm(true)
  }

  function openEdit(row: any) {
    setEditing(row)
    reset({ code: row.code, name: row.name, city: row.city, province: row.province ?? "", country: row.country ?? "Philippines" })
    setShowForm(true)
  }

  const onSubmit = async (v: Form) => {
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      return
    }
    const payload = { code: v.code.toUpperCase(), name: v.name, city: v.city, province: v.province || null, country: v.country || "Philippines" }
    const { error } = editing
      ? await supabase.from("ports").update(payload).eq("id", editing.id)
      : await supabase.from("ports").insert(payload)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    load()
  }

  async function onDelete(row: any) {
    if (!window.confirm(`Delete port ${row.code}?`)) return
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      return
    }
    const { error } = await supabase.from("ports").delete().eq("id", row.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="space-y-4">
      <AdminTable
        title="Ports"
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Name" },
          { key: "city", label: "City" },
          { key: "country", label: "Country" },
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
                <Label htmlFor="city">City</Label>
                <Input id="city" {...register("city")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="province">Province</Label>
                <Input id="province" {...register("province")} />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit">{editing ? "Save" : "Create"}</Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
            {Object.keys(formState.errors).length > 0 && (
              <p className="text-sm text-destructive mt-2">Check highlighted fields.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default PortsAdmin
