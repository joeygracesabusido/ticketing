// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { isAdmin } from "./roles"

describe("isAdmin", () => {
  it("returns true only for admin", () => {
    expect(isAdmin("admin")).toBe(true)
    expect(isAdmin("manager")).toBe(false)
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})
