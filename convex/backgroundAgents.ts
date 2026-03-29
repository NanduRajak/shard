import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { DEFAULT_BACKGROUND_TASK_INSTRUCTIONS } from "../src/lib/background-agent-task"
import {
  dedupeMergedFindings,
  deriveBackgroundOrchestratorStatus,
  getAgentDurationMs,
  getOrchestratorDurationMs,
} from "../src/lib/background-orchestrator-report"
import { buildScoreSummary } from "../src/lib/scoring"
import { validateBackgroundOrchestratorCreationInput } from "../src/lib/background-orchestrator-creation"

function isActiveRun(
  status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting",
) {
  return status === "queued" || status === "starting" || status === "running"
}

async function buildCredentialList(ctx: any) {
  const credentials = await ctx.db.query("credentials").collect()

  return credentials
    .slice()
    .filter((credential: any) => typeof credential.login === "string")
    .sort((left: any, right: any) => {
      const websiteComparison = left.website.localeCompare(right.website)

      if (websiteComparison !== 0) {
        return websiteComparison
      }

      return left.login.localeCompare(right.login)
    })
    .map((credential: any) => ({
      _id: credential._id,
      isDefault: credential.isDefault ?? false,
      login: credential.login,
      origin: credential.origin,
      website: credential.website,
    }))
}

async function getRunsForOrchestrator(ctx: any, orchestratorId: string) {
  return await ctx.db
    .query("runs")
    .withIndex("by_background_orchestrator", (q: any) =>
      q.eq("backgroundOrchestratorId", orchestratorId),
    )
    .collect()
}

async function buildAgentRunReport(ctx: any, run: any) {
  const [rawArtifacts, rawFindings, runEvents, session, performanceAudits] = await Promise.all([
    ctx.db
      .query("artifacts")
      .withIndex("by_run_and_created_at", (q: any) => q.eq("runId", run._id))
      .order("desc")
      .collect(),
    ctx.db
      .query("findings")
      .withIndex("by_run", (q: any) => q.eq("runId", run._id))
      .collect(),
    ctx.db
      .query("runEvents")
      .withIndex("by_run_and_created_at", (q: any) => q.eq("runId", run._id))
      .order("asc")
      .collect(),
    ctx.db
      .query("sessions")
      .withIndex("by_run_and_started_at", (q: any) => q.eq("runId", run._id))
      .order("desc")
      .first(),
    ctx.db
      .query("performanceAudits")
      .withIndex("by_run_and_created_at", (q: any) => q.eq("runId", run._id))
      .order("desc")
      .collect(),
  ])

  const artifacts = await Promise.all(
    rawArtifacts.map(async (artifact: any) => ({
      ...artifact,
      url: artifact.storageId ? await ctx.storage.getUrl(artifact.storageId) : undefined,
    })),
  )
  const artifactById = new Map(artifacts.map((artifact: any) => [artifact._id, artifact]))
  const findings = rawFindings
    .slice()
    .sort((left: any, right: any) => right.createdAt - left.createdAt)
    .map((finding: any) => ({
      ...finding,
      artifactUrl: finding.artifactId ? artifactById.get(finding.artifactId)?.url : undefined,
    }))
  const hydratedEvents = runEvents.map((event: any) => ({
    ...event,
    artifactUrl: event.artifactId ? artifactById.get(event.artifactId)?.url : undefined,
  }))
  const screenshots = artifacts
    .filter((artifact: any) => artifact.type === "screenshot")
    .slice()
    .sort((left: any, right: any) => left.createdAt - right.createdAt)

  return {
    artifacts,
    durationMs: getAgentDurationMs(run),
    findings,
    findingCounts: {
      console: findings.filter((finding: any) => finding.browserSignal === "console").length,
      network: findings.filter((finding: any) => finding.browserSignal === "network").length,
      pageerror: findings.filter((finding: any) => finding.browserSignal === "pageerror").length,
      total: findings.length,
    },
    latestScreenshot: screenshots[screenshots.length - 1] ?? null,
    performanceAudits: performanceAudits.map((audit: any) => ({
      ...audit,
      reportUrl: audit.reportArtifactId
        ? artifactById.get(audit.reportArtifactId)?.url
        : undefined,
    })),
    run,
    runEvents: hydratedEvents,
    screenshots,
    session,
    traceArtifact: artifacts.find((artifact: any) => artifact.type === "trace") ?? null,
  }
}

async function buildOrchestratorSummary(ctx: any, orchestrator: any) {
  const runs = await getRunsForOrchestrator(ctx, orchestrator._id)
  const sortedRuns = runs
    .slice()
    .sort((left: any, right: any) => (left.agentOrdinal ?? 0) - (right.agentOrdinal ?? 0))
  const status = deriveBackgroundOrchestratorStatus(sortedRuns.map((run: any) => run.status))
  const updatedAt = Math.max(
    orchestrator.updatedAt,
    ...sortedRuns.map((run: any) => run.updatedAt),
  )

  return {
    counts: {
      completed: sortedRuns.filter((run: any) => run.status === "completed").length,
      failed: sortedRuns.filter((run: any) => run.status === "failed" || run.status === "cancelled")
        .length,
      queued: sortedRuns.filter((run: any) => run.status === "queued").length,
      running: sortedRuns.filter((run: any) => run.status === "starting" || run.status === "running")
        .length,
    },
    durationMs: getOrchestratorDurationMs(sortedRuns),
    orchestrator,
    status,
    updatedAt,
  }
}

