import { readFile, unlink } from "node:fs/promises"
import { chromium, type BrowserContext, type Locator, type Page } from "playwright"
import SteelClient from "steel-sdk"
import { NonRetriableError } from "inngest"
import { generateObject, generateText, stepCountIs, tool } from "ai"
import { openai } from "@ai-sdk/openai"
import { Launcher } from "chrome-launcher"
import { z } from "zod"
import type { Id } from "../convex/_generated/dataModel"
import { api } from "../convex/_generated/api"
import { createConvexServerClient } from "~/server/convex"
import { serverEnv } from "~/server-env"
import { inngest } from "./core"
import { isTransientWorkflowError } from "@/lib/workflow-errors"
import { pickQaFallbackAction } from "@/lib/qa-fallback"
import {
  getDecryptedCredentialById,
} from "@/lib/credentials-server"
import { applyStoredLoginToPage } from "@/lib/stored-login"
import {
  buildActionSignature,
  isSameHostname,
  resolveSameHostUrl,
  shouldStopForNoOps,
  shouldStopForRepeatActions,
  wouldExceedPageLimit,
} from "@/lib/qa-guards"
import {
  buildScoreSummary,
  computeFindingScore,
  impactWeightForSource,
} from "@/lib/scoring"
import {
  QaRunCancelledError,
  runQaSession,
} from "@/lib/qa-engine"

const MAX_PAGE_FINDINGS = 2
const ACTION_HIGHLIGHT_DELAY_MS = 350
const DEFAULT_MODEL = serverEnv.OPENAI_MODEL ?? "gpt-4o-mini"
const INTERACTIVE_QA_CONFIG = {
  agentTimeBudgetMs: 8 * 60 * 1000,
  maxAgentSteps: 36,
  maxDiscoveredPages: 12,
  sessionTimeoutMs: 10 * 60 * 1000,
} as const
const BACKGROUND_QA_CONFIG = {
  agentTimeBudgetMs: 20 * 60 * 1000,
  maxAgentSteps: 60,
  maxDiscoveredPages: 18,
  sessionTimeoutMs: 24 * 60 * 1000,
} as const
const PLAYWRIGHT_TRACE_PATH_PREFIX = "/tmp/shard-background-trace"
const STEEL_CONNECT_TIMEOUT_MS = 30_000
const STOP_POLL_INTERVAL_MS = 500

type RunRequestedEvent = {
  data: {
    browserProvider: "local_chrome" | "playwright" | "steel"
    credentialId?: Id<"credentials">
    instructions?: string
    mode: "explore" | "task"
    runId: Id<"runs">
    url: string
  }
}

type InteractiveElement = {
  href?: string | null
  id: number
  label: string
  selector: string
  tagName: string
  type?: string | null
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
  browserSignal?: "console" | "network" | "pageerror"
  confidence: number
  description: string
  pageOrFlow?: string
  severity: "critical" | "high" | "low" | "medium"
  signature: string
  source: "browser" | "perf"
  suggestedFix?: string
  title: string
}

