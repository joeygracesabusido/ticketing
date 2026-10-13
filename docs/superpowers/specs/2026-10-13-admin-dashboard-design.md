# Admin Dashboard Design — 2026-10-13

## Goal

Add a modern admin-only dashboard (`/dashboard`) with sidebar for CRUD on
ports, vessels, routes, trips. Roles: `admin` (full dashboard access),
`manager` (public site only, role reserved for future use).

## Architecture

- No backend. Frontend (Vite + React + Tailwind/shadcn) talks to Supabase
  directly via existing `src/lib/supabase.ts` (publishable key).
- Auth state: new `useAuth` hook wraps `supabase.auth.getSession()` /
  `onAuthStateChange()` plus a fetch of the caller's row in `profiles`.
- Route guard `RequireAdmin`: no session → redirect `/login`; session but
  role != `admin` → redirect `/` with notice. All `/dashboard/*` routes nest
  inside it.

## Components

- `src/hooks/useAuth.ts` — `{ session, role, loading }`; caches profile row.
- `src/components/auth/RequireAdmin.tsx` — guard wrapper.
- `src/app/DashboardLayout.tsx` — sidebar + `<Outlet/>`. Sidebar items:
  Overview, Ports, Vessels, Routes, Trips. Collapses on mobile (existing
  Tailwind breakpoints, no new deps).
- `src/pages/dashboard/Overview.tsx` — 4 count cards (ports/vessels/routes/
  trips) via `select('*', { count: 'exact', head: true })`.
- `src/pages/dashboard/Ports.tsx`, `Vessels.tsx`, `Routes.tsx`, `Trips.tsx`
  — table + add/edit dialog + delete confirm, same Card/Button/Input/Select
  primitives. Trips form resolves port/route/vessel dropdowns by code.
- `Header.tsx` — append "Dashboard" link only when `role === 'admin'`.
- `router.tsx` — add `/dashboard` children listed above.

## Data flow

1. Login/Register (existing Supabase Auth) → trigger auto-creates
   `profiles` row with `role='manager'`.
2. Dashboard load → `useAuth` reads own profile → guard passes only for
   `admin`.
3. CRUD pages issue direct PostgREST queries; RLS enforces admin-write.
4. Errors surface inline (destructive text); deletes require confirm.

## Database (`supabase.sql` addition)

- `profiles(id uuid PK references auth.users, role text check
  ('admin','manager') default 'manager')`.
- Trigger `on_auth_user_created` inserts profile on signup.
- Helper `public.is_admin()` (security definer, reads own profile).
- RLS: `profiles` — user reads own row; write policies `for all using
  (is_admin())`. Add admin-write policies on ports/vessels/routes/trips
  (public read unchanged).
- First admin promoted manually:
  `update public.profiles set role='admin' where id = '<auth-user-id>';`

## Error handling

- `supabase === null` (missing env) → dashboard shows missing-env message,
  same pattern as Login/Register.
- Missing table (PGRST205) → empty-state message naming the table.
- RLS 401/403 on write → "Admins only" message (should be unreachable via
  UI due to guard; defense in depth).

## Testing

- `npm run build` passes; `/dashboard` redirects to `/login` logged-out,
  to `/` as manager, renders sidebar as admin.
- Live check with seeded data: Overview counts > 0, ports list shows 8
  seeded ports, create+delete a test vessel round-trips.

## Out of scope

- Manager dashboard access, bookings module, audit log, bulk import.
