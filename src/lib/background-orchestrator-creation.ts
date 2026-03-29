export type BackgroundOrchestratorAssignmentInput = {
  credentialId?: string
  instructions: string
  url: string
}

export type BackgroundOrchestratorCreationInput = {
  agentCount: number
  assignments: BackgroundOrchestratorAssignmentInput[]
  credentialId?: string
  instructions: string
  origin: string
  url: string
}

export function validateBackgroundOrchestratorCreationInput(
  input: BackgroundOrchestratorCreationInput,
) {
  if (!Number.isInteger(input.agentCount) || input.agentCount < 1 || input.agentCount > 6) {
    throw new Error("Agent count must be an integer between 1 and 6.")
  }

  if (input.assignments.length !== input.agentCount) {
    throw new Error("Assignment count must match the selected agent count.")
  }

  let orchestratorOrigin: string

  try {
    orchestratorOrigin = new URL(input.url).origin
  } catch {
    throw new Error("The orchestrator URL is invalid.")
  }

  if (orchestratorOrigin !== input.origin) {
    throw new Error("The orchestrator origin must match the site URL.")
  }

  for (const assignment of input.assignments) {
    let assignmentOrigin: string

    try {
      assignmentOrigin = new URL(assignment.url).origin
    } catch {
      throw new Error("Each orchestrator assignment must have a valid URL.")
    }

    if (assignmentOrigin !== input.origin) {
      throw new Error("All orchestrator assignments must target the same website origin.")
    }

    if (assignment.credentialId !== input.credentialId) {
      throw new Error("All orchestrator assignments must use the selected credential.")
    }
  }
}
