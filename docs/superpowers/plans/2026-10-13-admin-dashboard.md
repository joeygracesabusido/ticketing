# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin-only `/dashboard` with sidebar for CRUD on ports, vessels, routes, trips, gated by a Supabase `profiles.role`.

**Architecture:** No backend. Direct Supabase PostgREST queries from Vite + React pages. Auth via existing `src/lib/supabase.ts`; new `useAuth` hook + `RequireAdmin` guard; RLS enforces admin-write in Postgres.

**Tech Stack:** React 18, react-router-dom v6 (`createBrowserRouter`), @supabase/supabase-js v2, react-hook-form + zod + @hookform/resolvers, Tailwind + existing shadcn-style primitives (`Card`, `Button`, `Input`, `Label`, `Select`, `Badge`), vitest.

## Global Constraints

- Node 20+.
- Reuse existing UI primitives in `frontend/src/components/ui/` — no new component libraries.
- Reuse form pattern from `frontend/src/pages/Login.tsx` (react-hook-form + zodResolver).
- Supabase reads use `frontend/src/lib/supabase.ts`; handle `supabase === null` with missing-env message.
- Do NOT commit `supabase.sql` (owner runs it in Supabase dashboard manually).
- Every task commits its own files, except Task 1 (uncommitted SQL by owner request).

---

### Task 1: Roles SQL (profiles + admin-write RLS)

**Files:**
- Modify: `supabase.sql` (append at end, repo root)
- Test: none (verified by content grep + owner runs in Supabase SQL Editor)

**Interfaces:**
- Consumes: existing tables `ports`, `vessels`, `routes`, `trips`.
- Produces: `public.profiles` table, `public.is_admin()` function, trigger `on_auth_user_created`, RLS write policies that Tasks 6–9 rely on.

- [ ] **Step 1: Append the roles SQL block to `supabase.sql`**

```sql
-- ---------- roles: admin / manager ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'manager' check (role in ('admin', 'manager'))
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "admin write profiles" on public.profiles;
create policy "admin write profiles" on public.profiles
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public as
  $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as
  $$ begin insert into public.profiles (id) values (new.id) on conflict (id) do nothing; return new; end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- admin-only writes on ferry tables (public read unchanged) ----------
drop policy if exists "admin write" on public.ports;
create policy "admin write" on public.ports for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin write" on public.vessels;
create policy "admin write" on public.vessels for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin write" on public.routes;
create policy "admin write" on public.routes for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin write" on public.trips;
create policy "admin write" on public.trips for all using (public.is_admin()) with check (public.is_admin());
```

- [ ] **Step 2: Verify the block landed**

Run: `grep -c 'create policy "admin write' supabase.sql`
Expected: `5` (1 profiles + 4 ferry tables; note: bare `grep -c "admin write"` returns 10 because DROP lines match too)

- [ ] **Step 3: Do NOT commit (owner request)**

Leave `supabase.sql` uncommitted. Owner runs the whole file in Supabase Dashboard > SQL Editor, then promotes the first admin:
```sql
update public.profiles set role = 'admin' where id = '<auth-user-uuid>';
```

---

### Task 2: Role helper + test

**Files:**
- Create: `frontend/src/lib/roles.ts`
- Test: `frontend/src/lib/roles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Role` type and `isAdmin(role): boolean` used by Tasks 3–4 and Header (Task 10).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { isAdmin } from "./roles"

