import { describe, expect, it } from "vitest"
import {
  buildSteelEmbedUrl,
  describeExecutionState,
  formatSessionDuration,
  isActiveRunStatus,
  sortTimelineEvents,
} from "./run-report"
import { buildScoreSummary } from "./scoring"

describe("run report helpers", () => {
  it("recognizes active run statuses", () => {
    expect(isActiveRunStatus("queued")).toBe(true)
    expect(isActiveRunStatus("running")).toBe(true)
    expect(isActiveRunStatus("cancelled")).toBe(false)
  })

  it("builds the Steel embed URL with the expected viewer params", () => {
    expect(buildSteelEmbedUrl("https://app.steel.dev/sessions/123")).toBe(
      "https://app.steel.dev/sessions/123?interactive=false&showControls=false",
    )
    expect(buildSteelEmbedUrl("https://app.steel.dev/sessions/123?foo=bar")).toBe(
      "https://app.steel.dev/sessions/123?foo=bar&interactive=false&showControls=false",
    )
  })

  it("sorts timeline events in ascending order", () => {
    expect(
      sortTimelineEvents([
        { createdAt: 30 },
        { createdAt: 10 },
        { createdAt: 20 },
      ]),
    ).toEqual([{ createdAt: 10 }, { createdAt: 20 }, { createdAt: 30 }])
  })

  it("supports partial scoring for cancelled runs", () => {
    expect(
      buildScoreSummary({
        findings: [{ source: "browser", score: 35 }],
        performanceAudits: 0,
        screenshots: 2,
      }).overall,
    ).toBe(65)
  })

  it("describes worker execution states explicitly", () => {
    expect(describeExecutionState("queued")).toBe("queued")
    expect(describeExecutionState("waiting_for_worker")).toBe("waiting")
    expect(describeExecutionState("worker_unreachable")).toBe("worker_unreachable")
  })

  it("formats derived session durations for archived reports", () => {
    expect(formatSessionDuration(null)).toBe("Less than a second")
    expect(formatSessionDuration(45_000)).toBe("45s")
    expect(formatSessionDuration(120_000)).toBe("2m")
    expect(formatSessionDuration(125_000)).toBe("2m 5s")
  })
})
