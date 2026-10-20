import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Loader2, Plus, Power, RotateCw } from "lucide-react"
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
import { formatPeso } from "@/lib/fare"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import {
  PAGE_SIZE,
  accommodationCodeExists,
  clampPage,
  friendlyDbError,
  listAccommodations,
  listVesselOptions,
  type Accommodation,
  type AccommodationStatus,
  type VesselOption,
} from "@/lib/adminResources"

const schema = z.object({
  vessel_id: z.string().min(1, "Select a vessel."),
  code: z.string().trim().min(1, "Code is required.").max(32, "Use at most 32 characters."),
  name: z.string().trim().min(1, "Name is required."),
  capacity: z
    .string()
    .min(1, "Capacity is required.")
    .refine(
      (value) => Number.isInteger(Number(value)) && Number(value) >= 0,
      "Enter a whole number of 0 or more."
    ),
  fare_amount: z
    .string()
    .min(1, "Fare is required.")
    .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, "Enter 0 or more."),
  is_active: z.string().optional(),
})

type Form = z.infer<typeof schema>
type Notice = { text: string; tone: "success" | "error" | "info" } | null
type DialogState =
  | { mode: "create" }
  | { mode: "edit"; row: Accommodation }
  | { mode: "view"; row: Accommodation }
  | null

