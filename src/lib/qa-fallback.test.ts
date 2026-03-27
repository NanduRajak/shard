import { describe, expect, it } from "vitest"
import { pickQaFallbackAction } from "./qa-fallback"

describe("pickQaFallbackAction", () => {
  it("prefers a reversible same-host link action when coverage is available", () => {
    expect(
      pickQaFallbackAction({
        currentUrl: "https://example.com",
        interactives: [
          { href: "/blog", id: 1, label: "Blog", tagName: "a" },
          { href: "/pricing", id: 2, label: "Pricing", tagName: "a" },
        ],
        maxPages: 12,
        startUrl: "https://example.com",
        triedActions: [],
        visitedPages: ["https://example.com"],
      }),
    ).toEqual({
      kind: "click",
      id: 2,
      reason:
        "The planner did not choose a tool, so the run is exercising a reversible visible control on the current page.",
      targetLabel: "Pricing",
    })
  })

  it("falls back to navigation when the page action was already tried", () => {
    expect(
      pickQaFallbackAction({
        currentUrl: "https://example.com",
        interactives: [{ href: "/pricing", id: 2, label: "Pricing", tagName: "a" }],
        maxPages: 12,
        startUrl: "https://example.com",
        triedActions: ["click::https://example.com::2"],
        visitedPages: ["https://example.com"],
      }),
    ).toEqual({
      kind: "navigate",
      reason:
        "The planner did not choose a tool, so the run is following the next useful same-host path: Pricing.",
      targetLabel: "Pricing",
      url: "https://example.com/pricing",
    })
  })

  it("prefers safe coverage clicks before leaving the page", () => {
    expect(
      pickQaFallbackAction({
        currentUrl: "https://shop.example.com",
        interactives: [
          { id: 1, label: "Add to cart", tagName: "button" },
          { href: "/pricing", id: 2, label: "Pricing", tagName: "a" },
        ],
        maxPages: 12,
        startUrl: "https://shop.example.com",
        triedActions: [],
        visitedPages: ["https://shop.example.com"],
      }),
    ).toEqual({
      kind: "click",
      id: 1,
      reason:
        "The planner did not choose a tool, so the run is exercising a reversible visible control on the current page.",
      targetLabel: "Add to cart",
    })
  })

  it("blocks destructive controls from fallback exploration", () => {
    expect(
      pickQaFallbackAction({
        currentUrl: "https://example.com/settings",
        interactives: [{ id: 1, label: "Delete project", tagName: "button" }],
        maxPages: 12,
        startUrl: "https://example.com",
        triedActions: [],
        visitedPages: ["https://example.com/settings"],
      }),
    ).toEqual({
      kind: "screenshot",
      reason:
        "The planner did not choose a tool and no fresh reversible actions remained, so the run captured the current state and continued.",
    })
  })

  it("falls back to a screenshot when no fresh reversible actions remain", () => {
    expect(
      pickQaFallbackAction({
        currentUrl: "https://example.com",
        interactives: [
          { href: "https://other.com/docs", id: 1, label: "Docs", tagName: "a" },
          { href: "/pricing", id: 2, label: "Pricing", tagName: "a" },
        ],
        maxPages: 12,
        startUrl: "https://example.com",
        triedActions: [],
        visitedPages: ["https://example.com", "https://example.com/pricing"],
      }),
    ).toEqual({
      kind: "screenshot",
      reason:
        "The planner did not choose a tool and no fresh reversible actions remained, so the run captured the current state and continued.",
    })
  })
})
