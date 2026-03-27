import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const createRun = mutation({
  args: {
    url: v.string(),
    mode: v.union(v.literal("explore"), v.literal("task")),
    browserProvider: v.union(v.literal("steel"), v.literal("local_chrome")),
    credentialNamespace: v.optional(v.string()),
    instructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    const runId = await ctx.db.insert("runs", {
      url: args.url,
      mode: args.mode,
      browserProvider: args.browserProvider,
      credentialNamespace: args.credentialNamespace,
      instructions: args.instructions,
      status: "queued",
      queueState: "pending",
      currentStep: "Queued for scan",
      goalStatus: args.mode === "task" ? "not_requested" : undefined,
      startedAt: now,
      updatedAt: now,
    })

    await ctx.db.insert("runEvents", {
      runId,
      kind: "status",
      title: "Run queued",
      body:
        args.mode === "task" && args.instructions
          ? `The autonomous QA workflow has been created and is waiting for a runner.\nTask: ${args.instructions}`
          : "The autonomous QA workflow has been created and is waiting for a runner.",
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
