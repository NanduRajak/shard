import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
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
  IconWorld,
} from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"
import { useEffect, useRef } from "react"
import type { ReactNode } from "react"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
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
import { buildSteelEmbedUrl, isActiveRunStatus, sortTimelineEvents } from "@/lib/run-report"

export const Route = createFileRoute("/runs/$runId")({
  component: RunPage,
})

function RunPage() {
  const { runId } = Route.useParams()
  const navigate = Route.useNavigate()
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
    if (!report || isActiveRunStatus(report.run.status)) {
      return
    }

    void navigate({
      to: "/history/$runId",
      params: { runId: typedRunId },
      replace: true,
    })
  }, [navigate, report, typedRunId])

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
    return (
      <div className="grid gap-4 xl:grid-cols-[0.34fr_0.66fr]">
        <Card className="min-h-72 border border-border/70 bg-card/70" />
        <Card className="min-h-72 border border-border/70 bg-card/70" />
      </div>
    )
  }

  if (!isActiveRunStatus(report.run.status)) {
    return (
      <PanelState
        icon={<IconLoader3 className="size-5 animate-spin" />}
        title="Opening archived report"
        body="This run has ended. Redirecting to the history report."
      />
    )
  }

  const { executionState, run, runEvents, session } = report
  const timeline = sortTimelineEvents(runEvents as RunEvent[])
  const liveEmbedUrl = buildSteelEmbedUrl(session?.debugUrl)

  return (
    <div className="flex h-[calc(100svh-8.5rem)] min-h-[calc(100svh-8.5rem)] flex-col gap-4 overflow-hidden">
      <Card className="border border-border/70 bg-card/85">
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="tracking-[0.18em] uppercase">
                  Active run
                </Badge>
                <StatusBadge status={run.status} />
                <QueueBadge queueState={run.queueState} />
              </div>
              <CardTitle className="text-2xl text-balance">
                Live autonomous QA session
              </CardTitle>
              <CardDescription className="break-all text-sm/6 text-pretty">
                {run.url}
              </CardDescription>
            </div>
            <Button
              variant="destructive"
              className="rounded-2xl"
              disabled={stopMutation.isPending || Boolean(run.stopRequestedAt)}
              onClick={() => {
                void stopMutation.mutateAsync({ data: { runId: typedRunId } })
              }}
            >
              {stopMutation.isPending || run.stopRequestedAt ? "Stopping..." : "Stop run"}
              <IconPlayerStop className="size-4" />
            </Button>
          </div>

          <div className="grid gap-3 rounded-[1.5rem] border border-border/70 bg-background/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] md:grid-cols-2 xl:grid-cols-5">
            <RunMetaRow label="Step" value={run.currentStep ?? "Queued for scan"} />
            <RunMetaRow label="URL" value={run.currentUrl ?? run.url} />
            <RunMetaRow label="Session" value={session?.status ?? "Not created yet"} />
            <RunMetaRow label="Status" value={run.status} />
            <RunMetaRow
              label="Updated"
              value={formatDistanceToNow(run.updatedAt, { addSuffix: true })}
            />
          </div>
        </CardHeader>
      </Card>

      <div className="grid h-0 min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(18rem,0.34fr)_minmax(0,0.66fr)]">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden border border-border/70 bg-card/85">
          <CardHeader className="shrink-0 gap-2 border-b border-border/70 bg-card/95">
            <CardTitle className="text-base">Agent output</CardTitle>
            <CardDescription className="text-pretty">
              Playwright actions, QA decisions, findings, and citations from the live worker session.
            </CardDescription>
          </CardHeader>
          <CardContent ref={transcriptRef} className="h-0 min-h-0 flex-1 overflow-y-auto p-4">
            {timeline.length ? (
              <Accordion
                defaultValue={timeline[timeline.length - 1]?._id ? [timeline[timeline.length - 1]._id] : []}
                multiple
                className="space-y-4"
              >
                {timeline.map((event, index) => (
                  <article key={event._id} className="group relative pl-11">
                    {index < timeline.length - 1 ? (
                      <div className="absolute top-11 left-[1.1rem] bottom-[-1rem] w-px bg-linear-to-b from-border via-border/70 to-transparent" />
                    ) : null}
                    <div className="absolute top-1 left-0 flex size-9 items-center justify-center rounded-2xl border border-border/70 bg-background shadow-[0_10px_30px_-18px_rgba(0,0,0,0.6)] transition-transform duration-200 group-hover:scale-[1.02]">
                      {eventIcon(event.kind)}
                    </div>
                    <AccordionItem
                      value={event._id}
                      className="rounded-[1.4rem] border border-border/70 bg-background/70 px-4 shadow-[0_16px_40px_-34px_rgba(0,0,0,0.65)]"
                    >
                      <AccordionTrigger className="py-4 hover:no-underline">
                        <div className="pr-4 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{event.title}</p>
                            {event.status ? <StatusBadge status={event.status} /> : null}
                            {event.stepIndex !== undefined ? (
                              <Badge variant="outline">Step {event.stepIndex}</Badge>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                            <span>{formatDistanceToNow(event.createdAt, { addSuffix: true })}</span>
                            {event.pageUrl ? (
                              <span className="max-w-[14rem] truncate">{event.pageUrl}</span>
                            ) : null}
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pb-4">
                        {event.body ? (
                          <p className="text-sm leading-6 text-muted-foreground whitespace-pre-wrap text-pretty">
                            {event.body}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No additional details were recorded for this event.
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                          {event.pageUrl ? <span className="break-all">{event.pageUrl}</span> : null}
                          {event.artifactUrl ? (
                            <a
                              href={event.artifactUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-foreground"
                            >
                              Open artifact
                              <IconExternalLink className="size-3" />
                            </a>
                          ) : null}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </article>
                ))}
              </Accordion>
            ) : (
              <PanelState
                icon={<IconRadar2 className="size-4" />}
                title="Waiting for transcript"
                body="The worker has not emitted any runtime events yet."
              />
            )}
          </CardContent>
        </Card>

        <Card className="flex h-full min-h-0 flex-col overflow-hidden border border-border/70 bg-card/85">
          <CardHeader className="shrink-0 gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPlayerPlay className="size-4" />
              Live session
            </CardTitle>
            <CardDescription className="text-pretty">
              Steel mirrors the exact browser session the Playwright QA worker is controlling in real time.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-4">
            {executionState === "preview_active" && liveEmbedUrl ? (
              <iframe
                title="Steel live session"
                src={liveEmbedUrl}
                allow="clipboard-read; clipboard-write"
                className="h-full min-h-[26rem] w-full rounded-[1.6rem] border border-border/70 bg-background shadow-[0_24px_60px_-40px_rgba(0,0,0,0.7)]"
              />
            ) : (
              <PreviewState
                executionState={executionState}
                replayUrl={session?.replayUrl}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function PreviewState({
  executionState,
  replayUrl,
}: {
  executionState:
    | "preview_active"
    | "queued"
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
        title="Creating Steel session"
        body="The worker is running and setting up the remote browser. The preview will appear as soon as Steel finishes provisioning."
      />
    )
  }

  if (executionState === "worker_picked_up") {
    return (
      <PanelState
        icon={<IconSatellite className="size-5" />}
        title="Worker picked up the run"
        body="The job is executing, but Steel session metadata has not been published yet."
      />
    )
  }

  if (executionState === "waiting_for_worker") {
    return (
      <PanelState
        icon={<IconClock className="size-5" />}
        title="Queued and waiting for worker"
        body="The queue is reachable, but no background worker has started this job yet."
      />
    )
  }

  if (executionState === "worker_unreachable") {
    return (
      <PanelState
        icon={<IconCircleX className="size-5" />}
        title="Background worker unreachable"
        body="The run is still queued and the local Inngest dev server is not responding. Start the worker to continue this run."
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
}: {
  body: string
  icon: ReactNode
  title: string
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

function eventIcon(kind: string) {
  switch (kind) {
    case "navigation":
      return <IconWorld className="size-4" />
    case "session":
      return <IconSatellite className="size-4" />
    case "status":
      return <IconSparkles className="size-4" />
    default:
      return <IconRadar2 className="size-4" />
  }
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