export const createBackgroundOrchestrator = mutation({
  args: {
    agentCount: v.number(),
    assignments: v.array(
      v.object({
        credentialId: v.optional(v.id("credentials")),
        instructions: v.string(),
        url: v.string(),
      }),
    ),
    credentialId: v.optional(v.id("credentials")),
    instructions: v.string(),
    origin: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    validateBackgroundOrchestratorCreationInput(args)

    if (args.credentialId) {
      const credential = await ctx.db.get(args.credentialId)

      if (!credential) {
        throw new Error("Selected credential was not found.")
      }

      if (credential.origin !== args.origin) {
        throw new Error("Selected credential does not match the website origin.")
      }
    }

    for (const assignment of args.assignments) {
      if (!assignment.credentialId) {
        continue
      }

      const credential = await ctx.db.get(assignment.credentialId)

      if (!credential) {
        throw new Error("Selected credential was not found.")
      }

      if (credential.origin !== args.origin) {
        throw new Error("Selected credential does not match the website origin.")
      }
    }

    const now = Date.now()
    const orchestratorId = await ctx.db.insert("backgroundOrchestrators", {
      agentCount: args.agentCount,
      createdAt: now,
      credentialId: args.credentialId,
      instructions: args.instructions,
      origin: args.origin,
      updatedAt: now,
      url: args.url,
    })

    const runIds = []

    for (const [index, assignment] of args.assignments.entries()) {
      const runId = await ctx.db.insert("runs", {
        agentOrdinal: index + 1,
        backgroundOrchestratorId: orchestratorId,
        browserProvider: "playwright",
        credentialId: assignment.credentialId,
        currentStep: "Queued for orchestrator QA",
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
        title: "Orchestrator agent queued",
        body:
          assignment.instructions === DEFAULT_BACKGROUND_TASK_INSTRUCTIONS
            ? "The orchestrator agent is queued for the built-in end-to-end QA audit."
            : `The orchestrator agent is queued for autonomous QA.\nTask: ${assignment.instructions}`,
        status: "queued",
        pageUrl: assignment.url,
        createdAt: now,
      })

      runIds.push(runId)
    }

    return { orchestratorId, runIds }
  },
})

export const listCredentialsForBackgroundOrchestrators = query({
  args: {},
  handler: async (ctx) => {
    return await buildCredentialList(ctx)
  },
})

export const listBackgroundOrchestrators = query({
  args: {},
  handler: async (ctx) => {
    const orchestrators = await ctx.db
      .query("backgroundOrchestrators")
      .withIndex("by_created_at")
      .order("desc")
      .collect()

    const summaries = await Promise.all(
      orchestrators.map((orchestrator) => buildOrchestratorSummary(ctx, orchestrator)),
    )

    return summaries
      .slice()
      .sort((left: any, right: any) => right.updatedAt - left.updatedAt)
  },
})

export const getBackgroundOrchestratorDetail = query({
  args: {
    orchestratorId: v.optional(v.id("backgroundOrchestrators")),
  },
  handler: async (ctx, args) => {
    if (!args.orchestratorId) {
      return null
    }

    const orchestrator = await ctx.db.get(args.orchestratorId)

    if (!orchestrator) {
      return null
    }

    const [credential, runs] = await Promise.all([
      orchestrator.credentialId ? ctx.db.get(orchestrator.credentialId) : Promise.resolve(null),
      getRunsForOrchestrator(ctx, orchestrator._id),
    ])
    const sortedRuns = runs
      .slice()
      .sort((left: any, right: any) => (left.agentOrdinal ?? 0) - (right.agentOrdinal ?? 0))
    const findingsByRunId = new Map<string, number>()

    await Promise.all(
      sortedRuns.map(async (run: any) => {
        const findings = await ctx.db
          .query("findings")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .collect()
        findingsByRunId.set(run._id, findings.length)
      }),
    )

    return {
      agents: sortedRuns.map((run: any) => ({
        durationMs: getAgentDurationMs(run),
        findingsCount: findingsByRunId.get(run._id) ?? 0,
        run,
      })),
      counts: {
        completed: sortedRuns.filter((run: any) => run.status === "completed").length,
        failed: sortedRuns.filter((run: any) => run.status === "failed" || run.status === "cancelled")
          .length,
        queued: sortedRuns.filter((run: any) => run.status === "queued").length,
        running: sortedRuns.filter((run: any) => run.status === "starting" || run.status === "running")
          .length,
      },
      credential: credential
        ? {
            _id: credential._id,
            login: credential.login,
            website: credential.website,
          }
        : null,
      durationMs: getOrchestratorDurationMs(sortedRuns),
      orchestrator,
      status: deriveBackgroundOrchestratorStatus(sortedRuns.map((run: any) => run.status)),
    }
  },
})

