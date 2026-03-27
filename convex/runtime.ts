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

const runGoalStatus = v.union(
  v.literal("not_requested"),
  v.literal("completed"),
  v.literal("partially_completed"),
  v.literal("blocked"),
)

const queueState = v.union(
  v.literal("pending"),
  v.literal("waiting_for_worker"),
  v.literal("worker_unreachable"),
  v.literal("picked_up"),
)

const sessionStatus = v.union(
  v.literal("creating"),
  v.literal("active"),
  v.literal("closed"),
  v.literal("failed"),
)

const runEventKind = v.union(
  v.literal("status"),
  v.literal("session"),
  v.literal("navigation"),
  v.literal("agent"),
  v.literal("artifact"),
  v.literal("finding"),
  v.literal("audit"),
  v.literal("system"),
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
    queueState: v.optional(queueState),
    currentStep: v.optional(v.string()),
    currentUrl: v.optional(v.union(v.string(), v.null())),
    errorMessage: v.optional(v.union(v.string(), v.null())),
    stopRequestedAt: v.optional(v.union(v.number(), v.null())),
    goalStatus: v.optional(v.union(runGoalStatus, v.null())),
    goalSummary: v.optional(v.union(v.string(), v.null())),
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
      goalStatus?: "blocked" | "completed" | "not_requested" | "partially_completed" | undefined
      goalSummary?: string | undefined
      stopRequestedAt?: number | undefined
      queueState?: "pending" | "picked_up" | "waiting_for_worker" | "worker_unreachable"
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

    if (args.queueState !== undefined) {
      patch.queueState = args.queueState
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

    if (args.goalStatus !== undefined) {
      patch.goalStatus = args.goalStatus ?? undefined
    }

    if (args.goalSummary !== undefined) {
      patch.goalSummary = args.goalSummary ?? undefined
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

function normalizeQueueState(
  queueStateValue?: "pending" | "picked_up" | "waiting_for_worker" | "worker_unreachable",
) {
  return queueStateValue ?? "pending"
}

export const resetRunState = mutation({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)

    if (!run) {
      return
    }

    const [findings, artifacts, performanceAudits, sessions, runEvents] = await Promise.all([
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
      ctx.db
        .query("runEvents")
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
    await Promise.all(runEvents.map((event) => ctx.db.delete(event._id)))

    await ctx.db.patch(args.runId, {
      updatedAt: Date.now(),
      queueState: "pending",
      currentUrl: undefined,
      errorMessage: undefined,
      finalScore: undefined,
      finishedAt: undefined,
      goalStatus: run.mode === "task" ? "not_requested" : undefined,
      goalSummary: undefined,
    })
  },
})

export const updateRunQueueState = mutation({
  args: {
    runId: v.id("runs"),
    queueState: queueState,
    title: v.optional(v.string()),
    body: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)

    if (!run) {
      return { ok: false as const, reason: "not_found" as const }
    }

    if (normalizeQueueState(run.queueState) === args.queueState) {
      return { ok: true as const, changed: false as const }
    }

    await ctx.db.patch(args.runId, {
      queueState: args.queueState,
      updatedAt: Date.now(),
    })

    if (args.title) {
      await ctx.db.insert("runEvents", {
        runId: args.runId,
        kind: "system",
        title: args.title,
        body: args.body,
        status: run.status,
        pageUrl: run.currentUrl ?? run.url,
        createdAt: Date.now(),
      })
    }

    return { ok: true as const, changed: true as const }
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

    await ctx.db.insert("runEvents", {
      runId: args.runId,
      kind: "status",
      title: "Stop requested",
      body: "The run will shut down after the current step settles and cleanup completes.",
      status: run.status,
      pageUrl: run.currentUrl,
      createdAt: Date.now(),
    })

    return { ok: true as const, stopRequestedAt }
  },
})

export const clearAllData = mutation({
  args: {},
  handler: async (ctx) => {
    const [runs, findings, artifacts, prReviews, sessions, runEvents, performanceAudits, credentials] =
      await Promise.all([
        ctx.db.query("runs").collect(),
        ctx.db.query("findings").collect(),
        ctx.db.query("artifacts").collect(),
        ctx.db.query("prReviews").collect(),
        ctx.db.query("sessions").collect(),
        ctx.db.query("runEvents").collect(),
        ctx.db.query("performanceAudits").collect(),
        ctx.db.query("credentials").collect(),
      ])

    await Promise.all(
      artifacts.map(async (artifact) => {
        if (artifact.storageId) {
          await ctx.storage.delete(artifact.storageId).catch(() => undefined)
        }
      }),
    )

    await Promise.all([
      ...findings.map((doc) => ctx.db.delete(doc._id)),
      ...artifacts.map((doc) => ctx.db.delete(doc._id)),
      ...prReviews.map((doc) => ctx.db.delete(doc._id)),
      ...sessions.map((doc) => ctx.db.delete(doc._id)),
      ...runEvents.map((doc) => ctx.db.delete(doc._id)),
      ...performanceAudits.map((doc) => ctx.db.delete(doc._id)),
      ...credentials.map((doc) => ctx.db.delete(doc._id)),
      ...runs.map((doc) => ctx.db.delete(doc._id)),
    ])

    return {
      ok: true as const,
      counts: {
        artifacts: artifacts.length,
        credentials: credentials.length,
        findings: findings.length,
        performanceAudits: performanceAudits.length,
        prReviews: prReviews.length,
        runEvents: runEvents.length,
        runs: runs.length,
        sessions: sessions.length,
      },
    }
  },
})

export const deleteRun = mutation({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)

    if (!run) {
      return { ok: false as const, reason: "not_found" as const }
    }

    const [findings, artifacts, sessions, runEvents, performanceAudits, prReviews] =
      await Promise.all([
        ctx.db
          .query("findings")
          .withIndex("by_run", (q) => q.eq("runId", args.runId))
          .collect(),
        ctx.db
          .query("artifacts")
          .withIndex("by_run", (q) => q.eq("runId", args.runId))
          .collect(),
        ctx.db
          .query("sessions")
          .withIndex("by_run", (q) => q.eq("runId", args.runId))
          .collect(),
        ctx.db
          .query("runEvents")
          .withIndex("by_run", (q) => q.eq("runId", args.runId))
          .collect(),
        ctx.db
          .query("performanceAudits")
          .withIndex("by_run", (q) => q.eq("runId", args.runId))
          .collect(),
        ctx.db.query("prReviews").collect(),
      ])

    const linkedReviews = prReviews.filter((review) => review.browserRunId === args.runId)

    await Promise.all(
      artifacts.map(async (artifact) => {
        if (artifact.storageId) {
          await ctx.storage.delete(artifact.storageId).catch(() => undefined)
        }
      }),
    )

    await Promise.all([
      ...linkedReviews.map((review) =>
        ctx.db.patch(review._id, {
          browserRunId: undefined,
          updatedAt: Date.now(),
        }),
      ),
      ...findings.map((finding) => ctx.db.delete(finding._id)),
      ...artifacts.map((artifact) => ctx.db.delete(artifact._id)),
      ...sessions.map((session) => ctx.db.delete(session._id)),
      ...runEvents.map((event) => ctx.db.delete(event._id)),
      ...performanceAudits.map((audit) => ctx.db.delete(audit._id)),
    ])

    await ctx.db.delete(args.runId)

    return {
      ok: true as const,
      counts: {
        artifacts: artifacts.length,
        findings: findings.length,
        performanceAudits: performanceAudits.length,
        prReviewsCleared: linkedReviews.length,
        runEvents: runEvents.length,
        sessions: sessions.length,
      },
    }
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
      queueState: normalizeQueueState(run.queueState),
      startedAt: run.startedAt,
      stopRequestedAt: run.stopRequestedAt ?? null,
      currentUrl: run.currentUrl ?? null,
    }
  },
})

