import lighthouse from "lighthouse"
import { launch } from "chrome-launcher"
import { generateObject, generateText, stepCountIs, tool } from "ai"
import { z } from "zod"
import { scoreLighthouseFinding } from "./lighthouse-audits.ts"
import { pickQaFallbackAction } from "./qa-fallback.ts"
import {
  buildActionSignature,
  isSameHostname,
  resolveSameHostUrl,
  shouldStopForNoOps,
  shouldStopForRepeatActions,
  wouldExceedPageLimit,
} from "./qa-guards.ts"
import {
  buildScoreSummary,
  computeFindingScore,
  impactWeightForSource,
  type FindingSource,
  type FindingSeverity,
} from "./scoring.ts"

const MAX_PAGE_FINDINGS = 2
const MAX_TOOL_ATTEMPTS = 3
const TOOL_RETRY_DELAY_MS = 350

export type QaRunMode = "explore" | "task"
export type QaRunStatus =
  | "queued"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type QaEventKind =
  | "status"
  | "session"
  | "navigation"
  | "agent"
  | "artifact"
  | "finding"
  | "audit"
  | "system"

export type QaBrowserSignal = "console" | "network" | "pageerror"

export type QaRunGoalStatus =
  | "not_requested"
  | "completed"
  | "partially_completed"
  | "blocked"

export type QaArtifactType = "screenshot" | "trace" | "html-report" | "replay"

export type GoalOutcome = {
  status: "blocked" | "completed" | "partially_completed"
  summary: string
}

export type ToolOutcome = {
  actionKey?: string
  artifactCreated?: boolean
  changed: boolean
  currentUrl: string
  fallback?: boolean
  goalOutcome?: GoalOutcome
  note: string
  target?: string
  toolName:
    | "captureScreenshot"
    | "clickElement"
    | "fillInput"
    | "navigateToUrl"
    | "useStoredLogin"
  verifiedGoalOutcome?: GoalOutcome
}

export type BufferedFinding = {
  browserSignal?: QaBrowserSignal
  confidence: number
  description: string
  pageOrFlow?: string
  severity: FindingSeverity
  signature: string
  source: Extract<FindingSource, "browser" | "perf">
  suggestedFix?: string
  title: string
}

export type SavedFinding = {
  score: number
  source: Extract<FindingSource, "browser" | "perf">
}

export type PageCandidate = {
  findingCount: number
  firstSeenAt: number
  interactionCount: number
  url: string
}

export type InteractiveElement = {
  href?: string | null
  id: number
  label: string
  ref: string
  role?: string | null
  tagName: string
  type?: string | null
}

export type PageSnapshot = {
  formsSummary: string
  interactives: InteractiveElement[]
  signature: string
  textExcerpt: string
  title: string
  url: string
}

export type QaRuntimeConfig = {
  agentTimeBudgetMs: number
  maxAgentSteps: number
  maxDiscoveredPages: number
}

export type StoredCredential = {
  login: string
  origin: string
  password: string
}

export type QaBrowserAdapter = {
  captureRuntimeFindings: (
    startUrl: string,
    bufferedFindings: BufferedFinding[],
  ) => Promise<void>
  click: (ref: string) => Promise<void>
  fill: (ref: string, value: string) => Promise<void>
  getCurrentUrl: () => Promise<string>
  goBack?: () => Promise<void>
  inspectCurrentPage: () => Promise<PageSnapshot>
  navigate: (url: string) => Promise<void>
  pressKey?: (key: string) => Promise<void>
  startRuntimeCapture?: (
    startUrl: string,
    bufferedFindings: BufferedFinding[],
  ) => Promise<void> | void
  takeScreenshot: () => Promise<Uint8Array>
  useStoredLogin?: (credential: StoredCredential) => Promise<boolean>
}

export type QaRuntimeSink = {
  createArtifact: (payload: {
    body: Uint8Array
    contentType: string
    pageUrl?: string
    title?: string
    type: QaArtifactType
  }) => Promise<string>
  createFinding: (payload: {
    artifactId?: string
    browserSignal?: QaBrowserSignal
    confidence: number
    description: string
    impact: number
    pageOrFlow?: string
    score: number
    severity: FindingSeverity
    source: Extract<FindingSource, "browser" | "perf">
    stepIndex?: number
    suggestedFix?: string
    title: string
  }) => Promise<void>
  createPerformanceAudit?: (payload: {
    accessibilityScore: number
    bestPracticesScore: number
    pageUrl: string
    performanceScore: number
    reportArtifactId?: string
    seoScore: number
  }) => Promise<void>
  emitEvent: (payload: {
    artifactId?: string
    body?: string
    kind: QaEventKind
    pageUrl?: string
    status?: QaRunStatus
    stepIndex?: number
    title: string
  }) => Promise<void>
  getAbortSignal?: () => AbortSignal | undefined
  getStopState?: () => Promise<{
    currentUrl: string | null
    stopRequestedAt: number | null
  } | null>
  updateRun?: (payload: {
    currentStep?: string
    currentUrl?: string | null
    errorMessage?: string | null
    finalScore?: number
    finishedAt?: number
    goalStatus?: QaRunGoalStatus | null
    goalSummary?: string | null
    queueState?: "pending" | "picked_up" | "waiting_for_worker" | "worker_unreachable"
    status?: QaRunStatus
  }) => Promise<void>
}

export type QaSessionResult = {
  finalScore: number
  goalOutcome?: GoalOutcome
  performanceAuditCount: number
  screenshotCount: number
  scoreSummary: ReturnType<typeof buildScoreSummary>
}

const pageReviewSchema = z.object({
  findings: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        severity: z.enum(["low", "medium", "high", "critical"]),
        confidence: z.number().min(0).max(1),
        suggestedFix: z.string().min(1).nullable(),
      }),
    )
    .max(MAX_PAGE_FINDINGS),
})

const taskProofSchema = z.object({
  proof: z.string().min(1).nullable(),
  status: z.enum(["blocked", "completed", "not_yet", "partially_completed"]),
  summary: z.string().min(1),
})

export class QaRunCancelledError extends Error {
  readonly currentUrl?: string

  constructor(
    message: string,
    currentUrl?: string,
  ) {
    super(message)
    this.currentUrl = currentUrl
  }
}

