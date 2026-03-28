import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { DEFAULT_BACKGROUND_TASK_INSTRUCTIONS } from "../src/lib/background-agent-task"
import { buildScoreSummary } from "../src/lib/scoring"

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
        credentialId: v.optional(v.id("credentials")),
        instructions: v.string(),
        url: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const batchId = await ctx.db.insert("backgroundBatches", {
      title: args.title,
      totalRuns: args.assignments.length,
      createdAt: now,
      updatedAt: now,
    })

    const runIds = []
    let agentOrdinal = 1

    for (const assignment of args.assignments) {
      if (assignment.credentialId) {
        const credential = await ctx.db.get(assignment.credentialId)

        if (!credential) {
          throw new Error("Selected credential was not found.")
        }

        if (credential.origin !== new URL(assignment.url).origin) {
          throw new Error("Selected credential does not match the website origin.")
        }
      }

      const runId = await ctx.db.insert("runs", {
        agentOrdinal,
        backgroundBatchId: batchId,
        browserProvider: "playwright",
        credentialId: assignment.credentialId,
        currentStep: "Queued for background QA",
        executionMode: "background",
        goalStatus: "not_requested",
        instructions: assignment.instructions,
        mode: "task",
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
        body:
          assignment.instructions === DEFAULT_BACKGROUND_TASK_INSTRUCTIONS
            ? "The background agent is queued for the built-in end-to-end QA audit."
            : `The background agent is queued for long-running QA.\nTask: ${assignment.instructions}`,
        status: "queued",
        pageUrl: assignment.url,
        createdAt: now,
      })

      runIds.push(runId)
      agentOrdinal += 1
    }

    return { batchId, runIds }
  },
})

export const listCredentialsForBackgroundRuns = query({
  args: {},
  handler: async (ctx) => {
    const credentials = await ctx.db.query("credentials").collect()

    return credentials
      .slice()
      .filter((credential) => typeof credential.login === "string")
      .sort((left, right) => {
        const websiteComparison = left.website.localeCompare(right.website)

        if (websiteComparison !== 0) {
          return websiteComparison
        }

        return left.login.localeCompare(right.login)
      })
      .map((credential) => ({
        _id: credential._id,
        isDefault: credential.isDefault ?? false,
        login: credential.login,
        origin: credential.origin,
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

export const getBackgroundBatchReport = query({
  args: {
    batchId: v.optional(v.id("backgroundBatches")),
  },
  handler: async (ctx, args) => {
    if (!args.batchId) {
      return null
    }

    const batch = await ctx.db.get(args.batchId)
    if (!batch) {
      return null
    }

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_background_batch", (q) => q.eq("backgroundBatchId", args.batchId))
      .collect()

    const agentRuns = await Promise.all(
      runs
        .slice()
        .sort((left, right) => (left.agentOrdinal ?? 0) - (right.agentOrdinal ?? 0))
        .map(async (run) => {
          const [rawArtifacts, findings, runEvents, session, performanceAudits] =
            await Promise.all([
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
                .order("asc")
                .collect(),
              ctx.db
                .query("sessions")
                .withIndex("by_run_and_started_at", (q) => q.eq("runId", run._id))
                .order("desc")
                .first(),
              ctx.db
                .query("performanceAudits")
                .withIndex("by_run_and_created_at", (q) => q.eq("runId", run._id))
                .order("desc")
                .collect(),
            ])

          const artifacts = await Promise.all(
            rawArtifacts.map(async (artifact) => ({
              ...artifact,
              url: artifact.storageId ? await ctx.storage.getUrl(artifact.storageId) : undefined,
            })),
          )

          return {
            artifacts,
            findings: findings.slice().sort((left, right) => right.createdAt - left.createdAt),
            latestScreenshot: artifacts.find((artifact) => artifact.type === "screenshot") ?? null,
            performanceAudits,
            run,
            runEvents,
            session,
            traceArtifact: artifacts.find((artifact) => artifact.type === "trace") ?? null,
          }
        }),
    )

    const mergedFindingMap = new Map<string, (typeof agentRuns)[number]["findings"][number]>()
    for (const agentRun of agentRuns) {
      for (const finding of agentRun.findings) {
        const key = [
          finding.source,
          finding.browserSignal ?? "",
          finding.title.trim().toLowerCase(),
          (finding.pageOrFlow ?? "").trim().toLowerCase(),
        ].join("::")

        const existing = mergedFindingMap.get(key)
        if (!existing || (finding.score ?? 0) > (existing.score ?? 0)) {
          mergedFindingMap.set(key, finding)
        }
      }
    }

    const mergedFindings = [...mergedFindingMap.values()].sort(
      (left, right) => (right.score ?? 0) - (left.score ?? 0),
    )
    const mergedPerformanceAudits = agentRuns.flatMap((run) => run.performanceAudits)
    const mergedArtifacts = agentRuns.flatMap((run) => run.artifacts)
    const coverageUrls = Array.from(
      new Set(
        agentRuns.flatMap((agentRun) =>
          agentRun.runEvents
            .map((event) => event.pageUrl)
            .concat(agentRun.findings.map((finding) => finding.pageOrFlow))
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    )

    const completedRuns = agentRuns.filter((item) => item.run.status === "completed").length
    const failedRuns = agentRuns.filter((item) => isFailedRun(item.run.status)).length
    const activeRuns = agentRuns.filter((item) => isActiveRun(item.run.status)).length
    const queuedRuns = agentRuns.filter((item) => isQueuedRun(item.run.status)).length
    const siteOrigins = Array.from(
      new Set(
        agentRuns
          .map((item) => {
            try {
              return new URL(item.run.url).origin
            } catch {
              return null
            }
          })
          .filter((value): value is string => Boolean(value)),
      ),
    )
    const isSingleSiteBatch = siteOrigins.length <= 1

    return {
      agentRuns,
      batch,
      coverageUrls: isSingleSiteBatch ? coverageUrls : [],
      isSingleSiteBatch,
      mergedArtifacts: isSingleSiteBatch ? mergedArtifacts : [],
      mergedFindings: isSingleSiteBatch ? mergedFindings : [],
      mergedPerformanceAudits: isSingleSiteBatch ? mergedPerformanceAudits : [],
      scoreSummary: isSingleSiteBatch
        ? buildScoreSummary({
            findings: mergedFindings.map((finding) => ({
              score: finding.score ?? 0,
              source: finding.source,
            })),
            performanceAudits: mergedPerformanceAudits.length,
            screenshots: mergedArtifacts.filter((artifact) => artifact.type === "screenshot").length,
          })
        : null,
      siteOrigin: siteOrigins[0] ?? null,
      summary: {
        activeRuns,
        completedRuns,
        failedRuns,
        queuedRuns,
      },
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
