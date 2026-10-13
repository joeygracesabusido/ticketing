import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export type AdminColumn = {
  key: string
  label: string
  render?: (row: any) => React.ReactNode
}

export function AdminTable(props: {
  title: string
  columns: AdminColumn[]
  rows: any[]
  loading?: boolean
  error?: string | null
  onAdd: () => void
  onEdit: (row: any) => void
  onDelete: (row: any) => void
}) {
  const { title, columns, rows, loading, error, onAdd, onEdit, onDelete } = props
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{title}</h1>
        <Button onClick={onAdd}>Add</Button>
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
                <tr className="border-b">
                  {columns.map((c) => (
                    <th key={c.key} className="text-left px-4 py-2 font-medium text-muted-foreground">
                      {c.label}
                    </th>
                  ))}
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-2">
                        {c.render ? c.render(r) : String(r[c.key] ?? "--")}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right space-x-2">
                      <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onDelete(r)}>
                        Delete
                      </Button>
                    </td>
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
