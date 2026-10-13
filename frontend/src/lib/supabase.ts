import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// No live client without env (dev still boots on fallback data)
export const supabase = url && anonKey ? createClient(url, anonKey) : null
