import { describe, expect, it } from "vitest"
import { validateBackgroundOrchestratorCreationInput } from "./background-orchestrator-creation"

describe("validateBackgroundOrchestratorCreationInput", () => {
  it("accepts a single-site orchestrator payload", () => {
    expect(() =>
      validateBackgroundOrchestratorCreationInput({
        agentCount: 2,
        assignments: [
          {
            credentialId: "cred_1",
            instructions: "Lane 1",
            url: "https://app.example.com",
          },
          {
            credentialId: "cred_1",
            instructions: "Lane 2",
            url: "https://app.example.com/settings",
          },
        ],
        credentialId: "cred_1",
        instructions: "Run orchestrator",
        origin: "https://app.example.com",
        url: "https://app.example.com",
      }),
    ).not.toThrow()
  })

  it("rejects mismatched assignment counts", () => {
    expect(() =>
      validateBackgroundOrchestratorCreationInput({
        agentCount: 2,
        assignments: [
          {
            instructions: "Lane 1",
            url: "https://app.example.com",
          },
        ],
        instructions: "Run orchestrator",
        origin: "https://app.example.com",
        url: "https://app.example.com",
      }),
    ).toThrowError("Assignment count must match the selected agent count.")
  })

  it("rejects mixed-site assignments", () => {
    expect(() =>
      validateBackgroundOrchestratorCreationInput({
        agentCount: 2,
        assignments: [
          {
            instructions: "Lane 1",
            url: "https://app.example.com",
          },
          {
            instructions: "Lane 2",
            url: "https://admin.example.com",
          },
        ],
        instructions: "Run orchestrator",
        origin: "https://app.example.com",
        url: "https://app.example.com",
      }),
    ).toThrowError("All orchestrator assignments must target the same website origin.")
  })

  it("rejects inconsistent assignment credentials", () => {
    expect(() =>
      validateBackgroundOrchestratorCreationInput({
        agentCount: 1,
        assignments: [
          {
            credentialId: "cred_2",
            instructions: "Lane 1",
            url: "https://app.example.com",
          },
        ],
        credentialId: "cred_1",
        instructions: "Run orchestrator",
        origin: "https://app.example.com",
        url: "https://app.example.com",
      }),
    ).toThrowError("All orchestrator assignments must use the selected credential.")
  })
})
