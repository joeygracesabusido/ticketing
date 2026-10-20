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
import { AdminTable } from "@/components/admin/AdminTable"
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
  listPortOptions,
  listRoutes,
  routeCodeExists,
  routeReferences,
  type PortOption,
  type RouteRow,
} from "@/lib/adminResources"

const schema = z
  .object({
    code: z.string().trim().min(1, "Code is required.").max(16, "Use at most 16 characters."),
    origin_port_id: z.string().min(1, "Select an origin port."),
    destination_port_id: z.string().min(1, "Select a destination port."),
    distance_km: z
      .string()
      .optional()
      .refine((value) => !value || Number(value) > 0, "Enter a positive distance."),
    estimated_duration_minutes: z
      .string()
      .optional()
      .refine(
        (value) => !value || (Number.isInteger(Number(value)) && Number(value) > 0),
        "Enter positive whole minutes."
      ),
  })
  .refine((values) => values.origin_port_id !== values.destination_port_id, {
    message: "Origin and destination must differ.",
    path: ["destination_port_id"],
  })

type Form = z.infer<typeof schema>
type Notice = { text: string; tone: "success" | "error" | "info" } | null
type DialogState = { mode: "create" } | { mode: "edit"; row: RouteRow } | { mode: "view"; row: RouteRow } | null

