import lighthouse from "lighthouse"
import { chromium, type Page } from "playwright"
import SteelClient from "steel-sdk"
import { NonRetriableError } from "inngest"
import { generateObject, generateText, stepCountIs, tool } from "ai"
import { google } from "@ai-sdk/google"
import { launch } from "chrome-launcher"
import { z } from "zod"
import type { Id } from "../convex/_generated/dataModel"
import { api } from "../convex/_generated/api"
import { createConvexServerClient } from "~/server/convex"
import { serverEnv } from "~/server-env"
import { inngest } from "./core"
import { isTransientWorkflowError } from "@/lib/workflow-errors"
import { scoreLighthouseFinding } from "@/lib/lighthouse-audits"
import { pickQaFallbackAction } from "@/lib/qa-fallback"
import { getDecryptedCredentialForOrigin } from "@/lib/credentials-server"
import {
  buildActionSignature,
  isSameHostname,
  resolveSameHostUrl,
  shouldStopForNoOps,
  shouldStopForRepeatActions,
  wouldExceedPageLimit,
} from "@/lib/qa-guards"
import { generateTotpCode } from "@/lib/totp"
import {
  buildScoreSummary,
  computeFindingScore,
  impactWeightForSource,
} from "@/lib/scoring"

const MAX_AGENT_STEPS = 24
const MAX_DISCOVERED_PAGES = 12
const MAX_PAGE_FINDINGS = 2
const DEFAULT_MODEL = serverEnv.GEMINI_MODEL ?? "gemini-2.5-flash"

