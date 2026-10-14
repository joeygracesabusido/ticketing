// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { canAccessDashboard, isAdmin } from "./roles"

describe("isAdmin", () => {
  it("returns true only for admin", () => {
    expect(isAdmin("admin")).toBe(true)
    expect(isAdmin("manager")).toBe(false)
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})

describe("canAccessDashboard", () => {
  it("allows admin and manager (staff)", () => {
    expect(canAccessDashboard("admin")).toBe(true)
    expect(canAccessDashboard("manager")).toBe(true)
    expect(canAccessDashboard(null)).toBe(false)
    expect(canAccessDashboard(undefined)).toBe(false)
  })
})
