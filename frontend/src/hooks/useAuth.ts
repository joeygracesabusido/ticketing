import * as React from "react"
import type { Session } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import type { Role } from "@/lib/roles"

export type AuthState = {
  session: Session | null
  role: Role | null
  loading: boolean
}

export function useAuth(): AuthState {
  const [session, setSession] = React.useState<Session | null>(null)
  const [role, setRole] = React.useState<Role | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function load(s: Session | null) {
      if (cancelled) return
      setSession(s)
      if (!s?.user) {
        setRole(null)
        setLoading(false)
        return
      }
      const { data } = await supabase!.from("profiles").select("role").eq("id", s.user.id).single()
      if (cancelled) return
      setRole((data?.role as Role) ?? null)
      setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => load(s))
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return { session, role, loading }
}
