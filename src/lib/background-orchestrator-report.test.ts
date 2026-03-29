import { describe, expect, it } from "vitest"
import {
  dedupeMergedFindings,
  deriveBackgroundOrchestratorStatus,
  getAgentDurationMs,
  getMergedFindingKey,
  getOrchestratorDurationMs,
  isBackgroundOrchestratorActive,
  isBackgroundOrchestratorReportReady,
} from "./background-orchestrator-report"

describe("background orchestrator report helpers", () => {
  it("derives a queued orchestrator status", () => {
    expect(deriveBackgroundOrchestratorStatus(["queued", "queued"])).toBe("queued")
  })

  it("derives a running orchestrator status for mixed progress", () => {
    expect(deriveBackgroundOrchestratorStatus(["queued", "running", "completed"])).toBe(
      "running",
    )
  })

  it("derives a failed orchestrator status when any terminal lane fails", () => {
    expect(deriveBackgroundOrchestratorStatus(["completed", "failed"])).toBe("failed")
  })

  it("derives a cancelled orchestrator status when every lane is cancelled", () => {
    expect(deriveBackgroundOrchestratorStatus(["cancelled", "cancelled"])).toBe("cancelled")
  })

  it("marks report availability only after the orchestrator becomes terminal", () => {
    expect(isBackgroundOrchestratorActive("queued")).toBe(true)
    expect(isBackgroundOrchestratorActive("running")).toBe(true)
    expect(isBackgroundOrchestratorReportReady("completed")).toBe(true)
    expect(isBackgroundOrchestratorReportReady("failed")).toBe(true)
    expect(isBackgroundOrchestratorReportReady("cancelled")).toBe(true)
    expect(isBackgroundOrchestratorReportReady("running")).toBe(false)
  })

  it("dedupes merged findings by normalized signature", () => {
    const deduped = dedupeMergedFindings([
      {
        browserSignal: "console",
        pageOrFlow: "https://app.example.com/dashboard",
        score: 10,
        source: "browser",
        title: "Console error",
      },
      {
        browserSignal: "console",
        pageOrFlow: "https://app.example.com/dashboard",
        score: 30,
        source: "browser",
        title: " console error ",
      },
    ])

    expect(deduped).toHaveLength(1)
    expect(deduped[0]?.score).toBe(30)
  })

  it("computes agent and orchestrator durations", () => {
    expect(getAgentDurationMs({ finishedAt: 25_000, startedAt: 10_000 })).toBe(15_000)
    expect(
      getOrchestratorDurationMs([
        { finishedAt: 35_000, startedAt: 10_000 },
        { finishedAt: 50_000, startedAt: 20_000 },
      ]),
    ).toBe(40_000)
  })

  it("builds a stable merged finding key", () => {
    expect(
      getMergedFindingKey({
        browserSignal: "pageerror",
        pageOrFlow: "https://app.example.com/orders",
        source: "browser",
        title: "Unhandled error",
      }),
    ).toBe("browser::pageerror::unhandled error::https://app.example.com/orders")
  })
})