export async function runQaSession({
  browser,
  config,
  getStoredCredential,
  instructions,
  mode,
  model,
  runtime,
  startUrl,
}: {
  browser: QaBrowserAdapter
  config: QaRuntimeConfig
  getStoredCredential?: () => Promise<StoredCredential | null>
  instructions?: string
  mode: QaRunMode
  model: any
  runtime: QaRuntimeSink
  startUrl: string
}) {
  const bufferedFindings: BufferedFinding[] = []
  const pageCandidates = new Map<string, PageCandidate>()
  const findingSignatures = new Set<string>()
  const savedFindings: SavedFinding[] = []

  let screenshotCount = 0
  let performanceAuditCount = 0

  await browser.startRuntimeCapture?.(startUrl, bufferedFindings)
  await browser.captureRuntimeFindings(startUrl, bufferedFindings)

  screenshotCount += await runSnapshotStage({
    analyzedSnapshots: new Set<string>(),
    browser,
    bufferedFindings,
    config,
    findingSignatures,
    model,
    pageCandidates,
    runtime,
    savedFindings,
    stepIndex: 0,
  })

  screenshotCount += await throwIfStopRequested({
    bufferedFindings,
    findingSignatures,
    pageCandidates,
    pageUrl: await browser.getCurrentUrl(),
    runtime,
    savedFindings,
    stepIndex: 0,
    currentStep: "QA run stopped during exploration",
  })

  const agentLoopResult = await runAgentLoop({
    browser,
    bufferedFindings,
    config,
    findingSignatures,
    getStoredCredential,
    instructions,
    mode,
    model,
    pageCandidates,
    runtime,
    savedFindings,
    startUrl,
  })
  screenshotCount += agentLoopResult.screenshotCount

  screenshotCount += await throwIfStopRequested({
    bufferedFindings,
    findingSignatures,
    pageCandidates,
    pageUrl: await browser.getCurrentUrl(),
    runtime,
    savedFindings,
    stepIndex: config.maxAgentSteps,
    currentStep: "QA run stopped before Lighthouse",
  })

  performanceAuditCount = await runLighthouseAuditStage({
    findingSignatures,
    maxAuditUrls: config.maxDiscoveredPages,
    pageCandidates,
    runtime,
    savedFindings,
    startUrl,
    stepIndexOffset: config.maxAgentSteps,
  })

  screenshotCount += await throwIfStopRequested({
    bufferedFindings,
    findingSignatures,
    pageCandidates,
    pageUrl: await browser.getCurrentUrl(),
    runtime,
    savedFindings,
    stepIndex: config.maxAgentSteps + performanceAuditCount,
    currentStep: "QA run stopped before final scoring",
  })

  const scoreSummary = buildScoreSummary({
    findings: savedFindings,
    performanceAudits: performanceAuditCount,
    screenshots: screenshotCount,
  })

  return {
    finalScore: scoreSummary.overall,
    goalOutcome: agentLoopResult.goalOutcome,
    performanceAuditCount,
    screenshotCount,
    scoreSummary,
  } satisfies QaSessionResult
}

async function runAgentLoop({
  browser,
  bufferedFindings,
  config,
  findingSignatures,
  getStoredCredential,
  instructions,
  mode,
  model,
  pageCandidates,
  runtime,
  savedFindings,
  startUrl,
}: {
  browser: QaBrowserAdapter
  bufferedFindings: BufferedFinding[]
  config: QaRuntimeConfig
  findingSignatures: Set<string>
  getStoredCredential?: () => Promise<StoredCredential | null>
  instructions?: string
  mode: QaRunMode
  model: any
  pageCandidates: Map<string, PageCandidate>
  runtime: QaRuntimeSink
  savedFindings: SavedFinding[]
  startUrl: string
}) {
  const initialUrl = await browser.getCurrentUrl()
  const visitedPages = new Set<string>([initialUrl])
  const actionHistory: string[] = []
  const triedActions = new Set<string>()
  const analyzedSnapshots = new Set<string>()
  const deadlineAt = Date.now() + config.agentTimeBudgetMs

  let goalOutcome: GoalOutcome | undefined
  let noOpCount = 0
  let screenshotCount = 0
  let stopReason:
    | "goal"
    | "max_pages"
    | "max_steps"
    | "no_ops"
    | "planner_unavailable"
    | "repeat_actions"
    | "time_budget" = "max_steps"

  for (let stepIndex = 1; stepIndex <= config.maxAgentSteps; stepIndex += 1) {
    if (Date.now() >= deadlineAt) {
      stopReason = "time_budget"
      await runtime.emitEvent({
        kind: "system",
        title: "Exploration time budget reached",
        body: "The agent hit the exploration time budget and is moving on to scoring and cleanup.",
        pageUrl: await browser.getCurrentUrl(),
        status: "running",
        stepIndex,
      })
      break
    }

    const snapshot = await browser.inspectCurrentPage()
    pageCandidates.set(
      snapshot.url,
      pageCandidates.get(snapshot.url) ?? {
        url: snapshot.url,
        interactionCount: 0,
        findingCount: 0,
        firstSeenAt: pageCandidates.size,
      },
    )

    await throwIfStopRequested({
      bufferedFindings,
      findingSignatures,
      pageCandidates,
      pageUrl: snapshot.url,
      runtime,
      savedFindings,
      stepIndex,
      currentStep: "QA run stopped during exploration",
    })

    await runtime.updateRun?.({
      currentStep:
        mode === "task"
          ? `Task step ${stepIndex} of ${config.maxAgentSteps}`
          : `Exploration step ${stepIndex} of ${config.maxAgentSteps}`,
      currentUrl: snapshot.url,
      status: "running",
    })

    const plannerResult = await runRetriedAction(async () => {
      return await generateText({
        abortSignal: runtime.getAbortSignal?.(),
        model,
        prompt: buildAgentPrompt({
          hasStoredCredential: Boolean(getStoredCredential && browser.useStoredLogin),
          maxAgentSteps: config.maxAgentSteps,
          instructions,
          mode,
          remainingMs: Math.max(deadlineAt - Date.now(), 0),
          snapshot,
          stepIndex,
          visitedPages: [...visitedPages],
          recentActions: actionHistory.slice(-4),
        }),
        maxOutputTokens: 300,
        temperature: 0.2,
        stopWhen: stepCountIs(4),
        tools: buildAgentTools({
          browser,
          config,
          getStoredCredential,
          runtime,
          startUrl,
          visitedPages,
        }),
      })
    }).catch(async (error) => {
      await runtime.emitEvent({
        kind: "system",
        title: "Agent planning unavailable",
        body: `The AI planner failed during step ${stepIndex} after ${MAX_TOOL_ATTEMPTS} attempts. The run will end exploration early instead of failing.\nError: ${
          error instanceof Error ? error.message : "Unknown AI planner error"
        }`,
        pageUrl: snapshot.url,
        status: "running",
        stepIndex,
      })

      return null
    })
    const result = plannerResult?.value ?? null

    const plannerSummary = result?.text.trim() ?? ""
    const plannerGoalOutcome =
      mode === "task" && result ? parseGoalOutcome(plannerSummary) : null
    const toolResults = result?.steps.flatMap((step: any) => step.toolResults ?? []) ?? []
    const latestToolResult = [...toolResults].reverse().find(Boolean)

    if (plannerGoalOutcome && !latestToolResult) {
      if (plannerGoalOutcome.status === "completed") {
          const verifiedCompletion = await verifyTaskCompletion({
            instructions,
            model,
            plannerSummary,
            recentActions: actionHistory.slice(-4),
            runtime,
            snapshot,
          })

        if (verifiedCompletion?.status === "completed") {
          goalOutcome = verifiedCompletion
          stopReason = "goal"
          await runtime.emitEvent({
            kind: "agent",
            title: "Task completed",
            body: verifiedCompletion.summary,
            pageUrl: snapshot.url,
            status: "running",
            stepIndex,
          })
          break
        }

        await runtime.emitEvent({
          kind: "system",
          title: "Task completion not yet proven",
          body:
            verifiedCompletion?.summary ??
            "The planner claimed the task was complete, but the visible UI did not yet provide strong proof.",
          pageUrl: snapshot.url,
          status: "running",
          stepIndex,
        })
      } else {
        goalOutcome = plannerGoalOutcome
        stopReason = "goal"
        await runtime.emitEvent({
          kind: "agent",
          title:
            plannerGoalOutcome.status === "blocked"
              ? "Task blocked"
              : "Task partially completed",
          body: plannerGoalOutcome.summary,
          pageUrl: snapshot.url,
          status: "running",
          stepIndex,
        })
        break
      }
    }

    const outcome =
      latestToolResult && isToolOutcome(latestToolResult.output)
        ? latestToolResult.output
        : await executePlannerFallback({
            browser,
            config,
            runtime,
            snapshot,
            startUrl,
            stepIndex,
            triedActions,
            visitedPages,
          })

    await browser.captureRuntimeFindings(startUrl, bufferedFindings)

    if (plannerSummary || outcome.fallback) {
      await runtime.emitEvent({
        kind: "agent",
        title: outcome.fallback ? "Fallback action selected" : "Agent decision",
        body:
          plannerSummary ||
          "The planner did not choose a tool, so the run used a bounded fallback action.",
        pageUrl: snapshot.url,
        status: "running",
        stepIndex,
      })
    }

    await runtime.emitEvent({
      kind: outcome.toolName === "navigateToUrl" ? "navigation" : "agent",
      title: formatToolOutcomeTitle(outcome),
      body: outcome.note,
      pageUrl: outcome.currentUrl,
      status: "running",
      stepIndex,
    })

    actionHistory.push(
      outcome.actionKey ??
        buildActionSignature({
          action: outcome.toolName,
          pageUrl: outcome.currentUrl,
          target: outcome.target,
        }),
    )
    triedActions.add(actionHistory[actionHistory.length - 1]!)

    if (outcome.artifactCreated) {
      screenshotCount += 1
    }

    if (shouldStopForRepeatActions(actionHistory)) {
      stopReason = "repeat_actions"
      break
    }

    const beforeFindings = savedFindings.length
    const browserFindingCount = await flushBufferedFindings({
      bufferedFindings,
      findingSignatures,
      pageCandidates,
      runtime,
      savedFindings,
      stepIndex,
    })

    const nextSnapshot = await browser.inspectCurrentPage()
    visitedPages.add(nextSnapshot.url)
    const candidate = pageCandidates.get(nextSnapshot.url)

    if (candidate && isInteractiveTool(outcome.toolName) && outcome.changed) {
      candidate.interactionCount += 1
    }

    if (mode === "task" && instructions && outcome.changed) {
      const verifiedCompletion = await verifyTaskCompletion({
        instructions,
        model,
        plannerSummary,
        recentActions: actionHistory.slice(-4),
        runtime,
        snapshot: nextSnapshot,
      })

      if (verifiedCompletion?.status === "completed") {
        goalOutcome = verifiedCompletion
        stopReason = "goal"
        await runtime.emitEvent({
          kind: "agent",
          title: "Task completed",
          body: verifiedCompletion.summary,
          pageUrl: nextSnapshot.url,
          status: "running",
          stepIndex,
        })
        break
      }
    }

    if (visitedPages.size > config.maxDiscoveredPages) {
      stopReason = "max_pages"
      break
    }

    const stateChanged = outcome.changed || nextSnapshot.signature !== snapshot.signature
    if (stateChanged) {
      noOpCount = 0
      screenshotCount += await runSnapshotStage({
        analyzedSnapshots,
        browser,
        bufferedFindings,
        config,
        findingSignatures,
        model,
        pageCandidates,
        runtime,
        savedFindings,
        stepIndex,
      })
    } else if (
      browserFindingCount === 0 &&
      savedFindings.length === beforeFindings &&
      !outcome.artifactCreated
    ) {
      noOpCount += 1
    } else {
      noOpCount = 0
    }

    if (shouldStopForNoOps(noOpCount)) {
      stopReason = "no_ops"
      break
    }
  }

  return {
    screenshotCount,
    goalOutcome:
      mode === "task"
        ? goalOutcome ??
          inferTaskOutcome({
            actionCount: actionHistory.length,
            instructions,
            stopReason,
            visitedPageCount: visitedPages.size,
          })
        : undefined,
  }
}

