import { createFileRoute, Link } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { motion, type Variants } from "motion/react"
import {
  IconBrowser,
  IconClock,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconLoader3,
  IconPlayerPlay,
  IconPlayerStop,
  IconRadar2,
  IconSatellite,
  IconSparkles,
} from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"
import { useEffect, useRef } from "react"
import type { ReactNode } from "react"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button"
import { AgentPlan } from "@/components/ui/agent-plan"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { inspectRunStartup } from "@/lib/inspect-run-startup"
import { requestRunStop } from "@/lib/request-run-stop"
import {
  buildSteelEmbedUrl,
  describeBrowserProvider,
  filterTimelineEventsForQaView,
  isActiveRunStatus,
  sortTimelineEvents,
} from "@/lib/run-report"

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
}

export const Route = createFileRoute("/runs/$runId")({
  component: RunPage,
})

function RunPage() {
  const { runId } = Route.useParams()
  const typedRunId = runId as Id<"runs">
  const { data: report } = useQuery(
    convexQuery(api.runtime.getRunReport, { runId: typedRunId }),
  )
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const stopMutation = useMutation({
    mutationFn: requestRunStop,
  })

  useEffect(() => {
    if (!report || !isActiveRunStatus(report.run.status) || report.run.status !== "queued") {
      return
    }

    void inspectRunStartup({ data: { runId: typedRunId } })

    const intervalId = window.setInterval(() => {
      void inspectRunStartup({ data: { runId: typedRunId } })
    }, 5_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [report, typedRunId])

  useEffect(() => {
    const container = transcriptRef.current

    if (!container || !report || !isActiveRunStatus(report.run.status)) {
      return
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight

    if (distanceFromBottom > 96) {
      return
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    })
  }, [report])

  if (report === null) {
    return (
      <Empty className="min-h-[calc(100svh-12rem)] border border-dashed border-border/70 bg-card/60">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconCircleX />
          </EmptyMedia>
          <EmptyTitle>Run not found.</EmptyTitle>
          <EmptyDescription>
            The requested run id does not exist in Convex yet.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (!report) {
    return <RunPageSkeleton />
  }

  const { artifacts, executionState, run, runEvents, session } = report
  const isActive = isActiveRunStatus(run.status)
  const timeline = sortTimelineEvents(filterTimelineEventsForQaView(runEvents as RunEvent[]))
  const isSteelRun = (run.browserProvider ?? "steel") === "steel"
  const liveEmbedUrl = isSteelRun ? buildSteelEmbedUrl(session?.debugUrl) : null
  const latestScreenshot = (artifacts as RunArtifact[]).find(
    (artifact) => artifact.type === "screenshot",
  )
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
  const runLabel = describeRunLabel(run.status)

  return (
    <motion.div 
      className="flex min-h-[calc(100svh-8.5rem)] flex-col gap-4"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={itemVariants}>
        <Card className="border border-border/70 bg-card/85">
          <CardHeader className="gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="tracking-[0.18em] uppercase">
                    {runLabel}
                  </Badge>
                  <StatusBadge status={run.status} />
                  <QueueBadge queueState={run.queueState} />
                  {run.executionMode === "background" ? (
                    <Badge variant="secondary">Background agent</Badge>
                  ) : null}
                </div>
                <CardTitle className="text-2xl text-balance">
                  {isActive ? "Live autonomous QA session" : "Autonomous QA run timeline"}
                </CardTitle>
                <CardDescription className="break-all text-sm/6 text-pretty">
                  {run.url}
                </CardDescription>
              </div>

              <div className="flex flex-col items-end gap-3 mt-1 sm:mt-0 relative z-10 shrink-0">
                {isActive && (
                  <Button
                    variant="destructive"
                    className="rounded-[0.85rem] h-9 px-4 text-xs tracking-wide uppercase font-semibold border-0 shadow-sm"
                    disabled={stopMutation.isPending || Boolean(run.stopRequestedAt)}
                    onClick={() => {
                      void stopMutation.mutateAsync({ data: { runId: typedRunId } })
                    }}
                  >
                    {stopMutation.isPending || run.stopRequestedAt ? "Stopping..." : "Stop run"}
                    <IconPlayerStop className="size-3.5 ml-1.5" />
                  </Button>
                )}
                
                <div className="flex h-9 items-center rounded-lg bg-background border border-border/70 p-[3px] text-muted-foreground shadow-sm w-fit mt-auto">
                  <Link
                    to="/history/$runId"
                    params={{ runId: typedRunId }}
                    className="inline-flex h-full items-center justify-center whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wider ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-muted/80 data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                    activeProps={{ "data-state": "active" }}
                    inactiveProps={{ "data-state": "inactive" }}
                  >
                    QA Report
                  </Link>
                  <Link
                    to="/runs/$runId"
                    params={{ runId: typedRunId }}
                    className="inline-flex h-full items-center justify-center whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wider ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-muted/80 data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                    activeProps={{ "data-state": "active" }}
                    inactiveProps={{ "data-state": "inactive" }}
                  >
                    Timeline
                  </Link>
                </div>
              </div>
            </div>

          <div className="grid gap-3 rounded-[1.5rem] border border-border/70 bg-background/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] md:grid-cols-2 xl:grid-cols-5">
            <RunMetaRow label="Step" value={run.currentStep ?? "Queued for scan"} />
            <RunMetaRow label="URL" value={run.currentUrl ?? run.url} />
            <RunMetaRow
              label="Browser"
              value={describeBrowserProvider(run.browserProvider)}
            />
            <RunMetaRow label="Session" value={session?.status ?? "Not created yet"} />
            <RunMetaRow label="Status" value={run.status} />
            <RunMetaRow
              label="Updated"
              value={formatDistanceToNow(run.updatedAt, { addSuffix: true })}
            />
          </div>
          </CardHeader>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="grid min-h-[32rem] flex-1 gap-4 xl:grid-cols-[minmax(18rem,0.34fr)_minmax(0,0.66fr)]">
        <Card className="flex flex-col border border-border/70 bg-card/85">
          <CardHeader className="shrink-0 gap-2 border-b border-border/70 bg-card/95">
            <CardTitle className="text-base">Agent output</CardTitle>
            <CardDescription className="text-pretty">
              Playwright actions, QA decisions, findings, and citations from the live runner session.
            </CardDescription>
          </CardHeader>
          <CardContent
            ref={transcriptRef}
            className="flex-1 overflow-y-auto p-4 max-h-[48rem] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {timeline.length ? (
              <AgentPlan events={timeline} />
            ) : (
              <PanelState
                icon={<IconRadar2 className="size-4" />}
                title="Waiting for transcript"
                body="The run has not emitted any runtime events yet."
              />
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col border border-border/70 bg-card/85">
          <CardHeader className="shrink-0 gap-3 border-b border-border/70 bg-card/95">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPlayerPlay className="size-4" />
              {snapshotTitle}
            </CardTitle>
            <CardDescription className="text-pretty">
              {snapshotDescription}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 p-4">
            {isActive && executionState === "preview_active" && liveEmbedUrl ? (
              <iframe
                title="Steel live session"
                src={liveEmbedUrl}
                allow="clipboard-read; clipboard-write"
                sandbox="allow-downloads allow-forms allow-popups allow-same-origin allow-scripts"
                className="h-full min-h-[26rem] w-full rounded-[1.6rem] border border-border/70 bg-background shadow-[0_24px_60px_-40px_rgba(0,0,0,0.7)]"
              />
            ) : !isActive ? (
              <SnapshotState
                runId={typedRunId}
                browserProvider={run.browserProvider ?? "steel"}
                screenshot={latestScreenshot}
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
    </motion.div>
  )
}

function RunPageSkeleton() {
  return (
    <div className="flex min-h-[calc(100svh-8.5rem)] flex-col gap-4 animate-pulse">
      <Card className="border border-border/70 bg-card/40">
        <CardHeader className="gap-4">
           <div className="flex flex-wrap items-start justify-between gap-4">
             <div className="space-y-3 w-full max-w-lg">
               <div className="flex gap-2">
                 <Skeleton className="h-6 w-24 rounded-md bg-border/40" />
                 <Skeleton className="h-6 w-20 rounded-md bg-border/40" />
               </div>
               <Skeleton className="h-8 w-64 bg-border/40 mt-2" />
               <Skeleton className="h-5 w-3/4 bg-border/40" />
             </div>
             <Skeleton className="h-9 w-40 rounded-lg bg-border/30 mt-1 sm:mt-0" />
           </div>
           <div className="grid gap-3 rounded-[1.5rem] border border-border/70 bg-background/30 p-4 md:grid-cols-2 xl:grid-cols-5 mt-2">
             {Array.from({length: 5}).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-[1.2rem] bg-border/30" />
             ))}
           </div>
        </CardHeader>
      </Card>
      <div className="grid min-h-[32rem] flex-1 gap-4 xl:grid-cols-[minmax(18rem,0.34fr)_minmax(0,0.66fr)]">
        <Card className="flex flex-col border border-border/70 bg-card/40 min-h-[32rem]">
           <CardHeader className="border-b border-border/70">
             <Skeleton className="h-6 w-32 bg-border/40" />
             <Skeleton className="h-4 w-64 bg-border/30 mt-2" />
           </CardHeader>
           <CardContent className="p-4 space-y-4">
             {Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl bg-border/30" /> )}
           </CardContent>
        </Card>
        <Card className="flex flex-col border border-border/70 bg-card/40 min-h-[32rem]">
           <CardHeader className="border-b border-border/70">
             <Skeleton className="h-6 w-40 bg-border/40" />
             <Skeleton className="h-4 w-64 bg-border/30 mt-2" />
           </CardHeader>
           <CardContent className="p-4">
             <Skeleton className="h-full min-h-[26rem] w-full rounded-[1.6rem] bg-border/30" />
           </CardContent>
        </Card>
      </div>
    </div>
  )
}

function PreviewState({
  browserProvider,
  executionState,
  replayUrl,
}: {
  browserProvider: "local_chrome" | "playwright" | "steel"
  executionState:
    | "preview_active"
    | "queued"
    | "session_active"
    | "session_creating"
    | "terminal"
    | "waiting_for_worker"
    | "worker_picked_up"
    | "worker_unreachable"
  replayUrl?: string
}) {
  if (executionState === "session_creating") {
    return (
      <PanelState
        icon={<IconLoader3 className="size-5 animate-spin" />}
        title={
          browserProvider === "local_chrome"
            ? "Attaching local Chrome session"
            : browserProvider === "playwright"
              ? "Launching background Playwright session"
            : "Creating cloud browser session"
        }
        body={
          browserProvider === "local_chrome"
            ? "The local helper is connecting through Chrome DevTools MCP. Chrome may ask you to approve the debugging session."
            : browserProvider === "playwright"
              ? "The background worker is launching an isolated Playwright browser and preparing trace capture."
            : "The runner is setting up the remote browser. The preview will appear as soon as the session is ready."
        }
      />
    )
  }

  if (executionState === "worker_picked_up") {
    return (
      <PanelState
        icon={<IconSatellite className="size-5" />}
        title={
          browserProvider === "local_chrome"
            ? "Local helper picked up the run"
            : browserProvider === "playwright"
              ? "Background worker picked up the run"
            : "Runner picked up the run"
        }
        body={
          browserProvider === "local_chrome"
            ? "The local helper is preparing Chrome DevTools MCP and will begin driving your browser shortly."
            : browserProvider === "playwright"
              ? "The Playwright worker is running the QA job and will keep saving artifacts while it explores."
            : "The job is executing, but live session metadata has not been published yet."
        }
      />
    )
  }

  if (executionState === "waiting_for_worker") {
    return (
      <PanelState
        icon={<IconClock className="size-5" />}
        title={
          browserProvider === "local_chrome"
            ? "Queued and waiting for local helper"
            : browserProvider === "playwright"
              ? "Queued and waiting for background worker"
            : "Queued and waiting for runner"
        }
        body={
          browserProvider === "local_chrome"
            ? "The run is ready, but no healthy local helper has claimed it yet."
            : browserProvider === "playwright"
              ? "The batch is queued and waiting for an available Playwright worker slot."
            : "The queue is reachable, but no background runner has started this job yet."
        }
      />
    )
  }

  if (executionState === "worker_unreachable") {
    return (
      <PanelState
        icon={<IconCircleX className="size-5" />}
        title={
          browserProvider === "local_chrome"
            ? "Local helper unavailable"
            : browserProvider === "playwright"
              ? "Background runner unreachable"
            : "Background runner unreachable"
        }
        body={
          browserProvider === "local_chrome"
            ? "The run is still queued and no local helper heartbeat is available. Run `pnpm run local-helper` and keep Chrome open."
            : browserProvider === "playwright"
              ? "The run is still queued and the background worker process is not currently responding."
            : "The run is still queued and the local Inngest dev server is not responding. Start the runner to continue this run."
        }
      />
    )
  }

  if (executionState === "terminal" && replayUrl) {
    return (
      <PanelState
        icon={<IconCircleCheck className="size-5" />}
        title="Run completed"
        body="The live session has ended. Open the replay from the archived report."
      />
    )
  }

  return (
    <PanelState
      icon={<IconSparkles className="size-5" />}
      title="Queued for scan"
      body="The run has been created and is waiting for the background workflow to start."
    />
  )
}

function SnapshotState({
  browserProvider,
  runId,
  screenshot,
}: {
  browserProvider: "local_chrome" | "playwright" | "steel"
  runId: Id<"runs">
  screenshot?: RunArtifact
}) {
  if (screenshot?.url) {
    return (
      <div className="flex flex-col gap-4">
        <img
          alt={screenshot.title ?? "Latest run screenshot"}
          src={screenshot.url}
          className="w-full rounded-none border border-border/70 bg-background shadow-[0_24px_60px_-40px_rgba(0,0,0,0.7)]"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.4rem] border border-border/70 bg-background/70 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {screenshot.title ?? "Latest screenshot"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {screenshot.pageUrl ?? "No page URL recorded"}
            </p>
          </div>
          <Link
            to="/history/$runId"
            params={{ runId }}
            className={buttonVariants({
              variant: "outline",
              className: "rounded-2xl",
            })}
          >
            Open archived report
            <IconExternalLink className="size-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
      <PanelState
        icon={<IconCircleCheck className="size-5" />}
        title="Run finished"
        body={
          browserProvider === "local_chrome"
            ? "The session has ended and no screenshot was stored for the final state. Open the archived report for captured artifacts and findings."
            : browserProvider === "playwright"
              ? "The background session has ended and no screenshot was stored for the final state. Open the archived report for findings, artifacts, and the Playwright trace."
            : "The session has ended and no screenshot was stored for the final state. Open the archived report for the replay and captured artifacts."
        }
        action={
          <Link
          to="/history/$runId"
          params={{ runId }}
          className={buttonVariants({
            variant: "outline",
            className: "mt-4 rounded-2xl",
          })}
        >
          Open archived report
          <IconExternalLink className="size-4" />
        </Link>
      }
    />
  )
}

function LocalSessionState({
  browserProvider,
  currentUrl,
  screenshot,
}: {
  browserProvider: "local_chrome" | "playwright" | "steel"
  currentUrl: string
  screenshot?: RunArtifact
}) {
  if (screenshot?.url) {
    return (
      <div className="flex flex-col gap-4">
        <img
          alt={screenshot.title ?? "Latest local session screenshot"}
          src={screenshot.url}
          className="w-full rounded-none border border-border/70 bg-background shadow-[0_24px_60px_-40px_rgba(0,0,0,0.7)]"
        />
        <div className="rounded-[1.4rem] border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
          {browserProvider === "playwright"
            ? (
              <>
                Watching the latest background Playwright snapshot. Shard is currently focused on{" "}
                <span className="break-all text-foreground">{currentUrl}</span>.
              </>
            )
            : (
              <>
                Watching your own Chrome window live. Shard keeps the latest captured screenshot here and is currently focused on{" "}
                <span className="break-all text-foreground">{currentUrl}</span>.
              </>
            )}
        </div>
      </div>
    )
  }

  return (
    <PanelState
      icon={<IconBrowser className="size-5" />}
      title={browserProvider === "playwright" ? "Background browser is live" : "Local Chrome is live"}
      body={
        browserProvider === "playwright"
          ? `The background agent is driving an isolated Playwright browser. Shard will keep saving screenshots and artifacts while the run continues.\n\nCurrent URL: ${currentUrl}`
          : `The agent is driving your browser directly. Watch Chrome for live actions while Shard continues streaming progress here.\n\nCurrent URL: ${currentUrl}`
      }
    />
  )
}

function RunMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] border border-border/70 bg-background/70 p-4 shadow-[0_16px_40px_-36px_rgba(0,0,0,0.7)]">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 break-all text-sm text-foreground [font-variant-numeric:tabular-nums]">
        {value}
      </p>
    </div>
  )
}

function PanelState({
  body,
  icon,
  title,
  action,
}: {
  body: string
  icon: ReactNode
  title: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-[calc(100svh-20rem)] flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-background/70 p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-card text-foreground shadow-[0_20px_40px_-28px_rgba(0,0,0,0.75)]">
        {icon}
      </div>
      <p className="mt-5 text-base font-medium text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground text-pretty">
        {body}
      </p>
      {action}
    </div>
  )
}

function StatusBadge({
  status,
}: {
  status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
}) {
  if (status === "failed") {
    return <Badge variant="destructive">failed</Badge>
  }

  if (status === "completed") {
    return <Badge variant="default">completed</Badge>
  }

  return <Badge variant="secondary">{status}</Badge>
}

function QueueBadge({
  queueState,
}: {
  queueState: "pending" | "picked_up" | "waiting_for_worker" | "worker_unreachable"
}) {
  const label =
    queueState === "pending"
      ? "pending"
      : queueState === "picked_up"
        ? "picked up"
        : queueState === "waiting_for_worker"
          ? "waiting"
          : "worker unreachable"

  return <Badge variant="outline">{label}</Badge>
}



function describeRunLabel(status: RunEvent["status"]) {
  if (status === "completed") {
    return "Completed run"
  }

  if (status === "failed") {
    return "Failed run"
  }

  if (status === "cancelled") {
    return "Cancelled run"
  }

  return "Live run"
}

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

type RunArtifact = {
  _id: string
  pageUrl?: string
  title?: string
  type: string
  url?: string
}
