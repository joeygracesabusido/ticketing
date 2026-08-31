import { createBrowserRouter } from "react-router-dom"
import Home from "@/pages/Home"
import Trips from "@/pages/Trips"
import TripDetails from "@/pages/TripDetails"
import Login from "@/pages/Login"
import Register from "@/pages/Register"

export const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/trips", element: <Trips /> },
  { path: "/trips/:id", element: <TripDetails /> },
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
])