async function runSnapshotStage({
  analyzedSnapshots,
  browser,
  bufferedFindings,
  findingSignatures,
  model,
  pageCandidates,
  runtime,
  savedFindings,
  stepIndex,
}: {
  analyzedSnapshots: Set<string>
  browser: QaBrowserAdapter
  bufferedFindings: BufferedFinding[]
  config: QaRuntimeConfig
  findingSignatures: Set<string>
  model: any
  pageCandidates: Map<string, PageCandidate>
  runtime: QaRuntimeSink
  savedFindings: SavedFinding[]
  stepIndex: number
}) {
  const snapshot = await browser.inspectCurrentPage()
  pageCandidates.set(
    snapshot.url,
    pageCandidates.get(snapshot.url) ?? {
      url: snapshot.url,
      interactionCount: 0,
      findingCount: 0,
      firstSeenAt: pageCandidates.size,
    },
  )

  const screenshotArtifactId = await saveScreenshot({
    browser,
    runtime,
    stepIndex,
    title: stepIndex === 0 ? "Landing page screenshot" : `Step ${stepIndex} screenshot`,
  })

  await flushBufferedFindings({
    bufferedFindings,
    findingSignatures,
    pageCandidates,
    runtime,
    savedFindings,
    stepIndex,
  })

  if (analyzedSnapshots.has(snapshot.signature)) {
    return 1
  }

  analyzedSnapshots.add(snapshot.signature)

  const pageReview = await generateObject({
    abortSignal: runtime.getAbortSignal?.(),
    model,
    schema: pageReviewSchema,
    prompt: [
      "You are reviewing a public webpage during an automated QA run.",
      "Always return a JSON object with a `findings` array, even when it is empty.",
      "Return at most two concrete browser/UI findings.",
      "Focus on usability, broken states, missing context, dead ends, obvious copy/content problems, or visible defects.",
      "Do not invent auth, payment, or backend issues. If the page looks healthy, return an empty list.",
      `URL: ${snapshot.url}`,
      `Title: ${snapshot.title}`,
      `Forms: ${snapshot.formsSummary}`,
      `Visible text excerpt: ${snapshot.textExcerpt}`,
      `Interactive elements: ${snapshot.interactives.map((item) => `${item.id}. ${item.label} (${item.tagName})`).join("; ")}`,
    ].join("\n"),
  }).catch(async (error) => {
    if (isQaOperationAborted(runtime, error)) {
      throw buildQaAbortError("QA run stopped during page review", snapshot.url)
    }

    await runtime.emitEvent({
      kind: "system",
      title: "Page review skipped",
      body: `The AI page-review step failed, but the QA run will continue.\nError: ${
        error instanceof Error ? error.message : "Unknown AI review error"
      }`,
      artifactId: screenshotArtifactId,
      pageUrl: snapshot.url,
      status: "running",
      stepIndex,
    })

    return null
  })

  if (!pageReview) {
    return 1
  }

  for (const finding of pageReview.object.findings.slice(0, MAX_PAGE_FINDINGS)) {
    const signature = `browser::${snapshot.url}::${finding.title}`
    if (findingSignatures.has(signature)) {
      continue
    }

    findingSignatures.add(signature)
    const impact = impactWeightForSource("browser")
    const score = computeFindingScore({
      severity: finding.severity,
      confidence: finding.confidence,
      source: "browser",
    })

    await runtime.createFinding({
      artifactId: screenshotArtifactId,
      confidence: finding.confidence,
      description: finding.description,
      impact,
      pageOrFlow: snapshot.url,
      score,
      severity: finding.severity,
      source: "browser",
      stepIndex,
      suggestedFix: finding.suggestedFix ?? undefined,
      title: finding.title,
    })

    await runtime.emitEvent({
      kind: "finding",
      title: finding.title,
      body: finding.description,
      artifactId: screenshotArtifactId,
      pageUrl: snapshot.url,
      status: "running",
      stepIndex,
    })

    savedFindings.push({
      source: "browser",
      score,
    })

    const candidate = pageCandidates.get(snapshot.url)
    if (candidate) {
      candidate.findingCount += 1
    }
  }

  return 1
}

