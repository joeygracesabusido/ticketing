import * as React from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import type { Role } from "@/lib/roles"

export type AuthState = {
  session: Session | null
  role: Role | null
  isActive: boolean
  loading: boolean
}

export function useAuth(): AuthState {
  const [session, setSession] = React.useState<Session | null>(null)
  const [role, setRole] = React.useState<Role | null>(null)
  const [isActive, setIsActive] = React.useState(true)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function load(s: Session | null) {
      try {
        if (cancelled) return
        setSession(s)
        if (!s?.user) {
          setRole(null)
          setIsActive(true)
          setLoading(false)
          return
        }
        const { data } = await supabase!.from("profiles").select("role, is_active").eq("id", s.user.id).single()
        if (cancelled) return
        const active = (data as any)?.is_active !== false
        setIsActive(active)
        // Inactive accounts lose their effective role so guards deny access.
        setRole(active ? ((data as any)?.role as Role) ?? null : null)
        setLoading(false)
      } finally {
        setLoading(false)
      }
    }
    supabase.auth
      .getSession()
      .then(({ data }) => load(data.session))
      .catch(() => setLoading(false))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      load(s).catch(() => setLoading(false))
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return { session, role, isActive, loading }
}
