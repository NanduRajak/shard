import { validateRunUrl } from "@/lib/run-url"
import {
  buildBackgroundAgentInstructions,
  resolveBackgroundTaskInstructions,
} from "@/lib/background-agent-task"

export type BackgroundAssignmentInput = {
  credentialId?: string | null
  siteUrl: string
  task?: string | null
}

export type SiteBatchInput = {
  credentialId?: string | null
  agentCount?: number | null
  siteUrl: string
  task?: string | null
}

export function prepareCreateBackgroundBatchPayload(
  data: {
    assignments?: BackgroundAssignmentInput[]
    siteBatch?: SiteBatchInput | null
  },
  options?: {
    credentialProfiles?: Array<{
      _id: string
      origin: string
    }>
  },
) {
  const credentialProfilesById = new Map(
    (options?.credentialProfiles ?? []).map((profile) => [profile._id, profile]),
  )

  const explicitAssignments = (data.assignments ?? [])
    .map((assignment) => {
      const url = validateRunUrl(assignment.siteUrl)

      if (!url) {
        throw new Error("Every background assignment needs a full http:// or https:// URL.")
      }

      const credentialId = assignment.credentialId?.trim()

      if (credentialId) {
        const credentialProfile = credentialProfilesById.get(credentialId)

        if (!credentialProfile) {
          throw new Error("A selected credential could not be found.")
        }

        if (credentialProfile.origin !== new URL(url).origin) {
          throw new Error("A selected credential does not match the assignment website.")
        }
      }

      return {
        credentialId: credentialId || undefined,
        instructions: resolveBackgroundTaskInstructions(assignment.task),
        url,
      }
    })

  const generatedAssignments = data.siteBatch
    ? buildSiteBatchAssignments(data.siteBatch, credentialProfilesById)
    : []

  const assignments = [...explicitAssignments, ...generatedAssignments]
    .filter((assignment) => assignment.url)
    .map((assignment) => ({
      credentialId: assignment.credentialId,
      instructions: assignment.instructions,
      url: assignment.url,
    }))
    .filter((assignment) => assignment.url)

  if (assignments.length === 0) {
    throw new Error("Add at least one background assignment.")
  }

  return {
    assignments,
    title: `Background batch · ${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`,
  }
}

function buildSiteBatchAssignments(
  siteBatch: SiteBatchInput,
  credentialProfilesById: Map<string, { _id: string; origin: string }>,
) {
  const url = validateRunUrl(siteBatch.siteUrl)

  if (!url) {
    throw new Error("Enter a full site URL starting with http:// or https://.")
  }

  const credentialId = siteBatch.credentialId?.trim()
  if (credentialId) {
    const credentialProfile = credentialProfilesById.get(credentialId)

    if (!credentialProfile) {
      throw new Error("A selected credential could not be found.")
    }

    if (credentialProfile.origin !== new URL(url).origin) {
      throw new Error("A selected credential does not match the assignment website.")
    }
  }

  const agentCount = Math.max(1, Math.min(Number(siteBatch.agentCount ?? 1), 6))

  return Array.from({ length: agentCount }, (_, index) => ({
    credentialId: credentialId || undefined,
    instructions: buildBackgroundAgentInstructions({
      agentIndex: index,
      agentCount,
      task: siteBatch.task,
    }),
    url,
  }))
}
