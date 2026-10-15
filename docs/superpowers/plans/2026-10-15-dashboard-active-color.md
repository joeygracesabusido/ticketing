# Dashboard "Active on Color" Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle admin dashboard pages Ports→Reports and the sidebar with a tinted accent system (colored table headers, row hover, semantic status badges, active nav bar) while keeping every page structurally minimal.

**Architecture:** All shared table styling lives in one component (`AdminTable.tsx`), so six pages pick up the new look from a single edit. A small `StatusBadge` export in the same file maps semantic status strings to tint classes and is applied by each page's column `render`. The sidebar restyle is isolated in `DashboardLayout.tsx`. Overview, Header, public pages, forms, CSS config are untouched.

**Tech Stack:** React + TypeScript, Tailwind (shadcn-style tokens, light mode only), vitest + @testing-library/react, Vite.

## Global Constraints

- Light mode only — the app never enables `.dark`; do NOT add `dark:` variants.
- Do not touch: `frontend/src/pages/dashboard/Overview.tsx`, `frontend/src/components/layout/Header.tsx`, public pages (`pages/Home*`, `pages/Trips.tsx`, `pages/TripDetails.tsx`, booking components), `frontend/src/index.css`, `frontend/tailwind.config.js`, any add/edit form markup.
- The working tree contains unrelated uncommitted RBAC work (Users page, roles, supabase.sql). **Never** use `git add -A` or `git add .` — stage only the exact files listed per task.
- Tailwind opacity modifiers on token colors are safe here (`bg-primary/5`, `border-primary/20`) — precedent: `bg-background/95` already used in `Header.tsx`.
- Verify commands run from `frontend/`: tests `npx vitest run`, build `npm run build` (Vite does not typecheck; keep imports clean anyway).

---

### Task 1: AdminTable tinted header + row hover + StatusBadge

**Files:**
- Modify: `frontend/src/components/admin/AdminTable.tsx`
- Test: `frontend/src/components/admin/AdminTable.test.tsx`

**Interfaces:**
- Consumes: existing shadcn `Badge` (`variant="outline"`), nothing else new.
- Produces: `export function StatusBadge({ value }: { value: string | boolean })` — renders a tinted outline Badge; label = value capitalized, booleans mapped `true`→"active", `false`→"inactive"; unknown values fall back to neutral blue tint. Tasks 3 and 4 import this exact name from `@/components/admin/AdminTable`.

- [ ] **Step 1: Write the failing test**

In `frontend/src/components/admin/AdminTable.test.tsx`, add the import next to the existing `AdminTable` import and append a new test inside the `describe` block:

```tsx
import { AdminTable, StatusBadge } from "./AdminTable"
```

```tsx
  it("maps status values to semantic tints", () => {
    render(<StatusBadge value="paid" />)
    expect(screen.getByText("Paid").className).toContain("emerald")
    render(<StatusBadge value="weird-new-value" />)
    expect(screen.getByText("Weird-new-value").className).toContain("primary")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/admin/AdminTable.test.tsx` (from `frontend/`)
Expected: FAIL — "StatusBadge" is not exported / import error.

- [ ] **Step 3: Implement StatusBadge + header band + row hover in AdminTable.tsx**

Add to the imports at top of `AdminTable.tsx`:

```tsx
import { Badge } from "@/components/ui/badge"
```

Add after the `AdminColumn` type (before `export function AdminTable`):

```tsx
const STATUS_TINTS: [RegExp, string][] = [
  [/^(active|paid|open|confirmed)$/, "border-emerald-200 bg-emerald-50 text-emerald-700"],
  [/^(maintenance|pending|processing|boarding|not yet open)$/, "border-amber-200 bg-amber-50 text-amber-700"],
  [/^(retired|cancelled|failed|closed|inactive)$/, "border-rose-200 bg-rose-50 text-rose-700"],
]

export function StatusBadge({ value }: { value: string | boolean }) {
  const raw = String(value).trim()
  const norm = raw.toLowerCase()
  const label = norm === "true" ? "active" : norm === "false" ? "inactive" : raw.charAt(0).toUpperCase() + raw.slice(1)
  const tint = STATUS_TINTS.find(([re]) => re.test(norm))?.[1] ?? "border-primary/20 bg-primary/5 text-primary"
  return <Badge variant="outline" className={tint}>{label}</Badge>
}
```

Replace the `<thead>` block (currently plain `text-muted-foreground` headers) with:

```tsx
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
```

Replace the body row element:

```tsx
                  <tr key={r.id} className="border-b last:border-0 transition-colors hover:bg-primary/5">
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/admin/AdminTable.test.tsx` (from `frontend/`)
Expected: PASS — both tests (existing rows/edit/delete + new tints).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/AdminTable.tsx frontend/src/components/admin/AdminTable.test.tsx
git commit -m "feat(admin): tinted table headers, row hover, semantic StatusBadge"
```

---

### Task 2: Sidebar active/hover restyle + slim user box

**Files:**
- Modify: `frontend/src/app/DashboardLayout.tsx`

**Interfaces:**
- Consumes: existing `Button` from `@/components/ui/button` (add import), existing lucide icons.
- Produces: nothing (leaf change).

- [ ] **Step 1: Add Button import**

In `DashboardLayout.tsx`, add after the `Badge` import:

```tsx
import { Button } from "@/components/ui/button"
```

- [ ] **Step 2: Restyle NavLink active/hover + gradient left bar**

Replace the `NavLink` block (currently `className={({ isActive }) => ...}` with static children) with:

```tsx
            {navLinks.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn(
                    "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                    isActive ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-primary/5 hover:text-primary"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span aria-hidden className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-gradient-to-b from-primary to-violet-600" />
                    )}
                    <l.icon className="h-4 w-4 shrink-0" />
                    {l.label}
                  </>
                )}
              </NavLink>
            ))}
