import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"

export const requestRunStop = createServerFn({ method: "POST" })
  .inputValidator((data: { runId: Id<"runs"> }) => data)
  .handler(async ({ data }) => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()

    return await convex.mutation(api.runtime.requestRunStop, {
      runId: data.runId,
    })
  })