async function flushBufferedFindings({
  bufferedFindings,
  findingSignatures,
  pageCandidates,
  runtime,
  savedFindings,
  stepIndex,
}: {
  bufferedFindings: BufferedFinding[]
  findingSignatures: Set<string>
  pageCandidates: Map<string, PageCandidate>
  runtime: QaRuntimeSink
  savedFindings: SavedFinding[]
  stepIndex: number
}) {
  let createdCount = 0

  while (bufferedFindings.length > 0) {
    const finding = bufferedFindings.shift()
    if (!finding || findingSignatures.has(finding.signature)) {
      continue
    }

    findingSignatures.add(finding.signature)
    const impact = impactWeightForSource(finding.source)
    const score = computeFindingScore({
      severity: finding.severity,
      confidence: finding.confidence,
      source: finding.source,
    })

    await runtime.createFinding({
      browserSignal: finding.browserSignal,
      confidence: finding.confidence,
      description: finding.description,
      impact,
      pageOrFlow: finding.pageOrFlow,
      score,
      severity: finding.severity,
      source: finding.source,
      stepIndex,
      suggestedFix: finding.suggestedFix,
      title: finding.title,
    })

    await runtime.emitEvent({
      kind: "finding",
      title: finding.title,
      body: finding.description,
      pageUrl: finding.pageOrFlow,
      status: "running",
      stepIndex,
    })

    savedFindings.push({
      source: finding.source,
      score,
    })
    createdCount += 1

    const candidateUrl = finding.pageOrFlow
    if (candidateUrl) {
      const candidate = pageCandidates.get(candidateUrl)
      if (candidate) {
        candidate.findingCount += 1
      }
    }
  }

  return createdCount
}

function buildAgentTools({
  browser,
  config,
  getStoredCredential,
  runtime,
  startUrl,
  visitedPages,
}: {
  browser: QaBrowserAdapter
  config: QaRuntimeConfig
  getStoredCredential?: () => Promise<StoredCredential | null>
  runtime: QaRuntimeSink
  startUrl: string
  visitedPages: Set<string>
}) {
  return {
    inspectCurrentPage: tool({
      description: "Inspect the current page and return its compact QA snapshot.",
      inputSchema: z.object({}),
      execute: async () => await browser.inspectCurrentPage(),
    }),
    listInteractiveElements: tool({
      description: "List the currently visible clickable and input elements.",
      inputSchema: z.object({}),
      execute: async () => (await browser.inspectCurrentPage()).interactives,
    }),
    clickElement: tool({
      description: "Click a visible interactive element by its current snapshot id.",
      inputSchema: z.object({
        id: z.number(),
      }),
      execute: async ({ id }) =>
        await performClickAction({
          browser,
          maxDiscoveredPages: config.maxDiscoveredPages,
          startUrl,
          targetId: id,
          visitedPages,
        }),
    }),
    fillInput: tool({
      description:
        "Fill a safe text-like input by its current snapshot id. Do not use for auth, passwords, payments, or destructive forms.",
      inputSchema: z.object({
        id: z.number(),
        submitOnEnter: z.boolean().optional(),
        value: z.string().min(1),
      }),
      execute: async ({ id, submitOnEnter, value }) =>
        await performFillAction({
          browser,
          submitOnEnter: submitOnEnter ?? false,
          targetId: id,
          value,
        }),
    }),
    navigateToUrl: tool({
      description: "Navigate to a same-host URL.",
      inputSchema: z.object({
        url: z.string().min(1),
      }),
      execute: async ({ url }) => {
        const resolvedUrl = resolveSameHostUrl({
          currentUrl: await browser.getCurrentUrl(),
          nextUrl: url,
          startUrl,
        })

        if (!resolvedUrl) {
          return {
            toolName: "navigateToUrl",
            changed: false,
            currentUrl: await browser.getCurrentUrl(),
            note: `Blocked navigation to ${url}.`,
            target: url,
          } satisfies ToolOutcome
        }

        return await performNavigationAction({
          browser,
          maxDiscoveredPages: config.maxDiscoveredPages,
          resolvedUrl,
          targetLabel: resolvedUrl,
          visitedPages,
        })
      },
    }),
    captureScreenshot: tool({
      description: "Capture a full-page screenshot of the current page.",
      inputSchema: z.object({
        title: z.string().nullable(),
      }),
      execute: async ({ title }) => {
        await saveScreenshot({
          browser,
          runtime,
          stepIndex: -1,
          title: title ?? "Agent requested screenshot",
        })

        return {
          toolName: "captureScreenshot",
          artifactCreated: true,
          changed: false,
          currentUrl: await browser.getCurrentUrl(),
          note: "Captured screenshot.",
          target: title ?? undefined,
        } satisfies ToolOutcome
      },
    }),
    ...(browser.useStoredLogin && getStoredCredential
      ? {
          useStoredLogin: tool({
            description:
              "Use the stored login credential for the current website when an auth wall blocks useful exploration.",
            inputSchema: z.object({}),
            execute: async () => {
              const credential = await getStoredCredential()

              if (!credential) {
                return {
                  toolName: "useStoredLogin",
                  changed: false,
                  currentUrl: await browser.getCurrentUrl(),
                  note: "No stored credential is available for this website.",
                  target: new URL(await browser.getCurrentUrl()).origin,
                } satisfies ToolOutcome
              }

              try {
                const loginResult = await runRetriedAction(async () => {
                  return await browser.useStoredLogin!(credential)
                })
                const didApply = loginResult.value
                const after = await browser.inspectCurrentPage()

                return {
                  toolName: "useStoredLogin",
                  changed: didApply,
                  currentUrl: after.url,
                  note: didApply
                    ? loginResult.attempts > 1
                      ? `Attempted sign-in with the stored website credential after ${loginResult.attempts} attempts.`
                      : "Attempted sign-in with the stored website credential."
                    : "Could not find a compatible login form on this page.",
                  target: credential.origin,
                } satisfies ToolOutcome
              } catch (error) {
                return {
                  toolName: "useStoredLogin",
                  changed: false,
                  currentUrl: await browser.getCurrentUrl(),
                  note: `Stored login failed after ${MAX_TOOL_ATTEMPTS} attempts: ${
                    error instanceof Error ? error.message : "Unknown login error"
                  }. Skipping this step.`,
                  target: credential.origin,
                } satisfies ToolOutcome
              }
            },
          }),
        }
      : {}),
  }
}

