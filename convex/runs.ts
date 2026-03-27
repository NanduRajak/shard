import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const createRun = mutation({
  args: {
    url: v.string(),
    credentialNamespace: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    const runId = await ctx.db.insert("runs", {
      url: args.url,
      credentialNamespace: args.credentialNamespace,
      status: "queued",
      queueState: "pending",
      currentStep: "Queued for scan",
      startedAt: now,
      updatedAt: now,
    })

    await ctx.db.insert("runEvents", {
      runId,
      kind: "status",
      title: "Run queued",
      body: "The autonomous QA workflow has been created and is waiting for the background worker.",
      status: "queued",
      pageUrl: args.url,
      createdAt: now,
    })

    return runId
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
