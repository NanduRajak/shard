import { describe, expect, it } from "vitest"
import { prepareCreateBackgroundBatchPayload } from "./background-run-request"

describe("prepareCreateBackgroundBatchPayload", () => {
  it("expands a single assignment with multiple agents", () => {
    expect(
      prepareCreateBackgroundBatchPayload({
        assignments: [
          {
            agentCount: 3,
            goal: "Explore checkout safely",
            siteUrl: "https://shop.example.com",
          },
        ],
      }),
    ).toEqual({
      assignments: [
        {
          agentCount: 3,
          credentialProfileId: undefined,
          instructions: "Explore checkout safely",
          url: "https://shop.example.com/",
        },
      ],
      title: "Background batch · 1 assignment",
    })
  })

  it("supports multiple rows with optional credentials", () => {
    expect(
      prepareCreateBackgroundBatchPayload(
        {
          assignments: [
            {
              agentCount: 2,
              credentialProfileId: "cred_1",
              goal: "Review the admin dashboard",
              siteUrl: "https://admin.example.com/login",
            },
            {
              agentCount: 1,
              siteUrl: "https://marketing.example.com",
            },
          ],
        },
        {
          credentialProfiles: [
            {
              _id: "cred_1",
              origin: "https://admin.example.com",
            },
          ],
        },
      ),
    ).toEqual({
      assignments: [
        {
          agentCount: 2,
          credentialProfileId: "cred_1",
          instructions: "Review the admin dashboard",
          url: "https://admin.example.com/login",
        },
        {
          agentCount: 1,
          credentialProfileId: undefined,
          instructions: undefined,
          url: "https://marketing.example.com/",
        },
      ],
      title: "Background batch · 2 assignments",
    })
  })

  it("rejects invalid URLs", () => {
    expect(() =>
      prepareCreateBackgroundBatchPayload({
        assignments: [
          {
            agentCount: 1,
            siteUrl: "app.example.com",
          },
        ],
      }),
    ).toThrowError("Every background assignment needs a full http:// or https:// URL.")
  })

  it("rejects mismatched credential origins", () => {
    expect(() =>
      prepareCreateBackgroundBatchPayload(
        {
          assignments: [
            {
              agentCount: 1,
              credentialProfileId: "cred_1",
              siteUrl: "https://app.example.com",
            },
          ],
        },
        {
          credentialProfiles: [
            {
              _id: "cred_1",
              origin: "https://admin.example.com",
            },
          ],
        },
      ),
    ).toThrowError("A selected credential profile does not match the assignment website.")
  })
})
