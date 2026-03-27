import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"

const QUEUE_WARNING_THRESHOLD_MS = 15_000

export const inspectRunStartup = createServerFn({ method: "POST" })
  .inputValidator((data: { runId: Id<"runs"> }) => data)
  .handler(async ({ data }) => {
    const [{ createConvexServerClient }, { serverEnv }] = await Promise.all([
      import("~/server/convex"),
      import("~/server-env"),
    ])

    const convex = createConvexServerClient()
    const executionState = await convex.query(api.runtime.getRunExecutionState, {
      runId: data.runId,
    })

    if (!executionState || executionState.status !== "queued") {
      return executionState
    }

    if (Date.now() - executionState.startedAt < QUEUE_WARNING_THRESHOLD_MS) {
      return executionState
    }

    await convex.mutation(api.runtime.updateRunQueueState, {
      runId: data.runId,
      queueState: "waiting_for_worker",
      title:
        executionState.browserProvider === "local_chrome"
          ? "Still waiting for a local helper"
          : "Still waiting for background runner",
      body:
        executionState.browserProvider === "local_chrome"
          ? "The local run was created, but no healthy local helper has claimed it yet. Run `pnpm run local-helper`, keep Chrome open, and approve the Chrome debugging permission prompt."
          : serverEnv.INNGEST_DEV === "1"
          ? "The run request was accepted, but no worker has picked it up yet. Local Docker Inngest dev servers are known to lose sync with app endpoints. Run `pnpm inngest:dev` on the host machine and stop the Docker dev server for reliable local pickup."
          : serverEnv.INNGEST_BASE_URL
            ? `The run request was accepted, but no worker has picked it up yet. Configured Inngest URL: ${serverEnv.INNGEST_BASE_URL}`
            : "The run request was accepted, but no worker has picked it up yet.",
    })

    return await convex.query(api.runtime.getRunExecutionState, {
      runId: data.runId,
    })
  })
