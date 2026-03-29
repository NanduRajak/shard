import { validateRunUrl } from "@/lib/run-url"
import {
  buildBackgroundAgentInstructions,
  resolveBackgroundTaskInstructions,
} from "@/lib/background-agent-task"

export type CreateBackgroundOrchestratorInput = {
  agentCount?: number | null
  credentialId?: string | null
  siteUrl: string
  task?: string | null
}

export function prepareCreateBackgroundOrchestratorPayload(
  data: CreateBackgroundOrchestratorInput,
  options?: {
    credentialProfiles?: Array<{
      _id: string
      origin: string
    }>
  },
) {
  const url = validateRunUrl(data.siteUrl)

  if (!url) {
    throw new Error("Enter a full site URL starting with http:// or https://.")
  }

  const credentialProfilesById = new Map(
    (options?.credentialProfiles ?? []).map((profile) => [profile._id, profile]),
  )
  const credentialId = data.credentialId?.trim()

  if (credentialId) {
    const credentialProfile = credentialProfilesById.get(credentialId)

    if (!credentialProfile) {
      throw new Error("A selected credential could not be found.")
    }

    if (credentialProfile.origin !== new URL(url).origin) {
      throw new Error("A selected credential does not match the website origin.")
    }
  }

  const agentCount = Math.max(1, Math.min(Number(data.agentCount ?? 2), 6))
  const instructions = resolveBackgroundTaskInstructions(data.task)

  return {
    agentCount,
    assignments: Array.from({ length: agentCount }, (_, index) => ({
      credentialId: credentialId || undefined,
      instructions: buildBackgroundAgentInstructions({
        agentIndex: index,
        agentCount,
        task: data.task,
      }),
      url,
    })),
    credentialId: credentialId || undefined,
    instructions,
    origin: new URL(url).origin,
    url,
  }
}

