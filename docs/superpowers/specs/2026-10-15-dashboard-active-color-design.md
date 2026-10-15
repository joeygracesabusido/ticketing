# Dashboard "Active on Color, Minimalist" Redesign — Design

Date: 2026-10-15
Status: Approved (user approved design sections in chat, 2026-10-15)
Approach chosen: **A — Tinted accent system** (over B dark-rail sidebar, C per-section hues)

## Goal

Make every admin dashboard page from **Ports → Reports** feel more active through color, while keeping each page structurally minimal (title row + action button + table). The **Overview** page is untouched. The sidebar gets a matching restyle. No new layout chrome, no new animations beyond existing color transitions.

## Scope

In scope (frontend only, light mode — the app never enables `.dark`):

| File | Change |
|---|---|
| `frontend/src/components/admin/AdminTable.tsx` | Tinted header band + colored small-caps headers; row hover tint; new exported `StatusBadge` helper |
| `frontend/src/components/admin/AdminTable.test.tsx` | 2 assertions for `StatusBadge` mapping (paid→emerald, unknown→neutral) |
| `frontend/src/app/DashboardLayout.tsx` | Active/hover nav restyle; user box slimmed to email + role badge + icon-only logout |
| `frontend/src/pages/dashboard/Vessels.tsx` | `status` column rendered via `StatusBadge` |
| `frontend/src/pages/dashboard/Trips.tsx` | `status` column rendered via `StatusBadge` |
| `frontend/src/pages/dashboard/Accommodations.tsx` | `is_active` column rendered via `StatusBadge` (true→"active") |
| `frontend/src/pages/dashboard/Bookings.tsx` | Payment + booking `status` columns rendered via `StatusBadge` |
| `frontend/src/pages/dashboard/Users.tsx` | Own table: same header band/classes + row hover; `is_active` badge tinted; role badges unchanged |
| `frontend/src/pages/dashboard/Reports.tsx` | `bookingState` badge via `StatusBadge`; stat cards and list rows unchanged |

Out of scope: `Overview.tsx`, `Header.tsx`, public pages (Home/Trips/bookings search), `index.css`, `tailwind.config.js`, all add/edit forms, new animations/motion, dark mode.

This change builds on top of the uncommitted RBAC/user-management work in the working tree (optional `AdminTable` props, Users page) and does not alter its logic.

## Design details

### 1. Shared table (`AdminTable.tsx`)

Covers Ports, Vessels, Routes, Trips, Accommodations, Bookings in one edit.

- Header row: `bg-primary/5` tint band; header cells become
  `text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-primary`
  (was `font-medium text-muted-foreground`). Actions header keeps `text-right`.
- Body rows: add `transition-colors hover:bg-primary/5`; keep `border-b last:border-0`.
- Page title (gradient h1) and Add button (gradient): unchanged.
- Empty/loading/error states: unchanged.

### 2. StatusBadge — semantic tints

New export in `AdminTable.tsx` (no new file; all six pages already import from it):

```tsx
export function StatusBadge({ value }: { value: string | boolean })
```

Renders the existing shadcn `Badge` (`variant="outline"`) with tint classes per semantic group. Mapping is case-insensitive on trimmed string form (booleans stringified, `true`→"active"):

| Tint class | Values |
|---|---|
| emerald (`bg-emerald-50 text-emerald-700 border-emerald-200`) | active, paid, open, confirmed |
| amber (`bg-amber-50 text-amber-700 border-amber-200`) | maintenance, pending, processing, boarding, not yet open |
| rose (`bg-rose-50 text-rose-700 border-rose-200`) | retired, cancelled, failed, closed, inactive |
| blue/neutral (`bg-primary/5 text-primary border-primary/20`) | everything else (scheduled, departed, unknown) |

Display label: the original value capitalized (e.g. `not yet open` → "Not yet open").

Application points: Vessels.status, Trips.status, Accommodations.is_active (`true`→"active"), Bookings payment status + booking status, Reports.bookingState, Users is_active badge. Users role badges keep the current default variant (roles are identity, not state).

### 3. Sidebar (`DashboardLayout.tsx`)

- Active `NavLink`: replace solid `bg-primary text-primary-foreground` with
  `relative bg-primary/10 text-primary font-semibold` plus a 3px gradient left bar:
  absolutely-positioned span `left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-gradient-to-b from-primary to-violet-600`.
- Inactive links: `text-muted-foreground hover:bg-primary/5 hover:text-primary` (was gray hover).
- User box slimmed: email line stays; below it a row with the role `Badge` and an icon-only logout `Button variant="ghost" size="icon"` (`aria-label="Logout"`); the text "Logout" label is removed from the box. The separate mobile full-width logout link (with text) is unchanged.
- Brand block, "Manage" section label, nav order, mobile layout: unchanged.

### 4. Per-page extras

- `Users.tsx` table (does not use `AdminTable`): apply the same header band (`bg-primary/5`), small-caps primary headers, and row hover inline (~6 lines).
- `Reports.tsx`: no table exists — only the `bookingState` badge changes; stat cards and list rows untouched.

## Verification

1. `npm test` (vitest) in `frontend/` — existing AdminTable test must pass unmodified; new StatusBadge assertions pass.
2. `npm run build` in `frontend/` — typecheck + production build clean.
3. Manual spot-check in browser: Ports page header band + hover, Vessels status tints, sidebar active bar, Users table, Reports badges.

## Risks / notes

- Tints use fixed light-mode palette classes (`bg-emerald-50` etc.); if dark mode is ever enabled they will need `dark:` variants. Accepted — app is light-only today.
- `StatusBadge` falls back to neutral blue for unknown values, so new DB status values never render unstyled.
- No data/logic changes; all edits are presentational classes + one display helper.
