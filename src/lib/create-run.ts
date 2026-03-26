import { createServerFn } from "@tanstack/react-start"
import { api } from "../../convex/_generated/api"
import { prepareCreateRunPayload } from "./run-request"

export const createRun = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { credentialNamespace?: string | null; url: string }) => data,
  )
  .handler(async ({ data }) => {
    const payload = prepareCreateRunPayload(data)

    const [{ createConvexServerClient }, { inngest }] = await Promise.all([
      import("~/server/convex"),
      import("../../inngest/client"),
    ])

    const convex = createConvexServerClient()
    const runId = await convex.mutation(api.runs.createRun, payload)

    try {
      await inngest.send({
        name: "app/run.requested",
        data: { runId, ...payload },
      })
    } catch (error) {
      await convex.mutation(api.runtime.updateRun, {
        runId,
        status: "failed",
        currentStep: "Failed to enqueue background workflow",
        errorMessage:
          error instanceof Error ? error.message : "Unknown Inngest error",
        finishedAt: Date.now(),
      })

      throw error
    }

    return { runId }
  })
