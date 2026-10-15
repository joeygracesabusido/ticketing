import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export type AdminColumn = {
  key: string
  label: string
  render?: (row: any) => React.ReactNode
}

const STATUS_TINTS: [RegExp, string][] = [
  [/^(active|paid|open|confirmed)$/, "border-emerald-200 bg-emerald-50 text-emerald-700"],
  [/^(maintenance|pending|processing|boarding|not yet open)$/, "border-amber-200 bg-amber-50 text-amber-700"],
  [/^(retired|cancelled|failed|closed|inactive)$/, "border-rose-200 bg-rose-50 text-rose-700"],
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
  title: string
  columns: AdminColumn[]
  rows: any[]
  loading?: boolean
  error?: string | null
  onAdd?: () => void
  onEdit?: (row: any) => void
  onDelete?: (row: any) => void
}) {
  const { title, columns, rows, loading, error, onAdd, onEdit, onDelete } = props
  const showActions = Boolean(onEdit || onDelete)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary via-blue-600 to-violet-600 bg-clip-text text-transparent">{title}</h1>
        {onAdd && <Button onClick={onAdd} className="bg-gradient-to-r from-primary to-blue-600 hover:from-primary/90 hover:to-blue-600/90">Add</Button>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!loading && rows.length === 0 && !error && (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">No rows yet.</p>
          </CardContent>
        </Card>
      )}
      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-primary/5">
                  {columns.map((c) => (
                    <th key={c.key} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">
                      {c.label}
                    </th>
                  ))}
                  {showActions && (
                    <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 transition-colors hover:bg-primary/5">
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-2">
                        {c.render ? c.render(r) : String(r[c.key] ?? "--")}
                      </td>
                    ))}
                    {showActions && (
                      <td className="px-4 py-2 text-right space-x-1">
                        {onEdit && (
                          <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => onEdit(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {onDelete && (
                          <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => onDelete(r)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default AdminTable