export function RoutesAdmin() {
  const { get, update } = useTableQuery()
  const search = get("q")
  const debouncedSearch = useDebouncedValue(search)
  const originId = get("origin")
  const destinationId = get("destination")
  const page = Math.max(0, Math.floor(Number(get("page", "0")) || 0))
  const [rows, setRows] = React.useState<RouteRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [ports, setPorts] = React.useState<PortOption[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<Notice>(null)
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<RouteRow | null>(null)
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
    listRoutes({ search: debouncedSearch, originId, destinationId, page }).then((result) => {
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
  }, [debouncedSearch, originId, destinationId, page, reloadKey, update])

  React.useEffect(() => {
    let cancelled = false
    listPortOptions().then((result) => {
      if (cancelled) return
      if (result.error) setNotice({ text: `Could not load ports: ${result.error}`, tone: "error" })
      else setPorts(result.rows)
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
    reset({ code: "", origin_port_id: "", destination_port_id: "", distance_km: "", estimated_duration_minutes: "" })
    setDialog({ mode: "create" })
  }

  function openEdit(row: RouteRow) {
    setFormError(null)
    setNotice(null)
    reset({
      code: row.code,
      origin_port_id: row.origin_port_id,
      destination_port_id: row.destination_port_id,
      distance_km: row.distance_km == null ? "" : String(row.distance_km),
      estimated_duration_minutes:
        row.estimated_duration_minutes == null ? "" : String(row.estimated_duration_minutes),
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
      const duplicate = await routeCodeExists(code, editing?.id)
      if (duplicate.error) {
        setFormError(duplicate.error)
        return
      }
      if (duplicate.taken) {
        setFormError(`Route code ${code} is already in use.`)
        return
      }
      const payload = {
        code,
        origin_port_id: values.origin_port_id,
        destination_port_id: values.destination_port_id,
        distance_km: values.distance_km ? Number(values.distance_km) : null,
        estimated_duration_minutes: values.estimated_duration_minutes
          ? Number(values.estimated_duration_minutes)
          : null,
      }
      const { error: writeError } = editing
        ? await supabase.from("routes").update(payload).eq("id", editing.id)
        : await supabase.from("routes").insert(payload)
      if (writeError) {
        setFormError(friendlyDbError(writeError.message, "route"))
        return
      }
      setDialog(null)
      setNotice({
        text: editing ? `Route ${code} updated.` : `Route ${code} created.`,
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
      const refs = await routeReferences(row.id)
      if (refs.error) {
        setNotice({ text: refs.error, tone: "error" })
        return
      }
      if (refs.trips > 0) {
        setPendingDelete(null)
        setNotice({
          text: `Route ${row.code} cannot be deleted: ${refs.trips} trip(s) use it.`,
          tone: "error",
        })
        return
      }
      const { error: deleteError } = await supabase.from("routes").delete().eq("id", row.id)
      if (deleteError) {
        setNotice({ text: friendlyDbError(deleteError.message, "route"), tone: "error" })
        return
      }
      setPendingDelete(null)
      setNotice({ text: `Route ${row.code} deleted.`, tone: "success" })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const filtered = Boolean(debouncedSearch) || Boolean(originId) || Boolean(destinationId)

  function portLabel(port: PortOption | null) {
    return port ? `${port.code} — ${port.city}` : "—"
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Routes" description="Manage port-to-port routes and their scheduled duration.">
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add route
        </Button>
      </PageHeader>

      <PageNotice notice={notice} onDismiss={() => setNotice(null)} />

      <Card>
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_200px_200px_auto] lg:items-end">
          <SearchInput
            label="Search routes"
            placeholder="Code, origin or destination"
            value={search}
            onChange={(value) => update({ q: value, page: null })}
          />
          <FormField label="Origin" htmlFor="route-origin-filter">
            <Select
              id="route-origin-filter"
              value={originId}
              onChange={(e) => update({ origin: e.target.value || null, page: null })}
            >
              <option value="">All origins</option>
              {ports.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.code} — {port.city}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Destination" htmlFor="route-destination-filter">
            <Select
              id="route-destination-filter"
              value={destinationId}
              onChange={(e) => update({ destination: e.target.value || null, page: null })}
            >
              <option value="">All destinations</option>
              {ports.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.code} — {port.city}
                </option>
              ))}
            </Select>
          </FormField>
          <Button
            variant="outline"
            disabled={!filtered}
            onClick={() => update({ q: null, origin: null, destination: null, page: null })}
          >
            Reset
          </Button>
        </CardContent>
      </Card>

      <AdminTable
        columns={[
          { key: "code", label: "Code", className: "font-mono" },
          { key: "origin", label: "Origin", render: (row: RouteRow) => portLabel(row.origin) },
          {
            key: "destination",
            label: "Destination",
            render: (row: RouteRow) => portLabel(row.destination),
          },
          {
            key: "distance_km",
            label: "Distance (km)",
            render: (row: RouteRow) => (row.distance_km == null ? "—" : Number(row.distance_km)),
          },
          {
            key: "estimated_duration_minutes",
            label: "Duration (min)",
            render: (row: RouteRow) => row.estimated_duration_minutes ?? "—",
          },
        ]}
        rows={rows}
        loading={loading}
        error={error}
        onRetry={refresh}
        onView={(row) => setDialog({ mode: "view", row })}
        onEdit={openEdit}
        onDelete={setPendingDelete}
        deleteLabel="Delete"
        emptyMessage="No routes yet."
        emptyAction={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add route
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
              <DialogTitle>{editing ? "Edit route" : "Add route"}</DialogTitle>
              <DialogDescription>
                Origin and destination must be different ports. Codes are unique.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 px-6 pb-2 sm:grid-cols-2">
              <FormField label="Code" htmlFor="route-code" required error={errors.code?.message}>
                <Input id="route-code" autoComplete="off" {...register("code")} />
              </FormField>
              <div className="hidden sm:block" />
              <FormField label="Origin port" htmlFor="route-origin" required error={errors.origin_port_id?.message}>
                <Select id="route-origin" {...register("origin_port_id")}>
                  <option value="">Select origin</option>
                  {ports.map((port) => (
                    <option key={port.id} value={port.id}>
                      {port.code} — {port.city}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField
                label="Destination port"
                htmlFor="route-destination"
                required
                error={errors.destination_port_id?.message}
              >
                <Select id="route-destination" {...register("destination_port_id")}>
                  <option value="">Select destination</option>
                  {ports.map((port) => (
                    <option key={port.id} value={port.id}>
                      {port.code} — {port.city}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Distance (km)" htmlFor="route-distance" error={errors.distance_km?.message}>
                <Input id="route-distance" type="number" min="0" step="0.01" {...register("distance_km")} />
              </FormField>
              <FormField
                label="Duration (minutes)"
                htmlFor="route-duration"
                error={errors.estimated_duration_minutes?.message}
              >
                <Input id="route-duration" type="number" min="1" step="1" {...register("estimated_duration_minutes")} />
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
                {editing ? "Save changes" : "Create route"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewing)} onOpenChange={(open) => (open ? undefined : setDialog(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Route {viewing?.code}</DialogTitle>
            <DialogDescription>Read-only route details.</DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            {viewing && (
              <DetailList
                items={[
                  { label: "Code", value: viewing.code },
                  { label: "Origin", value: portLabel(viewing.origin) },
                  { label: "Destination", value: portLabel(viewing.destination) },
                  {
                    label: "Distance",
                    value: viewing.distance_km == null ? null : `${Number(viewing.distance_km)} km`,
                  },
                  {
                    label: "Duration",
                    value:
                      viewing.estimated_duration_minutes == null
                        ? null
                        : `${viewing.estimated_duration_minutes} minutes`,
                  },
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
        title="Delete route?"
        description={
          pendingDelete
            ? `Delete route ${pendingDelete.code}? Trips that use the route block deletion.`
            : ""
        }
        confirmLabel="Delete route"
        onConfirm={confirmDelete}
        busy={busy}
      />
    </div>
  )
}

export default RoutesAdmin
