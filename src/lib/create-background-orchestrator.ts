import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import {
  prepareCreateBackgroundOrchestratorPayload,
  type CreateBackgroundOrchestratorInput,
} from "./background-orchestrator-request"
import { enqueueBackgroundOrchestratorRuns } from "./background-orchestrator-enqueue"

export const createBackgroundOrchestrator = createServerFn({ method: "POST" })
  .inputValidator((data: CreateBackgroundOrchestratorInput) => data)
  .handler(async ({ data }) => {
    const [{ createConvexServerClient }, { serverEnv }] = await Promise.all([
      import("~/server/convex"),
      import("~/server-env"),
    ])

    const convex = createConvexServerClient()
    const credentials = await convex.query(
      api.backgroundAgents.listCredentialsForBackgroundOrchestrators,
      {},
    )
    const payload = prepareCreateBackgroundOrchestratorPayload(data, {
      credentialProfiles: credentials.map((credential: any) => ({
        _id: credential._id,
        origin: credential.origin,
      })),
    })
    const assignments = payload.assignments.map((assignment) => ({
      ...assignment,
      credentialId: assignment.credentialId as Id<"credentials"> | undefined,
    }))

    const { orchestratorId, runIds } = await convex.mutation(
      api.backgroundAgents.createBackgroundOrchestrator,
      {
        ...payload,
        assignments,
        credentialId: payload.credentialId as Id<"credentials"> | undefined,
      },
    )
    const crawlEventData = {
      orchestratorId: orchestratorId as string,
      url: payload.url,
      origin: new URL(payload.url).hostname,
    }

    if (serverEnv.QA_DIRECT_RUN_FALLBACK === "1") {
      const { runQaWorkflow } = await import("../../inngest/qa-run")

      await Promise.all(
        runIds.map(async (runId, index) => {
          const assignment = assignments[index]

          await convex.mutation(api.runtime.updateRunQueueState, {
            runId,
            queueState: "picked_up",
            title: "Direct orchestrator run fallback enabled",
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

      try {
        const { runSiteCrawlWorkflow } = await import("../../inngest/site-crawl")
        void runSiteCrawlWorkflow(crawlEventData).catch(() => undefined)
      } catch {
        // Crawl failure should not block orchestrator creation
      }
    } else {
      const { inngest } = await import("../../inngest/client")

      // Dispatch crawl in parallel with agent runs
      try {
        await inngest.send({
          name: "app/crawl.requested",
          data: crawlEventData,
        })
      } catch {
        // Crawl failure should not block orchestrator creation
      }

      await enqueueBackgroundOrchestratorRuns({
        markQueuedForWorker: async (runId) => {
          await convex.mutation(api.runtime.updateRunQueueState, {
            runId,
            queueState: "waiting_for_worker",
            title: "Waiting for background Playwright worker",
            body: "The orchestrator agent is queued and waiting for a Playwright worker to start the QA job.",
          })
        },
        markQueueDispatchFailed: async (runId, errorMessage) => {
          await convex.mutation(api.runtime.updateRun, {
            runId,
            status: "failed",
            currentStep: "Failed to enqueue orchestrator workflow",
            errorMessage,
            finishedAt: Date.now(),
          })
        },
        markQueueDispatchUnconfirmed: async (runId, errorMessage) => {
          await convex.mutation(api.runtime.updateRun, {
            runId,
            currentStep: "Unable to confirm orchestrator workflow enqueue",
            errorMessage,
            queueState: "worker_unreachable",
          })
        },
        runs: runIds.flatMap((runId, index) => {
          const assignment = assignments[index]

          return assignment
            ? [
                {
                  assignment,
                  runId,
                },
              ]
            : []
        }),
        sendEvent: (event) => inngest.send(event),
      })
    }

    return { orchestratorId, runIds }
  })
