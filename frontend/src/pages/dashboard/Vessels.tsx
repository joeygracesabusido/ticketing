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
  listVessels,
  vesselCodeExists,
  vesselReferences,
  type Vessel,
} from "@/lib/adminResources"

const schema = z.object({
  code: z.string().trim().min(1, "Code is required.").max(16, "Use at most 16 characters."),
  name: z.string().trim().min(1, "Name is required."),
  capacity: z
    .string()
    .optional()
    .refine((value) => !value || (Number.isInteger(Number(value)) && Number(value) > 0), "Enter a positive whole number."),
  status: z.string().optional(),
})

type Form = z.infer<typeof schema>
type Notice = { text: string; tone: "success" | "error" | "info" } | null
type DialogState = { mode: "create" } | { mode: "edit"; row: Vessel } | { mode: "view"; row: Vessel } | null

const STATUSES = ["active", "maintenance", "retired"]

export function VesselsAdmin() {
  const { get, update } = useTableQuery()
  const search = get("q")
  const debouncedSearch = useDebouncedValue(search)
  const status = get("status", "all")
  const page = Math.max(0, Math.floor(Number(get("page", "0")) || 0))
  const [rows, setRows] = React.useState<Vessel[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<Notice>(null)
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<Vessel | null>(null)
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
    listVessels({ search: debouncedSearch, status, page }).then((result) => {
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
    reset({ code: "", name: "", capacity: "", status: "active" })
    setDialog({ mode: "create" })
  }

  function openEdit(row: Vessel) {
    setFormError(null)
    setNotice(null)
    reset({
      code: row.code,
      name: row.name,
      capacity: row.capacity == null ? "" : String(row.capacity),
      status: row.status,
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
      const duplicate = await vesselCodeExists(code, editing?.id)
      if (duplicate.error) {
        setFormError(duplicate.error)
        return
      }
      if (duplicate.taken) {
        setFormError(`Vessel code ${code} is already in use.`)
        return
      }
      const payload = {
        code,
        name: values.name.trim(),
        capacity: values.capacity ? Number(values.capacity) : null,
        status: values.status || "active",
      }
      const { error: writeError } = editing
        ? await supabase.from("vessels").update(payload).eq("id", editing.id)
        : await supabase.from("vessels").insert(payload)
      if (writeError) {
        setFormError(friendlyDbError(writeError.message, "vessel"))
        return
      }
      setDialog(null)
      setNotice({
        text: editing ? `Vessel ${code} updated.` : `Vessel ${code} created.`,
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
      const refs = await vesselReferences(row.id)
      if (refs.error) {
        setNotice({ text: refs.error, tone: "error" })
        return
      }
      if (refs.trips > 0 || refs.bookings > 0) {
        setPendingDelete(null)
        setNotice({
          text: `Vessel ${row.code} cannot be deleted: ${refs.trips} trip(s) and ${refs.bookings} booking(s) depend on it.`,
          tone: "error",
        })
        return
      }
      const { error: deleteError } = await supabase.from("vessels").delete().eq("id", row.id)
      if (deleteError) {
        setNotice({ text: friendlyDbError(deleteError.message, "vessel"), tone: "error" })
        return
      }
      setPendingDelete(null)
      setNotice({ text: `Vessel ${row.code} deleted.`, tone: "success" })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const filtered = Boolean(debouncedSearch) || status !== "all"

  return (
    <div className="space-y-5">
      <PageHeader title="Vessels" description="Manage the fleet and each vessel's operating status.">
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add vessel
        </Button>
      </PageHeader>

      <PageNotice notice={notice} onDismiss={() => setNotice(null)} />

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
          <SearchInput
            label="Search vessels"
            placeholder="Code or name"
            value={search}
            onChange={(value) => update({ q: value, page: null })}
          />
          <FormField label="Status" htmlFor="vessel-status-filter">
            <Select
              id="vessel-status-filter"
              value={status}
              onChange={(e) => update({ status: e.target.value === "all" ? null : e.target.value, page: null })}
            >
              <option value="all">All statuses</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
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
          { key: "capacity", label: "Capacity", render: (row: Vessel) => row.capacity ?? "—" },
          { key: "status", label: "Status", render: (row: Vessel) => <StatusBadge value={row.status} /> },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={refresh}
        onView={(row) => setDialog({ mode: "view", row })}
        onEdit={openEdit}
        onDelete={setPendingDelete}
        deleteLabel="Delete"
        emptyMessage="No vessels yet."
        emptyAction={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add vessel
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
              <DialogTitle>{editing ? "Edit vessel" : "Add vessel"}</DialogTitle>
              <DialogDescription>
                Retired vessels stay in history but should not be scheduled on new trips.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 px-6 pb-2 sm:grid-cols-2">
              <FormField label="Code" htmlFor="vessel-code" required error={errors.code?.message}>
                <Input id="vessel-code" autoComplete="off" {...register("code")} />
              </FormField>
              <FormField label="Name" htmlFor="vessel-name" required error={errors.name?.message}>
                <Input id="vessel-name" {...register("name")} />
              </FormField>
              <FormField label="Capacity" htmlFor="vessel-capacity" error={errors.capacity?.message} hint="Optional passenger capacity">
                <Input id="vessel-capacity" type="number" min="1" step="1" {...register("capacity")} />
              </FormField>
              <FormField label="Status" htmlFor="vessel-status">
                <Select id="vessel-status" {...register("status")}>
                  {STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </option>
                  ))}
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
                {editing ? "Save changes" : "Create vessel"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewing)} onOpenChange={(open) => (open ? undefined : setDialog(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vessel {viewing?.code}</DialogTitle>
            <DialogDescription>Read-only vessel details.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            {viewing && (
              <DetailList
                items={[
                  { label: "Code", value: viewing.code },
                  { label: "Name", value: viewing.name },
                  { label: "Capacity", value: viewing.capacity },
                  { label: "Status", value: <StatusBadge value={viewing.status} /> },
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
        title="Delete vessel?"
        description={
          pendingDelete
            ? `Delete ${pendingDelete.code} — ${pendingDelete.name}? Its accommodation categories are removed too. Trips or bookings that depend on this vessel block deletion.`
            : ""
        }
        confirmLabel="Delete vessel"
        onConfirm={confirmDelete}
        busy={busy}
      />
    </div>
  )
}

export default VesselsAdmin
