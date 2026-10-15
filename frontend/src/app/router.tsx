import { createBrowserRouter } from "react-router-dom"
import Home from "@/pages/Home"
import Trips from "@/pages/Trips"
import TripDetails from "@/pages/TripDetails"
import Login from "@/pages/Login"
import Register from "@/pages/Register"
import RequireAdmin from "@/components/auth/RequireAdmin"
import DashboardLayout from "@/app/DashboardLayout"
import Overview from "@/pages/dashboard/Overview"
import PortsAdmin from "@/pages/dashboard/Ports"
import VesselsAdmin from "@/pages/dashboard/Vessels"
import RoutesAdmin from "@/pages/dashboard/Routes"
import TripsAdmin from "@/pages/dashboard/Trips"
import AccommodationsAdmin from "@/pages/dashboard/Accommodations"
import BookingsAdmin from "@/pages/dashboard/Bookings"
import UsersAdmin from "@/pages/dashboard/Users"
import Reports from "@/pages/dashboard/Reports"
import MyBookings from "@/pages/MyBookings"

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/trips", element: <Trips /> },
  { path: "/trips/:id", element: <TripDetails /> },
  { path: "/bookings", element: <MyBookings /> },
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
  {
    path: "/dashboard",
    element: <RequireAdmin />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Overview /> },
          { path: "ports", element: <PortsAdmin /> },
          { path: "vessels", element: <VesselsAdmin /> },
          { path: "routes", element: <RoutesAdmin /> },
          { path: "trips", element: <TripsAdmin /> },
          { path: "accommodations", element: <AccommodationsAdmin /> },
          { path: "bookings", element: <BookingsAdmin /> },
          { path: "users", element: <UsersAdmin /> },
          { path: "reports", element: <Reports /> },
        ],
      },
    ],
  },
])
