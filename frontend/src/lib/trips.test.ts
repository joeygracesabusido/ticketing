import { describe, expect, it } from "vitest"
import { getDay } from "date-fns"
import { generateDepartures, summarize, tripReference, validateProposals } from "./trips"

const at = (y: number, m: number, d: number, h = 20, min = 0) => new Date(y, m - 1, d, h, min)
const now = at(2026, 10, 20, 0)

function validate(departures: Date[], overrides: Partial<Parameters<typeof validateProposals>[0]> = {}) {
  return validateProposals({
    departures,
    durationMinutes: 720,
    turnaroundMinutes: 60,
    existing: [],
    vesselId: "v1",
    routeId: "r1",
    now,
    ...overrides,
  })
}

describe("generateDepartures", () => {
  it("returns one departure for once, even across a range", () => {
    const rows = generateDepartures({
      startDate: "2026-10-21",
      endDate: "2026-10-25",
      departureTime: "08:00",
      durationMinutes: 720,
      frequency: "once",
      weekdays: [],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].getHours()).toBe(8)
  })

  it("walks an inclusive daily range", () => {
    const rows = generateDepartures({
      startDate: "2026-10-21",
      endDate: "2026-10-23",
      departureTime: "20:00",
      durationMinutes: 720,
      frequency: "daily",
      weekdays: [],
    })
    expect(rows.map((d) => d.getDate())).toEqual([21, 22, 23])
  })

  it("keeps only the start weekday for weekly", () => {
    const rows = generateDepartures({
      startDate: "2026-10-21",
      endDate: "2026-10-31",
      departureTime: "20:00",
      durationMinutes: 720,
      frequency: "weekly",
      weekdays: [],
    })
    expect(rows).toHaveLength(2)
    expect(rows.every((d) => getDay(d) === getDay(at(2026, 10, 21)))).toBe(true)
  })

  it("filters selected weekdays and excludes Sunday", () => {
    const rows = generateDepartures({
      startDate: "2026-10-18",
      endDate: "2026-10-24",
      departureTime: "06:00",
      durationMinutes: 1440,
      frequency: "weekdays",
      weekdays: [1, 2, 3, 4, 5],
    })
    expect(rows.map((d) => d.getDate())).toEqual([19, 20, 21, 22, 23])
  })

  it("rejects invalid time and reversed ranges", () => {
    const base = {
      startDate: "2026-10-21",
      endDate: "2026-10-23",
      departureTime: "20:00",
      durationMinutes: 720,
      frequency: "daily" as const,
      weekdays: [],
    }
    expect(generateDepartures({ ...base, departureTime: "24:00" })).toEqual([])
    expect(generateDepartures({ ...base, endDate: "2026-10-20" })).toEqual([])
  })
})

describe("validateProposals", () => {
  it("marks a clean future departure ready", () => {
    const [row] = validate([at(2026, 10, 21)])
    expect(row.severity).toBe("ok")
    expect(row.reasons).toEqual([])
  })

  it("blocks departures in the past", () => {
    const [row] = validate([at(2026, 10, 19)])
    expect(row.severity).toBe("error")
    expect(row.reasons).toContain("Departure is in the past")
  })

  it("blocks a duplicate for the same vessel and ignores cancelled trips", () => {
    const existing = [
      { vessel_id: "v1", route_id: "r1", departure_at: at(2026, 10, 21).toISOString(), arrival_at: at(2026, 10, 22, 8).toISOString(), status: "scheduled" },
    ]
    const [row] = validate([at(2026, 10, 21)], { existing })
    expect(row.severity).toBe("error")
    expect(row.reasons.join(" ")).toContain("Duplicate")

    const [cancelled] = validate([at(2026, 10, 21)], {
      existing: [{ ...existing[0], status: "cancelled" }],
    })
    expect(cancelled.severity).toBe("ok")
  })

  it("blocks an overlapping trip for the same vessel", () => {
    const existing = [
      { vessel_id: "v1", route_id: "r1", departure_at: at(2026, 10, 21).toISOString(), arrival_at: at(2026, 10, 22, 8).toISOString(), status: "scheduled" },
    ]
    const [row] = validate([at(2026, 10, 21, 23)], { existing })
    expect(row.severity).toBe("error")
    expect(row.reasons.join(" ")).toContain("Vessel conflict")
  })

  it("warns on a tight turnaround and on a same-route competitor", () => {
    const existing = [
      { vessel_id: "v1", route_id: "r1", departure_at: at(2026, 10, 20).toISOString(), arrival_at: at(2026, 10, 21, 8).toISOString(), status: "scheduled" },
      { vessel_id: "v2", route_id: "r1", departure_at: at(2026, 10, 21, 8).toISOString(), arrival_at: at(2026, 10, 22, 8).toISOString(), status: "scheduled" },
    ]
    const [row] = validate([at(2026, 10, 21, 8)], { existing })
    expect(row.severity).toBe("warning")
    expect(row.reasons.join(" ")).toContain("turnaround")
    expect(row.reasons.join(" ")).toContain("Another vessel")
  })

  it("blocks generated departures that overlap each other", () => {
    const rows = validate([at(2026, 10, 21), at(2026, 10, 22)], { durationMinutes: 1800 })
    expect(rows.every((r) => r.severity === "error")).toBe(true)
    expect(rows[0].reasons.join(" ")).toContain("Overlaps another generated departure")
  })

  it("warns when generated departures leave too little turnaround", () => {
    const rows = validate([at(2026, 10, 21), at(2026, 10, 22)], {
      durationMinutes: 1380,
      turnaroundMinutes: 120,
    })
    expect(rows.every((r) => r.severity === "warning")).toBe(true)
    expect(rows[0].reasons.join(" ")).toContain("turnaround")
  })

  it("rejects duplicate timestamps in one batch", () => {
    const [row] = validate([at(2026, 10, 21), at(2026, 10, 21)])
    expect(row.reasons).toContain("Duplicate departure generated in this batch")
  })

  it("blocks inactive vessels and ports", () => {
    const [row] = validate([at(2026, 10, 21)], { vesselActive: false, portsActive: false })
    expect(row.severity).toBe("error")
    expect(row.reasons).toContain("Vessel is not active")
    expect(row.reasons).toContain("Origin or destination port is inactive")
  })
})

describe("summarize and tripReference", () => {
  it("counts severities", () => {
    const rows = validate([at(2026, 10, 19), at(2026, 10, 21), at(2026, 10, 22)], {
      durationMinutes: 1800,
    })
    expect(summarize(rows)).toEqual({ total: 3, valid: 0, warnings: 0, invalid: 3 })
  })

  it("derives a voyage reference from route code and local departure", () => {
    expect(
      tripReference({
        departure_at: at(2026, 10, 14).toISOString(),
        routes: { code: "MNL-CEB", estimated_duration_minutes: 720, origin_port_id: "p1", destination_port_id: "p2" },
      })
    ).toBe("MNL-CEB-20261014-2000")
  })
})
