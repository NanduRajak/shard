import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { prepareCreateBackgroundBatchPayload, type BackgroundAssignmentInput } from "./background-run-request"

export const createBackgroundBatch = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      assignments: BackgroundAssignmentInput[]
    }) => data,
  )
  .handler(async ({ data }) => {
    const [{ createConvexServerClient }, { serverEnv }] = await Promise.all([
      import("~/server/convex"),
      import("~/server-env"),
    ])

    const convex = createConvexServerClient()
    const credentialProfiles = await convex.query(
      api.backgroundAgents.listCredentialProfilesForBackgroundRuns,
      {},
    )
    const payload = prepareCreateBackgroundBatchPayload(data, {
      credentialProfiles: credentialProfiles.map((profile) => ({
        _id: profile._id,
        origin: profile.origin,
      })),
    })
    const assignments = payload.assignments.map((assignment) => ({
      ...assignment,
      credentialProfileId: assignment.credentialProfileId as Id<"credentials"> | undefined,
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
            const assignment = assignments.find((candidate, assignmentIndex) => {
              const agentCountBefore = assignments
                .slice(0, assignmentIndex)
                .reduce((sum, item) => sum + item.agentCount, 0)

              return index >= agentCountBefore && index < agentCountBefore + candidate.agentCount
            })

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
              credentialNamespace: assignment.credentialProfileId
                ? credentialProfiles.find((profile) => profile._id === assignment.credentialProfileId)
                    ?.namespace
                : undefined,
              credentialProfileId: assignment.credentialProfileId,
              instructions: assignment.instructions,
              mode: assignment.instructions ? "task" : "explore",
              runId,
              url: assignment.url,
            })
          }),
        )
      } else {
        const { inngest } = await import("../../inngest/client")

        await Promise.all(
          runIds.map(async (runId, index) => {
            const assignment = assignments.find((candidate, assignmentIndex) => {
              const agentCountBefore = assignments
                .slice(0, assignmentIndex)
                .reduce((sum, item) => sum + item.agentCount, 0)

              return index >= agentCountBefore && index < agentCountBefore + candidate.agentCount
            })

            if (!assignment) {
              return
            }

            await inngest.send({
              name: "app/background-run.requested",
              data: {
                browserProvider: "playwright",
                credentialNamespace: assignment.credentialProfileId
                  ? credentialProfiles.find((profile) => profile._id === assignment.credentialProfileId)
                      ?.namespace
                  : undefined,
                credentialProfileId: assignment.credentialProfileId,
                instructions: assignment.instructions,
                mode: assignment.instructions ? "task" : "explore",
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
