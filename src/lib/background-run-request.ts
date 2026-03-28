import { validateRunUrl } from "@/lib/run-url"
import { resolveBackgroundTaskInstructions } from "@/lib/background-agent-task"

export type BackgroundAssignmentInput = {
  credentialId?: string | null
  siteUrl: string
  task?: string | null
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
    .filter((assignment) => assignment.url)

  if (assignments.length === 0) {
    throw new Error("Add at least one background assignment.")
  }

  return {
    assignments,
    title: `Background batch · ${assignments.length} assignment${assignments.length === 1 ? "" : "s"}`,
  }
}
