import { validateRunUrl } from "@/lib/run-url"

export type BackgroundAssignmentInput = {
  agentCount: number
  credentialProfileId?: string | null
  goal?: string | null
  siteUrl: string
}

export function prepareCreateBackgroundBatchPayload(
  data: {
    assignments: BackgroundAssignmentInput[]
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

  const assignments = data.assignments
    .map((assignment) => {
      const url = validateRunUrl(assignment.siteUrl)

      if (!url) {
        throw new Error("Every background assignment needs a full http:// or https:// URL.")
      }

      const instructions = assignment.goal?.trim()
      const agentCount = Number(assignment.agentCount)

      if (!Number.isInteger(agentCount) || agentCount < 1 || agentCount > 8) {
        throw new Error("Each background assignment must request between 1 and 8 agents.")
      }

      const credentialProfileId = assignment.credentialProfileId?.trim()

      if (credentialProfileId) {
        const credentialProfile = credentialProfilesById.get(credentialProfileId)

        if (!credentialProfile) {
          throw new Error("A selected credential profile could not be found.")
        }

        if (credentialProfile.origin !== new URL(url).origin) {
          throw new Error("A selected credential profile does not match the assignment website.")
        }
      }

      return {
        agentCount,
        credentialProfileId: credentialProfileId || undefined,
        instructions: instructions || undefined,
        url,
      }
    })
    .filter((assignment) => assignment.url)

  if (assignments.length === 0) {
    throw new Error("Add at least one background assignment.")
  }

  return {
    assignments,
    title: `Background batch · ${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`,
  }
}
