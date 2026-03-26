import { v } from "convex/values"
import { mutation, query, type QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { buildScoreSummary } from "../src/lib/scoring"
import { buildAuditTrend } from "../src/lib/performance-trends"

const runStatus = v.union(
  v.literal("queued"),
  v.literal("starting"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
)

const sessionStatus = v.union(
  v.literal("creating"),
  v.literal("active"),
  v.literal("closed"),
  v.literal("failed"),
)

const artifactType = v.union(
  v.literal("screenshot"),
  v.literal("trace"),
  v.literal("html-report"),
  v.literal("replay"),
)

const findingSource = v.union(
  v.literal("browser"),
  v.literal("perf"),
  v.literal("hygiene"),
  v.literal("test"),
)

const findingSeverity = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
)

export const updateRun = mutation({
  args: {
    runId: v.id("runs"),
    status: v.optional(runStatus),
    currentStep: v.optional(v.string()),
    currentUrl: v.optional(v.union(v.string(), v.null())),
    errorMessage: v.optional(v.union(v.string(), v.null())),
    stopRequestedAt: v.optional(v.union(v.number(), v.null())),
    finishedAt: v.optional(v.number()),
    finalScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: {
      currentStep?: string
      currentUrl?: string | undefined
      errorMessage?: string | undefined
      finalScore?: number
      finishedAt?: number
      stopRequestedAt?: number | undefined
      status?:
        | "cancelled"
        | "completed"
        | "failed"
        | "queued"
        | "running"
        | "starting"
      updatedAt: number
    } = {
      updatedAt: Date.now(),
    }

    if (args.status !== undefined) {
      patch.status = args.status
    }

    if (args.currentStep !== undefined) {
      patch.currentStep = args.currentStep
    }

    if (args.currentUrl !== undefined) {
      patch.currentUrl = args.currentUrl ?? undefined
    }

    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage ?? undefined
    }

    if (args.stopRequestedAt !== undefined) {
      patch.stopRequestedAt = args.stopRequestedAt ?? undefined
    }

    if (args.finishedAt !== undefined) {
      patch.finishedAt = args.finishedAt
    }

    if (args.finalScore !== undefined) {
      patch.finalScore = args.finalScore
    }

    await ctx.db.patch(args.runId, patch)
  },
})

export const resetRunState = mutation({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const [findings, artifacts, performanceAudits, sessions] = await Promise.all([
      ctx.db
        .query("findings")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect(),
      ctx.db
        .query("artifacts")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect(),
      ctx.db
        .query("performanceAudits")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect(),
      ctx.db
        .query("sessions")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect(),
    ])

    await Promise.all(findings.map((finding) => ctx.db.delete(finding._id)))
    await Promise.all(
      performanceAudits.map((audit) => ctx.db.delete(audit._id)),
    )
    await Promise.all(sessions.map((session) => ctx.db.delete(session._id)))
    await Promise.all(
      artifacts.map(async (artifact) => {
        if (artifact.storageId) {
          await ctx.storage.delete(artifact.storageId)
        }

        await ctx.db.delete(artifact._id)
      }),
    )

    await ctx.db.patch(args.runId, {
      updatedAt: Date.now(),
      currentUrl: undefined,
      errorMessage: undefined,
      finalScore: undefined,
      finishedAt: undefined,
    })
  },
})

export const requestRunStop = mutation({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)

    if (!run) {
      return { ok: false as const, reason: "not_found" as const }
    }

    if (
      run.status !== "queued" &&
      run.status !== "starting" &&
      run.status !== "running"
    ) {
      return { ok: false as const, reason: "not_active" as const }
    }

    const stopRequestedAt = run.stopRequestedAt ?? Date.now()

    await ctx.db.patch(args.runId, {
      stopRequestedAt,
      currentStep: "Stop requested, shutting down run",
      updatedAt: Date.now(),
    })

    return { ok: true as const, stopRequestedAt }
  },
})

export const getRunExecutionState = query({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)

    if (!run) {
      return null
    }

    return {
      status: run.status,
      stopRequestedAt: run.stopRequestedAt ?? null,
      currentUrl: run.currentUrl ?? null,
    }
  },
})