type RunRequestedEvent = {
  data: {
    credentialNamespace?: string
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
  artifactCreated?: boolean
  changed: boolean
  currentUrl: string
  fallback?: boolean
  note: string
  target?: string
  toolName: string
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

export async function runQaWorkflow({
  credentialNamespace,
  runId,
  url,
}: RunRequestedEvent["data"]) {
  const convex = createConvexServerClient()

  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null
  let chrome: Awaited<ReturnType<typeof launch>> | null = null
  let currentSessionId: string | null = null
  let sessionDocId: Id<"sessions"> | null = null
  let finalRunStatus: "cancelled" | "completed" | "failed" = "completed"
  let workflowError: Error | null = null
  let screenshotCount = 0
  let performanceAuditCount = 0
  let lastKnownUrl = url
  let failureStage = "Queued"

  const savedFindings: SavedFinding[] = []
  const findingSignatures = new Set<string>()
  const bufferedFindings: BufferedFinding[] = []
  const pageCandidates = new Map<string, PageCandidate>()

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
        currentStep: "Creating Steel session",
        currentUrl: url,
        errorMessage: null,
      })
      await emitRunEvent(convex, {
        runId,
        kind: "status",
        title: "Run starting",
        body: "Initializing the Steel browser session and preparing the worker.",
        status: "starting",
        pageUrl: url,
      })

      await throwIfStopRequested({
        convex,
        runId,
        currentStep: "QA run stopped before session startup",
      })

      const steelSession = await steel.sessions.create()
      currentSessionId = steelSession.id
      const debugUrl = steelSession.debugUrl ?? steelSession.sessionViewerUrl
      sessionDocId = await convex.mutation(api.runtime.createSession, {
        runId,
        externalSessionId: steelSession.id,
        status: "creating",
        debugUrl,
        replayUrl: steelSession.sessionViewerUrl,
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

      await throwIfStopRequested({
        convex,
        runId,
        currentStep: "QA run stopped before browser connection",
      })

      await convex.mutation(api.runtime.updateRun, {
        runId,
        status: "running",
        currentStep: "Connecting Playwright to Steel",
      })
      failureStage = "Connecting Playwright to Steel"
      await emitRunEvent(convex, {
        runId,
        kind: "session",
        title: "Connecting to Steel",
        body: "Attaching Playwright to the remote browser session.",
        status: "running",
        pageUrl: url,
        sessionId: sessionDocId,
      })

      browser = await chromium.connectOverCDP(
        `wss://connect.steel.dev?apiKey=${serverEnv.STEEL_API_KEY}&sessionId=${steelSession.id}`,
      )

      await convex.mutation(api.runtime.updateSession, {
        sessionId: sessionDocId,
        status: "active",
        debugUrl,
        replayUrl: steelSession.sessionViewerUrl,
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

      const context = browser.contexts()[0] ?? (await browser.newContext())
      const page = context.pages()[0] ?? (await context.newPage())

      attachBrowserSignalCapture({
        bufferedFindings,
        page,
        startUrl: url,
      })

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
        body: "The run is now exploring the site, capturing screenshots, and collecting findings.",
        status: "running",
        pageUrl: page.url(),
        sessionId: sessionDocId,
      })

      screenshotCount += await throwIfStopRequested({
        convex,
        runId,
        bufferedFindings,
        currentStep: "QA run stopped after loading the target page",
        pageCandidates,
        pageUrl: page.url(),
        runIdForFindings: runId,
        savedFindings,
        stepIndex: 0,
        findingSignatures,
      })

      screenshotCount += await runSnapshotStage({
        convex,
        findingSignatures,
        bufferedFindings,
        sessionId: sessionDocId,
        page,
        pageCandidates,
        runId,
        savedFindings,
        stepIndex: 0,
      })

      screenshotCount += await throwIfStopRequested({
        convex,
        runId,
        bufferedFindings,
        sessionId: sessionDocId,
        currentStep: "QA run stopped during exploration",
        pageCandidates,
        pageUrl: page.url(),
        runIdForFindings: runId,
        savedFindings,
        stepIndex: 0,
        findingSignatures,
      })

      screenshotCount += await runAgentLoop({
        convex,
        credentialNamespace,
        findingSignatures,
        bufferedFindings,
        page,
        pageCandidates,
        runId,
        savedFindings,
        sessionId: sessionDocId,
        startUrl: url,
      })

      screenshotCount += await throwIfStopRequested({
        convex,
        runId,
        bufferedFindings,
        sessionId: sessionDocId,
        currentStep: "QA run stopped before Lighthouse",
        pageCandidates,
        pageUrl: page.url(),
        runIdForFindings: runId,
        savedFindings,
        stepIndex: MAX_AGENT_STEPS,
        findingSignatures,
      })

      const auditUrls = selectAuditUrls({
        pageCandidates,
        startUrl: url,
      })

      chrome = await launch({
        chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
      })

      for (const [index, auditUrl] of auditUrls.entries()) {
        failureStage = `Running Lighthouse audit ${index + 1} of ${auditUrls.length}`
        lastKnownUrl = auditUrl
        screenshotCount += await throwIfStopRequested({
          convex,
          runId,
          bufferedFindings,
          sessionId: sessionDocId,
          currentStep: "QA run stopped during Lighthouse",
          pageCandidates,
          pageUrl: auditUrl,
          runIdForFindings: runId,
          savedFindings,
          stepIndex: MAX_AGENT_STEPS + index,
          findingSignatures,
        })

        await convex.mutation(api.runtime.updateRun, {
          runId,
          currentStep: `Running Lighthouse audit ${index + 1} of ${auditUrls.length}`,
          currentUrl: auditUrl,
        })
        await emitRunEvent(convex, {
          runId,
          kind: "audit",
          title: `Running Lighthouse audit ${index + 1} of ${auditUrls.length}`,
          body: auditUrl,
          status: "running",
          pageUrl: auditUrl,
          sessionId: sessionDocId,
        })

        const auditResult = await lighthouse(auditUrl, {
          output: "html",
          onlyCategories: [
            "performance",
            "accessibility",
            "best-practices",
            "seo",
          ],
          port: chrome.port,
        })

        if (!auditResult) {
          continue
        }

        const reportHtml = Array.isArray(auditResult.report)
          ? auditResult.report.join("\n")
          : auditResult.report

        const reportArtifactId = await uploadArtifact({
          body: new TextEncoder().encode(reportHtml),
          contentType: "text/html; charset=utf-8",
          convex,
          pageUrl: auditUrl,
          runId,
          title: `Lighthouse report for ${auditUrl}`,
          type: "html-report",
        })
        performanceAuditCount += 1
        await emitRunEvent(convex, {
          runId,
          kind: "artifact",
          title: "Lighthouse report saved",
          body: `Stored HTML report for ${auditUrl}.`,
          status: "running",
          pageUrl: auditUrl,
          sessionId: sessionDocId,
          artifactId: reportArtifactId,
        })

        const categories = auditResult.lhr.categories

        await convex.mutation(api.runtime.createPerformanceAudit, {
          runId,
          pageUrl: auditUrl,
          performanceScore: categories.performance.score ?? 0,
          accessibilityScore: categories.accessibility.score ?? 0,
          bestPracticesScore: categories["best-practices"].score ?? 0,
          seoScore: categories.seo.score ?? 0,
          reportArtifactId,
        })

        const perfFindings = [
          scoreLighthouseFinding({
            category: "performance",
            isStartPage: auditUrl === url,
            pageUrl: auditUrl,
            score: categories.performance.score ?? 0,
          }),
          scoreLighthouseFinding({
            category: "accessibility",
            isStartPage: auditUrl === url,
            pageUrl: auditUrl,
            score: categories.accessibility.score ?? 0,
          }),
          scoreLighthouseFinding({
            category: "best-practices",
            isStartPage: auditUrl === url,
            pageUrl: auditUrl,
            score: categories["best-practices"].score ?? 0,
          }),
          scoreLighthouseFinding({
            category: "seo",
            isStartPage: auditUrl === url,
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

          await convex.mutation(api.runtime.createFinding, {
            runId,
            source: "perf",
            title: perfFinding.title,
            description: perfFinding.description,
            severity: perfFinding.severity,
            confidence: perfFinding.confidence,
            impact: perfFinding.impact,
            score: perfFinding.score,
            pageOrFlow: auditUrl,
            artifactId: reportArtifactId,
            suggestedFix: perfFinding.suggestedFix,
          })

          savedFindings.push({
            source: "perf",
            score: perfFinding.score,
          })
          await emitRunEvent(convex, {
            runId,
            kind: "finding",
            title: perfFinding.title,
            body: perfFinding.description,
            status: "running",
            pageUrl: auditUrl,
            sessionId: sessionDocId,
            artifactId: reportArtifactId,
          })
        }
      }

      screenshotCount += await throwIfStopRequested({
        convex,
        runId,
        bufferedFindings,
        sessionId: sessionDocId,
        currentStep: "QA run stopped before final scoring",
        pageCandidates,
        pageUrl: page.url(),
        runIdForFindings: runId,
        savedFindings,
        stepIndex: MAX_AGENT_STEPS + auditUrls.length,
        findingSignatures,
      })

      await convex.mutation(api.runtime.updateRun, {
        runId,
        currentStep: "Computing final quality score",
        currentUrl: url,
      })
      failureStage = "Computing final quality score"

      const scoreSummary = buildScoreSummary({
        findings: savedFindings,
        performanceAudits: performanceAuditCount,
        screenshots: screenshotCount,
      })

      await convex.mutation(api.runtime.updateRun, {
        runId,
        status: "completed",
        currentStep: "QA run completed",
        currentUrl: url,
        finalScore: scoreSummary.overall,
        finishedAt: Date.now(),
        errorMessage: null,
      })
      await emitRunEvent(convex, {
        runId,
        kind: "status",
        title: "Run completed",
        body: `Final quality score: ${scoreSummary.overall}/100.`,
        status: "completed",
        pageUrl: url,
        sessionId: sessionDocId,
      })
  } catch (error) {
      if (error instanceof RunCancelledError) {
        finalRunStatus = "cancelled"
        const finalScore = computeRunFinalScore({
          findings: savedFindings,
          performanceAudits: performanceAuditCount,
          screenshots: screenshotCount,
        })

        await convex.mutation(api.runtime.updateRun, {
          runId,
          status: "cancelled",
          currentStep: error.message,
          currentUrl: error.currentUrl ?? url,
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
          pageUrl: error.currentUrl ?? url,
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
      if (browser) {
        await browser.close().catch(() => undefined)
      }

      if (chrome) {
        try {
          await chrome.kill()
        } catch {
          // Ignore Chrome shutdown failures during cleanup.
        }
      }

      if (currentSessionId) {
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
            finishedAt: Date.now(),
          })
          .catch(() => undefined)
      }
  }
}

async function runAgentLoop({
  convex,
  credentialNamespace,
  findingSignatures,
  bufferedFindings,
  page,
  pageCandidates,
  runId,
  savedFindings,
  sessionId,
  startUrl,
}: {
  convex: ReturnType<typeof createConvexServerClient>
  credentialNamespace?: string
  findingSignatures: Set<string>
  bufferedFindings: BufferedFinding[]
  page: Page
  pageCandidates: Map<string, PageCandidate>
  runId: Id<"runs">
  savedFindings: SavedFinding[]
  sessionId: Id<"sessions"> | null
  startUrl: string
}) {
  const visitedPages = new Set<string>([page.url()])
  const actionHistory: string[] = []
  const analyzedSnapshots = new Set<string>()
  let noOpCount = 0
  let screenshotCount = 0

  for (let stepIndex = 1; stepIndex <= MAX_AGENT_STEPS; stepIndex += 1) {
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
      currentStep: `Exploration step ${stepIndex} of ${MAX_AGENT_STEPS}`,
      currentUrl: snapshot.url,
      status: "running",
    })
    await emitRunEvent(convex, {
      runId,
      kind: "agent",
      title: `Exploration step ${stepIndex}`,
      body: `Reviewing ${snapshot.url}.`,
      status: "running",
      pageUrl: snapshot.url,
      sessionId,
      stepIndex,
    })

    const result = await generateText({
      model: google(DEFAULT_MODEL),
      prompt: buildAgentPrompt({
        credentialNamespace,
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
        credentialNamespace,
        convex,
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
      break
    }

    const plannerSummary = result.text.trim()
    const toolResults = result.steps.flatMap((step) => step.toolResults)
    const latestToolResult = [...toolResults]
      .reverse()
      .find((toolResult) => Boolean(toolResult))

    const outcome = latestToolResult && !latestToolResult.dynamic && isToolOutcome(latestToolResult.output)
      ? latestToolResult.output
      : await executePlannerFallback({
          convex,
          page,
          runId,
          sessionId,
          snapshot,
          startUrl,
          stepIndex,
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
      buildActionSignature({
        action: outcome.toolName,
        pageUrl: outcome.currentUrl,
        target: outcome.target,
      }),
    )

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

    if (visitedPages.size > MAX_DISCOVERED_PAGES) {
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
      break
    }
  }

  return screenshotCount
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
  credentialNamespace,
  convex,
  page,
  runId,
  sessionId,
  startUrl,
  visitedPages,
}: {
  bufferedFindings: BufferedFinding[]
  credentialNamespace?: string
  convex: ReturnType<typeof createConvexServerClient>
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
        const snapshot = await inspectCurrentPage(page)
        const target = snapshot.interactives.find((item) => item.id === id)

        if (!target) {
          return {
            toolName: "clickElement",
            changed: false,
            currentUrl: page.url(),
            note: `Element ${id} is no longer available.`,
          } satisfies ToolOutcome
        }

        if (target.href && !isSameHostname(startUrl, new URL(target.href, page.url()).toString())) {
          return {
            toolName: "clickElement",
            changed: false,
            currentUrl: page.url(),
            note: `Blocked external link ${target.href}.`,
            target: target.label,
          } satisfies ToolOutcome
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
              maxPages: MAX_DISCOVERED_PAGES,
            })
          ) {
            return {
              toolName: "clickElement",
              changed: false,
              currentUrl: page.url(),
              note: `Skipped ${target.label} because it would exceed the page limit.`,
              target: target.label,
            } satisfies ToolOutcome
          }

          const locator = page.locator(target.selector).first()
          await locator.scrollIntoViewIfNeeded().catch(() => undefined)
          await locator.click({ timeout: 5_000 })
          await settlePage(page)

          if (!isSameHostname(startUrl, page.url())) {
            await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined)
            await settlePage(page)
            return {
              toolName: "clickElement",
              changed: false,
              currentUrl: page.url(),
              note: "Blocked navigation outside the starting hostname.",
              target: target.label,
            } satisfies ToolOutcome
          }

          if (
            wouldExceedPageLimit({
              visitedPages,
              nextUrl: page.url(),
              maxPages: MAX_DISCOVERED_PAGES,
            })
          ) {
            await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined)
            await settlePage(page)
            return {
              toolName: "clickElement",
              changed: false,
              currentUrl: page.url(),
              note: `Skipped ${target.label} because it would exceed the page limit.`,
              target: target.label,
            } satisfies ToolOutcome
          }

          const after = await inspectCurrentPage(page)

          return {
            toolName: "clickElement",
            changed: after.signature !== before.signature,
            currentUrl: after.url,
            note: `Clicked ${target.label}.`,
            target: target.label,
          } satisfies ToolOutcome
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
            toolName: "clickElement",
            changed: false,
            currentUrl: page.url(),
            note: `Failed to click ${target.label}.`,
            target: target.label,
          } satisfies ToolOutcome
        }
      },
    }),
    fillInput: tool({
      description:
        "Fill a safe text-like input by its current snapshot id. Do not use for auth, passwords, payments, or destructive forms.",
      inputSchema: z.object({
        id: z.number(),
        value: z.string().min(1),
      }),
      execute: async ({ id, value }) => {
        const snapshot = await inspectCurrentPage(page)
        const target = snapshot.interactives.find((item) => item.id === id)

        if (!target) {
          return {
            toolName: "fillInput",
            changed: false,
            currentUrl: page.url(),
            note: `Input ${id} is no longer available.`,
          } satisfies ToolOutcome
        }

        if (!isSafeInput(target)) {
          return {
            toolName: "fillInput",
            changed: false,
            currentUrl: page.url(),
            note: `Skipped unsafe field ${target.label}.`,
            target: target.label,
          } satisfies ToolOutcome
        }

        try {
          const locator = page.locator(target.selector).first()
          await locator.fill(value, { timeout: 5_000 })
          await settlePage(page)

          return {
            toolName: "fillInput",
            changed: true,
            currentUrl: page.url(),
            note: `Filled ${target.label}.`,
            target: target.label,
          } satisfies ToolOutcome
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
            toolName: "fillInput",
            changed: false,
            currentUrl: page.url(),
            note: `Failed to fill ${target.label}.`,
            target: target.label,
          } satisfies ToolOutcome
        }
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

        if (
          wouldExceedPageLimit({
            visitedPages,
            nextUrl: resolvedUrl,
            maxPages: MAX_DISCOVERED_PAGES,
          })
        ) {
          return {
            toolName: "navigateToUrl",
            changed: false,
            currentUrl: page.url(),
            note: `Blocked navigation to ${resolvedUrl} because it would exceed the page limit.`,
            target: resolvedUrl,
          } satisfies ToolOutcome
        }

        try {
          const beforeUrl = page.url()
          await safeGoto(page, resolvedUrl)

          return {
            toolName: "navigateToUrl",
            changed: page.url() !== beforeUrl,
            currentUrl: page.url(),
            note: `Navigated to ${resolvedUrl}.`,
            target: resolvedUrl,
          } satisfies ToolOutcome
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
            toolName: "navigateToUrl",
            changed: false,
            currentUrl: page.url(),
            note: `Failed to navigate to ${resolvedUrl}.`,
            target: resolvedUrl,
          } satisfies ToolOutcome
        }
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
    ...(credentialNamespace
      ? {
          useStoredLogin: tool({
            description:
              "Use the stored login credential for the current website when an auth wall blocks useful exploration.",
            inputSchema: z.object({}),
            execute: async () => {
              const credential = await getDecryptedCredentialForOrigin({
                convex,
                namespace: credentialNamespace,
                pageUrl: page.url(),
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
                const didApply = await applyCredentialToPage(page, credential)
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
  credentialNamespace,
  snapshot,
  stepIndex,
  visitedPages,
  recentActions,
}: {
  credentialNamespace?: string
  snapshot: PageSnapshot
  stepIndex: number
  visitedPages: string[]
  recentActions: string[]
}) {
  return [
    "You are a balanced autonomous QA engineer exploring a public website.",
    "Rules:",
    "- Stay on the starting hostname only.",
    credentialNamespace
      ? "- Do not attempt signup, checkout, payment, account deletion, or destructive submission flows. If login is required, use the stored login tool instead of typing credentials yourself."
      : "- Do not attempt login, signup, checkout, payment, account deletion, or destructive submission flows.",
    "- Prefer high-signal public pages like pricing, product, docs, support, contact, and clear navigation destinations.",
    "- Continue exploring even if the current page looks healthy when there are fresh public paths available.",
    "- Call at most one tool for the next best action. Avoid plain-text answers unless the page is truly exhausted and no fresh public navigation or safe interactions remain.",
    "- You do not need to capture screenshots on every step because the system already captures them after meaningful changes.",
    "- Favor visible navigation and exploratory clicks before giving up on the page.",
    `Step: ${stepIndex}/${MAX_AGENT_STEPS}`,
    `Current URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    `Forms: ${snapshot.formsSummary}`,
    `Visited pages: ${visitedPages.join(", ")}`,
    `Recent actions: ${recentActions.length ? recentActions.join(" | ") : "none"}`,
    `Visible text excerpt: ${snapshot.textExcerpt}`,
    `Current interactives: ${snapshot.interactives.map((item) => `${item.id}. ${item.label} [${item.tagName}${item.type ? `:${item.type}` : ""}]`).join("; ")}`,
    "Use conservative values if you fill a field, such as 'test search', 'Shard QA', or 'qa@example.com'.",
  ].join("\n")
}

async function executePlannerFallback({
  convex,
  page,
  runId,
  sessionId,
  snapshot,
  startUrl,
  stepIndex,
  visitedPages,
}: {
  convex: ReturnType<typeof createConvexServerClient>
  page: Page
  runId: Id<"runs">
  sessionId: Id<"sessions"> | null
  snapshot: PageSnapshot
  startUrl: string
  stepIndex: number
  visitedPages: Set<string>
}): Promise<ToolOutcome> {
  const fallbackAction = pickQaFallbackAction({
    currentUrl: snapshot.url,
    interactives: snapshot.interactives,
    maxPages: MAX_DISCOVERED_PAGES,
    startUrl,
    visitedPages,
  })

  if (fallbackAction.kind === "navigate") {
    try {
      const beforeUrl = page.url()
      await safeGoto(page, fallbackAction.url)

      return {
        toolName: "navigateToUrl",
        changed: page.url() !== beforeUrl,
        currentUrl: page.url(),
        fallback: true,
        note: fallbackAction.reason,
        target: fallbackAction.targetLabel,
      }
    } catch (error) {
      return {
        toolName: "navigateToUrl",
        changed: false,
        currentUrl: page.url(),
        fallback: true,
        note: `${fallbackAction.reason} Navigation failed: ${error instanceof Error ? error.message : "Unknown navigation error"}`,
        target: fallbackAction.targetLabel,
      }
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
  type: "html-report" | "screenshot"
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

async function applyCredentialToPage(
  page: Page,
  credential: {
    origin: string
    password: string
    totpSecret?: string
    username: string
  },
) {
  const usernameField = await findFirstVisibleLocator(page, [
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="email"]',
    'input[name*="email" i]',
    'input[id*="email" i]',
    'input[name*="user" i]',
    'input[id*="user" i]',
    'input[name*="login" i]',
    'input[id*="login" i]',
    'input[type="text"]',
  ])
  const passwordField = await findFirstVisibleLocator(page, [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[name*="password" i]',
    'input[id*="password" i]',
  ])

  if (!usernameField || !passwordField) {
    return false
  }

  await usernameField.fill(credential.username, { timeout: 5_000 })
  await passwordField.fill(credential.password, { timeout: 5_000 })

  if (credential.totpSecret) {
    const totpField = await findFirstVisibleLocator(page, [
      'input[autocomplete="one-time-code"]',
      'input[name*="otp" i]',
      'input[id*="otp" i]',
      'input[name*="totp" i]',
      'input[id*="totp" i]',
      'input[name*="auth" i]',
      'input[id*="auth" i]',
      'input[inputmode="numeric"]',
    ])

    if (totpField) {
      await totpField.fill(generateTotpCode(credential.totpSecret), {
        timeout: 5_000,
      })
    }
  }

  const submitButton = await findFirstVisibleLocator(page, [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Continue")',
    'button:has-text("Verify")',
  ])

  if (submitButton) {
    await submitButton.click({ timeout: 5_000 }).catch(() => undefined)
  }

  await settlePage(page)

  return true
}

async function findFirstVisibleLocator(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    const count = await locator.count()

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index)
      const isVisible = await candidate.isVisible().catch(() => false)

      if (isVisible) {
        return candidate
      }
    }
  }

  return null
}
