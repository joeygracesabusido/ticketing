// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { computeFare, remainingBalance, toCentavos } from "./fare"

describe("computeFare (12% VAT-inclusive)", () => {
  it("splits 1200x1 into net 1071.43 + vat 128.57", () => {
    const f = computeFare({ farePerPax: 1200, pax: 1 })
    expect(f.total).toBe(1200)
    expect(f.net).toBe(1071.43)
    expect(f.vat).toBe(128.57)
    expect(f.totalCentavos).toBe(120000)
  })

  it("multiplies by pax without float drift", () => {
    const f = computeFare({ farePerPax: 950, pax: 3 })
    expect(f.total).toBe(2850)
    expect(toCentavos(f.net) + toCentavos(f.vat)).toBe(toCentavos(f.total))
  })

  it("applies discount before VAT split", () => {
    const f = computeFare({ farePerPax: 1200, pax: 1, discountTotal: 240 })
    expect(f.total).toBe(960)
    expect(f.net + f.vat).toBeCloseTo(960, 2)
  })

  it("never goes negative", () => {
    const f = computeFare({ farePerPax: 100, pax: 1, discountTotal: 500 })
    expect(f.total).toBe(0)
    expect(f.vat).toBe(0)
  })
})

describe("remainingBalance", () => {
  it("subtracts paid amounts", () => {
    expect(remainingBalance(1200, 500)).toBe(700)
    expect(remainingBalance(1200, 1200)).toBe(0)
  })
})
