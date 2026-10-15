import { NavLink, Outlet } from "react-router-dom"
import { LayoutDashboard, Anchor, Ship, Route as RouteIcon, CalendarDays, BarChart3, LogOut, BedDouble, Ticket } from "lucide-react"
import { Header } from "@/components/layout/Header"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/useAuth"
import { useLogout } from "@/hooks/useLogout"
import { isAdmin } from "@/lib/roles"
import { cn } from "@/lib/utils"

const links = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/dashboard/ports", label: "Ports", icon: Anchor },
  { to: "/dashboard/vessels", label: "Vessels", icon: Ship },
  { to: "/dashboard/routes", label: "Routes", icon: RouteIcon },
  { to: "/dashboard/trips", label: "Trips", icon: CalendarDays },
  { to: "/dashboard/accommodations", label: "Accommodations", icon: BedDouble },
  { to: "/dashboard/bookings", label: "Bookings", icon: Ticket },
  { to: "/dashboard/reports", label: "Reports", icon: BarChart3 },
]

export function DashboardLayout() {
  const logout = useLogout()
  const { session, role } = useAuth()
  const admin = isAdmin(role)
  return (
    <div className="min-h-screen bg-muted/40">
      <Header />
      <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row gap-6">
        <aside className="md:w-60 shrink-0 md:sticky md:top-20 self-start">
          <nav className="flex md:flex-col gap-1 overflow-x-auto rounded-2xl border bg-card p-3 shadow-sm">
            <div className="hidden md:flex items-center gap-2.5 px-2 pt-1 pb-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-600 shadow-sm">
                <Ship className="h-4 w-4 text-white" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-bold">{admin ? "Admin" : "Operations"}</p>
                <p className="text-[11px] text-muted-foreground">{admin ? "Control center" : "Daily ops"}</p>
              </div>
            </div>
            <p className="hidden md:block px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Manage
            </p>
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                    isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )
                }
              >
                <l.icon className="h-4 w-4 shrink-0" />
                {l.label}
              </NavLink>
            ))}
            <div className="hidden md:block mt-2 rounded-xl bg-muted p-3">
              <p className="truncate text-xs text-muted-foreground">{session?.user?.email ?? "Signed in"}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <Badge variant="secondary" className="text-[11px]">
                  {admin ? "Admin" : "Staff"}
                </Badge>
                <button
                  onClick={logout}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Logout
                </button>
              </div>
            </div>
            <button
              onClick={logout}
              className="md:hidden flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Logout
            </button>
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
