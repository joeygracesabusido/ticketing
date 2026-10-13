import { NavLink, Outlet } from "react-router-dom"
import { LayoutDashboard, Anchor, Ship, Route as RouteIcon, CalendarDays, LogOut } from "lucide-react"
import { Header } from "@/components/layout/Header"
import { Button } from "@/components/ui/button"
import { useLogout } from "@/hooks/useLogout"
import { cn } from "@/lib/utils"

const links = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/dashboard/ports", label: "Ports", icon: Anchor },
  { to: "/dashboard/vessels", label: "Vessels", icon: Ship },
  { to: "/dashboard/routes", label: "Routes", icon: RouteIcon },
  { to: "/dashboard/trips", label: "Trips", icon: CalendarDays },
]

export function DashboardLayout() {
  const logout = useLogout()
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row gap-6">
        <aside className="md:w-52 shrink-0">
          <nav className="flex md:flex-col gap-1 overflow-x-auto rounded-lg border bg-card p-2">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap",
                    isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  )
                }
              >
                <l.icon className="h-4 w-4" />
                {l.label}
              </NavLink>
            ))}
            <Button variant="ghost" size="sm" onClick={logout} className="justify-start gap-2 md:mt-2">
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
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
