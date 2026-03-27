import { mkdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { hostname } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import lighthouse from "lighthouse"
import { launch } from "chrome-launcher"
import { generateObject, generateText, stepCountIs, tool } from "ai"
import { google } from "@ai-sdk/google"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { z } from "zod"
import { scoreLighthouseFinding } from "../src/lib/lighthouse-audits"
import {
  buildActionSignature,
  isSameHostname,
  resolveSameHostUrl,
  shouldStopForNoOps,
  shouldStopForRepeatActions,
  wouldExceedPageLimit,
} from "../src/lib/qa-guards"
import { pickQaFallbackAction } from "../src/lib/qa-fallback"
import {
  buildScoreSummary,
  computeFindingScore,
  impactWeightForSource,
} from "../src/lib/scoring"

const SESSION_TIMEOUT_MS = 10 * 60 * 1000
const AGENT_TIME_BUDGET_MS = 8 * 60 * 1000
const MAX_AGENT_STEPS = 24
const MAX_DISCOVERED_PAGES = 10
const MAX_PAGE_FINDINGS = 2
const POLL_INTERVAL_MS = Number(process.env.LOCAL_HELPER_POLL_INTERVAL_MS ?? 3_000)
const HEARTBEAT_INTERVAL_MS = Number(process.env.LOCAL_HELPER_HEARTBEAT_MS ?? 10_000)
const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash"

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
      await api
        .finalize({
          helperId,
          runId: claim.run._id,
          status: error instanceof RunCancelledError ? "cancelled" : "failed",
          currentStep:
            error instanceof RunCancelledError
              ? error.message
              : "Local Chrome QA run failed",
          currentUrl:
            error instanceof RunCancelledError
              ? error.currentUrl ?? claim.run.url
              : claim.run.url,
          errorMessage: error instanceof RunCancelledError ? undefined : message,
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
  const browser = new LocalChromeMcpBrowser()
  const bufferedFindings: BufferedFinding[] = []
  const pageCandidates = new Map<string, PageCandidate>()
  const findingSignatures = new Set<string>()
  const savedFindings: SavedFinding[] = []
  const externalSessionId = `local:${helperId}:${run._id}`
  let session: SessionRecord | null = null
  let screenshotCount = 0
  let performanceAuditCount = 0
  let finalStatus: "cancelled" | "completed" | "failed" = "completed"
  let lastKnownUrl = run.url

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
      body: `Local helper ${machineLabel} is preparing Chrome DevTools MCP and will drive your Chrome window directly.`,
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
      title: "Awaiting Chrome debugging permission",
      body: "Open Chrome, enable remote debugging in chrome://inspect/#remote-debugging, then allow the incoming debugging connection prompt.",
      pageUrl: run.url,
    })

    await browser.connect()
    await browser.open(run.url)
    await browser.collectRuntimeFindings(run.url, bufferedFindings)

    const openedUrl = await browser.getCurrentUrl()
    lastKnownUrl = openedUrl

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
      body: "Chrome DevTools MCP is connected. Watch your own Chrome window for live interactions while Shard streams steps and findings here.",
      pageUrl: openedUrl,
    })

    screenshotCount += await runSnapshotStage({
      analyzedSnapshots: new Set<string>(),
      api,
      browser,
      bufferedFindings,
      findingSignatures,
      pageCandidates,
      runId: run._id,
      savedFindings,
      sessionId: session.sessionId,
      stepIndex: 0,
    })

    const agentLoopResult = await runAgentLoop({
      api,
      browser,
      bufferedFindings,
      findingSignatures,
      instructions: run.instructions,
      mode: run.mode ?? "explore",
      pageCandidates,
      runId: run._id,
      savedFindings,
      sessionId: session.sessionId,
      startUrl: run.url,
    })
    screenshotCount += agentLoopResult.screenshotCount
    lastKnownUrl = await browser.getCurrentUrl()

    await throwIfStopRequested({
      api,
      currentStep: "Local run stopped before Lighthouse",
      pageUrl: lastKnownUrl,
      runId: run._id,
    })

    const auditUrls = selectAuditUrls({
      pageCandidates,
      startUrl: run.url,
    })

    const chrome = await launch({
      chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
    })

    try {
      for (const [index, auditUrl] of auditUrls.entries()) {
        await throwIfStopRequested({
          api,
          currentStep: "Local run stopped during Lighthouse",
          pageUrl: auditUrl,
          runId: run._id,
        })

        await api.progress({
          runId: run._id,
          currentStep: `Running Lighthouse audit ${index + 1} of ${auditUrls.length}`,
          currentUrl: auditUrl,
          status: "running",
        })
        await api.event({
          runId: run._id,
          kind: "audit",
          status: "running",
          sessionId: session.sessionId,
          title: `Running Lighthouse audit ${index + 1} of ${auditUrls.length}`,
          body: auditUrl,
          pageUrl: auditUrl,
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
        const reportArtifact = await api.artifact({
          runId: run._id,
          type: "html-report",
          contentType: "text/html; charset=utf-8",
          base64: Buffer.from(reportHtml, "utf8").toString("base64"),
          pageUrl: auditUrl,
          title: `Lighthouse report for ${auditUrl}`,
        })

        performanceAuditCount += 1
        await api.event({
          runId: run._id,
          kind: "artifact",
          status: "running",
          sessionId: session.sessionId,
          artifactId: reportArtifact.artifactId,
          title: "Lighthouse report saved",
          body: `Stored HTML report for ${auditUrl}.`,
          pageUrl: auditUrl,
        })

        const categories = auditResult.lhr.categories
        const perfFindings = [
          scoreLighthouseFinding({
            category: "performance",
            isStartPage: auditUrl === run.url,
            pageUrl: auditUrl,
            score: categories.performance.score ?? 0,
          }),
          scoreLighthouseFinding({
            category: "accessibility",
            isStartPage: auditUrl === run.url,
            pageUrl: auditUrl,
            score: categories.accessibility.score ?? 0,
          }),
          scoreLighthouseFinding({
            category: "best-practices",
            isStartPage: auditUrl === run.url,
            pageUrl: auditUrl,
            score: categories["best-practices"].score ?? 0,
          }),
          scoreLighthouseFinding({
            category: "seo",
            isStartPage: auditUrl === run.url,
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
          await api.finding({
            runId: run._id,
            source: "perf",
            title: perfFinding.title,
            description: perfFinding.description,
            severity: perfFinding.severity,
            confidence: perfFinding.confidence,
            impact: perfFinding.impact,
            score: perfFinding.score,
            pageOrFlow: auditUrl,
            artifactId: reportArtifact.artifactId,
            suggestedFix: perfFinding.suggestedFix,
          })
          await api.event({
            runId: run._id,
            kind: "finding",
            status: "running",
            sessionId: session.sessionId,
            artifactId: reportArtifact.artifactId,
            title: perfFinding.title,
            body: perfFinding.description,
            pageUrl: auditUrl,
          })
          savedFindings.push({
            source: "perf",
            score: perfFinding.score,
          })
        }
      }
    } finally {
      try {
        await chrome.kill()
      } catch {
        // Ignore Chrome shutdown failures during cleanup.
      }
    }

    const finalScore = buildScoreSummary({
      findings: savedFindings,
      performanceAudits: performanceAuditCount,
      screenshots: screenshotCount,
    }).overall

    await api.event({
      runId: run._id,
      kind: "status",
      status: "completed",
      sessionId: session.sessionId,
      title: "Run completed",
      body:
        run.mode === "task" && agentLoopResult.goalOutcome
          ? `Final quality score: ${finalScore}/100.\nTask outcome: ${agentLoopResult.goalOutcome.status}.\n${agentLoopResult.goalOutcome.summary}`
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
      goalStatus: agentLoopResult.goalOutcome?.status,
      goalSummary: agentLoopResult.goalOutcome?.summary,
      sessionId: session.sessionId,
      sessionStatus: "closed",
    })
  } catch (error) {
    finalStatus = error instanceof RunCancelledError ? "cancelled" : "failed"
    throw error
  } finally {
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
  browser: LocalChromeMcpBrowser
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
  browser: LocalChromeMcpBrowser
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
  browser: LocalChromeMcpBrowser
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
  browser: LocalChromeMcpBrowser
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
  browser: LocalChromeMcpBrowser
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
  browser: LocalChromeMcpBrowser
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
  browser: LocalChromeMcpBrowser
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
  browser: LocalChromeMcpBrowser
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
    base64: screenshot.toString("base64"),
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
  constructor(
    message: string,
    readonly currentUrl?: string,
  ) {
    super(message)
  }
}

class LocalHelperApi {
  constructor(
    private readonly appBaseUrl: string,
    private readonly helperSecret: string,
  ) {}

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

class LocalChromeMcpBrowser {
  private readonly client = new Client({
    name: "shard-local-helper",
    version: "0.1.0",
  })
  private readonly screenshotDir = join(tmpdir(), `shard-local-helper-${randomUUID()}`)
  private readonly seenConsoleMessages = new Set<number>()
  private readonly seenNetworkRequests = new Set<number>()
  private transport: StdioClientTransport | null = null

  async connect() {
    this.transport = new StdioClientTransport({
      command: resolveChromeDevtoolsCommand(),
      args: ["--autoConnect"],
      cwd: process.cwd(),
      stderr: "pipe",
    })

    await this.client.connect(this.transport)
  }

  async close() {
    await this.client.close().catch(() => undefined)
    await rm(this.screenshotDir, { recursive: true, force: true }).catch(() => undefined)
  }

  async open(url: string) {
    await this.callTool("new_page", {
      url,
      timeout: SESSION_TIMEOUT_MS,
    }).catch(async () => {
      await this.callTool("navigate_page", {
        type: "url",
        url,
        timeout: SESSION_TIMEOUT_MS,
      })
    })
  }

  async getCurrentUrl() {
    const meta = await this.evaluate<{
      url: string
    }>("() => ({ url: location.href })")

    return meta.url
  }

  async inspectCurrentPage(): Promise<PageSnapshot> {
    const [snapshotText, meta] = await Promise.all([
      this.takeSnapshot(),
      this.evaluate<{
        formsSummary: string
        textExcerpt: string
        title: string
        url: string
      }>(`(() => {
        const text = (document.body?.innerText ?? "")
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, 1200)

        return {
          url: location.href,
          title: document.title || "Untitled page",
          textExcerpt: text,
          formsSummary: \`\${document.forms.length} forms, \${document.querySelectorAll("input, textarea, select").length} form fields\`,
        }
      })`),
    ])

    const interactiveCandidates = parseInteractiveSnapshot(snapshotText).slice(0, 25)
    const interactives = (
      await Promise.all(
        interactiveCandidates.map(async (item, index) => {
          const elementMeta = await this.evaluate<{
            href?: string | null
            label?: string | null
            role?: string | null
            tagName?: string | null
            type?: string | null
          }>(
            `(el) => {
              if (!el) {
                return null
              }

              const text = el.innerText || el.textContent || ""
              return {
                tagName: el.tagName?.toLowerCase?.() ?? null,
                type: el.getAttribute?.("type"),
                role: el.getAttribute?.("role"),
                href: el.getAttribute?.("href"),
                label:
                  el.getAttribute?.("aria-label") ||
                  el.getAttribute?.("placeholder") ||
                  el.getAttribute?.("name") ||
                  text,
              }
            }`,
            [item.uid],
          ).catch(() => null)

          if (!elementMeta) {
            return null
          }

          return {
            id: index + 1,
            uid: item.uid,
            label: normalizeLabel(elementMeta.label ?? item.label),
            role: elementMeta.role ?? item.role,
            tagName: elementMeta.tagName ?? mapRoleToTagName(item.role),
            type: elementMeta.type ?? undefined,
            href: elementMeta.href ?? undefined,
          } satisfies InteractiveElement
        }),
      )
    ).filter(Boolean) as InteractiveElement[]

    return {
      ...meta,
      interactives,
      signature: JSON.stringify({
        url: meta.url,
        title: meta.title,
        text: meta.textExcerpt.slice(0, 300),
        interactives: interactives.map((item) => item.label),
      }),
    }
  }

  async click(uid: string) {
    await this.callTool("click", { uid })
  }

  async fill(uid: string, value: string) {
    await this.callTool("fill", { uid, value })
  }

  async pressKey(key: string) {
    await this.callTool("press_key", { key })
  }

  async navigate(url: string) {
    await this.callTool("navigate_page", {
      type: "url",
      url,
      timeout: SESSION_TIMEOUT_MS,
    })
  }

  async goBack() {
    await this.callTool("navigate_page", {
      type: "back",
      timeout: 5_000,
    })
  }

  async takeScreenshot() {
    await mkdir(this.screenshotDir, { recursive: true })
    const filePath = join(this.screenshotDir, `${randomUUID()}.png`)

    await this.callTool("take_screenshot", {
      filePath,
      format: "png",
      fullPage: true,
    })

    return await readFile(filePath)
  }

  async collectRuntimeFindings(startUrl: string, bufferedFindings: BufferedFinding[]) {
    const consoleResult = await this.callTool("list_console_messages", {
      includePreservedMessages: true,
      pageSize: 50,
      types: ["error", "warn"],
    }).catch(() => null)

    const consoleMessages = (consoleResult?.structuredContent?.messages ??
      consoleResult?.messages ??
      []) as Array<{ id: number; level: string; text: string }>

    for (const message of consoleMessages) {
      if (this.seenConsoleMessages.has(message.id)) {
        continue
      }

      this.seenConsoleMessages.add(message.id)
      if (!message.text?.trim()) {
        continue
      }

      bufferedFindings.push({
        source: "browser",
        signature: `console::${message.id}`,
        title: "Console warning or error",
        description: message.text,
        severity: message.level === "error" ? "high" : "medium",
        confidence: 0.92,
        pageOrFlow: await this.getCurrentUrl().catch(() => startUrl),
        suggestedFix: "Inspect the console output and resolve the reported client-side issue.",
      })
    }

    const networkResult = await this.callTool("list_network_requests", {
      includePreservedRequests: true,
      pageSize: 100,
    }).catch(() => null)

    const requests = (networkResult?.structuredContent?.requests ??
      networkResult?.requests ??
      []) as Array<{
      id: number
      method: string
      status?: number
      type?: string
      url: string
    }>

    for (const request of requests) {
      if (this.seenNetworkRequests.has(request.id)) {
        continue
      }

      this.seenNetworkRequests.add(request.id)
      if (!isSameHostname(startUrl, request.url)) {
        continue
      }

      if ((request.status ?? 0) < 400) {
        continue
      }

      bufferedFindings.push({
        source: "browser",
        signature: `network::${request.id}`,
        title: "Same-origin request failed",
        description: `${request.method} ${request.url} returned ${request.status ?? "an unknown"} status during the QA run.`,
        severity: request.type === "Document" ? "high" : "medium",
        confidence: 0.9,
        pageOrFlow: request.url,
        suggestedFix: "Inspect the failing endpoint or frontend request path and confirm the browser can complete the flow successfully.",
      })
    }
  }

  private async takeSnapshot() {
    const result = await this.callTool("take_snapshot", {})
    return (
      result?.structuredContent?.snapshot ??
      extractTextContent(result) ??
      "RootWebArea"
    ) as string
  }

  private async evaluate<T>(fn: string, args?: unknown[]) {
    const result = await this.callTool("evaluate_script", {
      function: fn,
      args,
    })

    return (result?.structuredContent?.result ?? result?.result) as T
  }

  private async callTool(name: string, args: Record<string, unknown>) {
    return await (this.client.callTool({
      name,
      arguments: args,
    }) as Promise<any>)
  }
}

function parseInteractiveSnapshot(snapshot: string) {
  return snapshot
    .split("\n")
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^\[(.+?)\]\s+([a-zA-Z-]+)(?:\s+["'](.+?)["'])?/)
      if (!match) {
        return null
      }

      const [, uid, role, rawLabel] = match
      if (!isInteractiveRole(role)) {
        return null
      }

      return {
        uid,
        role,
        label: normalizeLabel(rawLabel ?? role),
      }
    })
    .filter(Boolean) as Array<{ uid: string; role: string; label: string }>
}

function isInteractiveRole(role: string) {
  return [
    "button",
    "checkbox",
    "combobox",
    "link",
    "menuitem",
    "radio",
    "searchbox",
    "switch",
    "tab",
    "textbox",
  ].includes(role)
}

function mapRoleToTagName(role: string) {
  switch (role) {
    case "textbox":
    case "searchbox":
      return "input"
    case "combobox":
      return "select"
    default:
      return role === "link" ? "a" : "button"
  }
}

function normalizeLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120) || "Unnamed element"
}

function extractTextContent(result: any) {
  const textItem = result?.content?.find((item: any) => item?.type === "text")
  return typeof textItem?.text === "string" ? textItem.text : null
}

function resolveChromeDevtoolsCommand() {
  return process.platform === "win32"
    ? join(process.cwd(), "node_modules", ".bin", "chrome-devtools-mcp.cmd")
    : join(process.cwd(), "node_modules", ".bin", "chrome-devtools-mcp")
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
