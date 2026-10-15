import * as React from "react"
import { supabase, missingSupabaseEnvMessage } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/admin/AdminTable"
import { useAuth } from "@/hooks/useAuth"
import { canManageUsers, ROLE_OPTIONS } from "@/lib/roles"

const PAGE_SIZE = 10

function esc(v: string) {
  return v.replace(/[%(),]/g, " ").trim()
}

export function UsersAdmin() {
  const { session, role, loading: authLoading } = useAuth()
  const [users, setUsers] = React.useState<any[]>([])
  const [total, setTotal] = React.useState(0)
  const [query, setQuery] = React.useState("")
  const [roleFilter, setRoleFilter] = React.useState("all")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [page, setPage] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [newRole, setNewRole] = React.useState<string>("client")
  const [audit, setAudit] = React.useState<any[]>([])
  const [auditLoading, setAuditLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const selected = users.find((u) => u.id === selectedId) ?? null

  // Pre-migration rows have NULL email/names in profiles (backfill pending).
  // For your own row, fall back to the authoritative Auth session values.
  const dispEmail = (u: any) => u.email ?? (u.id === session?.user?.id ? (session?.user?.email ?? null) : null) ?? "—"
  const dispName = (u: any) => {
    const n = [u.first_name, u.last_name].filter(Boolean).join(" ")
    if (n) return n
    if (u.id === session?.user?.id) {
      const m = session?.user?.user_metadata as any
      const mn = [m?.first_name, m?.last_name].filter(Boolean).join(" ")
      if (mn) return mn
    }
    return "—"
  }

  async function load(p = page, q = query, rf = roleFilter, sf = statusFilter) {
    setLoading(true)
    setError(null)
    if (!supabase) {
      setError(missingSupabaseEnvMessage)
      setLoading(false)
      return
    }
    let b = supabase.from("profiles").select("*", { count: "exact" }).order("created_at", { ascending: false })
    if (rf !== "all") b = b.eq("role", rf)
    if (sf === "active") b = b.eq("is_active", true)
    if (sf === "inactive") b = b.eq("is_active", false)
    const needle = esc(q)
    if (needle) b = b.or(`email.ilike.%${needle}%,first_name.ilike.%${needle}%,last_name.ilike.%${needle}%`)
    const from = p * PAGE_SIZE
    const { data, error, count } = await b.range(from, from + PAGE_SIZE - 1)
    if (error) {
      setError(error.message)
    } else {
      let list = data ?? []
      let tot = count ?? 0
      // Pre-migration rows have NULL email/names so server ilike can't match
      // them. Union your own row (readable via "read own profile") when the
      // session email matches the query.
      if (needle && session?.user && !list.some((r) => r.id === session.user.id)) {
        const { data: own } = await supabase.from("profiles").select("*").eq("id", session.user.id).single()
        if (own) {
          const hay = [own.email ?? session.user.email ?? "", own.first_name ?? "", own.last_name ?? ""]
            .join(" ")
            .toLowerCase()
          if (hay.includes(needle.toLowerCase())) {
            list = [own, ...list]
            tot += 1
          }
        }
      }
      setUsers(list)
      setTotal(tot)
    }
    setLoading(false)
  }

  React.useEffect(() => {
    if (!authLoading && canManageUsers(role)) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, role])

  function refresh() {
    load()
    if (selectedId) loadAudit(selectedId)
  }

  async function loadAudit(id: string) {
    if (!supabase) return
    setAuditLoading(true)
    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("entity", "profiles")
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(20)
    setAudit(data ?? [])
    setAuditLoading(false)
  }

  function pick(u: any) {
    setSelectedId(u.id)
    setNewRole(u.role)
    setNotice(null)
    loadAudit(u.id)
  }

  async function saveRole() {
    if (!supabase || !selected) return
    if (newRole === selected.role) {
      setNotice("No change — pick a different role first.")
      return
    }
    if (!window.confirm(`Change ${dispEmail(selected)} role from ${selected.role} to ${newRole}?`)) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await supabase.rpc("set_user_role", { p_target: selected.id, p_role: newRole })
    setBusy(false)
    if (error) setError(error.message)
    else {
      setNotice(`Role updated: ${selected.role} → ${newRole}.`)
      refresh()
    }
  }

  async function toggleActive() {
    if (!supabase || !selected) return
    const next = !selected.is_active
    if (!window.confirm(`${next ? "Activate" : "Deactivate"} ${dispEmail(selected)}?${next ? "" : " They will lose dashboard access."}`)) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await supabase.rpc("set_user_active", { p_target: selected.id, p_active: next })
    setBusy(false)
    if (error) setError(error.message)
    else {
      setNotice(next ? "Account activated." : "Account deactivated.")
      refresh()
    }
  }

  if (authLoading) return <p className="text-sm text-muted-foreground">Loading...</p>
  if (!canManageUsers(role))
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Users unavailable</CardTitle>
          <CardDescription>
            Signed in as {session?.user?.email ?? "unknown"} · role: {role ?? "none"}. Only <code>admin</code> can manage users.
          </CardDescription>
        </CardHeader>
      </Card>
    )

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary via-blue-600 to-violet-600 bg-clip-text text-transparent">
          Users
        </h1>
        <Button variant="outline" onClick={() => load()}>
          Refresh
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-green-700 dark:text-green-400">{notice}</p>}

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="q">Search name or email</Label>
            <Input
              id="q"
              placeholder="e.g. juan@example.com"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") load(0)
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rf">Role</Label>
            <Select
              id="rf"
              value={roleFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                setRoleFilter(e.target.value)
                setPage(0)
              }}
            >
              <option value="all">All roles</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf">Status</Label>
            <Select
              id="sf"
              value={statusFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                setStatusFilter(e.target.value)
                setPage(0)
              }}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>
          <div className="md:col-span-4 flex gap-2">
            <Button onClick={() => load(0)}>Search</Button>
            <Button
              variant="outline"
              onClick={() => {
                setQuery("")
                setRoleFilter("all")
                setStatusFilter("all")
                setPage(0)
                load(0, "", "all", "all")
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : users.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground space-y-1">
              <p>No users found.</p>
              <p className="text-xs">Tip: accounts created before the RBAC migration may lack stored email — run the backfill in docs/ADMIN_USER_MANAGEMENT.md.</p>
            </div>
          ) : (
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b bg-primary/5">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Email</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Role</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Status</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0 transition-colors hover:bg-primary/5">
                    <td className="px-4 py-2 font-mono text-xs">{dispEmail(u)}</td>
                    <td className="px-4 py-2">{dispName(u)}</td>
                    <td className="px-4 py-2">
                      <Badge>{u.role}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge value={u.is_active} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => pick(u)}>
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {users.length === 0 ? 0 : page * PAGE_SIZE + 1}–{page * PAGE_SIZE + users.length} of {total}
        </span>
        <span className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => { const n = page - 1; setPage(n); load(n) }}>
            Prev
          </Button>
          <span className="px-1 py-1">
            Page {page + 1} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages || loading}
            onClick={() => { const n = page + 1; setPage(n); load(n) }}
          >
            Next
          </Button>
        </span>
      </div>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">User details</CardTitle>
            <CardDescription className="font-mono text-xs break-all">{selected.id}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <p><span className="text-muted-foreground">Email:</span> {selected ? dispEmail(selected) : "—"}</p>
              <p><span className="text-muted-foreground">Name:</span> {selected ? dispName(selected) : "—"}</p>
              <p><span className="text-muted-foreground">Role:</span> <Badge>{selected.role}</Badge></p>
              <p><span className="text-muted-foreground">Status:</span> {selected.is_active ? "active" : "inactive"}</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="nr">Replacement role</Label>
                <Select id="nr" value={newRole} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewRole(e.target.value)}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </div>
              <Button size="sm" disabled={busy || newRole === selected.role} onClick={saveRole}>
                {busy ? "Saving..." : `Save: ${selected.role} → ${newRole}`}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={toggleActive}>
                {selected.is_active ? "Deactivate" : "Activate"}
              </Button>
            </div>
            <div>
              <p className="font-medium mb-1">Audit (actor · old → new · time)</p>
              {auditLoading ? (
                <p className="text-muted-foreground">Loading audit...</p>
              ) : audit.length === 0 ? (
                <p className="text-muted-foreground">No audit records yet.</p>
              ) : (
                <ul className="space-y-1">
                  {audit.map((a) => (
                    <li key={a.id} className="font-mono text-xs break-all">
                      {String(a.actor ?? "system").slice(0, 8)} · {a.action} ·{" "}
                      {a.meta?.old_role ? `${a.meta.old_role} → ${a.meta.new_role ?? a.meta.is_active}` : JSON.stringify(a.meta)} ·{" "}
                      {new Date(a.created_at).toLocaleString()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default UsersAdmin