type QaRuntimeConfig = {
  agentTimeBudgetMs: number
  maxAgentSteps: number
  maxDiscoveredPages: number
  sessionTimeoutMs: number
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

const steel = new SteelClient({
  steelAPIKey: serverEnv.STEEL_API_KEY,
})

export const qaRun = inngest.createFunction(
  {
    id: "qa-run",
    retries: 2,
    triggers: [{ event: "app/run.requested" }],
    onFailure: async ({ event, error }) => {
      const convex = createConvexServerClient()
      const runId = extractRunIdFromFailureEvent(event)

      if (!runId) {
        return
      }

      await convex.mutation(api.runtime.updateRun, {
        runId,
        status: "failed",
        currentStep: "QA run failed",
        errorMessage: error.message,
        finishedAt: Date.now(),
      })
    },
  },
  async ({ event }: { event: RunRequestedEvent }) => {
    return await runQaWorkflow(event.data)
  },
)

export const backgroundQaRun = inngest.createFunction(
  {
    id: "background-qa-run",
    retries: 1,
    concurrency: {
      limit: 4,
    },
    triggers: [{ event: "app/background-run.requested" }],
    onFailure: async ({ event, error }) => {
      const convex = createConvexServerClient()
      const runId = extractRunIdFromFailureEvent(event)

      if (!runId) {
        return
      }

      await convex.mutation(api.runtime.updateRun, {
        runId,
        status: "failed",
        currentStep: "Background QA run failed",
        errorMessage: error.message,
        finishedAt: Date.now(),
      })
    },
  },
  async ({ event }: { event: RunRequestedEvent }) => {
    return await runQaWorkflow(event.data)
  },
)

function getQaRuntimeConfig(browserProvider: "local_chrome" | "playwright" | "steel") {
  return browserProvider === "playwright"
    ? BACKGROUND_QA_CONFIG
    : INTERACTIVE_QA_CONFIG
}

async function launchBackgroundPlaywrightBrowser() {
  try {
    return await chromium.launch({
      headless: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!message.includes("Executable doesn't exist")) {
      throw error
    }

    const chromePath = Launcher.getFirstInstallation()

    if (!chromePath) {
      throw new NonRetriableError(
        "Background agents could not find a Playwright Chromium binary or a local Chrome installation. Run `npx playwright install chromium` once, or install Google Chrome.",
      )
    }

    return await chromium.launch({
      executablePath: chromePath,
      headless: true,
    })
  }
}

export async function runQaWorkflow({
  browserProvider,
  credentialId,
  instructions,
  mode,
  runId,
  url,
}: RunRequestedEvent["data"]) {
  if (browserProvider === "local_chrome") {
    throw new NonRetriableError(
      "Local Chrome runs must be claimed by the local helper and cannot execute in the Steel/Inngest worker.",
    )
  }

  const convex = createConvexServerClient()
  const qaConfig = getQaRuntimeConfig(browserProvider)
  const run = await convex.query(api.runs.getRun, { runId })

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  let context: BrowserContext | null = null
  let currentSessionId: string | null = null
  let sessionDocId: Id<"sessions"> | null = null
  let sessionDebugUrl: string | undefined
  let sessionReplayUrl: string | undefined
  let finalRunStatus: "cancelled" | "completed" | "failed" = "completed"
  let workflowError: Error | null = null
  let lastKnownUrl = url
  let failureStage = "Queued"
  const runAbortController = new AbortController()
  let stopWatcher: ReturnType<typeof createImmediateRunStopWatcher> | null = null

  try {
      await convex.mutation(api.runtime.resetRunState, {
        runId,
      })

      await convex.mutation(api.runtime.updateRunQueueState, {
        runId,
        queueState: "picked_up",
        title: "Background worker picked up run",
        body: "The Inngest worker accepted the job and started executing the QA workflow.",
      })

      await convex.mutation(api.runtime.updateRun, {
        runId,
        status: "starting",
        queueState: "picked_up",
        currentStep:
          browserProvider === "playwright"
            ? "Creating background Playwright session"
            : "Creating Steel session",
        currentUrl: url,
        errorMessage: null,
      })
      await emitRunEvent(convex, {
        runId,
        kind: "status",
        title: "Run starting",
        body:
          browserProvider === "playwright"
            ? "Initializing the isolated Playwright browser session and preparing the background worker."
            : "Initializing the Steel browser session and preparing the worker.",
        status: "starting",
        pageUrl: url,
      })

      await throwIfStopRequested({
        convex,
        runId,
        currentStep: "QA run stopped before session startup",
      })

      if (browserProvider === "steel") {
        const steelSession = await steel.sessions.create({
          timeout: qaConfig.sessionTimeoutMs,
        })
        currentSessionId = steelSession.id
        sessionDebugUrl = steelSession.debugUrl ?? steelSession.sessionViewerUrl
        sessionReplayUrl = steelSession.sessionViewerUrl
        sessionDocId = await convex.mutation(api.runtime.createSession, {
          runId,
          provider: "steel",
          externalSessionId: steelSession.id,
          status: "creating",
          debugUrl: sessionDebugUrl,
          replayUrl: sessionReplayUrl,
        })
        await emitRunEvent(convex, {
          runId,
          kind: "session",
          title: "Steel session created",
          body: "Browser infrastructure is ready. The live preview will appear once Playwright attaches.",
          status: "starting",
          pageUrl: url,
          sessionId: sessionDocId,
        })
      } else {
        currentSessionId = `playwright-${runId}`
        sessionDocId = await convex.mutation(api.runtime.createSession, {
          runId,
          provider: "playwright",
          externalSessionId: currentSessionId,
          status: "creating",
        })
        await emitRunEvent(convex, {
          runId,
          kind: "session",
          title: "Background Playwright session created",
          body: "An isolated headless Playwright session is ready for the background QA agent.",
          status: "starting",
          pageUrl: url,
          sessionId: sessionDocId,
        })
      }

      await throwIfStopRequested({
        convex,
        runId,
        currentStep: "QA run stopped before browser connection",
      })

      await convex.mutation(api.runtime.updateRun, {
        runId,
        status: "running",
        currentStep:
          browserProvider === "playwright"
            ? "Launching Playwright browser"
            : "Connecting Playwright to Steel",
      })
      failureStage =
        browserProvider === "playwright"
          ? "Launching Playwright browser"
          : "Connecting Playwright to Steel"
      await emitRunEvent(convex, {
        runId,
        kind: "session",
        title:
          browserProvider === "playwright"
            ? "Launching Playwright"
            : "Connecting to Steel",
        body:
          browserProvider === "playwright"
            ? "Launching a fresh headless Playwright browser for the background worker."
            : "Attaching Playwright to the remote browser session.",
        status: "running",
        pageUrl: url,
        sessionId: sessionDocId,
      })

      if (browserProvider === "steel") {
        browser = await chromium.connectOverCDP(
          `wss://connect.steel.dev?apiKey=${serverEnv.STEEL_API_KEY}&sessionId=${currentSessionId}`,
          { timeout: STEEL_CONNECT_TIMEOUT_MS },
        )
        context = browser.contexts()[0] ?? (await browser.newContext())
        await convex.mutation(api.runtime.updateSession, {
          sessionId: sessionDocId,
          status: "active",
          debugUrl: sessionDebugUrl,
          replayUrl: sessionReplayUrl,
        })
        await emitRunEvent(convex, {
          runId,
          kind: "session",
          title: "Steel live preview ready",
          body: "The browser session is active and can be watched live.",
          status: "running",
          pageUrl: url,
          sessionId: sessionDocId,
        })
      } else {
        browser = await launchBackgroundPlaywrightBrowser()
        context = await browser.newContext()
        await context.tracing.start({ screenshots: true, snapshots: true })
        await convex.mutation(api.runtime.updateSession, {
          sessionId: sessionDocId,
          status: "active",
        })
        await emitRunEvent(convex, {
          runId,
          kind: "session",
          title: "Background Playwright session active",
          body: "The isolated background browser is active and recording a trace for later review.",
          status: "running",
          pageUrl: url,
          sessionId: sessionDocId,
        })
      }

      stopWatcher = createImmediateRunStopWatcher({
        pollStopState: async () =>
          await convex.query(api.runtime.getRunExecutionState, { runId }),
        onStop: async () => {
          runAbortController.abort("stop_requested")
          await context?.close().catch(() => undefined)
          await browser?.close().catch(() => undefined)

          if (currentSessionId && browserProvider === "steel") {
            await steel.sessions.release(currentSessionId).catch(() => undefined)
          }
        },
      })

      const page = context.pages()[0] ?? (await context.newPage())

      await convex.mutation(api.runtime.updateRun, {
        runId,
        currentStep: "Opening target page",
      })
      failureStage = "Opening target page"
      await emitRunEvent(convex, {
        runId,
        kind: "navigation",
        title: "Opening target page",
        body: "Loading the requested URL in the live browser session.",
        status: "running",
        pageUrl: url,
        sessionId: sessionDocId,
      })

      await safeGoto(page, url)
      lastKnownUrl = page.url()
      await convex.mutation(api.runtime.updateRun, {
        runId,
        currentUrl: page.url(),
        currentStep: "Booting autonomous QA agent",
      })
      failureStage = "Booting autonomous QA agent"
      await emitRunEvent(convex, {
        runId,
        kind: "navigation",
        title: "Target page loaded",
        body: page.url(),
        status: "running",
        pageUrl: page.url(),
        sessionId: sessionDocId,
      })
      await emitRunEvent(convex, {
        runId,
        kind: "agent",
        title: "Autonomous QA agent booted",
        body:
          mode === "task" && instructions
            ? `The run is now following the requested task, capturing screenshots, and collecting findings.\nTask: ${instructions}`
            : "The run is now exploring the site, capturing screenshots, and collecting findings.",
        status: "running",
        pageUrl: page.url(),
        sessionId: sessionDocId,
      })
      const sessionResult = await runQaSession({
        agentOrdinal: run?.agentOrdinal,
        browser: createPlaywrightQaBrowser(page),
        config: {
          agentTimeBudgetMs: qaConfig.agentTimeBudgetMs,
          maxAgentSteps: qaConfig.maxAgentSteps,
          maxDiscoveredPages: qaConfig.maxDiscoveredPages,
        },
        getStoredCredential: credentialId
          ? async () =>
              await getDecryptedCredentialById({
                convex,
                credentialId,
              })
          : undefined,
        instructions,
        mode,
        model: openai(DEFAULT_MODEL),
        runtime: createConvexQaRuntime({
          abortSignal: runAbortController.signal,
          convex,
          runId,
          sessionId: sessionDocId,
        }),
        startUrl: url,
      })

      lastKnownUrl = page.url()

      await convex.mutation(api.runtime.updateRun, {
        runId,
        status: "completed",
        currentStep: "QA run completed",
        currentUrl: page.url(),
        finalScore: sessionResult.finalScore,
        finishedAt: Date.now(),
        goalStatus: sessionResult.goalOutcome?.status ?? null,
        goalSummary: sessionResult.goalOutcome?.summary ?? null,
        errorMessage: null,
      })
      await emitRunEvent(convex, {
        runId,
        kind: "status",
        title: "Run completed",
        body:
          mode === "task" && sessionResult.goalOutcome
            ? `Final quality score: ${sessionResult.finalScore}/100.\nTask outcome: ${sessionResult.goalOutcome.status}.\n${sessionResult.goalOutcome.summary}`
            : `Final quality score: ${sessionResult.finalScore}/100.`,
        status: "completed",
        pageUrl: page.url(),
        sessionId: sessionDocId,
      })
  } catch (error) {
      const stopState =
        error instanceof RunCancelledError || error instanceof QaRunCancelledError
          ? {
              currentUrl: error.currentUrl ?? lastKnownUrl,
              stopRequestedAt: Date.now(),
            }
          : stopWatcher?.wasTriggered()
            ? {
                currentUrl: stopWatcher.currentUrl() ?? lastKnownUrl,
                stopRequestedAt: Date.now(),
              }
            : await convex
                .query(api.runtime.getRunExecutionState, { runId })
                .catch(() => null)

      if (
        error instanceof RunCancelledError ||
        error instanceof QaRunCancelledError ||
        stopState?.stopRequestedAt
      ) {
        finalRunStatus = "cancelled"
        const finalScore = await computePersistedRunScore(convex, runId)
        const cancelledUrl =
          error instanceof RunCancelledError || error instanceof QaRunCancelledError
            ? error.currentUrl ?? stopState?.currentUrl ?? url
            : stopState?.currentUrl ?? lastKnownUrl

        await convex.mutation(api.runtime.updateRun, {
          runId,
          status: "cancelled",
          currentStep:
            error instanceof RunCancelledError || error instanceof QaRunCancelledError
              ? error.message
              : "Stop requested, shutting down run",
          currentUrl: cancelledUrl,
          errorMessage: null,
          finalScore,
          finishedAt: Date.now(),
        })
        await emitRunEvent(convex, {
          runId,
          kind: "status",
          title: "Run cancelled",
          body: `Shutdown completed. Partial quality score: ${finalScore}/100.`,
          status: "cancelled",
          pageUrl: cancelledUrl,
          sessionId: sessionDocId,
        })

        return
      }

      finalRunStatus = "failed"
      workflowError = error instanceof Error ? error : new Error("Unknown QA run error")

      if (!isTransientWorkflowError(error)) {
        await convex.mutation(api.runtime.updateRun, {
          runId,
          status: "failed",
          currentStep: "QA run failed",
          errorMessage: workflowError.message,
          finishedAt: Date.now(),
        })
        await emitRunEvent(convex, {
          runId,
          kind: "status",
          title: "Run failed",
          body: [
            `Stage: ${failureStage}`,
            `Last URL: ${lastKnownUrl}`,
            `Error: ${workflowError.message}`,
          ].join("\n"),
          status: "failed",
          pageUrl: lastKnownUrl,
          sessionId: sessionDocId,
        })

        throw new NonRetriableError(workflowError.message)
      }

      await convex.mutation(api.runtime.updateRun, {
        runId,
        status: "running",
        currentStep: "Transient browser failure, retrying",
        errorMessage: workflowError.message,
      })
      await emitRunEvent(convex, {
        runId,
        kind: "system",
        title: "Transient failure detected",
        body: `${workflowError.message} Retrying the workflow.`,
        status: "running",
        pageUrl: url,
        sessionId: sessionDocId,
      })

      throw workflowError
  } finally {
      stopWatcher?.stop()

      if (browserProvider === "playwright" && context) {
        const tracePath = `${PLAYWRIGHT_TRACE_PATH_PREFIX}-${runId}.zip`

        try {
          await context.tracing.stop({ path: tracePath })
          const artifactId = await uploadArtifact({
            body: await readFile(tracePath),
            contentType: "application/zip",
            convex,
            pageUrl: lastKnownUrl,
            runId,
            title: "Playwright trace",
            type: "trace",
          })

          await emitRunEvent(convex, {
            runId,
            kind: "artifact",
            title: "Playwright trace saved",
            body: "Stored the background Playwright replay trace for later review.",
            status:
              finalRunStatus === "completed"
                ? "completed"
                : finalRunStatus === "cancelled"
                  ? "cancelled"
                  : "failed",
            pageUrl: lastKnownUrl,
            sessionId: sessionDocId,
            artifactId,
          }).catch(() => undefined)
        } catch {
          // Ignore trace export failures during cleanup.
        } finally {
          await unlink(tracePath).catch(() => undefined)
        }
      }

      if (browser) {
        await browser.close().catch(() => undefined)
      }

      if (currentSessionId && browserProvider === "steel") {
        await steel.sessions.release(currentSessionId).catch(() => undefined)
        await emitRunEvent(convex, {
          runId,
          kind: "session",
          title: "Steel session released",
          body: "The live browser session has been closed and archived.",
          status:
            finalRunStatus === "completed"
              ? "completed"
              : finalRunStatus === "cancelled"
                ? "cancelled"
                : "failed",
          pageUrl: url,
          sessionId: sessionDocId,
        }).catch(() => undefined)
      }

      if (sessionDocId) {
        await convex
          .mutation(api.runtime.updateSession, {
            sessionId: sessionDocId,
            status: finalRunStatus === "failed" ? "failed" : "closed",
            replayUrl: sessionReplayUrl,
            finishedAt: Date.now(),
          })
          .catch(() => undefined)
      }
  }
}

function createImmediateRunStopWatcher({
  onStop,
  pollStopState,
}: {
  onStop: () => Promise<void>
  pollStopState: () => Promise<{
    currentUrl: string | null
    stopRequestedAt: number | null
  } | null>
}) {
  let timer: ReturnType<typeof setInterval> | null = null
  let stopTriggered = false
  let stopInFlight = false
  let latestCurrentUrl: string | undefined

  const poll = async () => {
    if (stopInFlight) {
      return
    }

    const state = await pollStopState().catch(() => null)

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

function createPlaywrightQaBrowser(page: Page) {
  return {
    captureRuntimeFindings: async () => {},
    click: async (ref: string) => {
      const locator = page.locator(ref).first()
      await highlightActionTarget({ locator, page })
      await locator.click({ timeout: 5_000 })
      await settlePage(page)
    },
    fill: async (ref: string, value: string) => {
      const locator = page.locator(ref).first()
      await highlightActionTarget({ locator, page })
      await locator.fill(value, { timeout: 5_000 })
      await settlePage(page)
    },
    getCurrentUrl: async () => page.url(),
    goBack: async () => {
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined)
      await settlePage(page)
    },
    inspectCurrentPage: async () => {
      const snapshot = await inspectCurrentPage(page)
      return {
        ...snapshot,
        interactives: snapshot.interactives.map((item) => ({
          ...item,
          ref: item.selector,
        })),
      }
    },
    navigate: async (targetUrl: string) => {
      await safeGoto(page, targetUrl)
    },
    pressKey: async (key: string) => {
      await page.keyboard.press(key).catch(() => undefined)
      await settlePage(page)
    },
    startRuntimeCapture: async (startUrl: string, bufferedFindings: BufferedFinding[]) => {
      attachBrowserSignalCapture({
        bufferedFindings,
        page,
        startUrl,
      })
    },
    takeScreenshot: async () =>
      new Uint8Array(
        await page.screenshot({
          fullPage: true,
          type: "png",
        }),
      ),
    useStoredLogin: async (credential: {
      login: string
      origin: string
      password: string
    }) => await applyStoredLoginToPage(page, credential),
  }
}

function createConvexQaRuntime({
  abortSignal,
  convex,
  runId,
  sessionId,
}: {
  abortSignal: AbortSignal
  convex: ReturnType<typeof createConvexServerClient>
  runId: Id<"runs">
  sessionId: Id<"sessions"> | null
}) {
  return {
    createArtifact: async (payload: {
      body: Uint8Array
      contentType: string
      pageUrl?: string
      title?: string
      type: "html-report" | "replay" | "screenshot" | "trace"
    }) =>
      await uploadArtifact({
        body: payload.body,
        contentType: payload.contentType,
        convex,
        pageUrl: payload.pageUrl ?? "",
        runId,
        title: payload.title ?? payload.type,
        type: payload.type === "replay" ? "trace" : payload.type,
      }),
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
      await convex.mutation(api.runtime.createFinding, {
        ...payload,
        artifactId: payload.artifactId as Id<"artifacts"> | undefined,
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
      await convex.mutation(api.runtime.createPerformanceAudit, {
        ...payload,
        reportArtifactId: payload.reportArtifactId as Id<"artifacts"> | undefined,
        runId,
      })
    },
    emitEvent: async (payload: {
      artifactId?: string
      body?: string
      kind: "agent" | "artifact" | "audit" | "finding" | "navigation" | "session" | "status" | "system"
      pageUrl?: string
      status?: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
      stepIndex?: number
      title: string
    }) => {
      await emitRunEvent(convex, {
        ...payload,
        artifactId: payload.artifactId as Id<"artifacts"> | undefined,
        runId,
        sessionId,
      })
    },
    getAbortSignal: () => abortSignal,
    getStopState: async () => await convex.query(api.runtime.getRunExecutionState, { runId }),
    updateRun: async (payload: {
      currentStep?: string
      currentUrl?: string | null
      errorMessage?: string | null
      finalScore?: number
      finishedAt?: number
      goalStatus?: "blocked" | "completed" | "not_requested" | "partially_completed" | null
      goalSummary?: string | null
      queueState?: "pending" | "picked_up" | "waiting_for_worker" | "worker_unreachable"
      status?: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
    }) => {
      await convex.mutation(api.runtime.updateRun, {
        ...payload,
        runId,
      })
    },
  }
}

async function computePersistedRunScore(
  convex: ReturnType<typeof createConvexServerClient>,
  runId: Id<"runs">,
) {
  const report = await convex.query(api.runtime.getRunReport, { runId })
  return report?.scoreSummary.overall ?? 0
}

void runAgentLoop
void computeRunFinalScore
void selectAuditUrls

async function runAgentLoop({
  agentOrdinal,
  convex,
  credentialId,
  config,
  findingSignatures,
  bufferedFindings,
  instructions,
  mode,
  page,
  pageCandidates,
  runId,
  savedFindings,
  sessionId,
  startUrl,
}: {
  agentOrdinal?: number
  convex: ReturnType<typeof createConvexServerClient>
  credentialId?: Id<"credentials">
  config: QaRuntimeConfig
  findingSignatures: Set<string>
  bufferedFindings: BufferedFinding[]
  instructions?: string
  mode: "explore" | "task"
  page: Page
  pageCandidates: Map<string, PageCandidate>
  runId: Id<"runs">
  savedFindings: SavedFinding[]
  sessionId: Id<"sessions"> | null
  startUrl: string
}) {
  const visitedPages = new Set<string>([page.url()])
  const actionHistory: string[] = []
  const triedActions = new Set<string>()
  const analyzedSnapshots = new Set<string>()
  const deadlineAt = Date.now() + config.agentTimeBudgetMs
  let noOpCount = 0
  let screenshotCount = 0
  let goalOutcome: GoalOutcome | undefined
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
      await emitRunEvent(convex, {
        runId,
        kind: "system",
        title: "Exploration time budget reached",
        body: "The worker hit the exploration time budget and is moving on to final scoring and cleanup.",
        status: "running",
        pageUrl: page.url(),
        sessionId,
        stepIndex,
      })
      break
    }

    await throwIfStopRequested({
      convex,
      runId,
      bufferedFindings,
      currentStep: "QA run stopped during exploration",
      pageCandidates,
      pageUrl: page.url(),
      runIdForFindings: runId,
      savedFindings,
      stepIndex,
      findingSignatures,
      sessionId,
    })

    const snapshot = await inspectCurrentPage(page)
    pageCandidates.set(
      snapshot.url,
      pageCandidates.get(snapshot.url) ?? {
        url: snapshot.url,
        interactionCount: 0,
        findingCount: 0,
        firstSeenAt: pageCandidates.size,
      },
    )

    await convex.mutation(api.runtime.updateRun, {
      runId,
      currentStep:
        mode === "task"
          ? `Task step ${stepIndex} of ${config.maxAgentSteps}`
          : `Exploration step ${stepIndex} of ${config.maxAgentSteps}`,
      currentUrl: snapshot.url,
      status: "running",
    })
    await emitRunEvent(convex, {
      runId,
      kind: "agent",
      title: mode === "task" ? `Task step ${stepIndex}` : `Exploration step ${stepIndex}`,
      body:
        mode === "task" && instructions
          ? `Reviewing ${snapshot.url}.\nTask: ${instructions}`
          : `Reviewing ${snapshot.url}.`,
      status: "running",
      pageUrl: snapshot.url,
      sessionId,
      stepIndex,
    })

    const result = await generateText({
      model: openai(DEFAULT_MODEL),
      prompt: buildAgentPrompt({
        agentOrdinal,
        hasStoredCredential: Boolean(credentialId),
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
        bufferedFindings,
        credentialId,
        convex,
        maxDiscoveredPages: config.maxDiscoveredPages,
        page,
        runId,
        sessionId,
        startUrl,
        visitedPages,
      }),
    }).catch(async (error) => {
      await emitNonBlockingAiWarning(convex, {
        runId,
        sessionId,
        stepIndex,
        pageUrl: snapshot.url,
        title: "Agent planning unavailable",
        body: `The AI planner failed during exploration step ${stepIndex}. Ending exploration early instead of failing the run.\nError: ${
          error instanceof Error ? error.message : "Unknown AI planner error"
        }`,
      })

      return null
      })

    if (!result) {
      stopReason = "planner_unavailable"
      break
    }

    const plannerSummary = result.text.trim()
    const plannerGoalOutcome =
      mode === "task" ? parseGoalOutcome(plannerSummary) : null
    const toolResults = result.steps.flatMap((step) => step.toolResults)
    const latestToolResult = [...toolResults]
      .reverse()
      .find((toolResult) => Boolean(toolResult))

    if (plannerGoalOutcome && !latestToolResult) {
      goalOutcome = plannerGoalOutcome
      stopReason = "goal"
      await emitRunEvent(convex, {
        runId,
        kind: "agent",
        title:
          plannerGoalOutcome.status === "completed"
            ? "Task completed"
            : plannerGoalOutcome.status === "blocked"
              ? "Task blocked"
              : "Task partially completed",
        body: plannerGoalOutcome.summary,
        status: "running",
        pageUrl: snapshot.url,
        sessionId,
        stepIndex,
      })
      break
    }

    const outcome = latestToolResult && !latestToolResult.dynamic && isToolOutcome(latestToolResult.output)
      ? latestToolResult.output
      : await executePlannerFallback({
          maxDiscoveredPages: config.maxDiscoveredPages,
          bufferedFindings,
          convex,
          page,
          runId,
          sessionId,
          snapshot,
          startUrl,
          stepIndex,
          triedActions,
          visitedPages,
        })

    if (plannerSummary || outcome.fallback) {
      await emitRunEvent(convex, {
        runId,
        kind: "agent",
        title: outcome.fallback ? "Agent fallback decision" : "Agent decision",
        body:
          plannerSummary ||
          "The planner did not call a tool, so the run used a bounded fallback action to keep exploring.",
        status: "running",
        pageUrl: snapshot.url,
        sessionId,
        stepIndex,
      })
    }

    actionHistory.push(
      outcome.actionKey ??
        buildActionSignature({
          action: outcome.toolName,
          pageUrl: outcome.currentUrl,
          target: outcome.target,
        }),
    )
    triedActions.add(actionHistory[actionHistory.length - 1]!)

    await throwIfStopRequested({
      convex,
      runId,
      bufferedFindings,
      currentStep: "QA run stopped during exploration",
      pageCandidates,
      pageUrl: outcome.currentUrl,
      runIdForFindings: runId,
      savedFindings,
      stepIndex,
      findingSignatures,
      sessionId,
    })
    await emitRunEvent(convex, {
      runId,
      kind: outcome.toolName === "navigateToUrl" ? "navigation" : "agent",
      title: formatToolOutcomeTitle(outcome),
      body: outcome.note,
      status: "running",
      pageUrl: outcome.currentUrl,
      sessionId,
      stepIndex,
    })

    if (outcome.artifactCreated) {
      screenshotCount += 1
    }

    if (shouldStopForRepeatActions(actionHistory)) {
      stopReason = "repeat_actions"
      break
    }

    const beforeFindings = savedFindings.length
    const browserFindingCount = await flushBufferedFindings({
      convex,
      findingSignatures,
      bufferedFindings,
      pageCandidates,
      runId,
      savedFindings,
      sessionId,
      stepIndex,
    })

    const nextSnapshot = await inspectCurrentPage(page)
    visitedPages.add(nextSnapshot.url)
    const candidate = pageCandidates.get(nextSnapshot.url)

    if (candidate && isInteractiveTool(outcome.toolName) && outcome.changed) {
      candidate.interactionCount += 1
    }

    if (visitedPages.size > config.maxDiscoveredPages) {
      stopReason = "max_pages"
      break
    }

    const stateChanged = outcome.changed || nextSnapshot.signature !== snapshot.signature

    if (stateChanged) {
      noOpCount = 0

      screenshotCount += await runSnapshotStage({
        convex,
        findingSignatures,
        bufferedFindings,
        page,
        pageCandidates,
        runId,
        savedFindings,
        sessionId,
        stepIndex,
        analyzedSnapshots,
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
  convex,
  findingSignatures,
  bufferedFindings,
  page,
  pageCandidates,
  runId,
  savedFindings,
  sessionId,
  stepIndex,
  analyzedSnapshots = new Set<string>(),
}: {
  convex: ReturnType<typeof createConvexServerClient>
  findingSignatures: Set<string>
  bufferedFindings: BufferedFinding[]
  page: Page
  pageCandidates: Map<string, PageCandidate>
  runId: Id<"runs">
  savedFindings: SavedFinding[]
  sessionId: Id<"sessions"> | null
  stepIndex: number
  analyzedSnapshots?: Set<string>
}) {
  const snapshot = await inspectCurrentPage(page)
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
    convex,
    page,
    runId,
    sessionId,
    stepIndex,
    title: stepIndex === 0 ? "Landing page screenshot" : `Step ${stepIndex} screenshot`,
  })

  await flushBufferedFindings({
    convex,
    findingSignatures,
    bufferedFindings,
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
    model: openai(DEFAULT_MODEL),
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
  }).catch(async (error) => {
    await emitNonBlockingAiWarning(convex, {
      runId,
      sessionId,
      stepIndex,
      pageUrl: snapshot.url,
      artifactId: screenshotArtifactId,
      title: "Page review skipped",
      body: `The AI page-review step failed, but the QA run will continue.\nError: ${
        error instanceof Error ? error.message : "Unknown AI review error"
      }`,
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

    await convex.mutation(api.runtime.createFinding, {
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
    await emitRunEvent(convex, {
      runId,
      kind: "finding",
      title: finding.title,
      body: finding.description,
      status: "running",
      pageUrl: snapshot.url,
      sessionId,
      artifactId: screenshotArtifactId,
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

function buildAgentTools({
  bufferedFindings,
  credentialId,
  convex,
  maxDiscoveredPages,
  page,
  runId,
  sessionId,
  startUrl,
  visitedPages,
}: {
  bufferedFindings: BufferedFinding[]
  credentialId?: Id<"credentials">
  convex: ReturnType<typeof createConvexServerClient>
  maxDiscoveredPages: number
  page: Page
  runId: Id<"runs">
  sessionId: Id<"sessions"> | null
  startUrl: string
  visitedPages: Set<string>
}) {
  return {
    inspectCurrentPage: tool({
      description: "Inspect the current page and return its compact QA snapshot.",
      inputSchema: z.object({}),
      execute: async () => {
        return await inspectCurrentPage(page)
      },
    }),
    listInteractiveElements: tool({
      description: "List the currently visible clickable and input elements.",
      inputSchema: z.object({}),
      execute: async () => {
        const snapshot = await inspectCurrentPage(page)
        return snapshot.interactives
      },
    }),
    clickElement: tool({
      description: "Click a visible interactive element by its current snapshot id.",
      inputSchema: z.object({
        id: z.number(),
      }),
      execute: async ({ id }) => {
        return await performClickAction({
          bufferedFindings,
          maxDiscoveredPages,
          page,
          startUrl,
          targetId: id,
          visitedPages,
        })
      },
    }),
    fillInput: tool({
      description:
        "Fill a safe text-like input by its current snapshot id. Do not use for auth, passwords, payments, or destructive forms.",
      inputSchema: z.object({
        id: z.number(),
        submitOnEnter: z.boolean().optional(),
        value: z.string().min(1),
      }),
      execute: async ({ id, submitOnEnter, value }) => {
        return await performFillAction({
          bufferedFindings,
          page,
          submitOnEnter: submitOnEnter ?? false,
          targetId: id,
          value,
        })
      },
    }),
    navigateToUrl: tool({
      description: "Navigate to a same-host URL.",
      inputSchema: z.object({
        url: z.string().min(1),
      }),
      execute: async ({ url: nextUrl }) => {
        const resolvedUrl = resolveSameHostUrl({
          startUrl,
          currentUrl: page.url(),
          nextUrl,
        })

        if (!resolvedUrl) {
          return {
            toolName: "navigateToUrl",
            changed: false,
            currentUrl: page.url(),
            note: `Blocked navigation to ${nextUrl}.`,
            target: nextUrl,
          } satisfies ToolOutcome
        }

        return await performNavigationAction({
          bufferedFindings,
          maxDiscoveredPages,
          page,
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
          convex,
          page,
          runId,
          sessionId,
          stepIndex: -1,
          title: title ?? "Agent requested screenshot",
        })

        return {
          toolName: "captureScreenshot",
          artifactCreated: true,
          changed: false,
          currentUrl: page.url(),
          note: "Captured screenshot.",
          target: title ?? undefined,
        } satisfies ToolOutcome
      },
    }),
    ...(credentialId
      ? {
          useStoredLogin: tool({
            description:
              "Use the stored login credential for the current website when an auth wall blocks useful exploration.",
            inputSchema: z.object({}),
            execute: async () => {
              const credential = await getDecryptedCredentialById({
                convex,
                credentialId,
              })

              if (!credential) {
                return {
                  toolName: "useStoredLogin",
                  changed: false,
                  currentUrl: page.url(),
                  note: "No stored credential is available for this website.",
                  target: new URL(page.url()).origin,
                } satisfies ToolOutcome
              }

              try {
                const didApply = await applyStoredLoginToPage(page, credential)
                const after = await inspectCurrentPage(page)

                return {
                  toolName: "useStoredLogin",
                  changed: didApply,
                  currentUrl: after.url,
                  note: didApply
                    ? "Attempted sign-in with the stored website credential."
                    : "Could not find a compatible login form on this page.",
                  target: credential.origin,
                } satisfies ToolOutcome
              } catch (error) {
                bufferedFindings.push(
                  createActionFailureFinding({
                    action: "login",
                    error,
                    pageUrl: page.url(),
                    target: new URL(page.url()).origin,
                  }),
                )

                return {
                  toolName: "useStoredLogin",
                  changed: false,
                  currentUrl: page.url(),
                  note: "Stored login failed on this page.",
                  target: new URL(page.url()).origin,
                } satisfies ToolOutcome
              }
            },
          }),
        }
      : {}),
  }
}

function buildAgentPrompt({
  agentOrdinal,
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
  agentOrdinal?: number
  hasStoredCredential: boolean
  maxAgentSteps: number
  instructions?: string
  mode: "explore" | "task"
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
    agentOrdinal
      ? `Agent ordinal: ${agentOrdinal}. Favor a fresh area of the app when several agents share the same site or goal.`
      : null,
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

async function executePlannerFallback({
  bufferedFindings,
  convex,
  maxDiscoveredPages,
  page,
  runId,
  sessionId,
  snapshot,
  startUrl,
  stepIndex,
  triedActions,
  visitedPages,
}: {
  bufferedFindings: BufferedFinding[]
  convex: ReturnType<typeof createConvexServerClient>
  maxDiscoveredPages: number
  page: Page
  runId: Id<"runs">
  sessionId: Id<"sessions"> | null
  snapshot: PageSnapshot
  startUrl: string
  stepIndex: number
  triedActions: Set<string>
  visitedPages: Set<string>
}): Promise<ToolOutcome> {
  const fallbackAction = pickQaFallbackAction({
    currentUrl: snapshot.url,
    interactives: snapshot.interactives,
    maxPages: maxDiscoveredPages,
    startUrl,
    triedActions,
    visitedPages,
  })

  if (fallbackAction.kind === "navigate") {
    return {
      ...(await performNavigationAction({
        bufferedFindings,
        maxDiscoveredPages,
        page,
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
        bufferedFindings,
        maxDiscoveredPages,
        page,
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
        bufferedFindings,
        page,
        submitOnEnter: fallbackAction.submitOnEnter ?? false,
        targetId: fallbackAction.id,
        value: fallbackAction.value,
      })),
      fallback: true,
      note: fallbackAction.reason,
    }
  }

  await saveScreenshot({
    convex,
    page,
    runId,
    sessionId,
    stepIndex,
    title: `Fallback screenshot for step ${stepIndex}`,
  })

  return {
    toolName: "captureScreenshot",
    artifactCreated: true,
    changed: false,
    currentUrl: page.url(),
    fallback: true,
    note: fallbackAction.reason,
  }
}

async function performClickAction({
  bufferedFindings,
  maxDiscoveredPages,
  page,
  startUrl,
  targetId,
  visitedPages,
}: {
  bufferedFindings: BufferedFinding[]
  maxDiscoveredPages: number
  page: Page
  startUrl: string
  targetId: number
  visitedPages: Set<string>
}): Promise<ToolOutcome> {
  const snapshot = await inspectCurrentPage(page)
  const target = snapshot.interactives.find((item) => item.id === targetId)

  if (!target) {
    return {
      actionKey: `click::${snapshot.url}::${targetId}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: page.url(),
      note: `Element ${targetId} is no longer available.`,
    }
  }

  const safetyDecision = getClickSafetyDecision(target)

  if (!safetyDecision.allowed) {
    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: page.url(),
      note: safetyDecision.reason,
      target: target.label,
    }
  }

  if (target.href && !isSameHostname(startUrl, new URL(target.href, page.url()).toString())) {
    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: page.url(),
      note: `Blocked external link ${target.href}.`,
      target: target.label,
    }
  }

  try {
    const before = await inspectCurrentPage(page)
    const resolvedHref = target.href
      ? new URL(target.href, page.url()).toString()
      : null

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
        currentUrl: page.url(),
        note: `Skipped ${target.label} because it would exceed the page limit.`,
        target: target.label,
      }
    }

    const locator = page.locator(target.selector).first()
    await highlightActionTarget({ locator, page })
    await locator.click({ timeout: 5_000 })
    await settlePage(page)

    if (!isSameHostname(startUrl, page.url())) {
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined)
      await settlePage(page)
      return {
        actionKey: `click::${snapshot.url}::${target.id}`,
        toolName: "clickElement",
        changed: false,
        currentUrl: page.url(),
        note: "Blocked navigation outside the starting hostname.",
        target: target.label,
      }
    }

    if (
      wouldExceedPageLimit({
        visitedPages,
        nextUrl: page.url(),
        maxPages: maxDiscoveredPages,
      })
    ) {
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined)
      await settlePage(page)
      return {
        actionKey: `click::${snapshot.url}::${target.id}`,
        toolName: "clickElement",
        changed: false,
        currentUrl: page.url(),
        note: `Skipped ${target.label} because it would exceed the page limit.`,
        target: target.label,
      }
    }

    const after = await inspectCurrentPage(page)

    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: after.signature !== before.signature,
      currentUrl: after.url,
      note: `Clicked ${target.label}.`,
      target: target.label,
    }
  } catch (error) {
    bufferedFindings.push(
      createActionFailureFinding({
        action: "click",
        error,
        pageUrl: page.url(),
        target: target.label,
      }),
    )

    return {
      actionKey: `click::${snapshot.url}::${target.id}`,
      toolName: "clickElement",
      changed: false,
      currentUrl: page.url(),
      note: `Failed to click ${target.label}.`,
      target: target.label,
    }
  }
}

async function performFillAction({
  bufferedFindings,
  page,
  submitOnEnter,
  targetId,
  value,
}: {
  bufferedFindings: BufferedFinding[]
  page: Page
  submitOnEnter: boolean
  targetId: number
  value: string
}): Promise<ToolOutcome> {
  const snapshot = await inspectCurrentPage(page)
  const target = snapshot.interactives.find((item) => item.id === targetId)

  if (!target) {
    return {
      actionKey: `fill::${snapshot.url}::${targetId}::${submitOnEnter ? "submit" : "fill"}`,
      toolName: "fillInput",
      changed: false,
      currentUrl: page.url(),
      note: `Input ${targetId} is no longer available.`,
    }
  }

  if (!isSafeInput(target)) {
    return {
      actionKey: `fill::${snapshot.url}::${target.id}::${submitOnEnter ? "submit" : "fill"}`,
      toolName: "fillInput",
      changed: false,
      currentUrl: page.url(),
      note: `Skipped unsafe field ${target.label}.`,
      target: target.label,
    }
  }

  try {
    const locator = page.locator(target.selector).first()
    await highlightActionTarget({ locator, page })
    await locator.fill(value, { timeout: 5_000 })

    if (submitOnEnter && isSearchLikeInput(target)) {
      await locator.press("Enter", { timeout: 5_000 }).catch(() => undefined)
    }

    await settlePage(page)

    return {
      actionKey: `fill::${snapshot.url}::${target.id}::${submitOnEnter ? "submit" : "fill"}`,
      toolName: "fillInput",
      changed: true,
      currentUrl: page.url(),
      note: submitOnEnter ? `Filled and submitted ${target.label}.` : `Filled ${target.label}.`,
      target: target.label,
    }
  } catch (error) {
    bufferedFindings.push(
      createActionFailureFinding({
        action: "fill",
        error,
        pageUrl: page.url(),
        target: target.label,
      }),
    )

    return {
      actionKey: `fill::${snapshot.url}::${target.id}::${submitOnEnter ? "submit" : "fill"}`,
      toolName: "fillInput",
      changed: false,
      currentUrl: page.url(),
      note: `Failed to fill ${target.label}.`,
      target: target.label,
    }
  }
}

async function performNavigationAction({
  bufferedFindings,
  maxDiscoveredPages,
  page,
  resolvedUrl,
  targetLabel,
  visitedPages,
}: {
  bufferedFindings: BufferedFinding[]
  maxDiscoveredPages: number
  page: Page
  resolvedUrl: string
  targetLabel: string
  visitedPages: Set<string>
}): Promise<ToolOutcome> {
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
      currentUrl: page.url(),
      note: `Blocked navigation to ${resolvedUrl} because it would exceed the page limit.`,
      target: targetLabel,
    }
  }

  try {
    const beforeUrl = page.url()
    await safeGoto(page, resolvedUrl)

    return {
      actionKey: `navigate::${resolvedUrl}`,
      toolName: "navigateToUrl",
      changed: page.url() !== beforeUrl,
      currentUrl: page.url(),
      note: `Navigated to ${resolvedUrl}.`,
      target: targetLabel,
    }
  } catch (error) {
    bufferedFindings.push(
      createActionFailureFinding({
        action: "navigate",
        error,
        pageUrl: page.url(),
        target: resolvedUrl,
      }),
    )

    return {
      actionKey: `navigate::${resolvedUrl}`,
      toolName: "navigateToUrl",
      changed: false,
      currentUrl: page.url(),
      note: `Failed to navigate to ${resolvedUrl}.`,
      target: targetLabel,
    }
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
}): GoalOutcome {
  const taskLabel = instructions ? `Task: ${instructions}` : "The requested task"

  if (actionCount === 0 || stopReason === "planner_unavailable") {
    return {
      status: "blocked",
      summary: `${taskLabel}. The agent could not make reliable progress before the run ended.`,
    }
  }

  if (stopReason === "time_budget" || stopReason === "max_steps") {
    return {
      status: "partially_completed",
      summary: `${taskLabel}. The agent explored ${visitedPageCount} page${visitedPageCount === 1 ? "" : "s"} and executed ${actionCount} action${actionCount === 1 ? "" : "s"} before the time budget ended.`,
    }
  }

  if (stopReason === "no_ops" || stopReason === "repeat_actions") {
    return {
      status: "blocked",
      summary: `${taskLabel}. The visible UI no longer exposed fresh safe actions that advanced the task.`,
    }
  }

  return {
    status: "partially_completed",
    summary: `${taskLabel}. The agent made progress but could not confirm full completion before wrapping up.`,
  }
}

async function inspectCurrentPage(page: Page): Promise<PageSnapshot> {
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
        label: label.replace(/\s+/g, " ").trim().slice(0, 120),
        selector: buildSelector(element),
        tagName: element.tagName.toLowerCase(),
        type: element.getAttribute("type"),
        href: element.getAttribute("href"),
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
      browserSignal: "console",
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
      browserSignal: "pageerror",
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
      browserSignal: "network",
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
      browserSignal: "network",
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

async function flushBufferedFindings({
  convex,
  findingSignatures,
  bufferedFindings,
  pageCandidates,
  runId,
  savedFindings,
  sessionId,
  stepIndex,
}: {
  convex: ReturnType<typeof createConvexServerClient>
  findingSignatures: Set<string>
  bufferedFindings: BufferedFinding[]
  pageCandidates: Map<string, PageCandidate>
  runId: Id<"runs">
  savedFindings: SavedFinding[]
  sessionId?: Id<"sessions"> | null
  stepIndex: number
}) {
  let persistedCount = 0

  while (bufferedFindings.length > 0) {
    const finding = bufferedFindings.shift()

    if (!finding || findingSignatures.has(finding.signature)) {
      continue
    }

    findingSignatures.add(finding.signature)

    const score = computeFindingScore({
      severity: finding.severity,
      confidence: finding.confidence,
      source: finding.source,
    })
    const impact = impactWeightForSource(finding.source)

    await convex.mutation(api.runtime.createFinding, {
      runId,
      browserSignal: finding.browserSignal,
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
    await emitRunEvent(convex, {
      runId,
      kind: "finding",
      title: finding.title,
      body: finding.description,
      status: "running",
      pageUrl: finding.pageOrFlow,
      sessionId,
      stepIndex,
    })

    savedFindings.push({
      source: finding.source,
      score,
    })

    if (finding.pageOrFlow) {
      const candidate = pageCandidates.get(finding.pageOrFlow)
      if (candidate) {
        candidate.findingCount += 1
      }
    }

    persistedCount += 1
  }

  return persistedCount
}

async function emitRunEvent(
  convex: ReturnType<typeof createConvexServerClient>,
  event: {
    runId: Id<"runs">
    kind: "agent" | "artifact" | "audit" | "finding" | "navigation" | "session" | "status" | "system"
    title: string
    body?: string
    status?: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
    stepIndex?: number
    pageUrl?: string
    sessionId?: Id<"sessions"> | null
    artifactId?: Id<"artifacts">
  },
) {
  await convex.mutation(api.runtime.createRunEvent, {
    ...event,
    sessionId: event.sessionId ?? undefined,
  })
}

async function emitNonBlockingAiWarning(
  convex: ReturnType<typeof createConvexServerClient>,
  event: {
    runId: Id<"runs">
    title: string
    body: string
    pageUrl?: string
    sessionId?: Id<"sessions"> | null
    artifactId?: Id<"artifacts">
    stepIndex?: number
  },
) {
  await emitRunEvent(convex, {
    ...event,
    kind: "system",
    status: "running",
    sessionId: event.sessionId ?? undefined,
  })
}

function computeRunFinalScore({
  findings,
  performanceAudits,
  screenshots,
}: {
  findings: SavedFinding[]
  performanceAudits: number
  screenshots: number
}) {
  return buildScoreSummary({
    findings,
    performanceAudits,
    screenshots,
  }).overall
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
    case "useStoredLogin":
      return "Attempted stored login"
    default:
      return "Agent action completed"
  }
}

function extractRunIdFromFailureEvent(event: unknown): Id<"runs"> | null {
  if (!event || typeof event !== "object") {
    return null
  }

  const payload = event as {
    data?: {
      event?: {
        data?: {
          runId?: Id<"runs">
        }
      }
      runId?: Id<"runs">
    }
  }

  return payload.data?.event?.data?.runId ?? payload.data?.runId ?? null
}

class RunCancelledError extends Error {
  constructor(
    message: string,
    readonly currentUrl?: string,
  ) {
    super(message)
  }
}

async function throwIfStopRequested({
  convex,
  runId,
  currentStep,
  bufferedFindings,
  findingSignatures,
  pageCandidates,
  pageUrl,
  runIdForFindings,
  savedFindings,
  sessionId,
  stepIndex,
}: {
  convex: ReturnType<typeof createConvexServerClient>
  runId: Id<"runs">
  currentStep: string
  bufferedFindings?: BufferedFinding[]
  findingSignatures?: Set<string>
  pageCandidates?: Map<string, PageCandidate>
  pageUrl?: string
  runIdForFindings?: Id<"runs">
  savedFindings?: SavedFinding[]
  sessionId?: Id<"sessions"> | null
  stepIndex?: number
}) {
  const executionState = await convex.query(api.runtime.getRunExecutionState, { runId })

  if (!executionState?.stopRequestedAt) {
    return 0
  }

  if (
    bufferedFindings &&
    findingSignatures &&
    pageCandidates &&
    savedFindings &&
    stepIndex !== undefined &&
    runIdForFindings
  ) {
    await flushBufferedFindings({
      convex,
      findingSignatures,
      bufferedFindings,
      pageCandidates,
      runId: runIdForFindings,
      savedFindings,
      sessionId,
      stepIndex,
    })
  }

  throw new RunCancelledError(currentStep, pageUrl ?? executionState.currentUrl ?? undefined)
}

async function saveScreenshot({
  convex,
  page,
  runId,
  sessionId,
  stepIndex,
  title,
}: {
  convex: ReturnType<typeof createConvexServerClient>
  page: Page
  runId: Id<"runs">
  sessionId?: Id<"sessions"> | null
  stepIndex: number
  title: string
}) {
  const screenshot = await page.screenshot({
    fullPage: true,
    type: "png",
  })

  const artifactId = await uploadArtifact({
    body: new Uint8Array(screenshot),
    contentType: "image/png",
    convex,
    pageUrl: page.url(),
    runId,
    title: stepIndex >= 0 ? `${title}` : title,
    type: "screenshot",
  })

  await emitRunEvent(convex, {
    runId,
    kind: "artifact",
    title,
    body: `Screenshot captured for ${page.url()}.`,
    status: "running",
    pageUrl: page.url(),
    sessionId,
    artifactId,
    stepIndex: stepIndex >= 0 ? stepIndex : undefined,
  })

  return artifactId
}

async function uploadArtifact({
  body,
  contentType,
  convex,
  pageUrl,
  runId,
  title,
  type,
}: {
  body: Uint8Array
  contentType: string
  convex: ReturnType<typeof createConvexServerClient>
  pageUrl: string
  runId: Id<"runs">
  title: string
  type: "html-report" | "screenshot" | "trace"
}) {
  const uploadUrl = await convex.mutation(api.runtime.generateArtifactUploadUrl, {})
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
    },
    body: Buffer.from(body),
  })

  if (!uploadResponse.ok) {
    throw new Error(`Convex upload failed with status ${uploadResponse.status}`)
  }

  const { storageId } = (await uploadResponse.json()) as {
    storageId: Id<"_storage">
  }

  return await convex.mutation(api.runtime.createArtifact, {
    runId,
    type,
    fileLocation: `convex-storage:${storageId}`,
    storageId,
    title,
    pageUrl,
  })
}

function isSafeInput(target: InteractiveElement) {
  if (target.tagName === "textarea") {
    return true
  }

  if (target.tagName !== "input") {
    return false
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

  if (
    haystack.includes("buy now") ||
    haystack.includes("confirm") && haystack.includes("order")
  ) {
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

async function settlePage(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(
    () => undefined,
  )
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(
    () => undefined,
  )
  await page.waitForTimeout(500)
}

async function safeGoto(page: Page, url: string) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  })
  await settlePage(page)
}

function selectAuditUrls({
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
    .slice(0, maxAuditUrls - 1)
    .map((candidate) => candidate.url)

  return [startUrl, ...otherUrls]
}

function createActionFailureFinding({
  action,
  error,
  pageUrl,
  target,
}: {
  action: "click" | "fill" | "login" | "navigate"
  error: unknown
  pageUrl: string
  target: string
}) {
  const message = error instanceof Error ? error.message : "Unknown browser action failure"

  return {
    source: "browser",
    signature: `action::${action}::${pageUrl}::${target}::${message}`,
    title: `Agent ${action} action failed`,
    description: `${action} on "${target}" failed: ${message}`,
    severity: action === "navigate" ? "high" : "medium",
    confidence: 0.9,
    pageOrFlow: pageUrl,
    suggestedFix:
      "Inspect the target element or route and verify that the action stays stable in a clean browser session.",
  } satisfies BufferedFinding
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
    toolName === "navigateToUrl" ||
    toolName === "useStoredLogin"
  )
}
