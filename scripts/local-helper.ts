import { rm } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { generateObject, generateText, stepCountIs, tool } from "ai"
import { google } from "@ai-sdk/google"
import { Launcher } from "chrome-launcher"
import {
  type Browser,
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright"
import { z } from "zod"
import {
  buildActionSignature,
  isSameHostname,
  resolveSameHostUrl,
  shouldStopForNoOps,
  shouldStopForRepeatActions,
  wouldExceedPageLimit,
} from "../src/lib/qa-guards.ts"
import { pickQaFallbackAction } from "../src/lib/qa-fallback.ts"
import {
  computeFindingScore,
  impactWeightForSource,
} from "../src/lib/scoring.ts"
import {
  QaRunCancelledError,
  runQaSession,
} from "../src/lib/qa-engine.ts"

const SESSION_TIMEOUT_MS = 10 * 60 * 1000
const AGENT_TIME_BUDGET_MS = 8 * 60 * 1000
const MAX_AGENT_STEPS = 36
const MAX_DISCOVERED_PAGES = 12
const MAX_PAGE_FINDINGS = 2
const POLL_INTERVAL_MS = Number(process.env.LOCAL_HELPER_POLL_INTERVAL_MS ?? 3_000)
const HEARTBEAT_INTERVAL_MS = Number(process.env.LOCAL_HELPER_HEARTBEAT_MS ?? 10_000)
const STOP_POLL_INTERVAL_MS = Number(
  process.env.LOCAL_HELPER_STOP_POLL_INTERVAL_MS ?? 500,
)
const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
const ACTION_HIGHLIGHT_DELAY_MS = 350

type BrowserProvider = "local_chrome" | "steel"
type RunMode = "explore" | "task"
type RunStatus = "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
type RunGoalStatus = "blocked" | "completed" | "not_requested" | "partially_completed"
type LocalHelperStatus = "busy" | "error" | "idle" | "offline"
type SessionStatus = "active" | "closed" | "creating" | "failed"

type RunRecord = {
  _id: string
  browserProvider?: BrowserProvider
  credentialNamespace?: string
  currentStep?: string
  instructions?: string
  mode?: RunMode
  status: RunStatus
  url: string
}

type InteractiveElement = {
  href?: string | null
  id: number
  label: string
  role: string
  tagName: string
  type?: string | null
  uid: string
}

type PageSnapshot = {
  formsSummary: string
  interactives: InteractiveElement[]
  signature: string
  textExcerpt: string
  title: string
  url: string
}

type ToolOutcome = {
  actionKey?: string
  artifactCreated?: boolean
  changed: boolean
  currentUrl: string
  fallback?: boolean
  goalOutcome?: GoalOutcome
  note: string
  target?: string
  toolName: string
}

type GoalOutcome = {
  status: "blocked" | "completed" | "partially_completed"
  summary: string
}

type BufferedFinding = {
  confidence: number
  description: string
  pageOrFlow?: string
  severity: "critical" | "high" | "low" | "medium"
  signature: string
  source: "browser" | "perf"
  suggestedFix?: string
  title: string
}

type SavedFinding = {
  score: number
  source: "browser" | "perf"
}

type PageCandidate = {
  findingCount: number
  firstSeenAt: number
  interactionCount: number
  url: string
}

type SessionRecord = {
  sessionId: string
  externalSessionId: string
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

async function main() {
  const appBaseUrl = requiredEnv("APP_BASE_URL")
  const helperSecret = requiredEnv("LOCAL_HELPER_SECRET")
  const geminiApiKey = requiredEnv("GEMINI_API_KEY")
  const helperId = process.env.LOCAL_HELPER_ID ?? randomUUID()
  const machineLabel = process.env.LOCAL_HELPER_MACHINE_LABEL ?? hostname()
  const version = process.env.LOCAL_HELPER_VERSION ?? "0.1.0"
  const api = new LocalHelperApi(appBaseUrl, helperSecret)

  process.env.GEMINI_API_KEY = geminiApiKey

  const heartbeatState: {
    currentClaimedRunId?: string
    status: LocalHelperStatus
  } = {
    status: "idle",
  }

  const heartbeat = windowlessInterval(async () => {
    await api.register({
      helperId,
      machineLabel,
      version,
      status: heartbeatState.status,
      currentClaimedRunId: heartbeatState.currentClaimedRunId,
    })
  }, HEARTBEAT_INTERVAL_MS)

  process.on("SIGINT", async () => {
    heartbeatState.currentClaimedRunId = undefined
    heartbeatState.status = "offline"
    await heartbeat.stop().catch(() => undefined)
    await api
      .register({
        helperId,
        machineLabel,
        version,
        status: "offline",
      })
      .catch(() => undefined)
    process.exit(0)
  })

  await api.register({
    helperId,
    machineLabel,
    version,
    status: "idle",
  })

  while (true) {
    const claim = await api.claim({ helperId })

    if (!claim.ok) {
      heartbeatState.status = "error"
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    if (!claim.run) {
      heartbeatState.currentClaimedRunId = undefined
      heartbeatState.status = "idle"
      await sleep(POLL_INTERVAL_MS)
      continue
    }

    heartbeatState.currentClaimedRunId = claim.run._id
    heartbeatState.status = "busy"

    try {
      await runLocalQaWorkflow({
        api,
        helperId,
        machineLabel,
        run: claim.run,
      })
      heartbeatState.status = "idle"
    } catch (error) {
      heartbeatState.status = "error"

      const message = error instanceof Error ? error.message : "Unknown local helper failure"
      const status =
        error instanceof RunCancelledError || error instanceof QaRunCancelledError
          ? "cancelled"
          : "failed"
      const currentStep =
        error instanceof RunCancelledError || error instanceof QaRunCancelledError
          ? error.message
          : "Local Chrome QA run failed"
      const currentUrl =
        error instanceof RunCancelledError || error instanceof QaRunCancelledError
          ? error.currentUrl ?? claim.run.url
          : claim.run.url

      await api
        .event({
          runId: claim.run._id,
          kind: "status",
          status,
          title: status === "cancelled" ? "Run cancelled" : "Run failed",
          body: message,
          pageUrl: currentUrl,
        })
        .catch(() => undefined)

      await api
        .finalize({
          helperId,
          runId: claim.run._id,
          status,
          currentStep,
          currentUrl,
          errorMessage:
            error instanceof RunCancelledError || error instanceof QaRunCancelledError
              ? undefined
              : message,
        })
        .catch(() => undefined)
    } finally {
      heartbeatState.currentClaimedRunId = undefined
      if (heartbeatState.status !== "error") {
        heartbeatState.status = "idle"
      }
    }
  }
}

async function runLocalQaWorkflow({
  api,
  helperId,
  machineLabel,
  run,
}: {
  api: LocalHelperApi
  helperId: string
  machineLabel: string
  run: RunRecord
}) {
  const browser = new LocalChromeBrowser()
  const stopController = new AbortController()
  const externalSessionId = `local:${helperId}:${run._id}`
  let session: SessionRecord | null = null
  let finalStatus: "cancelled" | "completed" | "failed" = "completed"
  const stopWatcher = createImmediateRunStopWatcher({
    api,
    runId: run._id,
    onStop: async () => {
      stopController.abort("stop_requested")
      await browser.close().catch(() => undefined)
    },
  })

  try {
    await api.progress({
      runId: run._id,
      status: "starting",
      queueState: "picked_up",
      currentStep: "Connecting local Chrome helper",
      currentUrl: run.url,
      errorMessage: null,
    })
    await api.event({
      runId: run._id,
      kind: "status",
      status: "starting",
      title: "Local run starting",
      body: `Local helper ${machineLabel} is preparing a visible local Chrome window for live QA automation.`,
      pageUrl: run.url,
    })

    session = await api.session({
      runId: run._id,
      provider: "local_chrome",
      externalSessionId,
      status: "creating",
    })

    await api.event({
      runId: run._id,
      kind: "session",
      status: "starting",
      sessionId: session.sessionId,
      title: "Preparing local Chrome session",
      body: "Shard is starting the local Chrome session now. By default the helper launches a fresh visible Chrome window; if LOCAL_CHROME_BROWSER_URL is set, it will attach to that explicit debugging endpoint instead.",
      pageUrl: run.url,
    })

    await browser.connect()
    await browser.open(run.url)

    const openedUrl = await browser.getCurrentUrl()

    await api.progress({
      runId: run._id,
      status: "running",
      currentStep: "Booting autonomous QA agent",
      currentUrl: openedUrl,
      queueState: "picked_up",
    })

    await api.session({
      runId: run._id,
      sessionId: session.sessionId,
      provider: "local_chrome",
      externalSessionId,
      status: "active",
    })

    await api.event({
      runId: run._id,
      kind: "session",
      status: "running",
      sessionId: session.sessionId,
      title: "Local Chrome attached",
      body: `Shard is driving ${browser.connectionLabel()}. Watch the local Chrome window for live interactions while steps and findings stream here.`,
      pageUrl: openedUrl,
    })

    const sessionResult = await runQaSession({
      browser: createLocalQaBrowser(browser),
      config: {
        agentTimeBudgetMs: AGENT_TIME_BUDGET_MS,
        maxAgentSteps: MAX_AGENT_STEPS,
        maxDiscoveredPages: MAX_DISCOVERED_PAGES,
      },
      instructions: run.instructions,
      mode: run.mode ?? "explore",
      model: google(DEFAULT_MODEL),
      runtime: createLocalQaRuntime({
        api,
        abortSignal: stopController.signal,
        runId: run._id,
        sessionId: session.sessionId,
      }),
      startUrl: run.url,
    })

    const finalScore = sessionResult.finalScore

    await api.event({
      runId: run._id,
      kind: "status",
      status: "completed",
      sessionId: session.sessionId,
      title: "Run completed",
      body:
        run.mode === "task" && sessionResult.goalOutcome
          ? `Final quality score: ${finalScore}/100.\nTask outcome: ${sessionResult.goalOutcome.status}.\n${sessionResult.goalOutcome.summary}`
          : `Final quality score: ${finalScore}/100.`,
      pageUrl: await browser.getCurrentUrl(),
    })

    await api.finalize({
      helperId,
      runId: run._id,
      status: "completed",
      currentStep: "QA run completed",
      currentUrl: await browser.getCurrentUrl(),
      finalScore,
      goalStatus: sessionResult.goalOutcome?.status,
      goalSummary: sessionResult.goalOutcome?.summary,
      sessionId: session.sessionId,
      sessionStatus: "closed",
    })
  } catch (error) {
    const stopState =
      error instanceof RunCancelledError || error instanceof QaRunCancelledError
        ? {
            currentUrl: error.currentUrl ?? run.url,
            stopRequestedAt: Date.now(),
          }
        : stopWatcher.wasTriggered()
          ? {
              currentUrl: stopWatcher.currentUrl() ?? run.url,
              stopRequestedAt: Date.now(),
            }
          : await api.state({ runId: run._id }).catch(() => null)

    finalStatus =
      error instanceof RunCancelledError ||
      error instanceof QaRunCancelledError ||
      stopState?.stopRequestedAt
        ? "cancelled"
        : "failed"

    if (
      finalStatus === "cancelled" &&
      !(error instanceof RunCancelledError) &&
      !(error instanceof QaRunCancelledError)
    ) {
      throw new RunCancelledError(
        "Stop requested, shutting down local Chrome run",
        stopState?.currentUrl ?? run.url,
      )
    }

    throw error
  } finally {
    stopWatcher.stop()

    if (session && finalStatus !== "completed") {
      await api
        .session({
          runId: run._id,
          sessionId: session.sessionId,
          provider: "local_chrome",
          externalSessionId,
          status: finalStatus === "failed" ? "failed" : "closed",
          finishedAt: Date.now(),
        })
        .catch(() => undefined)
    }

    await browser.close().catch(() => undefined)
  }
}

function createLocalQaBrowser(browser: LocalChromeBrowser) {
  return {
    captureRuntimeFindings: async (startUrl: string, bufferedFindings: BufferedFinding[]) => {
      await browser.collectRuntimeFindings(startUrl, bufferedFindings)
    },
    click: async (ref: string) => {
      await browser.click(ref)
    },
    fill: async (ref: string, value: string) => {
      await browser.fill(ref, value)
    },
    getCurrentUrl: async () => await browser.getCurrentUrl(),
    goBack: async () => {
      await browser.goBack()
    },
    inspectCurrentPage: async () => {
      const snapshot = await browser.inspectCurrentPage()
      return {
        ...snapshot,
        interactives: snapshot.interactives.map((item) => ({
          ...item,
          ref: item.uid,
        })),
      }
    },
    navigate: async (url: string) => {
      await browser.navigate(url)
    },
    pressKey: async (key: string) => {
      await browser.pressKey(key)
    },
    startRuntimeCapture: async (startUrl: string, bufferedFindings: BufferedFinding[]) => {
      await browser.startRuntimeCapture(startUrl, bufferedFindings)
    },
    takeScreenshot: async () => await browser.takeScreenshot(),
  }
}

function createLocalQaRuntime({
  api,
  abortSignal,
  runId,
  sessionId,
}: {
  api: LocalHelperApi
  abortSignal: AbortSignal
  runId: string
  sessionId: string
}) {
  return {
    createArtifact: async (payload: {
      body: Uint8Array
      contentType: string
      pageUrl?: string
      title?: string
      type: "html-report" | "replay" | "screenshot" | "trace"
    }) => {
      const artifact = await api.artifact({
        base64: Buffer.from(payload.body).toString("base64"),
        contentType: payload.contentType,
        pageUrl: payload.pageUrl,
        runId,
        title: payload.title,
        type: payload.type,
      })

      return artifact.artifactId
    },
    createFinding: async (payload: {
      artifactId?: string
      browserSignal?: "console" | "network" | "pageerror"
      confidence: number
      description: string
      impact: number
      pageOrFlow?: string
      score: number
      severity: "critical" | "high" | "low" | "medium"
      source: "browser" | "perf"
      stepIndex?: number
      suggestedFix?: string
      title: string
    }) => {
      await api.finding({
        ...payload,
        runId,
      })
    },
    createPerformanceAudit: async (payload: {
      accessibilityScore: number
      bestPracticesScore: number
      pageUrl: string
      performanceScore: number
      reportArtifactId?: string
      seoScore: number
    }) => {
      await api.performanceAudit({
        ...payload,
        runId,
      })
    },
    emitEvent: async (payload: {
      artifactId?: string
      body?: string
      kind: "agent" | "artifact" | "audit" | "finding" | "navigation" | "session" | "status" | "system"
      pageUrl?: string
      status?: RunStatus
      stepIndex?: number
      title: string
    }) => {
      await api.event({
        ...payload,
        runId,
        sessionId,
      })
    },
    getAbortSignal: () => abortSignal,
    getStopState: async () => {
      const state = await api.state({ runId })
      return state
    },
    updateRun: async (payload: {
      currentStep?: string
      currentUrl?: string | null
      errorMessage?: string | null
      finalScore?: number
      finishedAt?: number
      goalStatus?: RunGoalStatus | null
      goalSummary?: string | null
      queueState?: "pending" | "picked_up" | "waiting_for_worker" | "worker_unreachable"
      status?: RunStatus
    }) => {
      await api.progress({
        ...payload,
        runId,
      })
    },
  }
}

void runAgentLoop
void selectAuditUrls

async function runAgentLoop({
  api,
  browser,
  bufferedFindings,
  findingSignatures,
  instructions,
  mode,
  pageCandidates,
  runId,
  savedFindings,
  sessionId,
  startUrl,
}: {
  api: LocalHelperApi
  browser: LocalChromeBrowser
  bufferedFindings: BufferedFinding[]
  findingSignatures: Set<string>
  instructions?: string
  mode: RunMode
  pageCandidates: Map<string, PageCandidate>
  runId: string
  savedFindings: SavedFinding[]
  sessionId: string
  startUrl: string
}) {
  const initialUrl = await browser.getCurrentUrl()
  const visitedPages = new Set<string>([initialUrl])
  const actionHistory: string[] = []
  const triedActions = new Set<string>()
  const analyzedSnapshots = new Set<string>()
  const deadlineAt = Date.now() + AGENT_TIME_BUDGET_MS
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

  for (let stepIndex = 1; stepIndex <= MAX_AGENT_STEPS; stepIndex += 1) {
    if (Date.now() >= deadlineAt) {
      stopReason = "time_budget"
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
      api,
      currentStep: "Local run stopped during exploration",
      pageUrl: snapshot.url,
      runId,
    })

    await api.progress({
      runId,
      currentStep:
        mode === "task"
          ? `Task step ${stepIndex} of ${MAX_AGENT_STEPS}`
          : `Exploration step ${stepIndex} of ${MAX_AGENT_STEPS}`,
      currentUrl: snapshot.url,
      status: "running",
    })

    const result = await generateText({
      model: google(DEFAULT_MODEL),
      prompt: buildAgentPrompt({
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
        api,
        browser,
        runId,
        sessionId,
        startUrl,
        visitedPages,
      }),
    }).catch(() => null)

    if (!result) {
      stopReason = "planner_unavailable"
      break
    }

    const plannerSummary = result.text.trim()
    const plannerGoalOutcome = mode === "task" ? parseGoalOutcome(plannerSummary) : null
    const toolResults = result.steps.flatMap((step: any) => step.toolResults ?? [])
    const latestToolResult = [...toolResults].reverse().find(Boolean)

    if (plannerGoalOutcome && !latestToolResult) {
      goalOutcome = plannerGoalOutcome
      stopReason = "goal"
      await api.event({
        runId,
        kind: "agent",
        status: "running",
        sessionId,
        stepIndex,
        title:
          plannerGoalOutcome.status === "completed"
            ? "Task completed"
            : plannerGoalOutcome.status === "blocked"
              ? "Task blocked"
              : "Task partially completed",
        body: plannerGoalOutcome.summary,
        pageUrl: snapshot.url,
      })
      break
    }

    const outcome =
      latestToolResult && isToolOutcome(latestToolResult.output)
        ? latestToolResult.output
        : await executePlannerFallback({
            api,
            browser,
            runId,
            sessionId,
            snapshot,
            startUrl,
            stepIndex,
            triedActions,
            visitedPages,
          })

    await browser.collectRuntimeFindings(startUrl, bufferedFindings)

    await api.event({
      runId,
      kind: outcome.toolName === "navigateToUrl" ? "navigation" : "agent",
      status: "running",
      sessionId,
      stepIndex,
      title: formatToolOutcomeTitle(outcome),
      body: outcome.note,
      pageUrl: outcome.currentUrl,
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
      api,
      bufferedFindings,
      findingSignatures,
      pageCandidates,
      runId,
      savedFindings,
      sessionId,
      stepIndex,
    })

    const nextSnapshot = await browser.inspectCurrentPage()
    visitedPages.add(nextSnapshot.url)

    const candidate = pageCandidates.get(nextSnapshot.url)
    if (candidate && isInteractiveTool(outcome.toolName) && outcome.changed) {
      candidate.interactionCount += 1
    }

    if (visitedPages.size > MAX_DISCOVERED_PAGES) {
      stopReason = "max_pages"
      break
    }

    const stateChanged = outcome.changed || nextSnapshot.signature !== snapshot.signature
    if (stateChanged) {
      noOpCount = 0
      screenshotCount += await runSnapshotStage({
        analyzedSnapshots,
        api,
        browser,
        bufferedFindings,
        findingSignatures,
        pageCandidates,
        runId,
        savedFindings,
        sessionId,
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
  api,
  browser,
  bufferedFindings,
  findingSignatures,
  pageCandidates,
  runId,
  savedFindings,
  sessionId,
  stepIndex,
}: {
  analyzedSnapshots: Set<string>
  api: LocalHelperApi
  browser: LocalChromeBrowser
  bufferedFindings: BufferedFinding[]
  findingSignatures: Set<string>
  pageCandidates: Map<string, PageCandidate>
  runId: string
  savedFindings: SavedFinding[]
  sessionId: string
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
    api,
    browser,
    runId,
    sessionId,
    stepIndex,
    title: stepIndex === 0 ? "Landing page screenshot" : `Step ${stepIndex} screenshot`,
  })

  await flushBufferedFindings({
    api,
    bufferedFindings,
    findingSignatures,
    pageCandidates,
    runId,
    savedFindings,
    sessionId,
    stepIndex,
  })

  if (analyzedSnapshots.has(snapshot.signature)) {
    return 1
  }

  analyzedSnapshots.add(snapshot.signature)

  const pageReview = await generateObject({
    model: google(DEFAULT_MODEL),
    schema: pageReviewSchema,
    prompt: [
      "You are reviewing a public webpage during an automated QA run.",
      "Always return a JSON object with a `findings` array, even when it is empty.",
      "Return at most two concrete browser/UI findings.",
      "Focus on usability, broken states, missing context, dead ends, or obvious copy/content problems visible from text and interactive structure.",
      "Do not invent auth, payment, or backend issues. If the page looks healthy, return an empty list.",
      `URL: ${snapshot.url}`,
      `Title: ${snapshot.title}`,
      `Forms: ${snapshot.formsSummary}`,
      `Visible text excerpt: ${snapshot.textExcerpt}`,
      `Interactive elements: ${snapshot.interactives.map((item) => `${item.id}. ${item.label} (${item.tagName})`).join("; ")}`,
    ].join("\n"),
  }).catch(() => null)

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

    await api.finding({
      runId,
      source: "browser",
      title: finding.title,
      description: finding.description,
      severity: finding.severity,
      confidence: finding.confidence,
      impact,
      score,
      stepIndex,
      pageOrFlow: snapshot.url,
      artifactId: screenshotArtifactId,
      suggestedFix: finding.suggestedFix ?? undefined,
    })

    await api.event({
      runId,
      kind: "finding",
      status: "running",
      sessionId,
      artifactId: screenshotArtifactId,
      stepIndex,
      title: finding.title,
      body: finding.description,
      pageUrl: snapshot.url,
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
  api,
  bufferedFindings,
  findingSignatures,
  pageCandidates,
  runId,
  savedFindings,
  sessionId,
  stepIndex,
}: {
  api: LocalHelperApi
  bufferedFindings: BufferedFinding[]
  findingSignatures: Set<string>
  pageCandidates: Map<string, PageCandidate>
  runId: string
  savedFindings: SavedFinding[]
  sessionId: string
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

    await api.finding({
      runId,
      source: finding.source,
      title: finding.title,
      description: finding.description,
      severity: finding.severity,
      confidence: finding.confidence,
      impact,
      score,
      stepIndex,
      pageOrFlow: finding.pageOrFlow,
      suggestedFix: finding.suggestedFix,
    })

    await api.event({
      runId,
      kind: "finding",
      status: "running",
      sessionId,
      stepIndex,
      title: finding.title,
      body: finding.description,
      pageUrl: finding.pageOrFlow,
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
  api,
  browser,
  runId,
  sessionId,
  startUrl,
  visitedPages,
}: {
  api: LocalHelperApi
  browser: LocalChromeBrowser
  runId: string
  sessionId: string
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
          startUrl,
          currentUrl: await browser.getCurrentUrl(),
          nextUrl: url,
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
          api,
          browser,
          runId,
          sessionId,
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
  }
}

async function executePlannerFallback({
  api,
  browser,
  runId,
  sessionId,
  snapshot,
  startUrl,
  stepIndex,
  triedActions,
  visitedPages,
}: {
  api: LocalHelperApi
  browser: LocalChromeBrowser
  runId: string
  sessionId: string
  snapshot: PageSnapshot
  startUrl: string
  stepIndex: number
  triedActions: Set<string>
  visitedPages: Set<string>
}) {
  const fallbackAction = pickQaFallbackAction({
    currentUrl: snapshot.url,
    interactives: snapshot.interactives,
    maxPages: MAX_DISCOVERED_PAGES,
    startUrl,
    triedActions,
    visitedPages,
  })

  if (fallbackAction.kind === "navigate") {
    return {
      ...(await performNavigationAction({
        browser,
        resolvedUrl: fallbackAction.url,
        targetLabel: fallbackAction.targetLabel,
        visitedPages,
      })),
      fallback: true,
      note: fallbackAction.reason,
    }
  }

  if (fallbackAction.kind === "click") {
    return {
      ...(await performClickAction({
        browser,
        startUrl,
        targetId: fallbackAction.id,
        visitedPages,
      })),
      fallback: true,
      note: fallbackAction.reason,
    }
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
    }
  }

  await saveScreenshot({
    api,
    browser,
    runId,
    sessionId,
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
  startUrl,
  targetId,
  visitedPages,
}: {
  browser: LocalChromeBrowser
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
      maxPages: MAX_DISCOVERED_PAGES,
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
    await browser.click(target.uid)
    const currentUrl = await browser.getCurrentUrl()

    if (!isSameHostname(startUrl, currentUrl)) {
      await browser.goBack()
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
        maxPages: MAX_DISCOVERED_PAGES,
      })
    ) {
      await browser.goBack()
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
      note: `Clicked ${target.label}.`,
      target: target.label,
    } satisfies ToolOutcome
  } catch (error) {
    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: snapshot.url,
      note: `Failed to click ${target.label}: ${error instanceof Error ? error.message : "Unknown error"}.`,
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
  browser: LocalChromeBrowser
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
    await browser.fill(target.uid, value)
    if (submitOnEnter && isSearchLikeInput(target)) {
      await browser.pressKey("Enter")
    }

    return {
      actionKey: `fill::${snapshot.url}::${target.id}`,
      toolName: "fillInput",
      changed: true,
      currentUrl: await browser.getCurrentUrl(),
      note: submitOnEnter ? `Filled and submitted ${target.label}.` : `Filled ${target.label}.`,
      target: target.label,
    } satisfies ToolOutcome
  } catch (error) {
    return {
      actionKey: `fill::${snapshot.url}::${target.id}`,
      toolName: "fillInput",
      changed: false,
      currentUrl: snapshot.url,
      note: `Failed to fill ${target.label}: ${error instanceof Error ? error.message : "Unknown error"}.`,
      target: target.label,
    } satisfies ToolOutcome
  }
}

async function performNavigationAction({
  browser,
  resolvedUrl,
  targetLabel,
  visitedPages,
}: {
  browser: LocalChromeBrowser
  resolvedUrl: string
  targetLabel: string
  visitedPages: Set<string>
}) {
  if (
    wouldExceedPageLimit({
      visitedPages,
      nextUrl: resolvedUrl,
      maxPages: MAX_DISCOVERED_PAGES,
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
    await browser.navigate(resolvedUrl)
    const currentUrl = await browser.getCurrentUrl()
    return {
      actionKey: `navigate::${resolvedUrl}`,
      toolName: "navigateToUrl",
      changed: currentUrl !== beforeUrl,
      currentUrl,
      note: `Navigated to ${resolvedUrl}.`,
      target: targetLabel,
    } satisfies ToolOutcome
  } catch (error) {
    return {
      actionKey: `navigate::${resolvedUrl}`,
      toolName: "navigateToUrl",
      changed: false,
      currentUrl: beforeUrl,
      note: `Failed to navigate to ${resolvedUrl}: ${error instanceof Error ? error.message : "Unknown error"}.`,
      target: targetLabel,
    } satisfies ToolOutcome
  }
}

async function saveScreenshot({
  api,
  browser,
  runId,
  sessionId,
  stepIndex,
  title,
}: {
  api: LocalHelperApi
  browser: LocalChromeBrowser
  runId: string
  sessionId: string
  stepIndex: number
  title: string
}) {
  const screenshot = await browser.takeScreenshot()
  const pageUrl = await browser.getCurrentUrl()
  const artifact = await api.artifact({
    runId,
    type: "screenshot",
    contentType: "image/png",
    base64: Buffer.from(screenshot).toString("base64"),
    pageUrl,
    title,
  })

  await api.event({
    runId,
    kind: "artifact",
    status: "running",
    sessionId,
    artifactId: artifact.artifactId,
    stepIndex: stepIndex >= 0 ? stepIndex : undefined,
    title,
    body: `Screenshot captured for ${pageUrl}.`,
    pageUrl,
  })

  return artifact.artifactId
}

async function throwIfStopRequested({
  api,
  currentStep,
  pageUrl,
  runId,
}: {
  api: LocalHelperApi
  currentStep: string
  pageUrl?: string
  runId: string
}) {
  const state = await api.state({ runId })

  if (!state?.stopRequestedAt) {
    return
  }

  throw new RunCancelledError(currentStep, pageUrl ?? state.currentUrl ?? undefined)
}

function createImmediateRunStopWatcher({
  api,
  onStop,
  runId,
}: {
  api: LocalHelperApi
  onStop: () => Promise<void>
  runId: string
}) {
  let timer: ReturnType<typeof setInterval> | null = null
  let stopTriggered = false
  let stopInFlight = false
  let latestCurrentUrl: string | undefined

  const poll = async () => {
    if (stopInFlight) {
      return
    }

    const state = await api.state({ runId }).catch(() => null)

    if (!state?.stopRequestedAt) {
      return
    }

    stopTriggered = true
    stopInFlight = true
    latestCurrentUrl = state.currentUrl ?? undefined
    await onStop().catch(() => undefined)
  }

  timer = setInterval(() => {
    void poll()
  }, STOP_POLL_INTERVAL_MS)

  void poll()

  return {
    currentUrl: () => latestCurrentUrl,
    stop: () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    wasTriggered: () => stopTriggered,
  }
}

function buildAgentPrompt({
  instructions,
  mode,
  remainingMs,
  snapshot,
  stepIndex,
  visitedPages,
  recentActions,
}: {
  instructions?: string
  mode: RunMode
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
    "- Do not attempt login, signup, payment submission, purchase completion, account deletion, or destructive submission flows.",
    "- Reversible actions are allowed, including search, filters, sorting, tabs, drawers, pagination, safe forms, add-to-cart, and opening checkout pages.",
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
    `Step: ${stepIndex}/${MAX_AGENT_STEPS}`,
    `Remaining time budget: ${Math.ceil(remainingMs / 1000)} seconds`,
    `Current URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    `Forms: ${snapshot.formsSummary}`,
    `Visited pages: ${visitedPages.join(", ")}`,
    `Recent actions: ${recentActions.length ? recentActions.join(" | ") : "none"}`,
    `Visible text excerpt: ${snapshot.textExcerpt}`,
    `Current interactives: ${snapshot.interactives.map((item) => `${item.id}. ${item.label} [${item.tagName}${item.type ? `:${item.type}` : ""}]`).join("; ")}`,
  ].join("\n")
}

function parseGoalOutcome(summary: string) {
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

function inferTaskOutcome({
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

function formatToolOutcomeTitle(outcome: ToolOutcome) {
  switch (outcome.toolName) {
    case "clickElement":
      return `Clicked ${outcome.target ?? "element"}`
    case "fillInput":
      return `Filled ${outcome.target ?? "input"}`
    case "navigateToUrl":
      return "Navigated to page"
    case "captureScreenshot":
      return "Captured screenshot"
    default:
      return "Agent action completed"
  }
}

function isToolOutcome(value: unknown): value is ToolOutcome {
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

function isInteractiveTool(toolName: ToolOutcome["toolName"]) {
  return (
    toolName === "clickElement" ||
    toolName === "fillInput" ||
    toolName === "navigateToUrl"
  )
}

function isSafeInput(target: InteractiveElement) {
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

function isSearchLikeInput(target: InteractiveElement) {
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

function getClickSafetyDecision(target: InteractiveElement) {
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

function selectAuditUrls({
  pageCandidates,
  startUrl,
}: {
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
    .slice(0, MAX_DISCOVERED_PAGES - 1)
    .map((candidate) => candidate.url)

  return [startUrl, ...otherUrls]
}

class RunCancelledError extends Error {
  readonly currentUrl?: string

  constructor(
    message: string,
    currentUrl?: string,
  ) {
    super(message)
    this.currentUrl = currentUrl
  }
}

class LocalHelperApi {
  private readonly appBaseUrl: string
  private readonly helperSecret: string

  constructor(
    appBaseUrl: string,
    helperSecret: string,
  ) {
    this.appBaseUrl = appBaseUrl
    this.helperSecret = helperSecret
  }

  async register(payload: {
    helperId: string
    machineLabel: string
    version?: string
    status: LocalHelperStatus
    currentClaimedRunId?: string
  }) {
    return await this.post("register", payload)
  }

  async claim(payload: { helperId: string }) {
    return await this.post("claim", payload) as {
      ok: boolean
      run: RunRecord | null
      reason?: string
    }
  }

  async state(payload: { runId: string }) {
    const response = await this.post("state", payload) as {
      ok: boolean
      state: {
        currentUrl: string | null
        stopRequestedAt: number | null
      } | null
    }

    return response.state
  }

  async progress(payload: {
    runId: string
    status?: RunStatus
    queueState?: "pending" | "picked_up" | "waiting_for_worker" | "worker_unreachable"
    currentStep?: string
    currentUrl?: string | null
    errorMessage?: string | null
    goalStatus?: RunGoalStatus | null
    goalSummary?: string | null
    finishedAt?: number
    finalScore?: number
  }) {
    return await this.post("progress", payload)
  }

  async session(payload: {
    runId: string
    sessionId?: string
    provider: BrowserProvider
    externalSessionId: string
    status: SessionStatus
    debugUrl?: string
    replayUrl?: string
    finishedAt?: number | null
  }) {
    return await this.post("session", payload) as SessionRecord
  }

  async event(payload: {
    runId: string
    kind: "agent" | "artifact" | "audit" | "finding" | "navigation" | "session" | "status" | "system"
    title: string
    body?: string
    status?: RunStatus
    stepIndex?: number
    pageUrl?: string
    sessionId?: string
    artifactId?: string
  }) {
    return await this.post("event", payload)
  }

  async finding(payload: {
    runId: string
    source: "browser" | "perf"
    title: string
    description: string
    severity: "critical" | "high" | "low" | "medium"
    confidence: number
    impact: number
    score: number
    stepIndex?: number
    pageOrFlow?: string
    artifactId?: string
    suggestedFix?: string
  }) {
    return await this.post("finding", payload)
  }

  async artifact(payload: {
    runId: string
    type: "html-report" | "replay" | "screenshot" | "trace"
    contentType: string
    base64: string
    pageUrl?: string
    title?: string
  }) {
    return await this.post("artifact", payload) as { artifactId: string }
  }

  async performanceAudit(payload: {
    runId: string
    pageUrl: string
    performanceScore: number
    accessibilityScore: number
    bestPracticesScore: number
    seoScore: number
    reportArtifactId?: string
  }) {
    return await this.post("performance-audit", payload)
  }

  async finalize(payload: {
    helperId: string
    runId: string
    status: "cancelled" | "completed" | "failed"
    currentStep?: string
    currentUrl?: string | null
    errorMessage?: string
    goalStatus?: GoalOutcome["status"]
    goalSummary?: string
    finishedAt?: number
    finalScore?: number
    sessionId?: string
    sessionStatus?: SessionStatus
  }) {
    const mappedGoalStatus =
      payload.goalStatus === "partially_completed"
        ? "partially_completed"
        : payload.goalStatus

    return await this.post("finalize", {
      ...payload,
      goalStatus: mappedGoalStatus,
    })
  }

  private async post(action: string, payload: unknown) {
    const response = await fetch(`${this.appBaseUrl}/api/local-helper/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-local-helper-secret": this.helperSecret,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Local helper API ${action} failed (${response.status}): ${body}`)
    }

    return await response.json()
  }
}

class LocalChromeBrowser {
  private readonly browserUrl = process.env.LOCAL_CHROME_BROWSER_URL?.trim() || null
  private readonly profileDir = join(tmpdir(), `shard-local-helper-profile-${randomUUID()}`)
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private connectionLabelValue = "a local Chrome window launched by Shard"
  private ownsBrowser = false
  private runtimeCaptureStarted = false

  async connect() {
    if (this.browserUrl) {
      await assertReachableChromeDebugEndpoint(this.browserUrl)

      this.browser = await chromium.connectOverCDP(this.browserUrl, {
        timeout: SESSION_TIMEOUT_MS,
      })
      this.context = this.browser.contexts()[0] ?? null
      this.connectionLabelValue = this.browserUrl
      this.ownsBrowser = false

      if (!this.context) {
        throw new Error(
          "The provided LOCAL_CHROME_BROWSER_URL is reachable, but Chrome did not expose a default browser context. Open a normal tab in that Chrome instance first, or unset LOCAL_CHROME_BROWSER_URL so Shard can launch Chrome directly.",
        )
      }
    } else {
      this.context = await launchLocalChromeContext(this.profileDir)
      this.connectionLabelValue = "the Chrome window launched by Shard"
      this.ownsBrowser = true
    }

    const page = await this.requirePage()
    await page.bringToFront().catch(() => undefined)
  }

  async close() {
    if (this.ownsBrowser) {
      await this.context?.close().catch(() => undefined)
    } else {
      await this.browser?.close().catch(() => undefined)
    }

    this.browser = null
    this.context = null
    this.page = null
    await rm(this.profileDir, { recursive: true, force: true }).catch(() => undefined)
  }

  connectionLabel() {
    return this.connectionLabelValue
  }

  async startRuntimeCapture(startUrl: string, bufferedFindings: BufferedFinding[]) {
    if (this.runtimeCaptureStarted) {
      return
    }

    attachBrowserSignalCapture({
      bufferedFindings,
      page: await this.requirePage(),
      startUrl,
    })
    this.runtimeCaptureStarted = true
  }

  async collectRuntimeFindings(
    _startUrl?: string,
    _bufferedFindings?: BufferedFinding[],
  ) {}

  async open(url: string) {
    await safeGoto(await this.requirePage(), url)
  }

  async getCurrentUrl() {
    return (await this.requirePage()).url()
  }

  async inspectCurrentPage(): Promise<PageSnapshot> {
    return await inspectLocalChromePage(await this.requirePage())
  }

  async click(uid: string) {
    const page = await this.requirePage()
    const locator = page.locator(uid).first()
    await highlightActionTarget({ locator, page })
    await locator.click({ timeout: 5_000 })
    await settlePage(page)
  }

  async fill(uid: string, value: string) {
    const page = await this.requirePage()
    const locator = page.locator(uid).first()
    await highlightActionTarget({ locator, page })
    await locator.fill(value, { timeout: 5_000 })
    await settlePage(page)
  }

  async pressKey(key: string) {
    const page = await this.requirePage()
    await page.keyboard.press(key).catch(() => undefined)
    await settlePage(page)
  }

  async navigate(url: string) {
    await safeGoto(await this.requirePage(), url)
  }

  async goBack() {
    const page = await this.requirePage()
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined)
    await settlePage(page)
  }

  async takeScreenshot() {
    return new Uint8Array(
      await (await this.requirePage()).screenshot({
        fullPage: true,
        type: "png",
      }),
    )
  }

  private async requirePage() {
    if (!this.context) {
      throw new Error("Local Chrome context is not ready yet.")
    }

    if (this.page && !this.page.isClosed()) {
      return this.page
    }

    this.page = this.context.pages().find((page) => !page.isClosed()) ?? null

    if (!this.page) {
      this.page = await this.context.newPage()
    }

    return this.page
  }
}

async function launchLocalChromeContext(userDataDir: string) {
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      headless: false,
      args: ["--start-maximized"],
      ignoreHTTPSErrors: true,
      viewport: null,
    })
  } catch (error) {
    const chromePath = Launcher.getFirstInstallation()
    if (!chromePath) {
      throw error
    }

    return await chromium.launchPersistentContext(userDataDir, {
      executablePath: chromePath,
      headless: false,
      args: ["--start-maximized"],
      ignoreHTTPSErrors: true,
      viewport: null,
    })
  }
}

async function assertReachableChromeDebugEndpoint(browserUrl: string) {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(browserUrl)
  } catch {
    throw new Error(
      "LOCAL_CHROME_BROWSER_URL must be a valid Chrome debugging endpoint such as http://127.0.0.1:9222 or ws://127.0.0.1:9222/devtools/browser/<id>.",
    )
  }

  if (
    parsedUrl.protocol !== "http:" &&
    parsedUrl.protocol !== "https:" &&
    parsedUrl.protocol !== "ws:" &&
    parsedUrl.protocol !== "wss:"
  ) {
    throw new Error(
      "LOCAL_CHROME_BROWSER_URL must use http, https, ws, or wss so Shard can connect to Chrome.",
    )
  }

  if (parsedUrl.protocol === "ws:" || parsedUrl.protocol === "wss:") {
    return
  }

  const versionUrl = new URL("/json/version", parsedUrl)
  let response: Response

  try {
    response = await fetch(versionUrl, {
      method: "GET",
    })
  } catch (error) {
    throw new Error(
      `Could not reach ${versionUrl.toString()}. Start Chrome with --remote-debugging-port=9222, then retry, or unset LOCAL_CHROME_BROWSER_URL so Shard launches Chrome directly. Cause: ${toErrorMessage(error)}`,
    )
  }

  if (!response.ok) {
    throw new Error(
      `Chrome debugging endpoint ${versionUrl.toString()} returned HTTP ${response.status}. Start Chrome with --remote-debugging-port=9222, then retry, or unset LOCAL_CHROME_BROWSER_URL so Shard launches Chrome directly.`,
    )
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch (error) {
    throw new Error(
      `Chrome debugging endpoint ${versionUrl.toString()} did not return valid JSON. Cause: ${toErrorMessage(error)}`,
    )
  }

  const webSocketDebuggerUrl =
    typeof payload === "object" && payload !== null && "webSocketDebuggerUrl" in payload
      ? payload.webSocketDebuggerUrl
      : null

  if (typeof webSocketDebuggerUrl !== "string" || webSocketDebuggerUrl.length === 0) {
    throw new Error(
      `Chrome debugging endpoint ${versionUrl.toString()} did not expose a browser webSocketDebuggerUrl. Start Chrome with --remote-debugging-port=9222 and make sure you are pointing at the Chrome debugger, not your app server.`,
    )
  }
}

async function highlightActionTarget({
  locator,
  page,
}: {
  locator: Locator
  page: Page
}) {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined)
  await locator.highlight().catch(() => undefined)
  await page.waitForTimeout(ACTION_HIGHLIGHT_DELAY_MS).catch(() => undefined)
}

async function inspectLocalChromePage(page: Page): Promise<PageSnapshot> {
  return await page.evaluate(() => {
    const text = (document.body?.innerText ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1200)

    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button, input, textarea, select, [role="button"], [role="link"]',
      ),
    )

    const visibleNodes = nodes.filter((node) => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      )
    })

    const escapeValue = (value: string) =>
      value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')

    const buildSelector = (element: HTMLElement) => {
      const id = element.getAttribute("id")
      if (id) {
        return `#${window.CSS?.escape ? window.CSS.escape(id) : escapeValue(id)}`
      }

      const dataTestId = element.getAttribute("data-testid")
      if (dataTestId) {
        return `[data-testid="${escapeValue(dataTestId)}"]`
      }

      const name = element.getAttribute("name")
      if (name) {
        return `${element.tagName.toLowerCase()}[name="${escapeValue(name)}"]`
      }

      const ariaLabel = element.getAttribute("aria-label")
      if (ariaLabel) {
        return `${element.tagName.toLowerCase()}[aria-label="${escapeValue(ariaLabel)}"]`
      }

      const placeholder = element.getAttribute("placeholder")
      if (placeholder) {
        return `${element.tagName.toLowerCase()}[placeholder="${escapeValue(placeholder)}"]`
      }

      if (element instanceof HTMLAnchorElement && element.getAttribute("href")) {
        return `a[href="${escapeValue(element.getAttribute("href") ?? "")}"]`
      }

      const path: string[] = []
      let current: Element | null = element

      while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 5) {
        const tagName = current.tagName.toLowerCase()
        const siblings = Array.from(current.parentElement?.children ?? []).filter(
          (sibling) => sibling.tagName === current?.tagName,
        )
        const index = siblings.indexOf(current) + 1
        path.unshift(`${tagName}:nth-of-type(${Math.max(index, 1)})`)
        current = current.parentElement
      }

      return path.join(" > ")
    }

    const interactives = visibleNodes.slice(0, 25).map((element, index) => {
      const label =
        element.getAttribute("aria-label") ||
        element.getAttribute("placeholder") ||
        element.getAttribute("name") ||
        element.innerText ||
        element.textContent ||
        element.getAttribute("href") ||
        `${element.tagName.toLowerCase()} ${index + 1}`

      return {
        id: index + 1,
        uid: buildSelector(element),
        label: label.replace(/\s+/g, " ").trim().slice(0, 120),
        role: element.getAttribute("role") ?? "",
        tagName: element.tagName.toLowerCase(),
        type: element.getAttribute("type") ?? undefined,
        href: element.getAttribute("href") ?? undefined,
      }
    })

    const formsSummary = `${document.forms.length} forms, ${
      document.querySelectorAll("input, textarea, select").length
    } form fields`

    const signature = JSON.stringify({
      url: location.href,
      title: document.title,
      text: text.slice(0, 300),
      interactives: interactives.map((item) => item.label),
    })

    return {
      url: location.href,
      title: document.title || "Untitled page",
      textExcerpt: text,
      formsSummary,
      interactives,
      signature,
    }
  })
}