export const createSession = mutation({
  args: {
    runId: v.id("runs"),
    externalSessionId: v.string(),
    status: sessionStatus,
    debugUrl: v.optional(v.string()),
    replayUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    return await ctx.db.insert("sessions", {
      runId: args.runId,
      provider: "steel",
      externalSessionId: args.externalSessionId,
      status: args.status,
      debugUrl: args.debugUrl,
      replayUrl: args.replayUrl,
      startedAt: now,
      updatedAt: now,
    })
  },
})

export const updateSession = mutation({
  args: {
    sessionId: v.id("sessions"),
    status: v.optional(sessionStatus),
    debugUrl: v.optional(v.string()),
    replayUrl: v.optional(v.string()),
    finishedAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const patch: {
      debugUrl?: string
      finishedAt?: number | undefined
      replayUrl?: string
      status?: "active" | "closed" | "creating" | "failed"
      updatedAt: number
    } = {
      updatedAt: Date.now(),
    }

    if (args.status !== undefined) {
      patch.status = args.status
    }

    if (args.debugUrl !== undefined) {
      patch.debugUrl = args.debugUrl
    }

    if (args.replayUrl !== undefined) {
      patch.replayUrl = args.replayUrl
    }

    if (args.finishedAt !== undefined) {
      patch.finishedAt = args.finishedAt ?? undefined
    }

    await ctx.db.patch(args.sessionId, patch)
  },
})

export const generateArtifactUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl()
  },
})

export const createArtifact = mutation({
  args: {
    runId: v.id("runs"),
    type: artifactType,
    fileLocation: v.string(),
    storageId: v.optional(v.id("_storage")),
    title: v.optional(v.string()),
    pageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("artifacts", {
      runId: args.runId,
      type: args.type,
      fileLocation: args.fileLocation,
      storageId: args.storageId,
      title: args.title,
      pageUrl: args.pageUrl,
      createdAt: Date.now(),
    })
  },
})

export const createFinding = mutation({
  args: {
    runId: v.optional(v.id("runs")),
    prReviewId: v.optional(v.id("prReviews")),
    source: findingSource,
    title: v.string(),
    description: v.string(),
    severity: findingSeverity,
    confidence: v.number(),
    impact: v.number(),
    score: v.number(),
    stepIndex: v.optional(v.number()),
    pageOrFlow: v.optional(v.string()),
    artifactId: v.optional(v.id("artifacts")),
    screenshotUrl: v.optional(v.string()),
    suggestedFix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("findings", {
      ...args,
      createdAt: Date.now(),
    })
  },
})

export const createPerformanceAudit = mutation({
  args: {
    runId: v.id("runs"),
    pageUrl: v.string(),
    performanceScore: v.number(),
    accessibilityScore: v.number(),
    bestPracticesScore: v.number(),
    seoScore: v.number(),
    reportArtifactId: v.optional(v.id("artifacts")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("performanceAudits", {
      ...args,
      createdAt: Date.now(),
    })
  },
})

export const getRunReport = query({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)

    if (!run) {
      return null
    }

    const previousRun = await findPreviousRunByUrl(ctx, args.runId, run.url)

    const [session, rawArtifacts, rawFindings, rawPerformanceAudits, previousRunAudits] =
      await Promise.all([
        ctx.db
          .query("sessions")
          .withIndex("by_run_and_started_at", (q) => q.eq("runId", args.runId))
          .order("desc")
          .first(),
        ctx.db
          .query("artifacts")
          .withIndex("by_run_and_created_at", (q) => q.eq("runId", args.runId))
          .order("desc")
          .collect(),
        ctx.db
          .query("findings")
          .withIndex("by_run", (q) => q.eq("runId", args.runId))
          .collect(),
        ctx.db
          .query("performanceAudits")
          .withIndex("by_run_and_created_at", (q) => q.eq("runId", args.runId))
          .order("desc")
          .collect(),
        previousRun
          ? ctx.db
              .query("performanceAudits")
              .withIndex("by_run_and_created_at", (q) => q.eq("runId", previousRun._id))
              .order("desc")
              .collect()
          : Promise.resolve([]),
      ])

    const artifacts = await Promise.all(
      rawArtifacts.map(async (artifact) => ({
        ...artifact,
        url: artifact.storageId
          ? await ctx.storage.getUrl(artifact.storageId)
          : undefined,
      })),
    )

    const artifactById = new Map(artifacts.map((artifact) => [artifact._id, artifact]))

    const findings = rawFindings
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((finding) => ({
        ...finding,
        artifactUrl: finding.artifactId
          ? artifactById.get(finding.artifactId)?.url
          : undefined,
      }))

    const performanceAudits = rawPerformanceAudits.map((audit) => ({
      ...audit,
      reportUrl: audit.reportArtifactId
        ? artifactById.get(audit.reportArtifactId)?.url
        : undefined,
    }))

    const latestReportArtifact =
      artifacts.find((artifact) => artifact.type === "html-report") ??
      artifacts.find((artifact) => artifact.type === "trace") ??
      null

    const scoreSummary = buildScoreSummary({
      findings: findings.map((finding) => ({
        score: finding.score,
        source: finding.source,
      })),
      performanceAudits: performanceAudits.length,
      screenshots: artifacts.filter((artifact) => artifact.type === "screenshot").length,
    })

    return {
      run,
      session,
      artifacts,
      findings,
      performanceAudits,
      latestReportArtifact,
      currentAuditTrend: buildAuditTrend({
        currentAudits: rawPerformanceAudits,
        previousAudits: previousRunAudits,
        runUrl: run.url,
      }),
      scoreSummary,
    }
  },
})