export const getBackgroundOrchestratorReport = query({
  args: {
    orchestratorId: v.optional(v.id("backgroundOrchestrators")),
  },
  handler: async (ctx, args) => {
    if (!args.orchestratorId) {
      return null
    }

    const detail = await ctx.db.get(args.orchestratorId)

    if (!detail) {
      return null
    }

    const runs = await getRunsForOrchestrator(ctx, detail._id)
    const sortedRuns = runs
      .slice()
      .sort((left: any, right: any) => (left.agentOrdinal ?? 0) - (right.agentOrdinal ?? 0))
    const agentRuns = await Promise.all(
      sortedRuns.map((run: any) => buildAgentRunReport(ctx, run)),
    )
    const allFindings = agentRuns.flatMap((agentRun) => agentRun.findings)
    const mergedFindings = dedupeMergedFindings(allFindings)
    const mergedPerformanceAudits = agentRuns.flatMap((agentRun) => agentRun.performanceAudits)
    const mergedArtifacts = agentRuns.flatMap((agentRun) => agentRun.artifacts)
    const coverageUrls = Array.from(
      new Set(
        [
          detail.url,
          ...agentRuns.flatMap((agentRun) =>
            agentRun.runEvents.map((event: any) => event.pageUrl),
          ),
          ...mergedFindings.map((finding) => finding.pageOrFlow),
        ].filter((value): value is string => Boolean(value)),
      ),
    )

    return {
      agentRuns,
      coverageUrls,
      durationMs: getOrchestratorDurationMs(sortedRuns),
      mergedFindings,
      mergedPerformanceAudits,
      orchestrator: detail,
      scoreSummary: buildScoreSummary({
        findings: mergedFindings.map((finding) => ({
          score: finding.score ?? 0,
          source: finding.source,
        })),
        performanceAudits: mergedPerformanceAudits.length,
        screenshots: mergedArtifacts.filter((artifact) => artifact.type === "screenshot").length,
      }),
      status: deriveBackgroundOrchestratorStatus(sortedRuns.map((run: any) => run.status)),
      summary: {
        completed: sortedRuns.filter((run: any) => run.status === "completed").length,
        failed: sortedRuns.filter((run: any) => run.status === "failed" || run.status === "cancelled")
          .length,
        queued: sortedRuns.filter((run: any) => run.status === "queued").length,
        running: sortedRuns.filter((run: any) => run.status === "starting" || run.status === "running")
          .length,
      },
    }
  },
})

export const requestBackgroundOrchestratorStop = mutation({
  args: {
    orchestratorId: v.id("backgroundOrchestrators"),
  },
  handler: async (ctx, args) => {
    const orchestrator = await ctx.db.get(args.orchestratorId)

    if (!orchestrator) {
      return { ok: false as const, reason: "not_found" as const }
    }

    const stopRequestedAt = orchestrator.stopRequestedAt ?? Date.now()
    const runs = await getRunsForOrchestrator(ctx, orchestrator._id)
    const activeRuns = runs.filter((run: any) => isActiveRun(run.status))

    await ctx.db.patch(orchestrator._id, {
      stopRequestedAt,
      updatedAt: stopRequestedAt,
    })

    for (const run of activeRuns) {
      if (run.status === "queued") {
        await ctx.db.patch(run._id, {
          stopRequestedAt,
          status: "cancelled",
          currentStep: "Run cancelled before execution started",
          finishedAt: stopRequestedAt,
          updatedAt: stopRequestedAt,
        })

        await ctx.db.insert("runEvents", {
          runId: run._id,
          kind: "status",
          title: "Run cancelled",
          body: "The orchestrator cancelled this agent before execution started.",
          status: "cancelled",
          pageUrl: run.currentUrl ?? run.url,
          createdAt: stopRequestedAt,
        })
      } else {
        await ctx.db.patch(run._id, {
          stopRequestedAt,
          currentStep: "Stop requested, shutting down run",
          updatedAt: stopRequestedAt,
        })

        await ctx.db.insert("runEvents", {
          runId: run._id,
          kind: "status",
          title: "Stop requested",
          body: "The orchestrator requested this agent to stop after the current step settles.",
          status: run.status,
          pageUrl: run.currentUrl ?? run.url,
          createdAt: stopRequestedAt,
        })
      }
    }

    if (activeRuns.every((run: any) => run.status === "queued")) {
      await ctx.db.patch(orchestrator._id, {
        finishedAt: stopRequestedAt,
      })
    }

    return {
      ok: true as const,
      stopRequestedAt,
      stoppedRuns: activeRuns.length,
    }
  },
})
