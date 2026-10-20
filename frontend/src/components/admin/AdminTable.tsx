import * as React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Eye, Pencil, RotateCw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type AdminColumn = {
  key: string
  label: string
  className?: string
  render?: (row: any) => React.ReactNode
}

const STATUS_TINTS: [RegExp, string][] = [
  [
    /^(active|paid|open|confirmed)$/,
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  ],
  [
    /^(maintenance|pending|processing|boarding|not yet open)$/,
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  ],
  [
    /^(retired|cancelled|failed|closed|inactive)$/,
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
  ],
]

export function StatusBadge({ value }: { value: string | boolean | null | undefined }) {
  const raw = String(value ?? "").trim()
  if (!raw) return <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">--</Badge>
  const norm = raw.toLowerCase()
  const key = norm === "true" ? "active" : norm === "false" ? "inactive" : norm
  const label = key.charAt(0).toUpperCase() + key.slice(1)
  const tint = STATUS_TINTS.find(([re]) => re.test(key))?.[1] ?? "border-primary/20 bg-primary/5 text-primary"
  return <Badge variant="outline" className={tint}>{label}</Badge>
}

export function AdminTable(props: {
  title?: string
  description?: string
  columns: AdminColumn[]
  rows: any[]
  loading?: boolean
  error?: string | null
  onAdd?: () => void
  addLabel?: string
  onView?: (row: any) => void
  onEdit?: (row: any) => void
  onDelete?: (row: any) => void
  canDelete?: (row: any) => boolean
  deleteLabel?: string
  deleteIcon?: React.ComponentType<{ className?: string }>
  onRetry?: () => void
  emptyMessage?: string
  emptyAction?: React.ReactNode
  filtered?: boolean
  page?: number
  pageCount?: number
  total?: number
  pageSize?: number
  onPageChange?: (page: number) => void
}) {
  const {
    title,
    description,
    columns,
    rows,
    loading,
    error,
    onAdd,
    addLabel = "Add",
    onView,
    onEdit,
    onDelete,
    canDelete,
    deleteLabel = "Delete",
    deleteIcon: DeleteIcon = Trash2,
    onRetry,
    emptyMessage = "No rows yet.",
    emptyAction,
    filtered,
    page = 0,
    pageCount,
    total,
    pageSize = 10,
    onPageChange,
  } = props

  const showActions = Boolean(onView || onEdit || onDelete)
  const showPagination = onPageChange != null && total != null && pageCount != null
  const first = total ? page * pageSize + 1 : 0
  const last = total ? Math.min((page + 1) * pageSize, total) : 0

  return (
    <div className="space-y-4" aria-busy={loading || undefined}>
      {title && (
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-primary via-blue-600 to-violet-600 bg-clip-text text-transparent">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {onAdd && <Button onClick={onAdd}>{addLabel}</Button>}
        </div>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <span>{error}</span>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          )}
        </div>
      )}
      {loading && rows.length === 0 && !error && (
        <Card>
          <CardContent className="p-0">
            <span className="sr-only">Loading...</span>
            <div className="space-y-3 p-4" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  {columns.map((c) => (
                    <Skeleton key={c.key} className="h-4 flex-1" />
                  ))}
                  {showActions && <Skeleton className="h-8 w-16" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {!loading && rows.length === 0 && !error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {filtered ? "No rows match these filters. Adjust or clear the filters above." : emptyMessage}
            </p>
            {emptyAction}
          </CardContent>
        </Card>
      )}
      {rows.length > 0 && (
        <Card className={loading ? "opacity-60 transition-opacity" : undefined}>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {columns.map((c) => (
                    <TableHead key={c.key} className={c.className}>
                      {c.label}
                    </TableHead>
                  ))}
                  {showActions && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className={c.className}>
                        {c.render ? c.render(r) : String(r[c.key] ?? "--")}
                      </TableCell>
                    ))}
                    {showActions && (
                      <TableCell className="space-x-1 text-right">
                        {onView && (
                          <Button variant="ghost" size="icon" aria-label="View" onClick={() => onView(r)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        {onEdit && (
                          <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => onEdit(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {onDelete && (!canDelete || canDelete(r)) && (
                          <Button variant="ghost" size="icon" aria-label={deleteLabel} onClick={() => onDelete(r)}>
                            <DeleteIcon className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {showPagination && rows.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {first}–{last} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 0 || loading}
              onClick={() => onPageChange(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= pageCount || loading}
              onClick={() => onPageChange(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminTable
