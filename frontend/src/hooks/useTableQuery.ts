import * as React from "react"
import { useLocation, useNavigate } from "react-router-dom"

// Keeps table filters in the URL so they survive navigation back to a page.
export function useTableQuery() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = React.useMemo(() => new URLSearchParams(location.search), [location.search])
  const searchRef = React.useRef(location.search)
  searchRef.current = location.search

  const get = React.useCallback(
    (key: string, fallback = "") => params.get(key) ?? fallback,
    [params]
  )

  const update = React.useCallback(
    (next: Record<string, string | number | null | undefined>) => {
      const merged = new URLSearchParams(searchRef.current)
      for (const [key, value] of Object.entries(next)) {
        if (value == null || value === "") merged.delete(key)
        else merged.set(key, String(value))
      }
      const query = merged.toString()
      navigate({ search: query ? `?${query}` : "" }, { replace: true })
    },
    [navigate]
  )

  return { get, update }
}
