import { describe, expect, it } from "vitest"
import { prepareCreateBackgroundBatchPayload } from "./background-run-request"

describe("prepareCreateBackgroundBatchPayload", () => {
  it("turns a blank task into the default QA brief", () => {
    expect(
      prepareCreateBackgroundBatchPayload({
        assignments: [
          {
            siteUrl: "https://shop.example.com",
          },
        ],
      }),
    ).toEqual({
      assignments: [
        {
          credentialId: undefined,
          instructions:
            "Run a focused end-to-end QA audit for this website. If a stored credential is available, use it when login is required. Exercise the primary user journeys and core navigation safely. Capture important functional issues, browser issues, and helpful artifacts such as screenshots or trace output. Avoid destructive actions, final purchases, account deletion, or irreversible submissions.",
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
              credentialId: "cred_1",
              siteUrl: "https://admin.example.com/login",
              task: "Review the admin dashboard",
            },
            {
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
          credentialId: "cred_1",
          instructions: "Review the admin dashboard",
          url: "https://admin.example.com/login",
        },
        {
          credentialId: undefined,
          instructions:
            "Run a focused end-to-end QA audit for this website. If a stored credential is available, use it when login is required. Exercise the primary user journeys and core navigation safely. Capture important functional issues, browser issues, and helpful artifacts such as screenshots or trace output. Avoid destructive actions, final purchases, account deletion, or irreversible submissions.",
          url: "https://marketing.example.com/",
        },
      ],
      title: "Background batch · 2 assignments",
    })
  })

  it("expands a site-first batch into auto-sharded assignments", () => {
    const result = prepareCreateBackgroundBatchPayload(
      {
        siteBatch: {
          agentCount: 3,
          siteUrl: "https://shop.example.com",
          task: "Add a Sony headset to cart and validate the cart flow",
        },
      },
      {
        credentialProfiles: [],
      },
    )

    expect(result.title).toBe("Background batch · 3 assignments")
    expect(result.assignments).toHaveLength(3)
    expect(result.assignments.map((assignment) => assignment.url)).toEqual([
      "https://shop.example.com/",
      "https://shop.example.com/",
      "https://shop.example.com/",
    ])
    expect(result.assignments[0]?.instructions).toContain("Coverage lane 1 of 3")
    expect(result.assignments[1]?.instructions).toContain("Coverage lane 2 of 3")
    expect(result.assignments[2]?.instructions).toContain("Coverage lane 3 of 3")
  })

  it("rejects invalid URLs", () => {
    expect(() =>
      prepareCreateBackgroundBatchPayload({
        assignments: [
          {
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
              credentialId: "cred_1",
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
    ).toThrowError("A selected credential does not match the assignment website.")
  })
})
