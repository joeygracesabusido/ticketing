# Admin User Management (RBAC)

## Architecture
- Auth: Supabase Auth (`auth.users`). Roles live in `public.profiles` (trusted DB, never `user_metadata`).
- Roles: `client` (default for new registrations) · `staff` · `manager` (legacy, kept for existing rows) · `admin`.
- Dashboard access (`RequireAdmin` + `canAccessDashboard`): `admin`, `manager`, `staff`. Clients see the denied screen.
- User management (`/dashboard/users`, `canManageUsers`): `admin` only — sidebar link hidden otherwise, page denies, and SQL functions re-check `is_admin()`.
- Privileged writes go through `SECURITY DEFINER` RPCs (same pattern as `verify_payment()`). Browser uses only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. No service key in frontend.
- Inactive accounts (`is_active=false`) get `role=null` in `useAuth`, so all guards deny. True Auth bans still need the Supabase dashboard (Auth Admin API); `is_active` is an app-level deactivation.

## Permissions matrix
| Action | client | staff | manager | admin |
|---|---|---|---|---|
| Public pages, book trips | ✓ | ✓ | ✓ | ✓ |
| `/dashboard` | — | ✓ | ✓ | ✓ |
| CRUD ports/vessels/routes/trips | — | — | — | see note |
| `/dashboard/users`, `set_user_role`, `set_user_active` | — | — | — | ✓ |
| `claim_first_admin` | one-time self, email-allowlisted, zero-admins only | | | |

Note: ferry-table `admin write` policies still check `is_admin()` (admin-only). Managers keep dashboard access per existing behavior but cannot manage users.

## Migrations (order)
1. `supabase/migrations/20261015_complete_shipping_booking.sql` (existing)
2. `supabase/migrations/20261016_user_management_rbac.sql` (new) — mirrored at the tail of `supabase.sql` (complete-file workflow).
3. Apply in Supabase Dashboard → SQL Editor → paste migration → Run. Re-runnable (`if not exists`, `or replace`, `drop ... if exists`). No table drops, no data deletes. One intentional tightening: drops legacy `admin write profiles` direct-write policy so roles change only via audited RPCs.

## Environment variables
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable only, browser-safe).
- Service-role key: never added to frontend; only used manually in SQL Editor if needed. Never printed.

## First-administrator bootstrap
1. Register the intended admin account via `/register` (gets `client` by default — cannot self-promote).
2. As project owner, in SQL Editor:
   ```sql
   insert into public.app_settings (key, value)
   values ('bootstrap_admin_email', 'you@example.com')
   on conflict (key) do update set value = excluded.value;
   ```
3. Login as that account, then run:
   ```sql
   select public.claim_first_admin();
   ```
4. The function verifies: logged in, email matches setting (case-insensitive), zero active admins. On success it promotes the caller, writes `audit_logs role.changed (bootstrap → admin)`, and **deletes** the setting so it cannot be reused.
5. Verify: `select * from public.profiles where role='admin';` Further changes go through `/dashboard/users`.

## Recovery
- Lost admin access: re-insert `bootstrap_admin_email` for a login-capable account **only if zero active admins remain**; otherwise an existing admin must promote via Users page.
- Accidental demotion is blocked: `set_user_role` / `set_user_active` raise `Cannot ... the last active administrator`.

## Verification (this repo)
- `npx tsc --noEmit` clean; `npm test -- --run` 4 files / 12 tests (incl. negative `canManageUsers` + `filterUsers`); `npm run build` succeeds.
- Manual checklist maps to task §8: register→client; self-escalation blocked (trigger hardcodes role, RLS denies direct writes); admin finds/filters/paginates user; role save shows `old → new` + audit row; deactivation loses access; direct `profiles` update via anon fails; `/dashboard/users` as manager/staff/client → denied card; last-admin demotion/deactivation → SQL error surfaced; login/register/booking flows untouched; layout responsive (overflow table + stacked filters).
- SQL not executed here (`.env` is placeholder `xyz...`); apply migration in the real project before testing live.
