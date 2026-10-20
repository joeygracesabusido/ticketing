import { describe, expect, it } from "vitest"
import {
  clampPage,
  friendlyDbError,
  ilikePattern,
  pageCount,
  pageRange,
  sanitizeSearch,
} from "./adminResources"

describe("adminResources search + pagination helpers", () => {
  it("strips PostgREST filter syntax from user input", () => {
    expect(sanitizeSearch(' 100% (Cebu), "x" ')).toBe("100 Cebu x")
    expect(ilikePattern("MNL")).toBe("%MNL%")
  })

  it("computes inclusive page ranges", () => {
    expect(pageRange(0)).toEqual({ from: 0, to: 9 })
    expect(pageRange(2, 10)).toEqual({ from: 20, to: 29 })
    expect(pageRange(-3, 10)).toEqual({ from: 0, to: 9 })
  })

  it("keeps page counts and clamps out-of-range pages", () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(10)).toBe(1)
    expect(pageCount(11)).toBe(2)
    expect(clampPage(5, 11)).toBe(1)
    expect(clampPage(-1, 11)).toBe(0)
  })

  it("explains duplicate and referenced-record write failures", () => {
    expect(friendlyDbError('duplicate key value violates unique constraint "ports_code_key"', "port")).toBe(
      "A port with this code already exists."
    )
    expect(friendlyDbError("violates foreign key constraint", "route")).toMatch(/still referenced/)
    expect(friendlyDbError("permission denied", "port")).toBe("permission denied")
  })
})