describe("isAdmin", () => {
  it("returns true only for admin", () => {
    expect(isAdmin("admin")).toBe(true)
    expect(isAdmin("manager")).toBe(false)
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/roles.test.ts`
Expected: FAIL with "Failed to resolve import ./roles" (file does not exist yet)

- [ ] **Step 3: Write minimal implementation**

```ts
export type Role = "admin" | "manager"

export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/roles.test.ts`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/roles.ts frontend/src/lib/roles.test.ts
git commit -m "feat(admin): add isAdmin role helper"
```

---

### Task 3: useAuth hook + test

**Files:**
- Create: `frontend/src/hooks/useAuth.ts`
- Test: `frontend/src/hooks/useAuth.test.tsx`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`, `Role` from `@/lib/roles`.
- Produces: `useAuth(): { session: Session | null, role: Role | null, loading: boolean }` used by Task 4.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { role: "admin" } }) }) }),
    }),
  },
}))

import { useAuth } from "./useAuth"

describe("useAuth", () => {
  it("returns session and admin role", async () => {
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.role).toBe("admin")
    expect(result.current.session?.user?.id).toBe("u1")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useAuth.test.tsx`
Expected: FAIL with "Failed to resolve import ./useAuth"

- [ ] **Step 3: Write minimal implementation**

```ts
import * as React from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import type { Role } from "@/lib/roles"

export type AuthState = {
  session: Session | null
  role: Role | null
  loading: boolean
}

export function useAuth(): AuthState {
  const [session, setSession] = React.useState<Session | null>(null)
  const [role, setRole] = React.useState<Role | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function load(s: Session | null) {
      if (cancelled) return
      setSession(s)
      if (!s?.user) {
        setRole(null)
        setLoading(false)
        return
      }
      const { data } = await supabase!.from("profiles").select("role").eq("id", s.user.id).single()
      if (cancelled) return
      setRole((data?.role as Role) ?? null)
      setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => load(s))
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return { session, role, loading }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useAuth.test.tsx`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useAuth.ts frontend/src/hooks/useAuth.test.tsx
git commit -m "feat(admin): add useAuth session+role hook"
```

---

### Task 4: RequireAdmin guard + dashboard shell + routes

**Files:**
- Create: `frontend/src/components/auth/RequireAdmin.tsx`
- Create: `frontend/src/app/DashboardLayout.tsx`
- Create: `frontend/src/pages/dashboard/Overview.tsx`
- Modify: `frontend/src/app/router.tsx` (add `/dashboard` branch)

**Interfaces:**
- Consumes: `useAuth` (Task 3), `isAdmin` (Task 2), existing `Header`, `Card` primitives.
- Produces: `/dashboard` route tree and `DashboardLayout` sidebar used by Tasks 6–9.

- [ ] **Step 1: Create `RequireAdmin.tsx`**

```tsx
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { isAdmin } from "@/lib/roles"

export function RequireAdmin() {
  const { session, role, loading } = useAuth()
  const location = useLocation()
  if (loading) return <p className="container mx-auto px-4 py-12 text-sm text-muted-foreground">Loading...</p>
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!isAdmin(role)) return <Navigate to="/" replace />
  return <Outlet />
}

export default RequireAdmin
```

- [ ] **Step 2: Create `DashboardLayout.tsx`**

```tsx
import { NavLink, Outlet } from "react-router-dom"
import { Header } from "@/components/layout/Header"
import { cn } from "@/lib/utils"

const links = [
  { to: "/dashboard", label: "Overview", end: true },
  { to: "/dashboard/ports", label: "Ports" },
  { to: "/dashboard/vessels", label: "Vessels" },
  { to: "/dashboard/routes", label: "Routes" },
  { to: "/dashboard/trips", label: "Trips" },
]

export function DashboardLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row gap-6">
        <aside className="md:w-52 shrink-0">
          <nav className="flex md:flex-col gap-1 overflow-x-auto">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap",
                    isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default DashboardLayout
```

- [ ] **Step 3: Create `Overview.tsx` (counts)**

```tsx
import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { supabase } from "@/lib/supabase"

export function Overview() {
  const [counts, setCounts] = React.useState<Record<string, number | null>>({})
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!supabase) {
      setError("Missing Supabase env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).")
      return
    }
    ;(async () => {
      const out: Record<string, number | null> = {}
      for (const t of ["ports", "vessels", "routes", "trips"]) {
        const { count, error } = await supabase!.from(t).select("*", { count: "exact", head: true })
        if (error) {
          setError(error.message)
          return
        }
        out[t] = count
      }
      setCounts(out)
    })()
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Overview</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {["ports", "vessels", "routes", "trips"].map((t) => (
          <Card key={t}>
            <CardHeader>
              <CardTitle className="text-sm capitalize">{t}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{counts[t] ?? "--"}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default Overview
```

- [ ] **Step 4: Wire routes in `router.tsx` (add imports + branch)**

```tsx
import RequireAdmin from "@/components/auth/RequireAdmin"
import DashboardLayout from "@/app/DashboardLayout"
import Overview from "@/pages/dashboard/Overview"

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/trips", element: <Trips /> },
  { path: "/trips/:id", element: <TripDetails /> },
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
  {
    path: "/dashboard",
    element: <RequireAdmin />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Overview /> },
          { path: "ports", element: <Overview /> },
          { path: "vessels", element: <Overview /> },
          { path: "routes", element: <Overview /> },
          { path: "trips", element: <Overview /> },
        ],
      },
    ],
  },
])
```

Note: CRUD pages land in Tasks 6–9; each of those tasks adds its own import and switches its route from `<Overview />` to its real page.

- [ ] **Step 5: Verify typecheck + build**

Run: `npx tsc --noEmit`
Expected: no output (clean)

Run: `npm run build 2>&1 | tail -2`
Expected: `✓ built in ...`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/auth/RequireAdmin.tsx frontend/src/app/DashboardLayout.tsx frontend/src/pages/dashboard/Overview.tsx frontend/src/app/router.tsx
git commit -m "feat(admin): add dashboard shell, guard, overview"
```