function attachBrowserSignalCapture({
  bufferedFindings,
  page,
  startUrl,
}: {
  bufferedFindings: BufferedFinding[]
  page: Page
  startUrl: string
}) {
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") {
      return
    }

    bufferedFindings.push({
      source: "browser",
      signature: `console::${message.type()}::${page.url()}::${message.text()}`,
      title: message.type() === "error" ? "Browser console error" : "Browser console warning",
      description: message.text(),
      severity: message.type() === "error" ? "high" : "medium",
      confidence: 0.9,
      pageOrFlow: page.url(),
      suggestedFix: "Inspect the console output and fix the underlying frontend runtime issue.",
    })
  })

  page.on("pageerror", (error) => {
    bufferedFindings.push({
      source: "browser",
      signature: `pageerror::${page.url()}::${error.message}`,
      title: "Unhandled browser error",
      description: error.message,
      severity: "high",
      confidence: 0.95,
      pageOrFlow: page.url(),
      suggestedFix: "Inspect the stack trace and resolve the runtime error before the affected flow ships.",
    })
  })

  page.on("requestfailed", (request) => {
    const failureUrl = request.url()
    if (!isSameHostname(startUrl, failureUrl)) {
      return
    }

    const resourceType = request.resourceType()
    if (resourceType !== "document" && resourceType !== "fetch" && resourceType !== "xhr") {
      return
    }

    bufferedFindings.push({
      source: "browser",
      signature: `requestfailed::${failureUrl}::${request.failure()?.errorText ?? "unknown"}`,
      title: "Same-origin request failed",
      description: `${resourceType} request to ${failureUrl} failed: ${request.failure()?.errorText ?? "Unknown failure"}`,
      severity: resourceType === "document" ? "high" : "medium",
      confidence: 0.9,
      pageOrFlow: page.url(),
      suggestedFix: "Check the failed request path, server response, and frontend call site.",
    })
  })

  page.on("response", (response) => {
    const responseUrl = response.url()
    if (!isSameHostname(startUrl, responseUrl)) {
      return
    }

    const resourceType = response.request().resourceType()
    if (
      response.status() < 400 ||
      (resourceType !== "document" && resourceType !== "fetch" && resourceType !== "xhr")
    ) {
      return
    }

    bufferedFindings.push({
      source: "browser",
      signature: `response::${response.status()}::${responseUrl}`,
      title: "Same-origin request returned an error status",
      description: `${resourceType} request to ${responseUrl} returned HTTP ${response.status()}.`,
      severity: resourceType === "document" ? "high" : "medium",
      confidence: 0.9,
      pageOrFlow: page.url(),
      suggestedFix: "Inspect the failing route or API handler and verify the frontend request path.",
    })
  })
}

async function settlePage(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined)
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined)
  await page.waitForTimeout(500).catch(() => undefined)
}

async function safeGoto(page: Page, url: string) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  })
  await settlePage(page)
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set before starting the local helper.`)
  }

  return value
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function windowlessInterval(callback: () => Promise<void>, intervalMs: number) {
  let timer = setInterval(() => {
    void callback().catch(() => undefined)
  }, intervalMs)

  return {
    stop: async () => {
      clearInterval(timer)
    },
    restart: () => {
      clearInterval(timer)
      timer = setInterval(() => {
        void callback().catch(() => undefined)
      }, intervalMs)
    },
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
