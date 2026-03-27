import { createServerFn } from "@tanstack/react-start"
import { api } from "../../convex/_generated/api"
import { prepareCreateRunPayload } from "./run-request"

export const createRun = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { credentialNamespace?: string | null; url: string }) => data,
  )
  .handler(async ({ data }) => {
    const payload = prepareCreateRunPayload(data)

    const [{ createConvexServerClient }, { serverEnv }] = await Promise.all([
      import("~/server/convex"),
      import("~/server-env"),
    ])

    const convex = createConvexServerClient()
    const runId = await convex.mutation(api.runs.createRun, payload)

    try {
      if (serverEnv.QA_DIRECT_RUN_FALLBACK === "1") {
        const { runQaWorkflow } = await import("../../inngest/qa-run")

        await convex.mutation(api.runtime.updateRunQueueState, {
          runId,
          queueState: "picked_up",
          title: "Direct run fallback enabled",
          body: "Running the QA workflow directly in the app server because QA_DIRECT_RUN_FALLBACK=1.",
        })

        void runQaWorkflow({ runId, ...payload })
      } else {
        const { inngest } = await import("../../inngest/client")

        await inngest.send({
          name: "app/run.requested",
          data: { runId, ...payload },
        })

        await convex.mutation(api.runtime.updateRunQueueState, {
          runId,
          queueState: "waiting_for_worker",
          title: "Waiting for background worker",
          body: "Inngest accepted the run request. Waiting for a worker to start the QA job.",
        })
      }
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
