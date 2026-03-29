import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"

export const deleteBackgroundOrchestrator = createServerFn({ method: "POST" })
  .inputValidator((data: { orchestratorId: Id<"backgroundOrchestrators"> }) => data)
  .handler(async ({ data }) => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()

    return await convex.mutation(api.backgroundAgents.deleteBackgroundOrchestrator, {
      orchestratorId: data.orchestratorId,
    })
  })
