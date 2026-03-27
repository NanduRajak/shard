import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"

export const deleteRun = createServerFn({ method: "POST" })
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

    if (
      report?.session?.externalSessionId &&
      (report.session.provider ?? "steel") === "steel"
    ) {
      const steel = new SteelClient({
        steelAPIKey: serverEnv.STEEL_API_KEY,
      })

      await steel.sessions.release(report.session.externalSessionId).catch(() => undefined)
    }

    return await convex.mutation(api.runtime.deleteRun, {
      runId: data.runId,
    })
  })