export function AccommodationsAdmin() {
  const { get, update } = useTableQuery()
  const search = get("q")
  const debouncedSearch = useDebouncedValue(search)
  const vesselId = get("vessel")
  const statusParam = get("status", "all")
  const status: AccommodationStatus =
    statusParam === "active" || statusParam === "inactive" ? statusParam : "all"
  const page = Math.max(0, Math.floor(Number(get("page", "0")) || 0))
  const [rows, setRows] = React.useState<Accommodation[]>([])
  const [total, setTotal] = React.useState(0)
  const [vessels, setVessels] = React.useState<VesselOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<Notice>(null)
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [pendingDeactivate, setPendingDeactivate] = React.useState<Accommodation | null>(null)
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
    listAccommodations({ search: debouncedSearch, vesselId, status, page }).then((result) => {
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
  }, [debouncedSearch, vesselId, status, page, reloadKey, update])

  React.useEffect(() => {
    let cancelled = false
    listVesselOptions().then((result) => {
      if (cancelled) return
      if (result.error) setNotice({ text: `Could not load vessels: ${result.error}`, tone: "error" })
      else setVessels(result.rows)
    })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  function refresh() {
    setReloadKey((key) => key + 1)
  }

  function openCreate() {
    setFormError(null)
    setNotice(null)
    reset({
      vessel_id: "",
      code: "",
      name: "",
      capacity: "50",
      fare_amount: "1200",
      is_active: "true",
    })
    setDialog({ mode: "create" })
  }

  function openEdit(row: Accommodation) {
    setFormError(null)
    setNotice(null)
    reset({
      vessel_id: row.vessel_id,
      code: row.code,
      name: row.name,
      capacity: String(row.capacity),
      fare_amount: String(row.fare_amount),
      is_active: String(row.is_active),
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
      const duplicate = await accommodationCodeExists(values.vessel_id, code, editing?.id)
      if (duplicate.error) {
        setFormError(duplicate.error)
        return
      }
      if (duplicate.taken) {
        setFormError(`Accommodation code ${code} already exists on this vessel.`)
        return
      }
      const payload = {
        vessel_id: values.vessel_id,
        code,
        name: values.name.trim(),
        capacity: Number(values.capacity),
        fare_amount: Number(values.fare_amount),
        is_active: values.is_active !== "false",
      }
      const { error: writeError } = editing
        ? await supabase.from("vessel_accommodations").update(payload).eq("id", editing.id)
        : await supabase.from("vessel_accommodations").insert(payload)
      if (writeError) {
        setFormError(friendlyDbError(writeError.message, "accommodation"))
        return
      }

      let inventoryWarning: string | null = null
      if (!editing) {
        // The DB trigger also backfills; this keeps older environments in sync.
        const { data: trips } = await supabase
          .from("trips")
          .select("id")
          .eq("vessel_id", values.vessel_id)
        const { data: accommodation } = await supabase
          .from("vessel_accommodations")
          .select("id,capacity,fare_amount")
          .eq("vessel_id", values.vessel_id)
          .eq("code", code)
          .single()
        if (trips && trips.length > 0 && accommodation) {
          const { error: inventoryError } = await supabase
            .from("trip_accommodation_inventory")
            .upsert(
              trips.map((trip: { id: string }) => ({
                trip_id: trip.id,
                accommodation_id: accommodation.id,
                capacity: payload.capacity,
                fare_amount: payload.fare_amount,
              })),
              { onConflict: "trip_id,accommodation_id", ignoreDuplicates: true }
            )
          if (inventoryError) {
            inventoryWarning = `Category saved, but trip inventory sync failed: ${inventoryError.message}`
          }
        }
      }

      setDialog(null)
      setNotice({
        text:
          inventoryWarning ??
          (editing ? `Accommodation ${code} updated.` : `Accommodation ${code} created.`),
        tone: inventoryWarning ? "error" : "success",
      })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  async function confirmDeactivate() {
    const row = pendingDeactivate
    if (!row || !supabase) return
    setBusy(true)
    try {
      const { error: updateError } = await supabase
        .from("vessel_accommodations")
        .update({ is_active: false })
        .eq("id", row.id)
      if (updateError) {
        setNotice({ text: friendlyDbError(updateError.message, "accommodation"), tone: "error" })
        return
      }
      setPendingDeactivate(null)
      setNotice({ text: `Accommodation ${row.code} deactivated.`, tone: "success" })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const filtered = Boolean(debouncedSearch) || Boolean(vesselId) || status !== "all"

  function vesselLabel(row: Accommodation) {
    return row.vessels ? `${row.vessels.code} — ${row.vessels.name}` : "—"
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accommodations"
        description="Fare classes per vessel. Disable a class instead of deleting it so bookings stay auditable."
      >
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add accommodation
        </Button>
      </PageHeader>

      <PageNotice notice={notice} onDismiss={() => setNotice(null)} />

      <Card>
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_200px_170px_auto] lg:items-end">
          <SearchInput
            label="Search accommodations"
            placeholder="Code, name or vessel"
            value={search}
            onChange={(value) => update({ q: value, page: null })}
          />
          <FormField label="Vessel" htmlFor="accommodation-vessel-filter">
            <Select
              id="accommodation-vessel-filter"
              value={vesselId}
              onChange={(e) => update({ vessel: e.target.value || null, page: null })}
            >
              <option value="">All vessels</option>
              {vessels.map((vessel) => (
                <option key={vessel.id} value={vessel.id}>
                  {vessel.code} — {vessel.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Status" htmlFor="accommodation-status-filter">
            <Select
              id="accommodation-status-filter"
              value={status}
              onChange={(e) => {
                const next = e.target.value as AccommodationStatus
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
            onClick={() => update({ q: null, vessel: null, status: null, page: null })}
          >
            Reset
          </Button>
        </CardContent>
      </Card>

      <AdminTable
        columns={[
          { key: "vessel", label: "Vessel", render: (row: Accommodation) => vesselLabel(row) },
          { key: "code", label: "Code", className: "font-mono" },
          { key: "name", label: "Name" },
          { key: "capacity", label: "Capacity" },
          {
            key: "fare_amount",
            label: "Fare (VAT-incl)",
            render: (row: Accommodation) => `₱${formatPeso(row.fare_amount)}`,
          },
          {
            key: "is_active",
            label: "Status",
            render: (row: Accommodation) => <StatusBadge value={row.is_active} />,
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={refresh}
        onView={(row) => setDialog({ mode: "view", row })}
        onEdit={openEdit}
        onDelete={setPendingDeactivate}
        canDelete={(row: Accommodation) => row.is_active}
        deleteLabel="Deactivate"
        deleteIcon={Power}
        emptyMessage="No accommodations yet."
        emptyAction={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add accommodation
          </Button>
        }
        filtered={filtered}
        page={page}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        total={total}
        onPageChange={(next) => update({ page: next === 0 ? null : next })}
      />

      <p className="text-xs text-muted-foreground">
        Per-voyage capacity lives in trip_accommodation_inventory; holds and releases are atomic in SQL.
      </p>

      <Dialog open={formOpen} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit accommodation" : "Add accommodation"}</DialogTitle>
              <DialogDescription>
                Codes are unique per vessel. New classes are backfilled to that vessel&apos;s existing trips.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 px-6 pb-2 sm:grid-cols-2">
              <FormField label="Vessel" htmlFor="accommodation-vessel" required error={errors.vessel_id?.message}>
                <Select id="accommodation-vessel" {...register("vessel_id")}>
                  <option value="">Select vessel</option>
                  {vessels.map((vessel) => (
                    <option key={vessel.id} value={vessel.id}>
                      {vessel.code} — {vessel.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Code" htmlFor="accommodation-code" required error={errors.code?.message}>
                <Input id="accommodation-code" autoComplete="off" placeholder="TOURIST" {...register("code")} />
              </FormField>
              <FormField label="Name" htmlFor="accommodation-name" required error={errors.name?.message}>
                <Input id="accommodation-name" placeholder="Tourist Class" {...register("name")} />
              </FormField>
              <FormField label="Capacity" htmlFor="accommodation-capacity" required error={errors.capacity?.message}>
                <Input id="accommodation-capacity" type="number" min="0" step="1" {...register("capacity")} />
              </FormField>
              <FormField
                label="Fare per pax (VAT-incl ₱)"
                htmlFor="accommodation-fare"
                required
                error={errors.fare_amount?.message}
              >
                <Input id="accommodation-fare" type="number" min="0" step="0.01" {...register("fare_amount")} />
              </FormField>
              <FormField label="Status" htmlFor="accommodation-active">
                <Select id="accommodation-active" {...register("is_active")}>
                  <option value="true">Active</option>
                  <option value="false">Inactive (maintenance)</option>
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
                {editing ? "Save changes" : "Create accommodation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewing)} onOpenChange={(open) => (open ? undefined : setDialog(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Accommodation {viewing?.code}
              {viewing?.vessels ? ` · ${viewing.vessels.code}` : ""}
            </DialogTitle>
            <DialogDescription>Read-only accommodation details.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            {viewing && (
              <DetailList
                items={[
                  { label: "Vessel", value: vesselLabel(viewing) },
                  { label: "Code", value: viewing.code },
                  { label: "Name", value: viewing.name },
                  { label: "Capacity", value: viewing.capacity },
                  { label: "Fare (VAT-incl)", value: `₱${formatPeso(viewing.fare_amount)}` },
                  { label: "Status", value: <StatusBadge value={viewing.is_active} /> },
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
        open={Boolean(pendingDeactivate)}
        onOpenChange={(open) => (open ? undefined : setPendingDeactivate(null))}
        title="Deactivate accommodation?"
        description={
          pendingDeactivate
            ? `Disable ${pendingDeactivate.code} — ${pendingDeactivate.name}? It stays in the database so existing bookings remain auditable. You can re-enable it with Edit.`
            : ""
        }
        confirmLabel="Deactivate"
        onConfirm={confirmDeactivate}
        busy={busy}
      />
    </div>
  )
}

export default AccommodationsAdmin
