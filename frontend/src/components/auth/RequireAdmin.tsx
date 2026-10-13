import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { isAdmin } from "@/lib/roles"

export function RequireAdmin() {
  const { session, role, loading } = useAuth()
  const location = useLocation()
  if (loading) return <p className="container mx-auto px-4 py-12 text-sm text-muted-foreground">Loading...</p>
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!isAdmin(role)) return <Navigate to="/" state={{ notice: "Admins only" }} replace />
  return <Outlet />
}

export default RequireAdmin
