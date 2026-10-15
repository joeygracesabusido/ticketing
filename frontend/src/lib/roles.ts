export type Role = "client" | "staff" | "manager" | "admin"

export const ROLE_OPTIONS: Role[] = ["client", "staff", "manager", "admin"]

export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin"
}

// Dashboard stays for internal roles; clients are denied at RequireAdmin.
export function canAccessDashboard(role: string | null | undefined): boolean {
  return role === "admin" || role === "manager" || role === "staff"
}

// Only admins may open /dashboard/users or call role RPCs (enforced again in SQL).
export function canManageUsers(role: string | null | undefined): boolean {
  return role === "admin"
}

// Pure helper for the Users page + unit tests (no Supabase needed).
export function filterUsers<T extends {
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  role?: string | null
  is_active?: boolean | null
}>(rows: T[], query: string, roleFilter: string, statusFilter: string): T[] {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => {
    if (roleFilter !== "all" && (r.role ?? "") !== roleFilter) return false
    if (statusFilter === "active" && r.is_active !== true) return false
    if (statusFilter === "inactive" && r.is_active !== false) return false
    if (!q) return true
    return [r.email, r.first_name, r.last_name, r.role]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q)
  })
}
