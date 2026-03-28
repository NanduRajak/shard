import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"

export const requestRunStop = createServerFn({ method: "POST" })
  .inputValidator((data: { runId: Id<"runs"> }) => data)
  .handler(async ({ data }) => {
    const [{ createConvexServerClient }, { default: SteelClient }, { serverEnv }] =
      await Promise.all([
        import("~/server/convex"),
        import("steel-sdk"),
        import("~/server-env"),
      ])
    const convex = createConvexServerClient()
    const report = await convex.query(api.runtime.getRunReport, {
      runId: data.runId,
    })

    const result = await convex.mutation(api.runtime.requestRunStop, {
      runId: data.runId,
    })

    if (!result.ok || !report?.session) {
      return result
    }

    const session = report.session

    if (
      session.provider === "steel" &&
      session.externalSessionId &&
      session.status !== "closed" &&
      session.status !== "failed"
    ) {
      const steel = new SteelClient({
        steelAPIKey: serverEnv.STEEL_API_KEY,
      })

      await steel.sessions.release(session.externalSessionId).catch(() => undefined)
      await convex
        .mutation(api.runtime.updateSession, {
          sessionId: session._id,
          status: "closed",
          debugUrl: session.debugUrl,
          replayUrl: session.replayUrl,
          finishedAt: Date.now(),
        })
        .catch(() => undefined)
    }

    return result
  })
