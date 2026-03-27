import { describe, expect, it } from "vitest"
import { pickQaFallbackAction } from "./qa-fallback"

describe("pickQaFallbackAction", () => {
  it("prefers an unvisited high-signal same-host link", () => {
    expect(
      pickQaFallbackAction({
        currentUrl: "https://example.com",
        interactives: [
          { href: "/blog", label: "Blog", tagName: "a" },
          { href: "/pricing", label: "Pricing", tagName: "a" },
        ],
        maxPages: 12,
        startUrl: "https://example.com",
        visitedPages: ["https://example.com"],
      }),
    ).toEqual({
      kind: "navigate",
      reason:
        "The planner did not choose a tool, so the run is following the next high-signal public path: Pricing.",
      targetLabel: "Pricing",
      url: "https://example.com/pricing",
    })
  })

  it("falls back to a screenshot when no fresh same-host links remain", () => {
    expect(
      pickQaFallbackAction({
        currentUrl: "https://example.com",
        interactives: [
          { href: "https://other.com/docs", label: "Docs", tagName: "a" },
          { href: "/pricing", label: "Pricing", tagName: "a" },
        ],
        maxPages: 12,
        startUrl: "https://example.com",
        visitedPages: ["https://example.com", "https://example.com/pricing"],
      }),
    ).toEqual({
      kind: "screenshot",
      reason:
        "The planner did not choose a tool and no fresh high-signal links were available, so the run captured the current state and continued.",
    })
  })
})
