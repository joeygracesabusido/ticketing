import { Link, Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { canAccessDashboard } from "@/lib/roles"
import { Header } from "@/components/layout/Header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function RequireAdmin() {
  const { session, role, loading } = useAuth()
  const location = useLocation()
  if (loading) return <p className="container mx-auto px-4 py-12 text-sm text-muted-foreground">Loading...</p>
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  // Don't bounce to "/" (looks exactly like Home) — render a distinct denied screen instead.
  if (!canAccessDashboard(role))
    return (
      <div className="min-h-screen bg-muted/40">
        <Header />
        <main className="container mx-auto px-4 py-12 max-w-lg">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Dashboard unavailable</CardTitle>
              <CardDescription>
                Signed in as {session.user.email ?? "unknown"} · role: {role ?? "none (no profile row)"}. Ask an admin
                to set your role to <code>admin</code> or <code>manager</code> in <code>profiles</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Link to="/">
                <Button variant="outline">Back to home</Button>
              </Link>
              <Link to="/login">
                <Button variant="ghost">Switch account</Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  return <Outlet />
}

export default RequireAdmin