---

### Task 5: Shared admin table primitives

**Files:**
- Create: `frontend/src/components/admin/AdminTable.tsx`
- Test: `frontend/src/components/admin/AdminTable.test.tsx`

**Interfaces:**
- Consumes: existing `Card`, `Button`.
- Produces: `AdminTable` used by Tasks 6–9.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AdminTable } from "./AdminTable"

describe("AdminTable", () => {
  it("renders rows and fires edit/delete", () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <AdminTable
        title="Ports"
        columns={[{ key: "code", label: "Code" }]}
        rows={[{ id: "1", code: "MNL" }]}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    )
    expect(screen.getByText("MNL")).toBeTruthy()
    fireEvent.click(screen.getByText("Edit"))
    fireEvent.click(screen.getByText("Delete"))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/admin/AdminTable.test.tsx`
Expected: FAIL with "Failed to resolve import ./AdminTable"

- [ ] **Step 3: Write minimal implementation**

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/admin/AdminTable.test.tsx`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/AdminTable.tsx frontend/src/components/admin/AdminTable.test.tsx
git commit -m "feat(admin): add shared admin table"
```

---

### Task 6: Ports admin page

**Files:**
- Create: `frontend/src/pages/dashboard/Ports.tsx`
- Modify: `frontend/src/app/router.tsx` (switch `ports` route from Overview to PortsAdmin)

**Interfaces:**
- Consumes: `AdminTable` (Task 5), `supabase`, Card/Input/Label/Button/Select primitives, react-hook-form + zod (Login pattern).
- Produces: `PortsAdmin` page.

- [ ] **Step 1: Create `Ports.tsx` (full file)**

```tsx
import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabase"
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
      setError("Missing Supabase env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).")
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
    if (!supabase) return
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
    if (!supabase) return
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
```

- [ ] **Step 2: Switch router `ports` route to `PortsAdmin`**

In `frontend/src/app/router.tsx`, add `import PortsAdmin from "@/pages/dashboard/Ports"` and change `{ path: "ports", element: <Overview /> }` to `{ path: "ports", element: <PortsAdmin /> }`.

- [ ] **Step 3: Verify typecheck + tests**

Run: `npx tsc --noEmit`
Expected: no output

Run: `npx vitest run src/lib/roles.test.ts src/hooks/useAuth.test.tsx src/components/admin/AdminTable.test.tsx`
Expected: `3 passed` (3 files)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/dashboard/Ports.tsx frontend/src/app/router.tsx
git commit -m "feat(admin): add ports CRUD page"
```

---

### Task 7: Vessels admin page

**Files:**
- Create: `frontend/src/pages/dashboard/Vessels.tsx`
- Modify: `frontend/src/app/router.tsx` (switch `vessels` route to VesselsAdmin)

**Interfaces:**
- Consumes: `AdminTable` (Task 5), `supabase`, same UI primitives as Task 6.
- Produces: `VesselsAdmin` page.

- [ ] **Step 1: Create `Vessels.tsx` (full file)**

```tsx
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
```

- [ ] **Step 2: Switch router `vessels` route to `VesselsAdmin`**

In `frontend/src/app/router.tsx`, add `import VesselsAdmin from "@/pages/dashboard/Vessels"` and change `{ path: "vessels", element: <Overview /> }` to `{ path: "vessels", element: <VesselsAdmin /> }`.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/dashboard/Vessels.tsx frontend/src/app/router.tsx
git commit -m "feat(admin): add vessels CRUD page"
```

---

### Task 8: Routes admin page

**Files:**
- Create: `frontend/src/pages/dashboard/Routes.tsx`
- Modify: `frontend/src/app/router.tsx` (switch `routes` route to RoutesAdmin)

**Interfaces:**
- Consumes: `AdminTable` (Task 5), `supabase`, ports list for origin/destination selects.
- Produces: `RoutesAdmin` page.

- [ ] **Step 1: Create `Routes.tsx` (full file)**

```tsx
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

const schema = z
  .object({
    code: z.string().min(1).max(16),
    origin_port_id: z.string().min(1, "Select origin"),
    destination_port_id: z.string().min(1, "Select destination"),
    distance_km: z.coerce.number().positive().optional(),
    estimated_duration_minutes: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.origin_port_id !== v.destination_port_id, {
    message: "Origin and destination must differ",
    path: ["destination_port_id"],
  })

type Form = z.infer<typeof schema>

export function RoutesAdmin() {
  const [rows, setRows] = React.useState<any[]>([])
  const [ports, setPorts] = React.useState<any[]>([])
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
    const [r, p] = await Promise.all([
      supabase.from("routes").select("*").order("code"),
      supabase.from("ports").select("id, code, city").order("code"),
    ])
    if (r.error) setError(r.error.message)
    else setRows(r.data ?? [])
    if (!p.error) setPorts(p.data ?? [])
    setLoading(false)
  }

  React.useEffect(() => {
    load()
  }, [])

  function openAdd() {
    setEditing(null)
    reset({ code: "", origin_port_id: "", destination_port_id: "" })
    setShowForm(true)
  }

  function openEdit(row: any) {
    setEditing(row)
    reset({
      code: row.code,
      origin_port_id: row.origin_port_id,
      destination_port_id: row.destination_port_id,
      distance_km: row.distance_km ?? undefined,
      estimated_duration_minutes: row.estimated_duration_minutes ?? undefined,
    })
    setShowForm(true)
  }

  const onSubmit = async (v: Form) => {
    if (!supabase) return
    const payload = {
      code: v.code.toUpperCase(),
      origin_port_id: v.origin_port_id,
      destination_port_id: v.destination_port_id,
      distance_km: v.distance_km ?? null,
      estimated_duration_minutes: v.estimated_duration_minutes ?? null,
    }
    const { error } = editing
      ? await supabase.from("routes").update(payload).eq("id", editing.id)
      : await supabase.from("routes").insert(payload)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    load()
  }

  async function onDelete(row: any) {
    if (!window.confirm(`Delete route ${row.code}?`)) return
    if (!supabase) return
    const { error } = await supabase.from("routes").delete().eq("id", row.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="space-y-4">
      <AdminTable
        title="Routes"
        columns={[
          { key: "code", label: "Code" },
          { key: "distance_km", label: "Distance (km)" },
          { key: "estimated_duration_minutes", label: "Duration (min)" },
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
                <Label htmlFor="origin_port_id">Origin port</Label>
                <Select id="origin_port_id" {...register("origin_port_id")} defaultValue="">
                  <option value="" disabled>
                    Select origin
                  </option>
                  {ports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} - {p.city}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="destination_port_id">Destination port</Label>
                <Select id="destination_port_id" {...register("destination_port_id")} defaultValue="">
                  <option value="" disabled>
                    Select destination
                  </option>
                  {ports.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} - {p.city}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="distance_km">Distance (km)</Label>
                <Input id="distance_km" type="number" step="0.01" {...register("distance_km")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimated_duration_minutes">Duration (min)</Label>
                <Input id="estimated_duration_minutes" type="number" {...register("estimated_duration_minutes")} />
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

export default RoutesAdmin
```

- [ ] **Step 2: Switch router `routes` route to `RoutesAdmin`**

In `frontend/src/app/router.tsx`, add `import RoutesAdmin from "@/pages/dashboard/Routes"` and change `{ path: "routes", element: <Overview /> }` to `{ path: "routes", element: <RoutesAdmin /> }`.

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no output

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/dashboard/Routes.tsx frontend/src/app/router.tsx
git commit -m "feat(admin): add routes CRUD page"
```

---

### Task 9: Trips admin page

**Files:**
- Create: `frontend/src/pages/dashboard/Trips.tsx`
- Modify: `frontend/src/app/router.tsx` (switch `trips` route to TripsAdmin; the dashboard component is named `TripsAdmin` so there is no clash with the public `Trips` page import)

**Interfaces:**
- Consumes: `AdminTable` (Task 5), `supabase`, routes + vessels + ports for selects.
- Produces: `TripsAdmin` page. Note: public `/trips` page is untouched.

- [ ] **Step 1: Create `Trips.tsx` (full file)**

```tsx
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
  route_id: z.string().min(1, "Select route"),
  vessel_id: z.string().min(1, "Select vessel"),
  departure_at: z.string().min(1, "Select departure"),
  arrival_at: z.string().min(1, "Select arrival"),
  status: z.string().optional(),
  fare_from: z.coerce.number().nonnegative().optional(),
})

type Form = z.infer<typeof schema>

function toLocal(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TripsAdmin() {
  const [rows, setRows] = React.useState<any[]>([])
  const [routes, setRoutes] = React.useState<any[]>([])
  const [vessels, setVessels] = React.useState<any[]>([])
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
    const [t, r, v] = await Promise.all([
      supabase.from("trips").select("id, departure_at, arrival_at, status, fare_from, routes(code)").order("departure_at"),
      supabase.from("routes").select("id, code").order("code"),
      supabase.from("vessels").select("id, code").order("code"),
    ])
    if (t.error) setError(t.error.message)
    else setRows(t.data ?? [])
    if (!r.error) setRoutes(r.data ?? [])
    if (!v.error) setVessels(v.data ?? [])
    setLoading(false)
  }

  React.useEffect(() => {
    load()
  }, [])

  function openAdd() {
    setEditing(null)
    reset({ route_id: "", vessel_id: "", departure_at: "", arrival_at: "", status: "scheduled" })
    setShowForm(true)
  }

  function openEdit(row: any) {
    setEditing(row)
    reset({
      route_id: row.route_id ?? "",
      vessel_id: row.vessel_id ?? "",
      departure_at: row.departure_at ? toLocal(row.departure_at) : "",
      arrival_at: row.arrival_at ? toLocal(row.arrival_at) : "",
      status: row.status,
      fare_from: row.fare_from ?? undefined,
    })
    setShowForm(true)
  }

  const onSubmit = async (v: Form) => {
    if (!supabase) return
    const route = routes.find((r) => r.id === v.route_id)
    if (!route && !editing) {
      setError("Select a route.")
      return
    }
    const payload: any = {
      departure_at: new Date(v.departure_at).toISOString(),
      arrival_at: new Date(v.arrival_at).toISOString(),
      status: v.status || "scheduled",
      fare_from: v.fare_from ?? null,
    }
    if (!editing) {
      const { data: full } = await supabase.from("routes").select("origin_port_id, destination_port_id").eq("id", v.route_id).single()
      Object.assign(payload, {
        route_id: v.route_id,
        vessel_id: v.vessel_id,
        departure_port_id: full?.origin_port_id,
        arrival_port_id: full?.destination_port_id,
      })
    } else {
      Object.assign(payload, { route_id: v.route_id, vessel_id: v.vessel_id })
    }
    const { error } = editing
      ? await supabase.from("trips").update(payload).eq("id", editing.id)
      : await supabase.from("trips").insert(payload)
    if (error) {
      setError(error.message)
      return
    }
    setShowForm(false)
    load()
  }

  async function onDelete(row: any) {
    if (!window.confirm("Delete this trip?")) return
    if (!supabase) return
    const { error } = await supabase.from("trips").delete().eq("id", row.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="space-y-4">
      <AdminTable
        title="Trips"
        columns={[
          { key: "departure_at", label: "Departure", render: (r) => new Date(r.departure_at).toLocaleString() },
          { key: "arrival_at", label: "Arrival", render: (r) => new Date(r.arrival_at).toLocaleString() },
          { key: "status", label: "Status" },
          { key: "fare_from", label: "Fare" },
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
                <Label htmlFor="route_id">Route</Label>
                <Select id="route_id" {...register("route_id")} defaultValue="">
                  <option value="" disabled>
                    Select route
                  </option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vessel_id">Vessel</Label>
                <Select id="vessel_id" {...register("vessel_id")} defaultValue="">
                  <option value="" disabled>
                    Select vessel
                  </option>
                  {vessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="departure_at">Departure</Label>
                <Input id="departure_at" type="datetime-local" {...register("departure_at")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="arrival_at">Arrival</Label>
                <Input id="arrival_at" type="datetime-local" {...register("arrival_at")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select id="status" {...register("status")}>
                  <option value="scheduled">scheduled</option>
                  <option value="boarding">boarding</option>
                  <option value="departed">departed</option>
                  <option value="cancelled">cancelled</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fare_from">Fare from</Label>
                <Input id="fare_from" type="number" step="0.01" {...register("fare_from")} />
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

export default TripsAdmin
```

- [ ] **Step 2: Switch router `trips` route to `TripsAdmin`**

In `frontend/src/app/router.tsx`, add `import TripsAdmin from "@/pages/dashboard/Trips"` and change `{ path: "trips", element: <Overview /> }` (inside dashboard children) to `{ path: "trips", element: <TripsAdmin /> }`. Do NOT touch the public `{ path: "/trips", element: <Trips /> }` route.

- [ ] **Step 3: Verify typecheck + full build**

Run: `npx tsc --noEmit`
Expected: no output

Run: `npm run build 2>&1 | tail -2`
Expected: `✓ built in ...`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/dashboard/Trips.tsx frontend/src/app/router.tsx
git commit -m "feat(admin): add trips CRUD page"
```

---

### Task 10: Header dashboard link + final verification

**Files:**
- Modify: `frontend/src/components/layout/Header.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 3), `isAdmin` (Task 2).
- Produces: admin-gated nav link. Final state of whole feature.

- [ ] **Step 1: Add admin-only Dashboard link**

In `frontend/src/components/layout/Header.tsx`, add imports and link between Trips link and Login link:

```tsx
import { useAuth } from "@/hooks/useAuth"
import { isAdmin } from "@/lib/roles"

export function Header() {
  const { role } = useAuth()
  ...
  {isAdmin(role) && (
    <Link to="/dashboard" className="text-sm font-medium hover:text-primary transition-colors px-3 py-2">
      Dashboard
    </Link>
  )}
```

Full edited nav block:

```tsx
<nav className="flex items-center gap-2">
  <Link to="/" className="text-sm font-medium hover:text-primary transition-colors px-3 py-2">
    Home
  </Link>
  <Link to="/trips" className="text-sm font-medium hover:text-primary transition-colors px-3 py-2">
    Trips
  </Link>
  {isAdmin(role) && (
    <Link to="/dashboard" className="text-sm font-medium hover:text-primary transition-colors px-3 py-2">
      Dashboard
    </Link>
  )}
  <Link to="/login">
    ...
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: `3 passed` across 3 test files (roles, useAuth, AdminTable)

- [ ] **Step 3: Final build + route smoke test**

Run: `npm run build 2>&1 | tail -2`
Expected: `✓ built in ...`

Run:
```bash
(npm run dev -- --port 5173 >/tmp/vite.log 2>&1 & echo $! > /tmp/vite.pid; sleep 4; curl -s -o /dev/null -w "dashboard:%{http_code}\n" http://localhost:5173/dashboard; curl -s -o /dev/null -w "login:%{http_code}\n" http://localhost:5173/login; kill $(cat /tmp/vite.pid) 2>/dev/null; true)
```
Expected: `dashboard:200` and `login:200` (SPA serves index.html; guard redirects client-side)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/layout/Header.tsx
git commit -m "feat(admin): show dashboard link for admins"
```
