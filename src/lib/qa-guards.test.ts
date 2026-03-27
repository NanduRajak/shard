import { describe, expect, it } from "vitest"
import {
  buildActionSignature,
  isSameHostname,
  resolveSameHostUrl,
  shouldStopForNoOps,
  shouldStopForRepeatActions,
  wouldExceedPageLimit,
} from "./qa-guards"

describe("qa guards", () => {
  it("allows only same-host navigation", () => {
    expect(isSameHostname("https://example.com", "https://example.com/about")).toBe(
      true,
    )
    expect(isSameHostname("https://example.com", "https://blog.example.com")).toBe(
      false,
    )
    expect(
      resolveSameHostUrl({
        startUrl: "https://example.com",
        currentUrl: "https://example.com/docs",
        nextUrl: "/pricing",
      }),
    ).toBe("https://example.com/pricing")
    expect(
      resolveSameHostUrl({
        startUrl: "https://example.com",
        currentUrl: "https://example.com/docs",
        nextUrl: "https://other.com",
      }),
    ).toBeNull()
  })

  it("stops after repeated actions", () => {
    const action = buildActionSignature({
      action: "click",
      pageUrl: "https://example.com",
      target: "pricing",
    })

    expect(shouldStopForRepeatActions([action])).toBe(false)
    expect(shouldStopForRepeatActions([action, action])).toBe(false)
    expect(shouldStopForRepeatActions([action, action, action])).toBe(true)
  })

  it("stops after repeated no-op steps", () => {
    expect(shouldStopForNoOps(3)).toBe(false)
    expect(shouldStopForNoOps(4)).toBe(true)
  })

  it("blocks discovering a page beyond the configured limit", () => {
    expect(
      wouldExceedPageLimit({
        maxPages: 3,
        nextUrl: "https://example.com/docs",
        visitedPages: new Set([
          "https://example.com",
          "https://example.com/pricing",
          "https://example.com/about",
        ]),
      }),
    ).toBe(true)

    expect(
      wouldExceedPageLimit({
        maxPages: 3,
        nextUrl: "https://example.com/about",
        visitedPages: new Set([
          "https://example.com",
          "https://example.com/pricing",
          "https://example.com/about",
        ]),
      }),
    ).toBe(false)
  })
})
