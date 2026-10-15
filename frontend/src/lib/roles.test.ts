// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { canAccessDashboard, canManageUsers, filterUsers, isAdmin } from "./roles"

describe("isAdmin", () => {
  it("returns true only for admin", () => {
    expect(isAdmin("admin")).toBe(true)
    expect(isAdmin("manager")).toBe(false)
    expect(isAdmin("staff")).toBe(false)
    expect(isAdmin("client")).toBe(false)
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})

describe("canAccessDashboard", () => {
  it("allows internal roles, denies clients and anonymous", () => {
    expect(canAccessDashboard("admin")).toBe(true)
    expect(canAccessDashboard("manager")).toBe(true)
    expect(canAccessDashboard("staff")).toBe(true)
    expect(canAccessDashboard("client")).toBe(false)
    expect(canAccessDashboard(null)).toBe(false)
    expect(canAccessDashboard(undefined)).toBe(false)
  })
})

describe("canManageUsers", () => {
  it("allows only admin (negative authorization)", () => {
    expect(canManageUsers("admin")).toBe(true)
    expect(canManageUsers("manager")).toBe(false)
    expect(canManageUsers("staff")).toBe(false)
    expect(canManageUsers("client")).toBe(false)
    expect(canManageUsers(null)).toBe(false)
  })
})

describe("filterUsers", () => {
  const rows = [
    { email: "juan@example.com", first_name: "Juan", last_name: "Cruz", role: "client", is_active: true },
    { email: "admin@example.com", first_name: "Ada", last_name: "Min", role: "admin", is_active: true },
    { email: "old@example.com", first_name: "Old", last_name: "Staff", role: "staff", is_active: false },
  ]
  it("searches name or email case-insensitively", () => {
    expect(filterUsers(rows, "JUAN", "all", "all")).toHaveLength(1)
    expect(filterUsers(rows, "admin@example", "all", "all")).toHaveLength(1)
    expect(filterUsers(rows, "", "all", "all")).toHaveLength(3)
  })
  it("filters by role and status", () => {
    expect(filterUsers(rows, "", "admin", "all")).toHaveLength(1)
    expect(filterUsers(rows, "", "all", "active")).toHaveLength(2)
    expect(filterUsers(rows, "", "all", "inactive")).toHaveLength(1)
  })
})
