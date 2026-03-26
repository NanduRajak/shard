import { createServerFn } from "@tanstack/react-start"
import { api } from "../../convex/_generated/api"
import { validateRunUrl } from "./run-url"

export const createRun = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => data)
  .handler(async ({ data }) => {
    const url = validateRunUrl(data.url)

    if (!url) {
      throw new Error("Enter a full URL starting with http:// or https://.")
    }

    const [{ createConvexServerClient }, { inngest }] = await Promise.all([
      import("~/server/convex"),
      import("../../inngest/core"),
    ])

    const convex = createConvexServerClient()
    const runId = await convex.mutation(api.runs.createRun, { url })

    try {
      await inngest.send({
        name: "app/run.requested",
        data: { runId, url },
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
