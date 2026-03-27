import { describe, expect, it } from "vitest"
import { prepareCreateRunPayload } from "./run-request"

describe("prepareCreateRunPayload", () => {
  it("creates an explore run when the prompt contains only a URL", () => {
    expect(
      prepareCreateRunPayload({
        prompt: "https://example.com",
      }),
    ).toEqual({
      url: "https://example.com/",
      mode: "explore",
      browserProvider: "steel",
      credentialNamespace: undefined,
      instructions: undefined,
    })
  })

  it("extracts instructions around the first absolute URL", () => {
    expect(
      prepareCreateRunPayload({
        prompt: "Open this site https://shop.example.com/search and search for headphones",
        credentialNamespace: " Store Admin ",
      }),
    ).toEqual({
      url: "https://shop.example.com/search",
      mode: "task",
      browserProvider: "steel",
      credentialNamespace: "Store Admin",
      instructions: "Open this site and search for headphones",
    })
  })

  it("supports local Chrome runs", () => {
    expect(
      prepareCreateRunPayload({
        prompt: "https://example.com",
        browserProvider: "local_chrome",
      }),
    ).toEqual({
      url: "https://example.com/",
      mode: "explore",
      browserProvider: "local_chrome",
      credentialNamespace: undefined,
      instructions: undefined,
    })
  })

  it("rejects prompts without an absolute URL", () => {
    expect(() =>
      prepareCreateRunPayload({
        prompt: "search for headphones on my task app",
      }),
    ).toThrowError("Enter a full URL starting with http:// or https://.")
  })
})
