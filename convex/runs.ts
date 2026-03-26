import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const createRun = mutation({
  args: {
    url: v.string(),
    credentialNamespace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    return await ctx.db.insert("runs", {
      url: args.url,
      credentialNamespace: args.credentialNamespace,
      status: "queued",
      currentStep: "Queued for scan",
      startedAt: now,
      updatedAt: now,
    })
  },
})

export const getRun = query({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.runId)
  },
})
