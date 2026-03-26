import { describe, expect, it } from "vitest"
import {
  buildScoreSummary,
  computeFindingScore,
  computeQualityScore,
  impactWeightForSource,
} from "./scoring"

describe("scoring", () => {
  it("computes a finding score from severity, confidence, and source impact weight", () => {
    expect(
      computeFindingScore({
        severity: "high",
        confidence: 0.8,
        source: "browser",
      }),
    ).toBe(57.2)
  })

  it("uses the source lookup table for impact weight", () => {
    expect(impactWeightForSource("browser")).toBe(1.1)
    expect(impactWeightForSource("perf")).toBe(1)
  })

  it("clamps the quality score between 0 and 100", () => {
    expect(computeQualityScore(-10)).toBe(100)
    expect(computeQualityScore(10)).toBe(90)
    expect(computeQualityScore(500)).toBe(0)
  })

  it("builds grouped source scores and overall summary", () => {
    expect(
      buildScoreSummary({
        findings: [
          { source: "browser", score: 50 },
          { source: "perf", score: 25 },
        ],
        performanceAudits: 2,
        screenshots: 3,
      }),
    ).toEqual({
      overall: 25,
      bySource: {
        browser: 50,
        perf: 75,
      },
      counts: {
        findings: 2,
        performanceAudits: 2,
        screenshots: 3,
      },
    })
  })
})
