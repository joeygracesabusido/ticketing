// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { role: "admin" } }) }) }),
    }),
  },
}))

import { useAuth } from "./useAuth"

describe("useAuth", () => {
  it("returns session and admin role", async () => {
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.role).toBe("admin")
    expect(result.current.session?.user?.id).toBe("u1")
  })
})
