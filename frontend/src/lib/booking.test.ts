import { describe, expect, it } from "vitest"
import { buildPassengerNames, missingPassengerIndex } from "./booking"

describe("buildPassengerNames", () => {
  it("returns null for single pax (legacy server behavior)", () => {
    expect(buildPassengerNames("Juan Cruz", 1, [])).toBeNull()
  })
  it("combines booker + extras, trims, pads to pax", () => {
    expect(buildPassengerNames("Juan Cruz", 3, [" Maria ", "Jose"])).toEqual(["Juan Cruz", "Maria", "Jose"])
    expect(buildPassengerNames("Juan", 3, ["Maria"])).toEqual(["Juan", "Maria", ""])
    expect(buildPassengerNames("Juan", 2, ["A", "B", "C"])).toEqual(["Juan", "A"])
  })
})

describe("missingPassengerIndex", () => {
  it("finds first short name or -1", () => {
    expect(missingPassengerIndex(null)).toBe(-1)
    expect(missingPassengerIndex(["Juan", "Maria"])).toBe(-1)
    expect(missingPassengerIndex(["Juan", " ", "Jose"])).toBe(1)
  })
})
