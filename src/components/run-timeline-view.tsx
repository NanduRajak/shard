import { useRef, useEffect, type ReactNode } from "react"
import { motion, type Variants } from "motion/react"
import { Link } from "@tanstack/react-router"
import {
  IconBrowser,
  IconClock,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconLoader3,
  IconPlayerPlay,
  IconRadar2,
  IconSatellite,
  IconSparkles,
} from "@tabler/icons-react"
import { buttonVariants } from "@/components/ui/button"
import { AgentPlan } from "@/components/ui/agent-plan"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  buildSteelEmbedUrl,
  filterTimelineEventsForQaView,
  isActiveRunStatus,
  sortTimelineEvents,
} from "@/lib/run-report"
import type { Id } from "../../convex/_generated/dataModel"

type RunEvent = {
  _id: string
  artifactUrl?: string
  body?: string
  createdAt: number
  kind: string
  pageUrl?: string
  status?: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
  stepIndex?: number
  title: string
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
}

export function RunTimelineView({ report }: { report: any }) {
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  
  const { artifacts, executionState, performanceAudits, run, runEvents, session } = report
  const isActive = isActiveRunStatus(run.status)
  const timeline = sortTimelineEvents(filterTimelineEventsForQaView(runEvents as RunEvent[]))
  const isSteelRun = (run.browserProvider ?? "steel") === "steel"
  const liveEmbedUrl = isSteelRun ? buildSteelEmbedUrl(session?.debugUrl) : null
  const latestScreenshot = (artifacts || []).find(
    (artifact: any) => artifact.type === "screenshot",
  )
  const typedRunId = run._id as Id<"runs">

  const snapshotTitle = !isActive
    ? "Final page snapshot"
    : isSteelRun
      ? "Live cloud session"
      : run.browserProvider === "playwright"
        ? "Background browser status"
        : "Local browser status"
  const snapshotDescription = !isActive
    ? "The browser session has ended. This snapshot shows the latest page screenshot captured during the run."
    : isSteelRun
      ? "Steel mirrors the exact browser session the autonomous QA runner is controlling in real time."
      : run.browserProvider === "playwright"
        ? "The background agent is driving an isolated headless Playwright browser. Follow progress here while artifacts and screenshots stream in."
        : "The agent is driving your own Chrome window. Watch your browser directly while Shard streams steps and captures screenshots here."

  useEffect(() => {
    const container = transcriptRef.current
    if (!container || !isActive) return

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceFromBottom > 96) return

    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
  }, [report, isActive])

  return (
    <motion.div variants={itemVariants} className="xl:col-span-2 grid min-h-[32rem] gap-4 xl:h-[48rem] xl:grid-cols-[minmax(20rem,0.3fr)_minmax(0,0.7fr)]">
      <Card className="flex min-h-0 flex-col overflow-hidden border border-border/70 bg-card/85 xl:h-full">
        <CardHeader className="shrink-0 gap-2 border-b border-border/70 bg-card/95">
          <CardTitle className="text-base">Agent output</CardTitle>
          <CardDescription className="text-pretty">
            Playwright actions, QA decisions, findings, and citations from the live runner session.
          </CardDescription>
        </CardHeader>
        <CardContent
          ref={transcriptRef}
          className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {timeline.length ? (
            <AgentPlan
              events={timeline}
              finalScore={run.finalScore}
              performanceAudits={performanceAudits ?? []}
            />
          ) : (
            <PanelState
              icon={<IconRadar2 className="size-4" />}
              title="Waiting for transcript"
              body="The run has not emitted any runtime events yet."
            />
          )}
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden border border-border/70 bg-card/85 xl:h-full">
        <CardHeader className="shrink-0 gap-3 border-b border-border/70 bg-card/95">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconPlayerPlay className="size-4" />
            {snapshotTitle}
          </CardTitle>
          <CardDescription className="text-pretty">
            {snapshotDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 p-4">
          {isActive && executionState === "preview_active" && liveEmbedUrl ? (
            <iframe
              title="Steel live session"
              src={liveEmbedUrl}
              allow="clipboard-read; clipboard-write"
              sandbox="allow-downloads allow-forms allow-popups allow-scripts"
              className="h-full min-h-[26rem] w-full rounded-[1.6rem] border border-border/70 bg-background shadow-[0_24px_60px_-40px_rgba(0,0,0,0.7)] xl:min-h-0"
            />
          ) : !isActive ? (
            <SnapshotState
              runId={typedRunId}
              browserProvider={run.browserProvider ?? "steel"}
              screenshot={latestScreenshot}
              hideLinks
            />
          ) : executionState === "session_active" ? (
            <LocalSessionState
              browserProvider={run.browserProvider ?? "steel"}
              currentUrl={run.currentUrl ?? run.url}
              screenshot={latestScreenshot}
            />
          ) : (
            <PreviewState
              browserProvider={run.browserProvider ?? "steel"}
              executionState={executionState}
              replayUrl={session?.replayUrl}
            />
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}

function PreviewState({ browserProvider, executionState, replayUrl }: any) {
  if (executionState === "session_creating") {
    return (
      <PanelState
        icon={<IconLoader3 className="size-5 animate-spin" />}
        title={browserProvider === "local_chrome" ? "Attaching local Chrome session" : browserProvider === "playwright" ? "Launching background Playwright session" : "Creating cloud browser session"}
        body={browserProvider === "local_chrome" ? "The local helper is launching or attaching to a visible Chrome window and preparing live automation." : browserProvider === "playwright" ? "The background worker is launching an isolated Playwright browser and preparing trace capture." : "The runner is setting up the remote browser. The preview will appear as soon as the session is ready."}
      />
    )
  }
  if (executionState === "worker_picked_up") {
    return (
      <PanelState
        icon={<IconSatellite className="size-5" />}
        title={browserProvider === "local_chrome" ? "Local helper picked up the run" : browserProvider === "playwright" ? "Background worker picked up the run" : "Runner picked up the run"}
        body={browserProvider === "local_chrome" ? "The local helper is preparing the local Chrome session and will begin driving it shortly." : browserProvider === "playwright" ? "The Playwright worker is running the QA job and will keep saving artifacts while it explores." : "The job is executing, but live session metadata has not been published yet."}
      />
    )
  }
  if (executionState === "waiting_for_worker") {
    return (
      <PanelState
        icon={<IconClock className="size-5" />}
        title={browserProvider === "local_chrome" ? "Queued and waiting for local helper" : browserProvider === "playwright" ? "Queued and waiting for background worker" : "Queued and waiting for runner"}
        body={browserProvider === "local_chrome" ? "The run is ready, but no healthy local helper has claimed it yet." : browserProvider === "playwright" ? "The batch is queued and waiting for an available Playwright worker slot." : "The queue is reachable, but no background runner has started this job yet."}
      />
    )
  }
  if (executionState === "worker_unreachable") {
    return (
      <PanelState
        icon={<IconCircleX className="size-5" />}
        title={browserProvider === "local_chrome" ? "Local helper unavailable" : "Background runner unreachable"}
        body={browserProvider === "local_chrome" ? "The run is still queued and no local helper heartbeat is available. Run `pnpm run local-helper` and the helper will launch Chrome when the run starts." : browserProvider === "playwright" ? "The run is still queued and the background worker process is not currently responding." : "The run is still queued and the local Inngest dev server is not responding. Start the runner to continue this run."}
      />
    )
  }
  if (executionState === "terminal" && replayUrl) {
    return (
      <PanelState icon={<IconCircleCheck className="size-5" />} title="Run completed" body="The live session has ended. Open the replay from the archived report." />
    )
  }
  return <PanelState icon={<IconSparkles className="size-5" />} title="Queued for scan" body="The run has been created and is waiting for the background workflow to start." />
}

function SnapshotState({ browserProvider, runId, screenshot, hideLinks }: any) {
  if (screenshot?.url) {
    return (
      <div className="flex flex-col gap-4">
        <img alt={screenshot.title ?? "Latest run screenshot"} src={screenshot.url} className="w-full rounded-[1.4rem] border border-border/70 bg-background shadow-[0_24px_60px_-40px_rgba(0,0,0,0.7)]" />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border border-border/70 bg-background/70 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{screenshot.title ?? "Latest screenshot"}</p>
            <p className="truncate text-xs text-muted-foreground">{screenshot.pageUrl ?? "No page URL recorded"}</p>
          </div>
          {!hideLinks && (
            <Link to="/report/$runId" params={{ runId }} className={buttonVariants({ variant: "outline", className: "rounded-2xl" })}>
              Open archived report <IconExternalLink className="size-4" />
            </Link>
          )}
        </div>
      </div>
    )
  }
  return (
    <PanelState
      icon={<IconCircleCheck className="size-5" />}
      title="Run finished"
      body={browserProvider === "local_chrome" ? "The session has ended and no screenshot was stored for the final state." : browserProvider === "playwright" ? "The background session has ended and no screenshot was stored for the final state." : "The session has ended and no screenshot was stored for the final state."}
      action={!hideLinks && (
        <Link to="/report/$runId" params={{ runId }} className={buttonVariants({ variant: "outline", className: "mt-4 rounded-2xl" })}>
          Open archived report <IconExternalLink className="size-4" />
        </Link>
      )}
    />
  )
}

function LocalSessionState({ browserProvider, currentUrl, screenshot }: any) {
  if (screenshot?.url) {
    return (
      <div className="flex flex-col gap-4">
        <img alt={screenshot.title ?? "Latest local session screenshot"} src={screenshot.url} className="w-full rounded-[1.4rem] border border-border/70 bg-background shadow-[0_24px_60px_-40px_rgba(0,0,0,0.7)]" />
        <div className="rounded-[1.4rem] border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
          {browserProvider === "playwright" ? <>Watching the latest background Playwright snapshot. Shard is currently focused on <span className="break-all text-foreground">{currentUrl}</span>.</> : <>Watching your own Chrome window live. Shard keeps the latest captured screenshot here and is currently focused on <span className="break-all text-foreground">{currentUrl}</span>.</>}
        </div>
      </div>
    )
  }
  return (
    <PanelState
      icon={<IconBrowser className="size-5" />}
      title={browserProvider === "playwright" ? "Background browser is live" : "Local Chrome is live"}
      body={browserProvider === "playwright" ? `The background agent is driving an isolated Playwright browser. Shard will keep saving screenshots and artifacts while the run continues.\n\nCurrent URL: ${currentUrl}` : `The agent is driving your browser directly. Watch Chrome for live actions while Shard continues streaming progress here.\n\nCurrent URL: ${currentUrl}`}
    />
  )
}

function PanelState({ body, icon, title, action }: { body: string; icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[26rem] flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-background/70 p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] xl:min-h-0">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-card text-foreground shadow-[0_20px_40px_-28px_rgba(0,0,0,0.75)]">
        {icon}
      </div>
      <p className="mt-5 text-base font-medium text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground text-pretty">{body}</p>
      {action}
    </div>
  )
}
