import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Loader2, Plus, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AdminTable, StatusBadge } from "@/components/admin/AdminTable"
import { ConfirmDialog } from "@/components/admin/ConfirmDialog"
import { DetailList, FormField } from "@/components/admin/FormField"
import { PageHeader, PageNotice } from "@/components/admin/PageHeader"
import { SearchInput } from "@/components/admin/SearchInput"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useTableQuery } from "@/hooks/useTableQuery"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import {
  PAGE_SIZE,
  clampPage,
  friendlyDbError,
  listPorts,
  portCodeExists,
  portReferences,
  type Port,
  type PortStatus,
} from "@/lib/adminResources"

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Use at least 2 characters.")
    .max(8, "Use at most 8 characters.")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and hyphens only."),
  name: z.string().trim().min(1, "Name is required."),
  city: z.string().trim().min(1, "City is required."),
  province: z.string().optional(),
  country: z.string().trim().min(1, "Country is required."),
  active: z.string().optional(),
})

type Form = z.infer<typeof schema>

type Notice = { text: string; tone: "success" | "error" | "info" } | null
type DialogState = { mode: "create" } | { mode: "edit"; row: Port } | { mode: "view"; row: Port } | null

export function PortsAdmin() {
  const { get, update } = useTableQuery()
  const search = get("q")
  const debouncedSearch = useDebouncedValue(search)
  const statusParam = get("status", "all")
  const status: PortStatus = statusParam === "active" || statusParam === "inactive" ? statusParam : "all"
  const page = Math.max(0, Math.floor(Number(get("page", "0")) || 0))
  const [rows, setRows] = React.useState<Port[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<Notice>(null)
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<Port | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Form>({ resolver: zodResolver(schema) })

  const editing = dialog?.mode === "edit" ? dialog.row : null
  const viewing = dialog?.mode === "view" ? dialog.row : null
  const formOpen = dialog?.mode === "create" || dialog?.mode === "edit"

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listPorts({ search: debouncedSearch, status, page }).then((result) => {
      if (cancelled) return
      setRows(result.rows)
      setTotal(result.total)
      setError(result.error)
      setLoading(false)
      const clamped = clampPage(page, result.total)
      if (clamped !== page) update({ page: clamped === 0 ? null : clamped })
    })
    return () => {
      cancelled = true
    }
  }, [debouncedSearch, status, page, reloadKey, update])

  function refresh() {
    setReloadKey((key) => key + 1)
  }

  function openCreate() {
    setFormError(null)
    setNotice(null)
    reset({ code: "", name: "", city: "", province: "", country: "Philippines", active: "true" })
    setDialog({ mode: "create" })
  }

  function openEdit(row: Port) {
    setFormError(null)
    setNotice(null)
    reset({
      code: row.code,
      name: row.name,
      city: row.city,
      province: row.province ?? "",
      country: row.country,
      active: String(row.active),
    })
    setDialog({ mode: "edit", row })
  }

  function closeDialog() {
    if (busy) return
    setDialog(null)
    setFormError(null)
  }

  async function onSubmit(values: Form) {
    if (!supabase) {
      setFormError(missingSupabaseEnvMessage)
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const code = values.code.trim().toUpperCase()
      const duplicate = await portCodeExists(code, editing?.id)
      if (duplicate.error) {
        setFormError(duplicate.error)
        return
      }
      if (duplicate.taken) {
        setFormError(`Port code ${code} is already in use.`)
        return
      }
      const payload = {
        code,
        name: values.name.trim(),
        city: values.city.trim(),
        province: values.province?.trim() || null,
        country: values.country.trim() || "Philippines",
        active: values.active !== "false",
      }
      const { error: writeError } = editing
        ? await supabase.from("ports").update(payload).eq("id", editing.id)
        : await supabase.from("ports").insert(payload)
      if (writeError) {
        setFormError(friendlyDbError(writeError.message, "port"))
        return
      }
      setDialog(null)
      setNotice({
        text: editing ? `Port ${code} updated.` : `Port ${code} created.`,
        tone: "success",
      })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    const row = pendingDelete
    if (!row || !supabase) return
    setBusy(true)
    try {
      const refs = await portReferences(row.id)
      if (refs.error) {
        setNotice({ text: refs.error, tone: "error" })
        return
      }
      if (refs.routes > 0 || refs.trips > 0) {
        setPendingDelete(null)
        setNotice({
          text: `Port ${row.code} cannot be deleted: ${refs.routes} route(s) and ${refs.trips} trip(s) reference it.`,
          tone: "error",
        })
        return
      }
      const { error: deleteError } = await supabase.from("ports").delete().eq("id", row.id)
      if (deleteError) {
        setNotice({ text: friendlyDbError(deleteError.message, "port"), tone: "error" })
        return
      }
      setPendingDelete(null)
      setNotice({ text: `Port ${row.code} deleted.`, tone: "success" })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const filtered = Boolean(debouncedSearch) || status !== "all"

  return (
    <div className="space-y-5">
      <PageHeader title="Ports" description="Manage the ports used by routes and trips.">
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add port
        </Button>
      </PageHeader>

      <PageNotice notice={notice} onDismiss={() => setNotice(null)} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
          <SearchInput
            label="Search ports"
            placeholder="Code, name, city or country"
            value={search}
            onChange={(value) => update({ q: value, page: null })}
          />
          <FormField label="Status" htmlFor="port-status-filter">
            <Select
              id="port-status-filter"
              value={status}
              onChange={(e) => {
                const next = e.target.value as PortStatus
                update({ status: next === "all" ? null : next, page: null })
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </FormField>
          <Button
            variant="outline"
            disabled={!filtered}
            onClick={() => update({ q: null, status: null, page: null })}
          >
            Reset
          </Button>
        </CardContent>
      </Card>

      <AdminTable
        columns={[
          { key: "code", label: "Code", className: "font-mono" },
          { key: "name", label: "Name" },
          { key: "city", label: "City" },
          { key: "province", label: "Province", render: (row: Port) => row.province || "—" },
          { key: "country", label: "Country" },
          { key: "active", label: "Status", render: (row: Port) => <StatusBadge value={row.active} /> },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={refresh}
        onView={(row) => setDialog({ mode: "view", row })}
        onEdit={openEdit}
        onDelete={setPendingDelete}
        deleteLabel="Delete"
        emptyMessage="No ports yet."
        emptyAction={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add port
          </Button>
        }
        filtered={filtered}
        page={page}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        total={total}
        onPageChange={(next) => update({ page: next === 0 ? null : next })}
      />

      <Dialog open={formOpen} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit port" : "Add port"}</DialogTitle>
              <DialogDescription>
                Codes are unique and stored in uppercase. Inactive ports stay in history.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 px-6 pb-2 sm:grid-cols-2">
              <FormField label="Code" htmlFor="port-code" required error={errors.code?.message} hint="2–8 characters">
                <Input id="port-code" autoComplete="off" {...register("code")} />
              </FormField>
              <FormField label="Name" htmlFor="port-name" required error={errors.name?.message}>
                <Input id="port-name" {...register("name")} />
              </FormField>
              <FormField label="City" htmlFor="port-city" required error={errors.city?.message}>
                <Input id="port-city" {...register("city")} />
              </FormField>
              <FormField label="Province" htmlFor="port-province" error={errors.province?.message}>
                <Input id="port-province" {...register("province")} />
              </FormField>
              <FormField label="Country" htmlFor="port-country" required error={errors.country?.message}>
                <Input id="port-country" {...register("country")} />
              </FormField>
              <FormField label="Status" htmlFor="port-active">
                <Select id="port-active" {...register("active")}>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </Select>
              </FormField>
            </div>
            {formError && (
              <p role="alert" className="px-6 pt-2 text-sm text-destructive">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {editing ? "Save changes" : "Create port"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewing)} onOpenChange={(open) => (open ? undefined : setDialog(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Port {viewing?.code}</DialogTitle>
            <DialogDescription>Read-only port details.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            {viewing && (
              <DetailList
                items={[
                  { label: "Code", value: viewing.code },
                  { label: "Name", value: viewing.name },
                  { label: "City", value: viewing.city },
                  { label: "Province", value: viewing.province },
                  { label: "Country", value: viewing.country },
                  { label: "Status", value: <StatusBadge value={viewing.active} /> },
                ]}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => (open ? undefined : setPendingDelete(null))}
        title="Delete port?"
        description={
          pendingDelete
            ? `Delete ${pendingDelete.code} — ${pendingDelete.name}? This is blocked while routes or trips reference the port.`
            : ""
        }
        confirmLabel="Delete port"
        onConfirm={confirmDelete}
        busy={busy}
      />
    </div>
  )
}

export default PortsAdmin
