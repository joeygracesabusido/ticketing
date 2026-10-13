import { NavLink, Outlet } from "react-router-dom"
import { LayoutDashboard, Anchor, Ship, Route as RouteIcon, CalendarDays, LogOut } from "lucide-react"
import { Header } from "@/components/layout/Header"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/hooks/useAuth"
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
  const { session } = useAuth()
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row gap-6">
        <aside className="md:w-60 shrink-0 md:sticky md:top-20 self-start">
          <nav className="flex md:flex-col gap-1 overflow-x-auto rounded-xl bg-slate-950 text-slate-200 p-3 shadow-lg">
            <div className="hidden md:flex items-center gap-2 px-3 pt-1 pb-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Ship className="h-4 w-4 text-primary-foreground" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-bold text-white">Admin</p>
                <p className="text-[11px] text-slate-400">Control center</p>
              </div>
            </div>
            <p className="hidden md:block px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Manage
            </p>
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                    isActive ? "bg-primary text-primary-foreground shadow" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  )
                }
              >
                <l.icon className="h-4 w-4 shrink-0" />
                {l.label}
              </NavLink>
            ))}
            <div className="hidden md:block mt-2 rounded-lg bg-slate-900 p-3">
              <p className="truncate text-xs text-slate-400">{session?.user?.email ?? "Signed in"}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <Badge variant="secondary" className="bg-slate-800 text-slate-200 text-[11px]">
                  Admin
                </Badge>
                <button
                  onClick={logout}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Logout
                </button>
              </div>
            </div>
            <button
              onClick={logout}
              className="md:hidden flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium whitespace-nowrap text-slate-300 hover:bg-slate-800 hover:text-white"
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