```

Note: `relative` moves from conditional to the base class list (needed by the absolutely-positioned bar).

- [ ] **Step 3: Slim the user box logout to icon-only**

In the `hidden md:block mt-2 rounded-xl bg-muted p-3` div, replace the text `<button>…Logout</button>` with:

```tsx
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Logout"
                  onClick={logout}
                  className="h-7 w-7 text-muted-foreground hover:text-primary"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
```

Leave the email line, role `Badge`, and the separate mobile logout link unchanged.

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run build` (from `frontend/`)
Expected: all tests pass; build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/DashboardLayout.tsx
git commit -m "feat(admin): active sidebar state with gradient bar, slim user box"
```

---

### Task 3: Apply StatusBadge to Vessels, Trips, Accommodations, Bookings

**Files:**
- Modify: `frontend/src/pages/dashboard/Vessels.tsx`
- Modify: `frontend/src/pages/dashboard/Trips.tsx`
- Modify: `frontend/src/pages/dashboard/Accommodations.tsx`
- Modify: `frontend/src/pages/dashboard/Bookings.tsx`

**Interfaces:**
- Consumes: `StatusBadge` from `@/components/admin/AdminTable` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Vessels — status column to badge**

In `Vessels.tsx`, change the import:

```tsx
import { AdminTable, StatusBadge } from "@/components/admin/AdminTable"
```

Change the column definition `{ key: "status", label: "Status" },` to:

```tsx
          { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
```

- [ ] **Step 2: Trips — status column to badge**

In `Trips.tsx`, change the import:

```tsx
import { AdminTable, StatusBadge } from "@/components/admin/AdminTable"
```

Change `{ key: "status", label: "Status" },` to:

```tsx
          { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
```

- [ ] **Step 3: Accommodations — is_active column to badge**

In `Accommodations.tsx`, change the import:

```tsx
import { AdminTable, StatusBadge } from "@/components/admin/AdminTable"
```

Change `{ key: "is_active", label: "Active", render: (r) => String(r.is_active) },` to:

```tsx
        { key: "is_active", label: "Active", render: (r) => <StatusBadge value={r.is_active} /> },
```

- [ ] **Step 4: Bookings — both status columns to badge, drop unused Badge import**

In `Bookings.tsx`, change the import and remove the now-unused Badge import:

```tsx
import { AdminTable, StatusBadge } from "@/components/admin/AdminTable"
```

(delete the line `import { Badge } from "@/components/ui/badge"`)

Replace both occurrences of `{ key: "status", label: "Status", render: (r) => <Badge>{r.status}</Badge> },` with:

```tsx
        { key: "status", label: "Status", render: (r) => <StatusBadge value={r.status} /> },
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build` (from `frontend/`)
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/dashboard/Vessels.tsx frontend/src/pages/dashboard/Trips.tsx frontend/src/pages/dashboard/Accommodations.tsx frontend/src/pages/dashboard/Bookings.tsx
git commit -m "feat(admin): semantic status badges on vessels, trips, accommodations, bookings"
```

---

### Task 4: Users table restyle + Reports booking-state badge

**Files:**
- Modify: `frontend/src/pages/dashboard/Users.tsx`
- Modify: `frontend/src/pages/dashboard/Reports.tsx`

**Interfaces:**
- Consumes: `StatusBadge` from `@/components/admin/AdminTable` (Task 1).
- Produces: nothing. Final task — run the full verification suite at the end.

- [ ] **Step 1: Users — tinted header band, small-caps headers, row hover**

In `Users.tsx`, replace the table `<thead>` block with:

```tsx
              <thead>
                <tr className="border-b bg-primary/5">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Email</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Name</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Role</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Status</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary">Actions</th>
                </tr>
              </thead>
```

Replace the body row element `<tr key={u.id} className="border-b last:border-0">` with:

```tsx
                  <tr key={u.id} className="border-b last:border-0 transition-colors hover:bg-primary/5">
```

- [ ] **Step 2: Users — is_active badge to StatusBadge (role badges unchanged)**

Add the import next to other component imports:

```tsx
import { StatusBadge } from "@/components/admin/AdminTable"
```

Replace:

```tsx
                      <Badge variant={u.is_active ? "secondary" : "outline"}>{u.is_active ? "active" : "inactive"}</Badge>
```

with:

```tsx
                      <StatusBadge value={u.is_active} />
```

(`Badge` import stays — role badges still use it.)

- [ ] **Step 3: Reports — bookingState badge to StatusBadge**

In `Reports.tsx`, add the import:

```tsx
import { StatusBadge } from "@/components/admin/AdminTable"
```

Replace `<Badge>{r.bookingState}</Badge>` with:

```tsx
                  <StatusBadge value={r.bookingState} />
```

(`Badge` import stays — routeCode badges still use it.)

- [ ] **Step 4: Full verification**

Run: `npx vitest run && npm run build` (from `frontend/`)
Expected: all tests pass (including the original AdminTable test and StatusBadge tints); build succeeds.

Manual spot-check (dev server, admin login): Ports page shows tinted header band + row hover; Vessels status column shows emerald/amber/rose badges; sidebar active item has soft blue tint + gradient left bar; Users table matches the shared look; Reports list shows tinted booking-state badges; Overview pixel-identical to before.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/dashboard/Users.tsx frontend/src/pages/dashboard/Reports.tsx
git commit -m "feat(admin): tinted Users table headers and Reports booking-state badges"
```
