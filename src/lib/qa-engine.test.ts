import { describe, expect, it } from "vitest"
import {
  getClickSafetyDecision,
  inferTaskOutcome,
  parseGoalOutcome,
  selectAuditUrls,
} from "./qa-engine"

describe("qa engine helpers", () => {
  it("parses explicit task outcomes", () => {
    expect(parseGoalOutcome("TASK_COMPLETE: Added the product to cart.")).toEqual({
      status: "completed",
      summary: "Added the product to cart.",
    })
    expect(parseGoalOutcome("TASK_BLOCKED: Login wall stopped progress.")).toEqual({
      status: "blocked",
      summary: "Login wall stopped progress.",
    })
    expect(parseGoalOutcome("Not a task outcome")).toBeNull()
  })

  it("infers blocked vs partial task results conservatively", () => {
    expect(
      inferTaskOutcome({
        actionCount: 0,
        instructions: "Create a task",
        stopReason: "planner_unavailable",
        visitedPageCount: 1,
      }),
    ).toEqual({
      status: "blocked",
      summary: "Task: Create a task. The agent could not make reliable progress before the run ended.",
    })

    expect(
      inferTaskOutcome({
        actionCount: 4,
        instructions: "Create a task",
        stopReason: "max_steps",
        visitedPageCount: 3,
      }),
    ).toEqual({
      status: "partially_completed",
      summary:
        "Task: Create a task. The agent explored 3 pages and executed 4 actions before the time budget ended.",
    })
  })

  it("blocks destructive click targets", () => {
    expect(
      getClickSafetyDecision({
        id: 1,
        label: "Delete account",
        ref: "#delete",
        tagName: "button",
      }),
    ).toEqual({
      allowed: false,
      reason: "Skipped Delete account because it looks destructive or irreversible.",
    })
  })

  it("prioritizes the most interesting pages for audits", () => {
    const urls = selectAuditUrls({
      maxAuditUrls: 3,
      pageCandidates: new Map([
        [
          "https://app.example.com/",
          { url: "https://app.example.com/", findingCount: 0, firstSeenAt: 0, interactionCount: 0 },
        ],
        [
          "https://app.example.com/tasks",
          { url: "https://app.example.com/tasks", findingCount: 2, firstSeenAt: 1, interactionCount: 4 },
        ],
        [
          "https://app.example.com/settings",
          { url: "https://app.example.com/settings", findingCount: 1, firstSeenAt: 2, interactionCount: 2 },
        ],
        [
          "https://app.example.com/help",
          { url: "https://app.example.com/help", findingCount: 0, firstSeenAt: 3, interactionCount: 5 },
        ],
      ]),
      startUrl: "https://app.example.com/",
    })

    expect(urls).toEqual([
      "https://app.example.com/",
      "https://app.example.com/tasks",
      "https://app.example.com/settings",
    ])
  })
})
