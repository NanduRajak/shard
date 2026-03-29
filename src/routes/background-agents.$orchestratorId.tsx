import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconCircleCheck,
  IconExternalLink,
  IconHourglassEmpty,
  IconLoader3,
  IconPhoto,
  IconPlayerPlay,
  IconRadar2,
  IconX,
} from "@tabler/icons-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { AgentPlan, type TimelineEvent as AgentPlanEvent } from "@/components/ui/agent-plan"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { getBackgroundAgentLaneLabel, getBackgroundTaskLabel } from "@/lib/background-agent-task"
import {
  isBackgroundOrchestratorActive,
  isBackgroundOrchestratorReportReady,
} from "@/lib/background-orchestrator-report"
import { formatSessionDuration, filterTimelineEventsForQaView, sortTimelineEvents } from "@/lib/run-report"
import { requestBackgroundOrchestratorStop } from "@/lib/request-background-orchestrator-stop"
import { requestRunStop } from "@/lib/request-run-stop"

export const Route = createFileRoute("/background-agents/$orchestratorId")({
  component: BackgroundOrchestratorDetailPage,
})

function BackgroundOrchestratorDetailPage() {
  const { orchestratorId } = Route.useParams()
  const navigate = useNavigate()
  const typedOrchestratorId = orchestratorId as Id<"backgroundOrchestrators">
  const { data: detail } = useQuery(
    convexQuery(api.backgroundAgents.getBackgroundOrchestratorDetail, {
      orchestratorId: typedOrchestratorId,
    }),
  )
  const { data: report } = useQuery(
    convexQuery(api.backgroundAgents.getBackgroundOrchestratorReport, {
      orchestratorId: typedOrchestratorId,
    }),
  )
  const stopOrchestratorMutation = useMutation({
    mutationFn: requestBackgroundOrchestratorStop,
  })
  const stopRunMutation = useMutation({
    mutationFn: requestRunStop,
  })
  const [selectedAgentId, setSelectedAgentId] = useState<Id<"runs"> | null>(null)
  const [activeTab, setActiveTab] = useState<"report" | "timeline" | null>(null)

  useEffect(() => {
    if (!detail?.agents.length) {
      return
    }

    setSelectedAgentId((current) =>
      current && detail.agents.some((agent: any) => agent.run._id === current)
        ? current
        : detail.agents[0]!.run._id,
    )
  }, [detail])

  useEffect(() => {
    if (!detail || activeTab) {
      return
    }

    setActiveTab(isBackgroundOrchestratorReportReady(detail.status) ? "report" : "timeline")
  }, [activeTab, detail])

  useEffect(() => {
    if (!detail || activeTab !== "report") {
      return
    }

    if (!isBackgroundOrchestratorReportReady(detail.status)) {
      setActiveTab("timeline")
    }
  }, [activeTab, detail])

  const selectedAgent = useMemo(
    () => report?.agentRuns.find((agentRun: any) => agentRun.run._id === selectedAgentId) ?? null,
    [report, selectedAgentId],
  )
  const selectedAgentDetail = useMemo(
    () => detail?.agents.find((agent: any) => agent.run._id === selectedAgentId) ?? null,
    [detail, selectedAgentId],
  )
  const mergedSeverityCounts = useMemo(() => {
    const findings = report?.mergedFindings ?? []

    return {
      critical: findings.filter((finding: any) => finding.severity === "critical").length,
      high: findings.filter((finding: any) => finding.severity === "high").length,
      low: findings.filter((finding: any) => finding.severity === "low").length,
      medium: findings.filter((finding: any) => finding.severity === "medium").length,
    }
  }, [report])
  const selectedTimeline = useMemo(
    () =>
      selectedAgent
        ? (sortTimelineEvents(
            filterTimelineEventsForQaView(selectedAgent.runEvents),
          ) as AgentPlanEvent[])
        : [],
    [selectedAgent],
  )

  if (detail === null || report === null) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:p-8">
        <Empty className="min-h-[calc(100svh-12rem)] border border-dashed border-border/70 bg-card/60">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconAlertTriangle />
            </EmptyMedia>
            <EmptyTitle>Orchestrator not found</EmptyTitle>
            <EmptyDescription>
              The requested orchestrator id does not exist in Convex yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (!detail || !report || !activeTab) {
    return <div className="mx-auto min-h-128 max-w-7xl animate-pulse rounded-2xl bg-muted/20 m-4 md:m-8" />
  }

  const canStopOrchestrator = isBackgroundOrchestratorActive(detail.status)
  const isReportReady = isBackgroundOrchestratorReportReady(detail.status)

  return (
    <div className="mx-auto grid max-w-7xl gap-4 p-3 md:p-5">
      {/* Top Main Hero Stats Card */}
      <Card className="border border-border/70 bg-card/80">
        <CardHeader className="gap-4 border-b border-border/70">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="size-7 rounded-sm text-foreground/80 hover:bg-background/80 transition-colors bg-background/50 border-border/70 mr-0.5"
                  onClick={() => navigate({ to: "/background-agents" })}
                >
                  <IconArrowLeft className="size-4" />
                </Button>
                <Badge variant="outline" className="tracking-[0.18em] uppercase">
                  Orchestrator
                </Badge>
                <StatusBadge status={detail.status} />
                {canStopOrchestrator ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 rounded-md px-2 text-[10px] uppercase tracking-widest bg-red-500/15 text-red-500 hover:bg-red-500/25 border-0 shadow-none ml-2"
                    disabled={stopOrchestratorMutation.isPending || Boolean(detail.orchestrator.stopRequestedAt)}
                    onClick={() => {
                      void stopOrchestratorMutation
                        .mutateAsync({ data: { orchestratorId: typedOrchestratorId } })
                        .then((result) => {
                          if (!result.ok) toast.error("Could not stop orchestrator.")
                          else toast.success("Stop requested.")
                        })
                        .catch((error) => toast.error(error.message))
                    }}
                  >
                    {stopOrchestratorMutation.isPending || detail.orchestrator.stopRequestedAt ? "STOPPING..." : "STOP RUN"}
                  </Button>
                ) : null}
              </div>
              <CardTitle className="text-2xl leading-tight text-foreground break-all max-w-[50rem]">
                {detail.orchestrator.url}
              </CardTitle>
              <CardDescription className="max-w-3xl text-sm/6">
                {getBackgroundTaskLabel(detail.orchestrator.instructions)}
              </CardDescription>
            </div>
            
            <div className="grid min-w-52 gap-2 sm:grid-cols-2">
              <MetricCard
                label="Overall score"
                value={`${report.scoreSummary.overall.toFixed(0)}/100`}
              />
              <MetricCard label="Total Findings" value={`${report.mergedFindings.length}`} />
            </div>
          </div>
          
          <div className="flex h-9 items-center rounded-lg bg-background border border-border/70 p-[3px] text-muted-foreground mt-4 mb-2 w-fit shadow-sm relative">
            <button
              onClick={() => setActiveTab("report")}
              disabled={!isReportReady}
              title={
                isReportReady
                  ? undefined
                  : "QA report unlocks after every background agent finishes."
              }
              className={`relative z-10 inline-flex h-full items-center justify-center whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:pointer-events-none disabled:opacity-50 ${activeTab === "report" ? "text-foreground" : "hover:text-foreground"}`}
            >
              {activeTab === "report" && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute inset-0 z-[-1] rounded-md bg-muted/80 shadow-sm"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}
              QA Report
            </button>
            <button
              onClick={() => setActiveTab("timeline")}
              className={`relative z-10 inline-flex h-full items-center justify-center whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:pointer-events-none disabled:opacity-50 ${activeTab === "timeline" ? "text-foreground" : "hover:text-foreground"}`}
            >
              {activeTab === "timeline" && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute inset-0 z-[-1] rounded-md bg-muted/80 shadow-sm"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}
              Agent Timelines
            </button>
          </div>
          {!isReportReady ? (
            <p className="text-xs text-muted-foreground">
              QA report unlocks when all agent lanes finish. Live timelines and artifacts are available now.
            </p>
          ) : null}
        </CardHeader>
        
        {activeTab === "report" && isReportReady && (
          <CardContent className="grid gap-4 pt-4 md:grid-cols-5">
            <MetricCard label="Elapsed Time" value={formatSessionDuration(detail.durationMs)} />
            <MetricCard label="Lanes Deployed" value={`${detail.orchestrator.agentCount}`} />
            <MetricCard label="Agents Running" value={`${detail.counts.running}`} />
            <MetricCard label="Agents Completed" value={`${detail.counts.completed}`} />
            <MetricCard label="Auth Profile" value={detail.credential?.login ?? "No stored login"} />
          </CardContent>
        )}
      </Card>

      {/* MERGED QA REPORT TAB */}
      {activeTab === "report" && isReportReady && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border border-border/70 bg-card/80 h-full">
            <CardHeader className="gap-3 border-b border-border/70">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconCheck className="size-4" />
                Actionable Deduplicated Summary
              </CardTitle>
              <CardDescription>
                Unique issues identified across all agent lanes during the orchestrator sweep.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 grid gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MetricCard label="Critical Issues" value={`${mergedSeverityCounts.critical}`} />
                <MetricCard label="High Issues" value={`${mergedSeverityCounts.high}`} />
                <MetricCard label="Medium Issues" value={`${mergedSeverityCounts.medium}`} />
                <MetricCard label="Perf Audits" value={`${report.mergedPerformanceAudits.length}`} />
              </div>

              {/* Merged Findings List */}
              <div className="space-y-3">
                {report.mergedFindings.length ? (
                  report.mergedFindings.map((finding: any) => (
                    <article
                      key={finding._id}
                      className="rounded-2xl border border-border/70 bg-background/70 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{finding.source}</Badge>
                        <Badge variant="secondary">{finding.severity}</Badge>
                        {finding.browserSignal ? (
                          <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                            {finding.browserSignal}
                          </Badge>
                        ) : null}
                      </div>
                      <h3 className="mt-3 text-sm font-medium text-foreground">{finding.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground break-words text-pretty">
                        {finding.description}
                      </p>
                      {finding.pageOrFlow ? (
                        <div className="mt-3 text-xs text-muted-foreground">
                          Location: {finding.pageOrFlow}
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <EmptyStateCopy
                    icon={<IconCircleCheck className="size-4" />}
                    title="No findings yet"
                    body="Findings will automatically populate here as they are discovered by background agents."
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 h-max content-start">
            <Card className="border border-border/70 bg-card/80">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconRadar2 className="size-4" />
                  Routes Explored
                </CardTitle>
                <CardDescription>
                  Combined coverage map of URLs visited by all agents.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="rounded-[1.1rem] border border-border/70 bg-background/70 p-4">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Coverage Map
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {report.coverageUrls.length ? report.coverageUrls.slice(0, 18).map((route: string) => (
                      <Badge key={route} variant="outline" className="max-w-full truncate font-normal">
                        {route}
                      </Badge>
                    )) : (
                      <span className="text-sm text-muted-foreground">No routes visited yet.</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border/70 bg-card/80">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="text-base">Agent Breakdown</CardTitle>
                <CardDescription>
                  Contribution and status summary by agent lane.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 grid gap-3">
                {report.agentRuns.map((agentRun: any) => (
                  <div
                    key={agentRun.run._id}
                    className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/70 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">
                        Agent {agentRun.run.agentOrdinal ?? "?"}
                      </span>
                      <StatusBadge status={agentRun.run.status} />
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground mt-1 tabular-nums">
                      <span>{formatSessionDuration(agentRun.durationMs)}</span>
                      <span>{agentRun.findings.length} findings</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* LIVE AGENT TIMELINES TAB */}
      {activeTab === "timeline" && (
        <div className="grid gap-4 xl:grid-cols-[14rem_1fr] items-start">
          {/* Timeline Nav Sidebar */}
          <Card className="flex flex-col border border-border/70 bg-card/80 h-[calc(100svh-16rem)] min-h-[500px]">
            <CardHeader className="shrink-0 border-b border-border/70 pb-4">
              <CardTitle className="text-base">Agents</CardTitle>
              <CardDescription>Select an agent to view its output.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-3 space-y-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {detail.agents.map((agent: any) => {
                const laneLabel = getBackgroundAgentLaneLabel({
                  agentCount: detail.orchestrator.agentCount,
                  agentIndex: Math.max((agent.run.agentOrdinal ?? 1) - 1, 0),
                })
                const isActive = selectedAgentId === agent.run._id

                return (
                  <button
                    key={agent.run._id}
                    type="button"
                    className={`group flex w-full flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-colors ${
                      isActive
                        ? "border-border/70 bg-background/90 shadow-sm"
                        : "border-transparent text-muted-foreground hover:bg-background/50 hover:text-foreground"
                    }`}
                    onClick={() => setSelectedAgentId(agent.run._id)}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider">
                        Agent {agent.run.agentOrdinal ?? "?"}
                      </span>
                      <AgentStatusDot status={agent.run.status} />
                    </div>
                    <p className="text-sm tracking-tight font-medium text-foreground line-clamp-1">
                      {laneLabel}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                      {formatSessionDuration(agent.durationMs)}
                    </p>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          {/* Timeline View Workspace */}
          {!selectedAgent || !selectedAgentDetail ? (
            <Card className="flex flex-col items-center justify-center border border-border/70 bg-card/80 p-8 text-center text-muted-foreground">
              Select an agent from the sidebar to inspect its timeline.
            </Card>
          ) : (
            <div className="grid gap-4 h-full xl:grid-cols-[minmax(20rem,0.4fr)_minmax(0,0.6fr)]">
              {/* Output Panel */}
              <Card className="flex flex-col border border-border/70 bg-card/85 h-[calc(100svh-16rem)] min-h-[500px]">
                <CardHeader className="shrink-0 gap-2 border-b border-border/70 bg-card/90">
                  <div className="flex justify-between items-center w-full">
                    <CardTitle className="text-base flex items-center gap-2">
                      <IconRadar2 className="size-4" /> Agent Transcript
                    </CardTitle>
                    {canStopRunState(selectedAgentDetail.run.status) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] uppercase font-bold text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                        disabled={stopRunMutation.isPending || Boolean(selectedAgentDetail.run.stopRequestedAt)}
                        onClick={() => {
                          void stopRunMutation
                            .mutateAsync({ data: { runId: selectedAgentDetail.run._id } })
                            .then((res) => {
                              if (!res.ok) toast.error("Could not stop agent.")
                              else toast.success("Stop requested for agent.")
                            })
                            .catch((e) => toast.error(e.message))
                        }}
                      >
                        {stopRunMutation.isPending || selectedAgentDetail.run.stopRequestedAt ? "STOPPING..." : "STOP AGENT"}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] uppercase font-bold text-muted-foreground hover:bg-background"
                        onClick={() => navigate({ to: "/runs/$runId", params: { runId: selectedAgentDetail.run._id } })}
                      >
                        VIEW RAW LOGS <IconExternalLink className="ml-1 size-3" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {selectedTimeline.length ? (
                    <AgentPlan events={selectedTimeline} />
                  ) : (
                    <EmptyStateCopy
                      icon={<IconLoader3 className="size-5 animate-spin" />}
                      title="Starting up"
                      body="The agent has not emitted any timeline events yet. Stand by."
                    />
                  )}
                </CardContent>
              </Card>

              {/* Artifacts/Screenshots Panel */}
              <Card className="flex flex-col border border-border/70 bg-card/85 h-[calc(100svh-16rem)] min-h-[500px] overflow-hidden">
                <CardHeader className="shrink-0 gap-2 border-b border-border/70 bg-card/90">
                  <CardTitle className="text-base flex items-center gap-2">
                    <IconPhoto className="size-4" /> Artifacts
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="space-y-4">
                    {selectedAgent.screenshots.length ? (
                      selectedAgent.screenshots.map((screenshot: any) => (
                        <a
                          key={screenshot._id}
                          href={screenshot.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group block overflow-hidden rounded-[1.4rem] border border-border/70 bg-background/50 shadow-sm transition-colors hover:border-border/90"
                        >
                          <img
                            src={screenshot.url}
                            alt={screenshot.title ?? "Agent screenshot"}
                            className="aspect-[16/10] w-full object-cover transition-opacity group-hover:opacity-90"
                          />
                          <div className="flex items-center justify-between gap-3 p-4 border-t border-border/70 bg-background/80">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {screenshot.title ?? "Screenshot captured"}
                              </p>
                              <p className="truncate text-xs text-muted-foreground mt-0.5">
                                {screenshot.pageUrl ?? selectedAgentDetail.run.url}
                              </p>
                            </div>
                            <Button variant="outline" size="icon" className="size-8 rounded-full pointer-events-none opacity-50 group-hover:opacity-100">
                              <IconExternalLink className="size-3.5" />
                            </Button>
                          </div>
                        </a>
                      ))
                    ) : (
                      <EmptyStateCopy
                        icon={<IconPhoto className="size-4" />}
                        title="No screenshots captured"
                        body="Visual artifacts will stream here as the agent explores the site."
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function canStopRunState(status: string) {
  return status === "queued" || status === "starting" || status === "running"
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 break-all text-[14px] font-medium text-foreground">{value}</dd>
    </div>
  )
}

function EmptyStateCopy({
  body,
  icon,
  title,
}: {
  body: string
  icon: ReactNode
  title: string
}) {
  return (
    <div className="rounded-[1.75rem] border border-dashed border-border/70 bg-background/70 p-6 text-sm text-center text-muted-foreground flex flex-col items-center justify-center min-h-[16rem]">
      <div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border border-border/70 bg-card text-foreground shadow-sm">
        {icon}
      </div>
      <p className="font-medium text-foreground text-center">{title}</p>
      <p className="mt-2 text-center max-w-[16rem] leading-relaxed mx-auto">{body}</p>
    </div>
  )
}

function StatusBadge({
  status,
}: {
  status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
}) {
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="items-center gap-1 bg-red-500/15 text-red-500 hover:bg-red-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs">
        <IconX className="size-3.5" stroke={2.5} />
        FAILED
      </Badge>
    )
  }

  if (status === "completed") {
    return (
      <Badge className="items-center gap-1 bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs" variant="secondary">
        <IconCheck className="size-3.5" stroke={2.5} />
        COMPLETED
      </Badge>
    )
  }

  if (status === "running" || status === "starting") {
    return (
      <Badge className="items-center gap-1 bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs" variant="secondary">
        <IconPlayerPlay className="size-3.5 animate-pulse" stroke={2.5} />
        RUNNING
      </Badge>
    )
  }

  if (status === "cancelled") {
    return (
      <Badge className="items-center gap-1 bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs" variant="secondary">
        <IconX className="size-3.5" stroke={2.5} />
        CANCELLED
      </Badge>
    )
  }

  return (
    <Badge className="items-center gap-1 bg-yellow-500/15 text-yellow-500 hover:bg-yellow-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs" variant="secondary">
      <IconHourglassEmpty className="size-3.5" stroke={2.5} />
      PENDING
    </Badge>
  )
}

function AgentStatusDot({
  status,
}: {
  status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
}) {
  if (status === "completed") return <div className="size-2 rounded-full bg-teal-500" />
  if (status === "failed") return <div className="size-2 rounded-full bg-red-500" />
  if (status === "cancelled") return <div className="size-2 rounded-full bg-zinc-400" />
  if (status === "running" || status === "starting") {
    return (
      <div className="relative flex size-2 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
      </div>
    )
  }
  return <div className="size-2 animate-pulse rounded-full bg-amber-500" />
}
