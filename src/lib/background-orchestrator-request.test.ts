import { describe, expect, it } from "vitest"
import { prepareCreateBackgroundOrchestratorPayload } from "./background-orchestrator-request"

describe("prepareCreateBackgroundOrchestratorPayload", () => {
  it("uses a default agent count of two and creates static lanes", () => {
    const result = prepareCreateBackgroundOrchestratorPayload({
      siteUrl: "https://shop.example.com",
      task: "Validate the add to cart flow",
    })

    expect(result.agentCount).toBe(2)
    expect(result.assignments).toHaveLength(2)
    expect(result.assignments[0]?.instructions).toContain("agent 1 of 2")
    expect(result.assignments[1]?.instructions).toContain("agent 2 of 2")
  })

  it("gives each agent a distinct anti-overlap mission", () => {
    const result = prepareCreateBackgroundOrchestratorPayload({
      agentCount: 2,
      siteUrl: "https://shop.example.com",
    })

    expect(result.assignments[0]?.instructions).not.toEqual(result.assignments[1]?.instructions)
    expect(result.assignments[0]?.instructions).toContain("agent 1 of 2")
    expect(result.assignments[0]?.instructions).toContain("landing and primary navigation")
    expect(result.assignments[1]?.instructions).toContain("agent 2 of 2")
    expect(result.assignments[1]?.instructions).toContain("search, filters, and browse discovery")
    expect(result.assignments[0]?.instructions).toContain("Do not mirror another agent's path.")
  })

  it("clamps the agent count to six", () => {
    const result = prepareCreateBackgroundOrchestratorPayload({
      agentCount: 10,
      siteUrl: "https://shop.example.com",
    })

    expect(result.agentCount).toBe(6)
    expect(result.assignments).toHaveLength(6)
  })

  it("accepts a matching credential for the same origin", () => {
    const result = prepareCreateBackgroundOrchestratorPayload(
      {
        agentCount: 1,
        credentialId: "cred_1",
        siteUrl: "https://app.example.com/login",
      },
      {
        credentialProfiles: [
          {
            _id: "cred_1",
            origin: "https://app.example.com",
          },
        ],
      },
    )

    expect(result.credentialId).toBe("cred_1")
    expect(result.assignments[0]?.credentialId).toBe("cred_1")
  })

  it("rejects invalid URLs", () => {
    expect(() =>
      prepareCreateBackgroundOrchestratorPayload({
        siteUrl: "app.example.com",
      }),
    ).toThrowError("Enter a full site URL starting with http:// or https://.")
  })

  it("rejects mismatched credential origins", () => {
    expect(() =>
      prepareCreateBackgroundOrchestratorPayload(
        {
          credentialId: "cred_1",
          siteUrl: "https://app.example.com",
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
    ).toThrowError("A selected credential does not match the website origin.")
  })
})