export const getSessionReplayAccess = query({
  args: {
    externalSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_external_session_id", (q) =>
        q.eq("externalSessionId", args.externalSessionId),
      )
      .first()

    if (!session) {
      return null
    }

    const run = await ctx.db.get(session.runId)

    if (!run) {
      return null
    }

    return {
      externalSessionId: session.externalSessionId,
      runId: session.runId,
      status: session.status,
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

export const createRunEvent = mutation({
  args: {
    runId: v.id("runs"),
    kind: runEventKind,
    title: v.string(),
    body: v.optional(v.string()),
    status: v.optional(runStatus),
    stepIndex: v.optional(v.number()),
    pageUrl: v.optional(v.string()),
    sessionId: v.optional(v.id("sessions")),
    artifactId: v.optional(v.id("artifacts")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("runEvents", {
      ...args,
      createdAt: Date.now(),
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

    const [session, rawArtifacts, rawFindings, rawPerformanceAudits, rawRunEvents, previousRunAudits] =
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
        ctx.db
          .query("runEvents")
          .withIndex("by_run_and_created_at", (q) => q.eq("runId", args.runId))
          .order("asc")
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

    const runEvents = rawRunEvents.map((event) => ({
      ...event,
      artifactUrl: event.artifactId ? artifactById.get(event.artifactId)?.url : undefined,
    }))

    const latestReportArtifact =
      artifacts.find((artifact) => artifact.type === "html-report") ??
      artifacts.find((artifact) => artifact.type === "trace") ??
      null

    const scoreSummary = buildScoreSummary({
      findings: findings.map((finding) => ({
        score: finding.score ?? 0,
        source: finding.source,
      })),
      performanceAudits: performanceAudits.length,
      screenshots: artifacts.filter((artifact) => artifact.type === "screenshot").length,
    })

    return {
      run: {
        ...run,
        mode: run.mode ?? "explore",
        queueState: normalizeQueueState(run.queueState),
      },
      session,
      sessionDurationMs: getSessionDurationMs({
        runFinishedAt: run.finishedAt,
        runStartedAt: run.startedAt,
        session,
      }),
      executionState: buildExecutionState({
        run,
        session,
      }),
      artifacts,
      runEvents,
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
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_started_at")
      .order("desc")
      .collect()

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
          run: {
            ...run,
            mode: run.mode ?? "explore",
          },
          session,
          sessionDurationMs: getSessionDurationMs({
            runFinishedAt: run.finishedAt,
            runStartedAt: run.startedAt,
            session,
          }),
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

function buildExecutionState({
  run,
  session,
}: {
  run: {
    queueState?: "pending" | "picked_up" | "waiting_for_worker" | "worker_unreachable"
    status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
  }
  session:
    | {
        replayUrl?: string
        status: "active" | "closed" | "creating" | "failed"
      }
    | null
}) {
  if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
    return "terminal" as const
  }

  if (session?.status === "active") {
    return "preview_active" as const
  }

  if (session?.status === "creating") {
    return "session_creating" as const
  }

  if (normalizeQueueState(run.queueState) === "worker_unreachable") {
    return "worker_unreachable" as const
  }

  if (normalizeQueueState(run.queueState) === "waiting_for_worker") {
    return "waiting_for_worker" as const
  }

  if (normalizeQueueState(run.queueState) === "picked_up") {
    return "worker_picked_up" as const
  }

  return "queued" as const
}

function getSessionDurationMs({
  runFinishedAt,
  runStartedAt,
  session,
}: {
  runFinishedAt?: number
  runStartedAt: number
  session:
    | {
        finishedAt?: number
        startedAt: number
      }
    | null
}) {
  if (session?.finishedAt) {
    return Math.max(session.finishedAt - session.startedAt, 0)
  }

  if (runFinishedAt) {
    return Math.max(runFinishedAt - (session?.startedAt ?? runStartedAt), 0)
  }

  return null
}
