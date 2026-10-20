import { Link } from "react-router-dom"
import { Ship } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { useLogout } from "@/hooks/useLogout"
import { canAccessDashboard } from "@/lib/roles"

export function Header() {
  const { session, role } = useAuth()
  const logout = useLogout()
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-bold text-lg">
          <Ship className="h-6 w-6 text-primary" />
          Ferry Ticketing
        </Link>
        <nav className="flex min-w-0 items-center gap-2 overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap">
          <Link to="/" className="text-sm font-medium hover:text-primary transition-colors px-3 py-2">
            Home
          </Link>
          <Link to="/trips" className="text-sm font-medium hover:text-primary transition-colors px-3 py-2">
            Trips
          </Link>
          <Link to="/bookings" className="text-sm font-medium hover:text-primary transition-colors px-3 py-2">
            My bookings
          </Link>
          {canAccessDashboard(role) && (
            <Link to="/dashboard" className="text-sm font-medium hover:text-primary transition-colors px-3 py-2">
              Dashboard
            </Link>
          )}
          {session ? (
            <Button variant="ghost" size="sm" onClick={logout}>
              Logout
            </Button>
          ) : (
            <>
              <Link to="/login">
                <Button variant="ghost" size="sm">
                  Login
                </Button>
              </Link>
              <Link to="/register">
                <Button size="sm">Register</Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

export default Header
