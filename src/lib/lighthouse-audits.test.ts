import { describe, expect, it } from "vitest"
import {
  buildLighthouseFinding,
  scoreLighthouseFinding,
  severityFromCategoryScore,
} from "./lighthouse-audits"

describe("lighthouse audits", () => {
  it("maps category scores to severity thresholds", () => {
    expect(severityFromCategoryScore(0.92)).toBeNull()
    expect(severityFromCategoryScore(0.85)).toBe("low")
    expect(severityFromCategoryScore(0.7)).toBe("medium")
    expect(severityFromCategoryScore(0.5)).toBe("high")
    expect(severityFromCategoryScore(0.3)).toBe("critical")
  })

  it("creates scored perf findings for poor category scores", () => {
    expect(
      scoreLighthouseFinding({
        category: "performance",
        isStartPage: true,
        pageUrl: "https://example.com",
        score: 0.5,
      }),
    ).toMatchObject({
      title: "Performance score is 50/100",
      severity: "high",
      score: 61.75,
    })
  })

  it("skips healthy category scores", () => {
    expect(
      buildLighthouseFinding({
        category: "seo",
        isStartPage: false,
        pageUrl: "https://example.com/docs",
        score: 0.95,
      }),
    ).toBeNull()
  })
})