async function executePlannerFallback({
  browser,
  config,
  runtime,
  snapshot,
  startUrl,
  stepIndex,
  triedActions,
  visitedPages,
}: {
  browser: QaBrowserAdapter
  config: QaRuntimeConfig
  runtime: QaRuntimeSink
  snapshot: PageSnapshot
  startUrl: string
  stepIndex: number
  triedActions: Set<string>
  visitedPages: Set<string>
}) {
  const fallbackAction = pickQaFallbackAction({
    currentUrl: snapshot.url,
    interactives: snapshot.interactives,
    maxPages: config.maxDiscoveredPages,
    startUrl,
    triedActions,
    visitedPages,
  })

  if (fallbackAction.kind === "navigate") {
    return {
      ...(await performNavigationAction({
        browser,
        maxDiscoveredPages: config.maxDiscoveredPages,
        resolvedUrl: fallbackAction.url,
        targetLabel: fallbackAction.targetLabel,
        visitedPages,
      })),
      fallback: true,
      note: fallbackAction.reason,
    } satisfies ToolOutcome
  }

  if (fallbackAction.kind === "click") {
    return {
      ...(await performClickAction({
        browser,
        maxDiscoveredPages: config.maxDiscoveredPages,
        startUrl,
        targetId: fallbackAction.id,
        visitedPages,
      })),
      fallback: true,
      note: fallbackAction.reason,
    } satisfies ToolOutcome
  }

  if (fallbackAction.kind === "fill") {
    return {
      ...(await performFillAction({
        browser,
        submitOnEnter: fallbackAction.submitOnEnter ?? false,
        targetId: fallbackAction.id,
        value: fallbackAction.value,
      })),
      fallback: true,
      note: fallbackAction.reason,
    } satisfies ToolOutcome
  }

  await saveScreenshot({
    browser,
    runtime,
    stepIndex,
    title: `Fallback screenshot for step ${stepIndex}`,
  })

  return {
    toolName: "captureScreenshot",
    artifactCreated: true,
    changed: false,
    currentUrl: await browser.getCurrentUrl(),
    fallback: true,
    note: fallbackAction.reason,
  } satisfies ToolOutcome
}