export const listRuns = query({
  args: {},
  handler: async (ctx) => {
    const allRuns = await ctx.db
      .query("runs")
      .withIndex("by_started_at")
      .order("desc")
      .collect()
    const runs = allRuns.filter(
      (run) =>
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "cancelled",
    )

    const items = await Promise.all(
      runs.map(async (run) => {
        const [session, artifacts, currentAudits, previousRun] = await Promise.all([
          ctx.db
            .query("sessions")
            .withIndex("by_run_and_started_at", (q) => q.eq("runId", run._id))
            .order("desc")
            .first(),
          ctx.db
            .query("artifacts")
            .withIndex("by_run_and_created_at", (q) => q.eq("runId", run._id))
            .order("desc")
            .collect(),
          ctx.db
            .query("performanceAudits")
            .withIndex("by_run_and_created_at", (q) => q.eq("runId", run._id))
            .order("desc")
            .collect(),
          findPreviousRunByUrl(ctx, run._id, run.url),
        ])

        const previousAudits = previousRun
          ? await ctx.db
              .query("performanceAudits")
              .withIndex("by_run_and_created_at", (q) => q.eq("runId", previousRun._id))
              .order("desc")
              .collect()
          : []

        return {
          run,
          session,
          latestReportArtifact:
            artifacts.find((artifact) => artifact.type === "html-report") ??
            artifacts.find((artifact) => artifact.type === "trace") ??
            null,
          currentAuditTrend: buildAuditTrend({
            currentAudits,
            previousAudits,
            runUrl: run.url,
          }),
        }
      }),
    )

    return items
  },
})

export const getDashboardRuns = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_started_at")
      .order("desc")
      .take(12)

    return await Promise.all(
      runs.map(async (run) => {
        const [findings, audits, previousRun] = await Promise.all([
          ctx.db
            .query("findings")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .collect(),
          ctx.db
            .query("performanceAudits")
            .withIndex("by_run_and_created_at", (q) => q.eq("runId", run._id))
            .order("desc")
            .collect(),
          findPreviousRunByUrl(ctx, run._id, run.url),
        ])

        const previousAudits = previousRun
          ? await ctx.db
              .query("performanceAudits")
              .withIndex("by_run_and_created_at", (q) => q.eq("runId", previousRun._id))
              .order("desc")
              .collect()
          : []

        return {
          run,
          findingsCount: findings.length,
          currentAuditTrend: buildAuditTrend({
            currentAudits: audits,
            previousAudits,
            runUrl: run.url,
          }),
        }
      }),
    )
  },
})

async function findPreviousRunByUrl(
  ctx: QueryCtx,
  runId: Id<"runs">,
  url: string,
) {
  return await ctx.db
    .query("runs")
    .withIndex("by_started_at")
    .order("desc")
    .filter((q) =>
      q.and(
        q.eq(q.field("url"), url),
        q.neq(q.field("_id"), runId),
      ),
    )
    .first()
}
