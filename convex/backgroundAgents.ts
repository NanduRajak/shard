import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

function isActiveRun(status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting") {
  return status === "starting" || status === "running"
}

function isQueuedRun(status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting") {
  return status === "queued"
}

function isFailedRun(status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting") {
  return status === "failed" || status === "cancelled"
}

export const createBackgroundBatch = mutation({
  args: {
    title: v.string(),
    assignments: v.array(
      v.object({
        agentCount: v.number(),
        credentialProfileId: v.optional(v.id("credentials")),
        instructions: v.optional(v.string()),
        url: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const batchId = await ctx.db.insert("backgroundBatches", {
      title: args.title,
      totalRuns: args.assignments.reduce((sum, assignment) => sum + assignment.agentCount, 0),
      createdAt: now,
      updatedAt: now,
    })

    const runIds = []
    let agentOrdinal = 1

    for (const assignment of args.assignments) {
      let credentialNamespace: string | undefined

      if (assignment.credentialProfileId) {
        const credential = await ctx.db.get(assignment.credentialProfileId)

        if (!credential) {
          throw new Error("Selected credential profile was not found.")
        }

        if (credential.origin !== new URL(assignment.url).origin) {
          throw new Error("Selected credential profile does not match the website origin.")
        }

        credentialNamespace = credential.namespace
      }

      const mode = assignment.instructions ? "task" : "explore"

      for (let index = 0; index < assignment.agentCount; index += 1) {
        const runId = await ctx.db.insert("runs", {
          agentOrdinal,
          backgroundBatchId: batchId,
          browserProvider: "playwright",
          credentialNamespace,
          credentialProfileId: assignment.credentialProfileId,
          currentStep: "Queued for background QA",
          executionMode: "background",
          goalStatus: mode === "task" ? "not_requested" : undefined,
          instructions: assignment.instructions,
          mode,
          queueState: "pending",
          startedAt: now,
          status: "queued",
          updatedAt: now,
          url: assignment.url,
        })

        await ctx.db.insert("runEvents", {
          runId,
          kind: "status",
          title: "Background agent queued",
          body: assignment.instructions
            ? `The background agent is queued for long-running QA.\nTask: ${assignment.instructions}`
            : "The background agent is queued for long-running whole-app exploration.",
          status: "queued",
          pageUrl: assignment.url,
          createdAt: now,
        })

        runIds.push(runId)
        agentOrdinal += 1
      }
    }

    return { batchId, runIds }
  },
})

export const listCredentialProfilesForBackgroundRuns = query({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.db.query("credentials").collect()

    return credentials
      .slice()
      .sort((left, right) => {
        const namespaceComparison = left.namespace.localeCompare(right.namespace)

        if (namespaceComparison !== 0) {
          return namespaceComparison
        }

        const websiteComparison = left.website.localeCompare(right.website)

        if (websiteComparison !== 0) {
          return websiteComparison
        }

        return (left.profileLabel ?? left.username).localeCompare(
          right.profileLabel ?? right.username,
        )
      })
      .map((credential) => ({
        _id: credential._id,
        isDefault: credential.isDefault ?? false,
        namespace: credential.namespace,
        origin: credential.origin,
        profileLabel: credential.profileLabel ?? credential.username,
        username: credential.username,
        website: credential.website,
      }))
  },
})

export const getBackgroundAgentsOverview = query({
  args: {},
  handler: async (ctx) => {
    const [batches, runs] = await Promise.all([
      ctx.db
        .query("backgroundBatches")
        .withIndex("by_created_at")
        .order("desc")
        .collect(),
      ctx.db
        .query("runs")
        .withIndex("by_execution_mode_started_at", (q) =>
          q.eq("executionMode", "background"),
        )
        .order("desc")
        .collect(),
    ])

    const batchById = new Map(batches.map((batch) => [batch._id, batch]))
    const cards = await Promise.all(
      runs.map(async (run) => {
        const [artifacts, findings, runEvents] = await Promise.all([
          ctx.db
            .query("artifacts")
            .withIndex("by_run_and_created_at", (q) => q.eq("runId", run._id))
            .order("desc")
            .collect(),
          ctx.db
            .query("findings")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .collect(),
          ctx.db
            .query("runEvents")
            .withIndex("by_run_and_created_at", (q) => q.eq("runId", run._id))
            .order("desc")
            .take(1),
        ])

        const latestScreenshot =
          artifacts.find((artifact) => artifact.type === "screenshot") ?? null
        const traceArtifact =
          artifacts.find((artifact) => artifact.type === "trace") ?? null

        return {
          batch: run.backgroundBatchId ? batchById.get(run.backgroundBatchId) ?? null : null,
          findingsCount: findings.length,
          latestEvent: runEvents[0] ?? null,
          latestScreenshot,
          run,
          traceArtifact,
        }
      }),
    )

    const queuedRuns = cards.filter((item) => isQueuedRun(item.run.status))
    const activeRuns = cards.filter((item) => isActiveRun(item.run.status))
    const completedRuns = cards.filter((item) => item.run.status === "completed")
    const failedRuns = cards.filter((item) => isFailedRun(item.run.status))

    return {
      activeRuns,
      batches: batches.map((batch) => ({
        batch,
        counts: {
          active: activeRuns.filter((item) => item.run.backgroundBatchId === batch._id).length,
          completed: completedRuns.filter((item) => item.run.backgroundBatchId === batch._id)
            .length,
          failed: failedRuns.filter((item) => item.run.backgroundBatchId === batch._id).length,
          queued: queuedRuns.filter((item) => item.run.backgroundBatchId === batch._id).length,
        },
      })),
      completedRuns,
      failedRuns,
      queuedRuns,
    }
  },
})

export const getBackgroundBatch = query({
  args: {
    batchId: v.id("backgroundBatches"),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId)

    if (!batch) {
      return null
    }

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_background_batch", (q) => q.eq("backgroundBatchId", args.batchId))
      .collect()

    return {
      batch,
      runs: runs
        .slice()
        .sort((left, right) => (left.agentOrdinal ?? 0) - (right.agentOrdinal ?? 0)),
    }
  },
})

export const getBackgroundRunDetail = query({
  args: {
    runId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    if (!args.runId) {
      return null
    }

    const runId = args.runId
    const run = await ctx.db.get(runId)

    if (!run || run.executionMode !== "background") {
      return null
    }

    const [batch, rawArtifacts, findings, runEvents, session] = await Promise.all([
      run.backgroundBatchId ? ctx.db.get(run.backgroundBatchId) : Promise.resolve(null),
      ctx.db
        .query("artifacts")
        .withIndex("by_run_and_created_at", (q) => q.eq("runId", runId))
        .order("desc")
        .collect(),
      ctx.db
        .query("findings")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect(),
      ctx.db
        .query("runEvents")
        .withIndex("by_run_and_created_at", (q) => q.eq("runId", runId))
        .order("asc")
        .collect(),
      ctx.db
        .query("sessions")
        .withIndex("by_run_and_started_at", (q) => q.eq("runId", runId))
        .order("desc")
        .first(),
    ])

    const artifacts = await Promise.all(
      rawArtifacts.map(async (artifact) => ({
        ...artifact,
        url: artifact.storageId ? await ctx.storage.getUrl(artifact.storageId) : undefined,
      })),
    )

    const latestScreenshot =
      artifacts.find((artifact) => artifact.type === "screenshot") ?? null
    const traceArtifact = artifacts.find((artifact) => artifact.type === "trace") ?? null
    const consoleFindings = findings.filter((finding) => finding.browserSignal === "console")
    const networkFindings = findings.filter((finding) => finding.browserSignal === "network")
    const pageErrorFindings = findings.filter((finding) => finding.browserSignal === "pageerror")

    return {
      artifacts,
      batch,
      consoleFindings,
      findings: findings.slice().sort((left, right) => right.createdAt - left.createdAt),
      latestScreenshot,
      networkFindings,
      pageErrorFindings,
      run,
      runEvents,
      session,
      traceArtifact,
    }
  },
})