async function performClickAction({
  browser,
  maxDiscoveredPages,
  startUrl,
  targetId,
  visitedPages,
}: {
  browser: QaBrowserAdapter
  maxDiscoveredPages: number
  startUrl: string
  targetId: number
  visitedPages: Set<string>
}) {
  const snapshot = await browser.inspectCurrentPage()
  const target = snapshot.interactives.find((item) => item.id === targetId)

  if (!target) {
    return {
      actionKey: `click::${snapshot.url}::${targetId}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: snapshot.url,
      note: `Element ${targetId} is no longer available.`,
    } satisfies ToolOutcome
  }

  const safetyDecision = getClickSafetyDecision(target)
  if (!safetyDecision.allowed) {
    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: snapshot.url,
      note: safetyDecision.reason,
      target: target.label,
    } satisfies ToolOutcome
  }

  if (target.href && !isSameHostname(startUrl, new URL(target.href, snapshot.url).toString())) {
    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: snapshot.url,
      note: `Blocked external link ${target.href}.`,
      target: target.label,
    } satisfies ToolOutcome
  }

  const before = snapshot
  const resolvedHref = target.href ? new URL(target.href, snapshot.url).toString() : null

  if (
    resolvedHref &&
    wouldExceedPageLimit({
      visitedPages,
      nextUrl: resolvedHref,
      maxPages: maxDiscoveredPages,
    })
  ) {
    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: snapshot.url,
      note: `Skipped ${target.label} because it would exceed the page limit.`,
      target: target.label,
    } satisfies ToolOutcome
  }

  try {
    const clickResult = await runRetriedAction(async () => {
      await browser.click(target.ref)
      return await browser.getCurrentUrl()
    })
    const currentUrl = clickResult.value

    if (!isSameHostname(startUrl, currentUrl)) {
      await browser.goBack?.().catch(() => undefined)
      return {
        actionKey: `click::${snapshot.url}::${target.id}`,
        toolName: "clickElement",
        changed: false,
        currentUrl: await browser.getCurrentUrl(),
        note: "Blocked navigation outside the starting hostname.",
        target: target.label,
      } satisfies ToolOutcome
    }

    if (
      wouldExceedPageLimit({
        visitedPages,
        nextUrl: currentUrl,
        maxPages: maxDiscoveredPages,
      })
    ) {
      await browser.goBack?.().catch(() => undefined)
      return {
        actionKey: `click::${snapshot.url}::${target.id}`,
        toolName: "clickElement",
        changed: false,
        currentUrl: await browser.getCurrentUrl(),
        note: `Skipped ${target.label} because it would exceed the page limit.`,
        target: target.label,
      } satisfies ToolOutcome
    }

    const after = await browser.inspectCurrentPage()
    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: after.signature !== before.signature,
      currentUrl: after.url,
      note:
        clickResult.attempts > 1
          ? `Clicked ${target.label} after ${clickResult.attempts} attempts.`
          : `Clicked ${target.label}.`,
      target: target.label,
    } satisfies ToolOutcome
  } catch (error) {
    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: snapshot.url,
      note: `Failed to click ${target.label} after ${MAX_TOOL_ATTEMPTS} attempts: ${error instanceof Error ? error.message : "Unknown error"}. Skipping this step.`,
      target: target.label,
    } satisfies ToolOutcome
  }
}

async function performFillAction({
  browser,
  submitOnEnter,
  targetId,
  value,
}: {
  browser: QaBrowserAdapter
  submitOnEnter: boolean
  targetId: number
  value: string
}) {
  const snapshot = await browser.inspectCurrentPage()
  const target = snapshot.interactives.find((item) => item.id === targetId)

  if (!target) {
    return {
      actionKey: `fill::${snapshot.url}::${targetId}`,
      toolName: "fillInput",
      changed: false,
      currentUrl: snapshot.url,
      note: `Input ${targetId} is no longer available.`,
    } satisfies ToolOutcome
  }

  if (!isSafeInput(target)) {
    return {
      actionKey: `fill::${snapshot.url}::${target.id}`,
      toolName: "fillInput",
      changed: false,
      currentUrl: snapshot.url,
      note: `Skipped unsafe field ${target.label}.`,
      target: target.label,
    } satisfies ToolOutcome
  }

  try {
    const fillResult = await runRetriedAction(async () => {
      await browser.fill(target.ref, value)
    })
    if (submitOnEnter && isSearchLikeInput(target)) {
      await runRetriedAction(async () => {
        await browser.pressKey?.("Enter")
      })
    }

    return {
      actionKey: `fill::${snapshot.url}::${target.id}`,
      toolName: "fillInput",
      changed: true,
      currentUrl: await browser.getCurrentUrl(),
      note:
        fillResult.attempts > 1
          ? submitOnEnter
            ? `Filled and submitted ${target.label} after ${fillResult.attempts} attempts.`
            : `Filled ${target.label} after ${fillResult.attempts} attempts.`
          : submitOnEnter
            ? `Filled and submitted ${target.label}.`
            : `Filled ${target.label}.`,
      target: target.label,
    } satisfies ToolOutcome
  } catch (error) {
    return {
      actionKey: `fill::${snapshot.url}::${target.id}`,
      toolName: "fillInput",
      changed: false,
      currentUrl: snapshot.url,
      note: `Failed to fill ${target.label} after ${MAX_TOOL_ATTEMPTS} attempts: ${error instanceof Error ? error.message : "Unknown error"}. Skipping this step.`,
      target: target.label,
    } satisfies ToolOutcome
  }
}

async function performNavigationAction({
  browser,
  maxDiscoveredPages,
  resolvedUrl,
  targetLabel,
  visitedPages,
}: {
  browser: QaBrowserAdapter
  maxDiscoveredPages: number
  resolvedUrl: string
  targetLabel: string
  visitedPages: Set<string>
}) {
  if (
    wouldExceedPageLimit({
      visitedPages,
      nextUrl: resolvedUrl,
      maxPages: maxDiscoveredPages,
    })
  ) {
    return {
      actionKey: `navigate::${resolvedUrl}`,
      toolName: "navigateToUrl",
      changed: false,
      currentUrl: await browser.getCurrentUrl(),
      note: `Blocked navigation to ${resolvedUrl} because it would exceed the page limit.`,
      target: targetLabel,
    } satisfies ToolOutcome
  }

  const beforeUrl = await browser.getCurrentUrl()
  try {
    const navigateResult = await runRetriedAction(async () => {
      await browser.navigate(resolvedUrl)
      return await browser.getCurrentUrl()
    })
    const currentUrl = navigateResult.value
    return {
      actionKey: `navigate::${resolvedUrl}`,
      toolName: "navigateToUrl",
      changed: currentUrl !== beforeUrl,
      currentUrl,
      note:
        navigateResult.attempts > 1
          ? `Navigated to ${resolvedUrl} after ${navigateResult.attempts} attempts.`
          : `Navigated to ${resolvedUrl}.`,
      target: targetLabel,
    } satisfies ToolOutcome
  } catch (error) {
    return {
      actionKey: `navigate::${resolvedUrl}`,
      toolName: "navigateToUrl",
      changed: false,
      currentUrl: beforeUrl,
      note: `Failed to navigate to ${resolvedUrl} after ${MAX_TOOL_ATTEMPTS} attempts: ${error instanceof Error ? error.message : "Unknown error"}. Skipping this step.`,
      target: targetLabel,
    } satisfies ToolOutcome
  }
}

async function runLighthouseAuditStage({
  findingSignatures,
  maxAuditUrls,
  pageCandidates,
  runtime,
  savedFindings,
  startUrl,
  stepIndexOffset,
}: {
  findingSignatures: Set<string>
  maxAuditUrls: number
  pageCandidates: Map<string, PageCandidate>
  runtime: QaRuntimeSink
  savedFindings: SavedFinding[]
  startUrl: string
  stepIndexOffset: number
}) {
  const auditUrls = selectAuditUrls({
    maxAuditUrls,
    pageCandidates,
    startUrl,
  })

  const chrome = await launch({
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  })

  let completedCount = 0

  try {
    for (const [index, auditUrl] of auditUrls.entries()) {
      const stepIndex = stepIndexOffset + index

      await throwIfStopRequested({
        pageCandidates,
        pageUrl: auditUrl,
        runtime,
        savedFindings,
        stepIndex,
        currentStep: "QA run stopped during Lighthouse",
        bufferedFindings: [],
        findingSignatures,
      })

      await runtime.updateRun?.({
        currentStep: `Running Lighthouse audit ${index + 1} of ${auditUrls.length}`,
        currentUrl: auditUrl,
        status: "running",
      })
      await runtime.emitEvent({
        kind: "audit",
        title: `Running Lighthouse audit ${index + 1} of ${auditUrls.length}`,
        body: auditUrl,
        pageUrl: auditUrl,
        status: "running",
        stepIndex,
      })

      const auditResult = await lighthouse(auditUrl, {
        output: "html",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        port: chrome.port,
      })

      if (!auditResult) {
        continue
      }

      const reportHtml = Array.isArray(auditResult.report)
        ? auditResult.report.join("\n")
        : auditResult.report
      const reportArtifactId = await runtime.createArtifact({
        body: new TextEncoder().encode(reportHtml),
        contentType: "text/html; charset=utf-8",
        pageUrl: auditUrl,
        title: `Lighthouse report for ${auditUrl}`,
        type: "html-report",
      })

      await runtime.emitEvent({
        kind: "artifact",
        title: "Lighthouse report saved",
        body: `Stored HTML report for ${auditUrl}.`,
        artifactId: reportArtifactId,
        pageUrl: auditUrl,
        status: "running",
        stepIndex,
      })

      const categories = auditResult.lhr.categories
      await runtime.createPerformanceAudit?.({
        accessibilityScore: categories.accessibility.score ?? 0,
        bestPracticesScore: categories["best-practices"].score ?? 0,
        pageUrl: auditUrl,
        performanceScore: categories.performance.score ?? 0,
        reportArtifactId,
        seoScore: categories.seo.score ?? 0,
      })

      const perfFindings = [
        scoreLighthouseFinding({
          category: "performance",
          isStartPage: auditUrl === startUrl,
          pageUrl: auditUrl,
          score: categories.performance.score ?? 0,
        }),
        scoreLighthouseFinding({
          category: "accessibility",
          isStartPage: auditUrl === startUrl,
          pageUrl: auditUrl,
          score: categories.accessibility.score ?? 0,
        }),
        scoreLighthouseFinding({
          category: "best-practices",
          isStartPage: auditUrl === startUrl,
          pageUrl: auditUrl,
          score: categories["best-practices"].score ?? 0,
        }),
        scoreLighthouseFinding({
          category: "seo",
          isStartPage: auditUrl === startUrl,
          pageUrl: auditUrl,
          score: categories.seo.score ?? 0,
        }),
      ]

      for (const perfFinding of perfFindings) {
        if (!perfFinding) {
          continue
        }

        const perfSignature = `perf::${auditUrl}::${perfFinding.title}`
        if (findingSignatures.has(perfSignature)) {
          continue
        }

        findingSignatures.add(perfSignature)
        await runtime.createFinding({
          artifactId: reportArtifactId,
          confidence: perfFinding.confidence,
          description: perfFinding.description,
          impact: perfFinding.impact,
          pageOrFlow: auditUrl,
          score: perfFinding.score,
          severity: perfFinding.severity,
          source: "perf",
          suggestedFix: perfFinding.suggestedFix,
          title: perfFinding.title,
        })
        await runtime.emitEvent({
          kind: "finding",
          title: perfFinding.title,
          body: perfFinding.description,
          artifactId: reportArtifactId,
          pageUrl: auditUrl,
          status: "running",
          stepIndex,
        })
        savedFindings.push({
          source: "perf",
          score: perfFinding.score,
        })
      }

      completedCount += 1
    }
  } finally {
    try {
      await chrome.kill()
    } catch {
      // Ignore Chrome shutdown failures during cleanup.
    }
  }

  return completedCount
}

async function saveScreenshot({
  browser,
  runtime,
  stepIndex,
  title,
}: {
  browser: QaBrowserAdapter
  runtime: QaRuntimeSink
  stepIndex: number
  title: string
}) {
  const screenshot = await browser.takeScreenshot()
  const pageUrl = await browser.getCurrentUrl()
  const artifactId = await runtime.createArtifact({
    body: screenshot,
    contentType: "image/png",
    pageUrl,
    title,
    type: "screenshot",
  })

  await runtime.emitEvent({
    kind: "artifact",
    title,
    body: `Screenshot captured for ${pageUrl}.`,
    artifactId,
    pageUrl,
    status: "running",
    stepIndex: stepIndex >= 0 ? stepIndex : undefined,
  })

  return artifactId
}

async function throwIfStopRequested({
  bufferedFindings,
  currentStep,
  findingSignatures,
  pageCandidates,
  pageUrl,
  runtime,
  savedFindings,
  stepIndex,
}: {
  bufferedFindings?: BufferedFinding[]
  currentStep: string
  findingSignatures?: Set<string>
  pageCandidates: Map<string, PageCandidate>
  pageUrl?: string
  runtime: QaRuntimeSink
  savedFindings: SavedFinding[]
  stepIndex: number
}) {
  const executionState = await runtime.getStopState?.()

  if (!executionState?.stopRequestedAt) {
    return 0
  }

  if (
    bufferedFindings &&
    findingSignatures &&
    bufferedFindings.length > 0
  ) {
    await flushBufferedFindings({
      bufferedFindings,
      findingSignatures,
      pageCandidates,
      runtime,
      savedFindings,
      stepIndex,
    })
  }

  throw new QaRunCancelledError(currentStep, pageUrl ?? executionState.currentUrl ?? undefined)
}

function buildAgentPrompt({
  hasStoredCredential,
  maxAgentSteps,
  instructions,
  mode,
  remainingMs,
  snapshot,
  stepIndex,
  visitedPages,
  recentActions,
}: {
  hasStoredCredential: boolean
  maxAgentSteps: number
  instructions?: string
  mode: QaRunMode
  remainingMs: number
  snapshot: PageSnapshot
  stepIndex: number
  visitedPages: string[]
  recentActions: string[]
}) {
  const baseRules = [
    "You are a balanced autonomous QA engineer exploring a public website.",
    "Rules:",
    "- Stay on the starting hostname only.",
    hasStoredCredential
      ? "- Do not attempt signup, payment submission, purchase completion, account deletion, or destructive submission flows. If login is required, use the stored login tool instead of typing credentials yourself."
      : "- Do not attempt login, signup, payment submission, purchase completion, account deletion, or destructive submission flows.",
    "- Reversible actions are allowed, including search, filters, sorting, tabs, drawers, pagination, safe forms, add-to-cart, opening checkout pages, and safe record creation/edit flows when explicitly requested.",
    "- Never finalize a purchase, submit payment, or trigger destructive admin/account actions.",
    "- Call at most one tool for the next best action.",
    "- You do not need to capture screenshots on every step because the system already captures them after meaningful changes.",
    "- Use conservative values if you fill a field, such as 'test search', 'Shard QA', or 'qa@example.com'.",
  ]

  const modeRules =
    mode === "task" && instructions
      ? [
          `Primary task: ${instructions}`,
          "- Prioritize finishing the task safely and efficiently over broad exploration.",
          "- Only say the task is complete when the current visible UI strongly proves success.",
          "- When the task is complete and no more action is needed, reply with `TASK_COMPLETE: <brief summary>` and do not call a tool.",
          "- When the task cannot be completed safely or the app blocks progress, reply with `TASK_BLOCKED: <brief summary>` and do not call a tool.",
          "- If you made meaningful progress but cannot fully complete the task, reply with `TASK_PARTIAL: <brief summary>` and do not call a tool.",
        ]
      : [
          "- Explore like a strong QA engineer: prefer fresh reversible interactions on the current page before leaving it.",
          "- Prioritize tabs, accordions, drawers, filters, sort controls, pagination, search fields, safe forms, modals, add-to-cart, then same-host navigation.",
          "- Continue exploring when the current page looks healthy and fresh reversible actions remain.",
        ]

  return [
    ...baseRules,
    ...modeRules,
    `Step: ${stepIndex}/${maxAgentSteps}`,
    `Remaining time budget: ${Math.ceil(remainingMs / 1000)} seconds`,
    `Current URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    `Forms: ${snapshot.formsSummary}`,
    `Visited pages: ${visitedPages.join(", ")}`,
    `Recent actions: ${recentActions.length ? recentActions.join(" | ") : "none"}`,
    `Visible text excerpt: ${snapshot.textExcerpt}`,
    `Current interactives: ${snapshot.interactives.map((item) => `${item.id}. ${item.label} [${item.tagName}${item.type ? `:${item.type}` : ""}]`).join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n")
}

async function verifyTaskCompletion({
  instructions,
  model,
  plannerSummary,
  recentActions,
  runtime,
  snapshot,
}: {
  instructions?: string
  model: any
  plannerSummary: string
  recentActions: string[]
  runtime: QaRuntimeSink
  snapshot: PageSnapshot
}) {
  if (!instructions) {
    return null
  }

  const assessment = await generateObject({
    abortSignal: runtime.getAbortSignal?.(),
    model,
    schema: taskProofSchema,
    prompt: [
      "You are verifying whether an automated QA task is visibly complete.",
      "Only return `completed` when the CURRENT visible UI strongly proves success.",
      "Strong proof includes created record visible, cart state visible, route/state change proving the result, success confirmation, or visible persisted data.",
      "If proof is weak, indirect, or absent, return `not_yet` or `partially_completed`.",
      `Task: ${instructions}`,
      `Planner summary: ${plannerSummary || "none"}`,
      `Recent actions: ${recentActions.length ? recentActions.join(" | ") : "none"}`,
      `Current URL: ${snapshot.url}`,
      `Page title: ${snapshot.title}`,
      `Forms: ${snapshot.formsSummary}`,
      `Visible text excerpt: ${snapshot.textExcerpt}`,
      `Interactive elements: ${snapshot.interactives.map((item) => `${item.id}. ${item.label} (${item.tagName})`).join("; ")}`,
    ].join("\n"),
  }).catch((error) => {
    if (isQaOperationAborted(runtime, error)) {
      throw buildQaAbortError("QA run stopped during task verification", snapshot.url)
    }

    return null
  })

  if (!assessment) {
    return null
  }

  if (assessment.object.status === "completed") {
    return {
      status: "completed",
      summary: assessment.object.proof
        ? `${assessment.object.summary}\nProof: ${assessment.object.proof}`
        : assessment.object.summary,
    } satisfies GoalOutcome
  }

  if (assessment.object.status === "blocked") {
    return {
      status: "blocked",
      summary: assessment.object.summary,
    } satisfies GoalOutcome
  }

  if (assessment.object.status === "partially_completed") {
    return {
      status: "partially_completed",
      summary: assessment.object.summary,
    } satisfies GoalOutcome
  }

  return null
}

export function parseGoalOutcome(summary: string) {
  const trimmed = summary.trim()

  if (trimmed.startsWith("TASK_COMPLETE:")) {
    return {
      status: "completed",
      summary: trimmed.replace("TASK_COMPLETE:", "").trim() || "The requested task was completed safely.",
    } satisfies GoalOutcome
  }

  if (trimmed.startsWith("TASK_BLOCKED:")) {
    return {
      status: "blocked",
      summary: trimmed.replace("TASK_BLOCKED:", "").trim() || "The task could not be completed safely.",
    } satisfies GoalOutcome
  }

  if (trimmed.startsWith("TASK_PARTIAL:")) {
    return {
      status: "partially_completed",
      summary:
        trimmed.replace("TASK_PARTIAL:", "").trim() ||
        "The task made meaningful progress but was not fully completed.",
    } satisfies GoalOutcome
  }

  return null
}

export function inferTaskOutcome({
  actionCount,
  instructions,
  stopReason,
  visitedPageCount,
}: {
  actionCount: number
  instructions?: string
  stopReason:
    | "goal"
    | "max_pages"
    | "max_steps"
    | "no_ops"
    | "planner_unavailable"
    | "repeat_actions"
    | "time_budget"
  visitedPageCount: number
}) {
  const taskLabel = instructions ? `Task: ${instructions}` : "The requested task"

  if (actionCount === 0 || stopReason === "planner_unavailable") {
    return {
      status: "blocked",
      summary: `${taskLabel}. The agent could not make reliable progress before the run ended.`,
    } satisfies GoalOutcome
  }

  if (stopReason === "time_budget" || stopReason === "max_steps") {
    return {
      status: "partially_completed",
      summary: `${taskLabel}. The agent explored ${visitedPageCount} page${visitedPageCount === 1 ? "" : "s"} and executed ${actionCount} action${actionCount === 1 ? "" : "s"} before the time budget ended.`,
    } satisfies GoalOutcome
  }

  if (stopReason === "no_ops" || stopReason === "repeat_actions") {
    return {
      status: "blocked",
      summary: `${taskLabel}. The visible UI no longer exposed fresh safe actions that advanced the task.`,
    } satisfies GoalOutcome
  }

  return {
    status: "partially_completed",
    summary: `${taskLabel}. The agent made progress but could not confirm full completion before wrapping up.`,
  } satisfies GoalOutcome
}

export function formatToolOutcomeTitle(outcome: ToolOutcome) {
  switch (outcome.toolName) {
    case "clickElement":
      return `Clicked ${outcome.target ?? "element"}`
    case "fillInput":
      return `Filled ${outcome.target ?? "input"}`
    case "navigateToUrl":
      return "Navigated to page"
    case "captureScreenshot":
      return "Captured screenshot"
    case "useStoredLogin":
      return "Attempted stored login"
    default:
      return "Agent action completed"
  }
}

export function isToolOutcome(value: unknown): value is ToolOutcome {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<ToolOutcome>
  return (
    typeof candidate.toolName === "string" &&
    typeof candidate.currentUrl === "string" &&
    typeof candidate.changed === "boolean" &&
    typeof candidate.note === "string"
  )
}

export function isInteractiveTool(toolName: ToolOutcome["toolName"]) {
  return (
    toolName === "clickElement" ||
    toolName === "fillInput" ||
    toolName === "navigateToUrl" ||
    toolName === "useStoredLogin"
  )
}

export function isSafeInput(target: InteractiveElement) {
  if (target.tagName === "textarea") {
    return true
  }

  if (target.tagName !== "input") {
    return target.role === "combobox"
  }

  const label = target.label.toLowerCase()
  const type = target.type?.toLowerCase() ?? "text"

  if (
    label.includes("password") ||
    label.includes("credit") ||
    label.includes("card") ||
    label.includes("login") ||
    label.includes("sign in") ||
    label.includes("checkout")
  ) {
    return false
  }

  return ["text", "search", "email", "url", "tel"].includes(type)
}

export function isSearchLikeInput(target: InteractiveElement) {
  const haystack = target.label.toLowerCase()
  const type = target.type?.toLowerCase() ?? "text"

  return (
    type === "search" ||
    haystack.includes("search") ||
    haystack.includes("find") ||
    haystack.includes("filter") ||
    haystack.includes("query")
  )
}

export function getClickSafetyDecision(target: InteractiveElement) {
  const haystack = `${target.label} ${target.href ?? ""}`.toLowerCase()
  const blockedKeywords = [
    "delete",
    "remove",
    "destroy",
    "purge",
    "erase",
    "deactivate",
    "disable",
    "revoke",
    "terminate",
    "confirm purchase",
    "complete purchase",
    "complete order",
    "place order",
    "submit payment",
    "pay now",
  ]

  if (blockedKeywords.some((keyword) => haystack.includes(keyword))) {
    return {
      allowed: false,
      reason: `Skipped ${target.label} because it looks destructive or irreversible.`,
    }
  }

  if (haystack.includes("buy now") || (haystack.includes("confirm") && haystack.includes("order"))) {
    return {
      allowed: false,
      reason: `Skipped ${target.label} because it appears to finalize a purchase.`,
    }
  }

  return {
    allowed: true,
    reason: "",
  }
}

export function selectAuditUrls({
  maxAuditUrls,
  pageCandidates,
  startUrl,
}: {
  maxAuditUrls: number
  pageCandidates: Map<string, PageCandidate>
  startUrl: string
}) {
  const otherUrls = [...pageCandidates.values()]
    .filter((candidate) => candidate.url !== startUrl)
    .sort((left, right) => {
      if (right.findingCount !== left.findingCount) {
        return right.findingCount - left.findingCount
      }
      if (right.interactionCount !== left.interactionCount) {
        return right.interactionCount - left.interactionCount
      }
      return left.firstSeenAt - right.firstSeenAt
    })
    .slice(0, Math.max(maxAuditUrls - 1, 0))
    .map((candidate) => candidate.url)

  return [startUrl, ...otherUrls]
}

async function runRetriedAction<T>(operation: () => Promise<T>) {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_TOOL_ATTEMPTS; attempt += 1) {
    try {
      const value = await operation()
      return {
        attempts: attempt,
        value,
      }
    } catch (error) {
      lastError = error

      if (isAbortError(error)) {
        throw error
      }

      if (attempt < MAX_TOOL_ATTEMPTS) {
        await sleep(TOOL_RETRY_DELAY_MS)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown tool execution error")
}

async function sleep(durationMs: number) {
  await new Promise((resolve) => setTimeout(resolve, durationMs))
}

function isQaOperationAborted(runtime: QaRuntimeSink, error: unknown) {
  return Boolean(runtime.getAbortSignal?.()?.aborted) || isAbortError(error)
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false
  }

  const candidate = error as { name?: string; message?: string }

  return (
    candidate.name === "AbortError" ||
    candidate.message?.toLowerCase().includes("aborted") === true
  )
}

function buildQaAbortError(currentStep: string, currentUrl?: string) {
  return new QaRunCancelledError(currentStep, currentUrl)
}
