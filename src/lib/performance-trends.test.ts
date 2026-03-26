import { describe, expect, it } from "vitest"
import { buildAuditTrend } from "./performance-trends"

describe("performance trends", () => {
  it("compares the start page audit against the previous run", () => {
    expect(
      buildAuditTrend({
        runUrl: "https://example.com",
        currentAudits: [
          {
            pageUrl: "https://example.com",
            performanceScore: 0.75,
            accessibilityScore: 0.9,
            bestPracticesScore: 0.8,
            seoScore: 0.7,
          },
        ],
        previousAudits: [
          {
            pageUrl: "https://example.com",
            performanceScore: 0.7,
            accessibilityScore: 0.84,
            bestPracticesScore: 0.76,
            seoScore: 0.66,
          },
        ],
      }),
    ).toEqual({
      performance: { current: 0.75, previous: 0.7, delta: 5 },
      accessibility: { current: 0.9, previous: 0.84, delta: 6 },
      bestPractices: { current: 0.8, previous: 0.76, delta: 4 },
      seo: { current: 0.7, previous: 0.66, delta: 4 },
    })
  })

  it("falls back to average scores when the start page audit is missing", () => {
    expect(
      buildAuditTrend({
        runUrl: "https://example.com",
        currentAudits: [
          {
            pageUrl: "https://example.com/docs",
            performanceScore: 0.6,
            accessibilityScore: 0.7,
            bestPracticesScore: 0.8,
            seoScore: 0.9,
          },
          {
            pageUrl: "https://example.com/pricing",
            performanceScore: 0.8,
            accessibilityScore: 0.9,
            bestPracticesScore: 0.7,
            seoScore: 0.8,
          },
        ],
        previousAudits: [
          {
            pageUrl: "https://example.com/docs",
            performanceScore: 0.5,
            accessibilityScore: 0.8,
            bestPracticesScore: 0.7,
            seoScore: 0.7,
          },
          {
            pageUrl: "https://example.com/pricing",
            performanceScore: 0.7,
            accessibilityScore: 0.7,
            bestPracticesScore: 0.6,
            seoScore: 0.6,
          },
        ],
      }),
    ).toEqual({
      performance: { current: 0.7, previous: 0.6, delta: 10 },
      accessibility: { current: 0.8, previous: 0.75, delta: 5 },
      bestPractices: { current: 0.75, previous: 0.65, delta: 10 },
      seo: { current: 0.85, previous: 0.65, delta: 20 },
    })
  })

  it("returns null deltas when no previous run exists", () => {
    expect(
      buildAuditTrend({
        runUrl: "https://example.com",
        currentAudits: [
          {
            pageUrl: "https://example.com",
            performanceScore: 0.82,
            accessibilityScore: 0.88,
            bestPracticesScore: 0.9,
            seoScore: 0.79,
          },
        ],
        previousAudits: [],
      }),
    ).toEqual({
      performance: { current: 0.82, previous: null, delta: null },
      accessibility: { current: 0.88, previous: null, delta: null },
      bestPractices: { current: 0.9, previous: null, delta: null },
      seo: { current: 0.79, previous: null, delta: null },
    })
  })
})
