import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import {
  prepareCreateBackgroundBatchPayload,
  type BackgroundAssignmentInput,
  type SiteBatchInput,
} from "./background-run-request"

export const createBackgroundBatch = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      assignments?: BackgroundAssignmentInput[]
      siteBatch?: SiteBatchInput | null
    }) => data,
  )
  .handler(async ({ data }) => {
    const [{ createConvexServerClient }, { serverEnv }] = await Promise.all([
      import("~/server/convex"),
      import("~/server-env"),
    ])

    const convex = createConvexServerClient()
    const credentials = await convex.query(
      api.backgroundAgents.listCredentialsForBackgroundRuns,
      {},
    )
    const payload = prepareCreateBackgroundBatchPayload(data, {
      credentialProfiles: credentials.map((credential) => ({
        _id: credential._id,
        origin: credential.origin,
      })),
    })
    const assignments = payload.assignments.map((assignment) => ({
      ...assignment,
      credentialId: assignment.credentialId as Id<"credentials"> | undefined,
    }))

    const { batchId, runIds } = await convex.mutation(
      api.backgroundAgents.createBackgroundBatch,
      {
        ...payload,
        assignments,
      },
    )

    try {
      if (serverEnv.QA_DIRECT_RUN_FALLBACK === "1") {
        const { runQaWorkflow } = await import("../../inngest/qa-run")

        // Dev-only shortcut: this bypasses Inngest's worker concurrency controls.
        // Revisit before any production deployment so background runs respect the
        // intended parallelism and queue semantics outside local development.
        await Promise.all(
          runIds.map(async (runId, index) => {
            const assignment = assignments[index]

            await convex.mutation(api.runtime.updateRunQueueState, {
              runId,
              queueState: "picked_up",
              title: "Direct background run fallback enabled",
              body: "Running the background QA workflow directly in the app server because QA_DIRECT_RUN_FALLBACK=1.",
            })

            if (!assignment) {
              return
            }

            void runQaWorkflow({
              browserProvider: "playwright",
              credentialId: assignment.credentialId,
              instructions: assignment.instructions,
              mode: "task",
              runId,
              url: assignment.url,
            })
          }),
        )
      } else {
        const { inngest } = await import("../../inngest/client")

        await Promise.all(
          runIds.map(async (runId, index) => {
            const assignment = assignments[index]

            if (!assignment) {
              return
            }

            await inngest.send({
              name: "app/background-run.requested",
              data: {
                browserProvider: "playwright",
                credentialId: assignment.credentialId,
                instructions: assignment.instructions,
                mode: "task",
                runId,
                url: assignment.url,
              },
            })

            await convex.mutation(api.runtime.updateRunQueueState, {
              runId,
              queueState: "waiting_for_worker",
              title: "Waiting for background Playwright worker",
              body: "The background agent is queued and waiting for a Playwright worker to start the QA job.",
            })
          }),
        )
      }
    } catch (error) {
      await Promise.all(
        runIds.map((runId) =>
          convex.mutation(api.runtime.updateRun, {
            runId,
            status: "failed",
            currentStep: "Failed to enqueue background workflow",
            errorMessage: error instanceof Error ? error.message : "Unknown background queue error",
            finishedAt: Date.now(),
          }),
        ),
      )

      throw error
    }

    return { batchId, runIds }
  })
