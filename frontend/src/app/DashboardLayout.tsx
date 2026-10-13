import { NavLink, Outlet } from "react-router-dom"
import { Header } from "@/components/layout/Header"
import { cn } from "@/lib/utils"

const links = [
  { to: "/dashboard", label: "Overview", end: true },
  { to: "/dashboard/ports", label: "Ports" },
  { to: "/dashboard/vessels", label: "Vessels" },
  { to: "/dashboard/routes", label: "Routes" },
  { to: "/dashboard/trips", label: "Trips" },
]

export function DashboardLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row gap-6">
        <aside className="md:w-52 shrink-0">
          <nav className="flex md:flex-col gap-1 overflow-x-auto">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap",
                    isActive ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
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
