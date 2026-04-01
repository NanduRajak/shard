import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBolt,
  IconCheck,
  IconCircleCheck,
  IconClockHour4,
  IconBrandAndroid,
  IconExternalLink,
  IconHourglassEmpty,
  IconInfoCircle,
  IconLinkOff,
  IconLoader3,
  IconMapPin,
  IconPhoto,
  IconPlayerPlay,
  IconPlayerStop,
  IconRadar2,
  IconRoute,
  IconRosetteDiscountCheck,
  IconShieldExclamation,
  IconStack2,
  IconTrash,
  IconWorldWww,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { CrawlStatusBadge } from "@/components/crawl-status-badge";
import { SiteMapView } from "@/components/site-map-view";
import { FormInventoryView } from "@/components/form-inventory-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AgentPlan,
  type TimelineEvent as AgentPlanEvent,
} from "@/components/ui/agent-plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  getBackgroundAgentLaneLabel,
  getBackgroundTaskLabel,
} from "@/lib/background-agent-task";
import {
  isBackgroundOrchestratorActive,
  isBackgroundOrchestratorReportReady,
} from "@/lib/background-orchestrator-report";
import {
  formatSessionDuration,
  filterTimelineEventsForQaView,
  sortTimelineEvents,
} from "@/lib/run-report";
import { cn } from "@/lib/utils";
import { deleteBackgroundOrchestrator } from "@/lib/delete-background-orchestrator";
import { requestBackgroundOrchestratorStop } from "@/lib/request-background-orchestrator-stop";
import { requestRunStop } from "@/lib/request-run-stop";

export const Route = createFileRoute("/background-agents/$orchestratorId")({
  component: BackgroundOrchestratorDetailPage,
});

function BackgroundOrchestratorDetailPage() {
  const { orchestratorId } = Route.useParams();
  const navigate = useNavigate();
  const typedOrchestratorId = orchestratorId as Id<"backgroundOrchestrators">;
  const { data: detail } = useQuery(
    convexQuery(api.backgroundAgents.getBackgroundOrchestratorDetail, {
      orchestratorId: typedOrchestratorId,
    }),
  );
  const { data: report } = useQuery(
    convexQuery(api.backgroundAgents.getBackgroundOrchestratorReport, {
      orchestratorId: typedOrchestratorId,
    }),
  );
  const { data: crawlJob } = useQuery(
    convexQuery(api.crawl.getCrawlJobByOrchestrator, {
      orchestratorId: typedOrchestratorId,
    }),
  );
  const { data: crawledPages } = useQuery({
    ...convexQuery(
      api.crawl.listCrawledPages,
      crawlJob ? { crawlJobId: crawlJob._id } : "skip",
    ),
    enabled: crawlJob != null,
  });
  const { data: crawlCoverage } = useQuery({
    ...convexQuery(
      api.crawl.getCrawlCoverage,
      crawlJob ? { crawlJobId: crawlJob._id } : "skip",
    ),
    enabled: crawlJob != null,
  });
  const { data: crawlFormPages } = useQuery({
    ...convexQuery(
      api.crawl.listFormsFromCrawl,
      crawlJob ? { crawlJobId: crawlJob._id } : "skip",
    ),
    enabled: crawlJob != null,
  });

  const stopOrchestratorMutation = useMutation({
    mutationFn: requestBackgroundOrchestratorStop,
  });
  const deleteOrchestratorMutation = useMutation({
    mutationFn: deleteBackgroundOrchestrator,
  });
  const stopRunMutation = useMutation({
    mutationFn: requestRunStop,
  });
  const [selectedAgentId, setSelectedAgentId] = useState<Id<"runs"> | null>(
    null,
  );
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedReportAgentId, setSelectedReportAgentId] = useState<
    Id<"runs"> | null
  >(null);
  const [selectedReportSeverity, setSelectedReportSeverity] = useState<
    "critical" | "high" | "medium" | null
  >(null);
  const [showAllMergedFindings, setShowAllMergedFindings] = useState(false);
  const [activeTab, setActiveTab] = useState<"report" | "timeline" | null>(
    null,
  );

  useEffect(() => {
    if (!detail?.agents.length) {
      return;
    }

    setSelectedAgentId((current) =>
      current && detail.agents.some((agent: any) => agent.run._id === current)
        ? current
        : detail.agents[0]!.run._id,
    );
  }, [detail]);

  useEffect(() => {
    if (!detail || activeTab) {
      return;
    }

    setActiveTab(
      isBackgroundOrchestratorReportReady(detail.status)
        ? "report"
        : "timeline",
    );
  }, [activeTab, detail]);

  useEffect(() => {
    if (!detail || activeTab !== "report") {
      return;
    }

    if (!isBackgroundOrchestratorReportReady(detail.status)) {
      setActiveTab("timeline");
    }
  }, [activeTab, detail]);

  useEffect(() => {
    if (!selectedReportAgentId) {
      setSelectedReportSeverity(null);
    }
  }, [selectedReportAgentId]);

  const selectedAgent = useMemo(
    () =>
      report?.agentRuns.find(
        (agentRun: any) => agentRun.run._id === selectedAgentId,
      ) ?? null,
    [report, selectedAgentId],
  );
  const selectedAgentDetail = useMemo(
    () =>
      detail?.agents.find((agent: any) => agent.run._id === selectedAgentId) ??
      null,
    [detail, selectedAgentId],
  );
  const selectedReportAgent = useMemo(
    () =>
      report?.agentRuns.find(
        (agentRun: any) => agentRun.run._id === selectedReportAgentId,
      ) ?? null,
    [report, selectedReportAgentId],
  );
  const selectedReportFindings = useMemo(() => {
    const findings = selectedReportAgent?.findings ?? [];
    if (!selectedReportSeverity) {
      return findings;
    }
    return findings.filter(
      (finding: any) => finding.severity === selectedReportSeverity,
    );
  }, [selectedReportAgent, selectedReportSeverity]);
  const visibleMergedFindings = useMemo(() => {
    const findings = report?.mergedFindings ?? [];
    return showAllMergedFindings ? findings : findings.slice(0, 4);
  }, [report, showAllMergedFindings]);
  const mergedSeverityCounts = useMemo(() => {
    const findings = report?.mergedFindings ?? [];

    return {
      critical: findings.filter(
        (finding: any) => finding.severity === "critical",
      ).length,
      high: findings.filter((finding: any) => finding.severity === "high")
        .length,
      low: findings.filter((finding: any) => finding.severity === "low").length,
      medium: findings.filter((finding: any) => finding.severity === "medium")
        .length,
    };
  }, [report]);
  const selectedTimeline = useMemo(
    () =>
      selectedAgent
        ? (sortTimelineEvents(
            filterTimelineEventsForQaView(selectedAgent.runEvents),
          ) as AgentPlanEvent[])
        : [],
    [selectedAgent],
  );

  const combinedVisitedUrls = useMemo(() => {
    const urls = new Set<string>();
    if (report?.coverageUrls) {
      for (const url of report.coverageUrls) {
        urls.add(url);
      }
    }
    return urls;
  }, [report]);

  const hasCrawlData = crawledPages && crawledPages.length > 0;
  const crawlCoveragePercent =
    crawledPages && crawledPages.length > 0
      ? Math.round((combinedVisitedUrls.size / crawledPages.length) * 100)
      : 0;

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
    );
  }

  if (!detail || !report || !activeTab) {
    return (
      <div className="mx-auto grid max-w-8xl gap-4">
        <PageLoadingSkeleton />
      </div>
    );
  }

  const canStopOrchestrator = isBackgroundOrchestratorActive(detail.status);
  const canDeleteOrchestrator = !canStopOrchestrator;
  const isReportReady = isBackgroundOrchestratorReportReady(detail.status);
  const overallRiskLabel =
    report.scoreSummary.overall >= 85
      ? "Low"
      : report.scoreSummary.overall >= 60
        ? "Medium"
        : "High";
  const overallRiskTone =
    overallRiskLabel === "Low"
      ? "text-emerald-400"
      : overallRiskLabel === "Medium"
        ? "text-amber-400"
        : "text-rose-400";
  const tabSwitcher = (
    <div className="relative flex h-9 w-fit items-center rounded-xl border border-border/70 bg-background p-[3px] text-muted-foreground shadow-sm">
      <button
        onClick={() => setActiveTab("report")}
        disabled={!isReportReady}
        title={
          isReportReady
            ? undefined
            : "QA report unlocks after every background agent finishes."
        }
        className={`relative z-10 inline-flex h-full items-center justify-center whitespace-nowrap rounded-lg px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:pointer-events-none disabled:opacity-50 ${activeTab === "report" ? "text-foreground" : "hover:text-foreground"}`}
      >
        {activeTab === "report" && (
          <motion.div
            layoutId="activeTabIndicator"
            className="absolute inset-0 z-[-1] rounded-lg bg-muted/80 shadow-sm"
            transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
          />
        )}
        QA Report
      </button>
      <button
        onClick={() => setActiveTab("timeline")}
        className={`relative z-10 inline-flex h-full items-center justify-center whitespace-nowrap rounded-lg px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:pointer-events-none disabled:opacity-50 ${activeTab === "timeline" ? "text-foreground" : "hover:text-foreground"}`}
      >
        {activeTab === "timeline" && (
          <motion.div
            layoutId="activeTabIndicator"
            className="absolute inset-0 z-[-1] rounded-lg bg-muted/80 shadow-sm"
            transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
          />
        )}
        Agent Timelines
      </button>
    </div>
  );

  return (
    <div className="mx-auto grid max-w-8xl gap-4">
      {/* Top Main Hero Stats Card */}
      <Card className="border border-border/70 bg-card/80">
        <CardHeader className="gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-7 rounded-lg text-foreground/80 transition-colors bg-background/50 border-border/70 hover:bg-background/80 mr-0.5"
                  onClick={() => navigate({ to: "/background-agents" })}
                >
                  <IconArrowLeft className="size-4" />
                </Button>
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Orchestrator
                </span>
                <StatusBadge status={detail.status} />
                <CrawlStatusBadge crawlJob={crawlJob} />
              </div>
              <CardTitle className="text-2xl leading-tight text-foreground max-w-[50rem]">
                {getBackgroundTaskLabel(detail.orchestrator.instructions)}
              </CardTitle>
              <CardDescription className="max-w-3xl break-all font-mono text-sm/6 text-muted-foreground/90">
                {detail.orchestrator.url}
              </CardDescription>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconClockHour4 className="size-4 text-emerald-300" />
                <span>Time taken {formatSessionDuration(detail.durationMs)}</span>
              </div>
            </div>

            <div className="flex min-w-52 flex-col items-end gap-3 sm:min-w-64">
              {canStopOrchestrator ? (
                <Button
                  variant="destructive"
                  className="rounded-[0.85rem] h-9 px-4 text-xs tracking-wide uppercase font-semibold border-0 shadow-sm"
                  disabled={
                    stopOrchestratorMutation.isPending ||
                    Boolean(detail.orchestrator.stopRequestedAt)
                  }
                  onClick={() => {
                    void stopOrchestratorMutation
                      .mutateAsync({
                        data: { orchestratorId: typedOrchestratorId },
                      })
                      .then((result) => {
                        if (!result.ok)
                          toast.error("Could not stop orchestrator.");
                        else toast.success("Stop requested.");
                      })
                      .catch((error) => toast.error(error.message));
                  }}
                >
                  {stopOrchestratorMutation.isPending ||
                  detail.orchestrator.stopRequestedAt
                    ? "Stopping..."
                    : "Stop run"}
                  <IconPlayerStop className="ml-1.5 size-3.5" />
                </Button>
              ) : null}
              {canDeleteOrchestrator ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-[0.85rem] border-0 bg-transparent text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleteOrchestratorMutation.isPending}
                  onClick={() => setIsDeleteDialogOpen(true)}
                  title="Delete background agent report"
                  aria-label="Delete background agent report"
                >
                  <IconTrash className="size-4" />
                </Button>
              ) : null}

              <div className="grid w-full gap-2 sm:grid-cols-2">
                <MetricCard
                  label="Overall Risk"
                  value={overallRiskLabel}
                  icon={<IconShieldExclamation className={`size-4 ${overallRiskTone}`} />}
                  helperIcon={
                    <div className="group relative flex items-center">
                      <IconInfoCircle className="size-3.5 cursor-help text-muted-foreground transition-colors hover:text-foreground" />
                      <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-72 rounded-xl border border-border/70 bg-background/95 p-3 text-[11px] normal-case tracking-normal text-muted-foreground shadow-xl group-hover:block">
                        Overall risk is derived from the existing quality calculation:
                        lower remaining quality means higher risk. This report labels
                        the result as Low, Medium, or High instead of showing a raw
                        numeric score.
                      </div>
                    </div>
                  }
                  valueClassName={`${overallRiskTone} text-base font-semibold uppercase tracking-[0.12em]`}
                />
                <MetricCard
                  label="Total Findings"
                  value={`${report.mergedFindings.length}`}
                  icon={<IconStack2 className="size-4 text-sky-400" />}
                  valueClassName="text-sky-400"
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {tabSwitcher}
            {!isReportReady ? (
              <p className="text-xs text-muted-foreground">
                QA report unlocks when all agent lanes finish. Live timelines and
                artifacts are available now.
              </p>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {/* MERGED QA REPORT TAB */}
      {activeTab === "report" && isReportReady && (
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border border-border/70 bg-card/80">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconStack2 className="size-4 text-emerald-400" />
                  Agent Breakdown
                </CardTitle>
                <CardDescription>
                  Contribution and status summary by agent lane.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 grid gap-3">
                {report.agentRuns.map((agentRun: any) => (
                  <button
                    key={agentRun.run._id}
                    type="button"
                    onClick={() => {
                      setSelectedReportAgentId(agentRun.run._id);
                      setSelectedReportSeverity(null);
                    }}
                    className="cursor-pointer flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/70 p-4 text-left transition-colors hover:border-border"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <IconBrandAndroid className="size-4 text-violet-400" />
                        Agent {agentRun.run.agentOrdinal ?? "?"}
                      </span>
                      <StatusBadge status={agentRun.run.status} />
                    </div>
                    <div className="flex justify-between items-center text-xs text-muted-foreground mt-1 tabular-nums">
                      <span className="flex items-center gap-1.5">
                        <IconClockHour4 className="size-3.5 text-emerald-400/90" />
                        {formatSessionDuration(agentRun.durationMs)}
                      </span>
                      <span className="flex items-center gap-1.5 text-yellow-200">
                        <IconAlertTriangle className="size-3.5 text-yellow-400/90" />
                        {agentRun.findings.length} findings
                      </span>
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="border border-border/70 bg-card/80">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconRoute className="size-4 text-cyan-400" />
                  Routes Explored
                </CardTitle>
                <CardDescription>
                  Combined coverage map of URLs visited by all agents.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="rounded-[1.1rem] border border-border/70 bg-background/70 p-4">
                  <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    <IconRadar2 className="size-3.5 text-cyan-400/90" />
                    Coverage Map
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {report.coverageUrls.length ? (
                      report.coverageUrls.slice(0, 18).map((route: string) => (
                        <Badge
                          key={route}
                          variant="outline"
                          className="max-w-full truncate border-cyan-500/20 text-cyan-100"
                        >
                          <IconMapPin className="mr-1.5 size-3 text-cyan-400" />
                          {route}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        No routes visited yet.
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border border-border/70 bg-card/80 h-full">
            <CardHeader className="gap-3 border-b border-border/70">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconShieldExclamation className="size-4 text-amber-400" />
                Actionable Deduplicated Summary
              </CardTitle>
              <CardDescription>
                Unique issues identified across all agent lanes during the
                orchestrator sweep.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 grid gap-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <MetricCard
                  label="Critical Issues"
                  value={`${mergedSeverityCounts.critical}`}
                  variant="summary"
                  icon={<IconAlertTriangle className="size-4 text-red-400" />}
                  accentClassName="border-red-500/20 bg-red-500/[0.05]"
                  valueClassName="text-red-100"
                />
                <MetricCard
                  label="High Issues"
                  value={`${mergedSeverityCounts.high}`}
                  variant="summary"
                  icon={
                    <IconShieldExclamation className="size-4 text-amber-400" />
                  }
                  accentClassName="border-amber-500/20 bg-amber-500/[0.05]"
                  valueClassName="text-amber-100"
                />
                <MetricCard
                  label="Medium Issues"
                  value={`${mergedSeverityCounts.medium}`}
                  variant="summary"
                  icon={<IconInfoCircle className="size-4 text-sky-400" />}
                  accentClassName="border-sky-500/20 bg-sky-500/[0.05]"
                  valueClassName="text-sky-100"
                />
                <MetricCard
                  label="Perf Audits"
                  value={`${report.mergedPerformanceAudits.length}`}
                  variant="summary"
                  icon={<IconBolt className="size-4 text-violet-400" />}
                  accentClassName="border-violet-500/20 bg-violet-500/[0.05]"
                  valueClassName="text-violet-100"
                />
              </div>

              <div className="space-y-3">
                {report.mergedFindings.length ? (
                  <>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {visibleMergedFindings.map((finding: any) => (
                        <FindingReportCard key={finding._id} finding={finding} />
                      ))}
                    </div>
                    {report.mergedFindings.length > 4 ? (
                      <div className="flex justify-center pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-sm px-4 text-xs"
                          onClick={() =>
                            setShowAllMergedFindings((current) => !current)
                          }
                        >
                          {showAllMergedFindings ? "View Less" : "View More"}
                        </Button>
                      </div>
                    ) : null}
                  </>
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

          {crawlJob && !hasCrawlData ? (
            <Card className="border border-border/70 bg-card/80">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconWorldWww className="size-4 text-cyan-400" />
                  Crawl Progress
                </CardTitle>
                <CardDescription>
                  The crawler is preparing site coverage data for this orchestrator.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="rounded-[1.25rem] border border-border/70 bg-background/60 px-4 py-3 text-sm">
                  {crawlJob.status === "failed" ? (
                    <div className="flex items-start gap-2 text-red-200">
                      <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
                      <div>
                        <p className="font-medium text-foreground">Crawl failed before coverage data was captured.</p>
                        <p className="mt-1 text-muted-foreground">
                          {crawlJob.errorMessage ?? "The crawl did not finish successfully, so the site map is unavailable."}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <IconLoader3 className="mt-0.5 size-4 shrink-0 animate-spin text-blue-400" />
                      <div>
                        <p className="font-medium text-foreground">Crawl indexing is still in progress.</p>
                        <p className="mt-1 text-muted-foreground">
                          {crawlJob.crawledPages != null && crawlJob.totalPages != null
                            ? `${crawlJob.crawledPages}/${crawlJob.totalPages} pages have been indexed so far. The site map and form inventory will appear here as soon as crawl data is available.`
                            : "The site map and form inventory will appear here as pages start streaming in from the crawler."}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {hasCrawlData && (
            <Card className="border border-border/70 bg-card/80">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconWorldWww className="size-4 text-cyan-400" />
                  Crawl Coverage
                </CardTitle>
                <CardDescription>
                  Pre-crawl site map and coverage analysis from the automated
                  crawler.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-4">
                {crawlCoverage && (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard
                      label="Pages Crawled"
                      value={`${crawlCoverage.total}`}
                      variant="summary"
                      icon={
                        <IconWorldWww className="size-4 text-cyan-400" />
                      }
                      accentClassName="border-cyan-500/20 bg-cyan-500/[0.05]"
                      valueClassName="text-cyan-100"
                    />
                    <MetricCard
                      label="Pages Visited"
                      value={`${combinedVisitedUrls.size}`}
                      variant="summary"
                      icon={
                        <IconRadar2 className="size-4 text-emerald-400" />
                      }
                      accentClassName="border-emerald-500/20 bg-emerald-500/[0.05]"
                      valueClassName="text-emerald-100"
                    />
                    <MetricCard
                      label="Coverage"
                      value={`${crawlCoveragePercent}%`}
                      variant="summary"
                      icon={
                        <IconRoute className="size-4 text-blue-400" />
                      }
                      accentClassName="border-blue-500/20 bg-blue-500/[0.05]"
                      valueClassName="text-blue-100"
                    />
                    <MetricCard
                      label="Dead Links"
                      value={`${crawlCoverage.deadLinks}`}
                      variant="summary"
                      icon={
                        <IconLinkOff className="size-4 text-red-400" />
                      }
                      accentClassName="border-red-500/20 bg-red-500/[0.05]"
                      valueClassName="text-red-100"
                    />
                  </div>
                )}
                <SiteMapView
                  crawledPages={crawledPages}
                  visitedUrls={combinedVisitedUrls}
                  coverage={crawlCoverage ?? undefined}
                />
                {crawlFormPages && crawlFormPages.length > 0 && (
                  <FormInventoryView formPages={crawlFormPages} />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Sheet
        open={selectedReportAgentId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedReportAgentId(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full border-border/70 bg-card sm:max-w-2xl"
        >
          <SheetHeader className="border-b border-border/70">
            <SheetTitle className="flex items-center gap-2">
              <IconRosetteDiscountCheck className="size-4 text-emerald-400" />
              {selectedReportAgent
                ? `Agent ${selectedReportAgent.run.agentOrdinal ?? "?"} Findings`
                : "Agent Findings"}
            </SheetTitle>
            <SheetDescription>
              {selectedReportAgent
                ? `Filtered issue cards generated by this agent lane only.`
                : "Filtered issue cards for the selected agent."}
            </SheetDescription>
          </SheetHeader>

          <div className="grid gap-4 border-b border-border/70 p-4 sm:grid-cols-3">
            <MetricFilterCard
              label="Critical Issues"
              value={`${(selectedReportAgent?.findings ?? []).filter((finding: any) => finding.severity === "critical").length}`}
              icon={<IconAlertTriangle className="size-4 text-red-400" />}
              accentClassName="border-red-500/20 bg-red-500/[0.05]"
              valueClassName="text-red-100"
              active={selectedReportSeverity === "critical"}
              onClick={() =>
                setSelectedReportSeverity((current) =>
                  current === "critical" ? null : "critical",
                )
              }
            />
            <MetricFilterCard
              label="High Issues"
              value={`${(selectedReportAgent?.findings ?? []).filter((finding: any) => finding.severity === "high").length}`}
              icon={<IconShieldExclamation className="size-4 text-amber-400" />}
              accentClassName="border-amber-500/20 bg-amber-500/[0.05]"
              valueClassName="text-amber-100"
              active={selectedReportSeverity === "high"}
              onClick={() =>
                setSelectedReportSeverity((current) =>
                  current === "high" ? null : "high",
                )
              }
            />
            <MetricFilterCard
              label="Medium Issues"
              value={`${(selectedReportAgent?.findings ?? []).filter((finding: any) => finding.severity === "medium").length}`}
              icon={<IconInfoCircle className="size-4 text-sky-400" />}
              accentClassName="border-sky-500/20 bg-sky-500/[0.05]"
              valueClassName="text-sky-100"
              active={selectedReportSeverity === "medium"}
              onClick={() =>
                setSelectedReportSeverity((current) =>
                  current === "medium" ? null : "medium",
                )
              }
            />
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {selectedReportFindings.length ? (
              selectedReportFindings.map((finding: any) => (
                <FindingReportCard key={finding._id} finding={finding} />
              ))
            ) : (
              <EmptyStateCopy
                icon={<IconCircleCheck className="size-4" />}
                title={
                  selectedReportSeverity
                    ? `No ${selectedReportSeverity} findings`
                    : "No findings for this agent"
                }
                body={
                  selectedReportSeverity
                    ? "This agent lane has no persisted issue cards for the selected severity."
                    : "This agent lane finished without persisted issue cards."
                }
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* LIVE AGENT TIMELINES TAB */}
      {activeTab === "timeline" && (
        <div className="grid gap-4 xl:grid-cols-[14rem_1fr] items-start">
          {/* Timeline Nav Sidebar */}
          <Card className="flex flex-col border border-border/70 bg-card/80 h-[calc(100svh-16rem)] min-h-[500px]">
            <CardHeader className="shrink-0 border-b border-border/70 pb-4">
              <CardTitle className="text-base">Agents</CardTitle>
              <CardDescription>
                Select an agent to view its output.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-3 space-y-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {detail.agents.map((agent: any) => {
                const laneLabel = getBackgroundAgentLaneLabel({
                  agentCount: detail.orchestrator.agentCount,
                  agentIndex: Math.max((agent.run.agentOrdinal ?? 1) - 1, 0),
                });
                const isActive = selectedAgentId === agent.run._id;

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
                );
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
                        disabled={
                          stopRunMutation.isPending ||
                          Boolean(selectedAgentDetail.run.stopRequestedAt)
                        }
                        onClick={() => {
                          void stopRunMutation
                            .mutateAsync({
                              data: { runId: selectedAgentDetail.run._id },
                            })
                            .then((res) => {
                              if (!res.ok) toast.error("Could not stop agent.");
                              else toast.success("Stop requested for agent.");
                            })
                            .catch((e) => toast.error(e.message));
                        }}
                      >
                        {stopRunMutation.isPending ||
                        selectedAgentDetail.run.stopRequestedAt
                          ? "STOPPING..."
                          : "STOP AGENT"}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] uppercase font-bold text-muted-foreground hover:bg-background"
                        onClick={() =>
                          navigate({
                            to: "/runs/$runId",
                            params: { runId: selectedAgentDetail.run._id },
                          })
                        }
                      >
                        VIEW RAW LOGS{" "}
                        <IconExternalLink className="ml-1 size-3" />
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
                                {screenshot.pageUrl ??
                                  selectedAgentDetail.run.url}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="icon"
                              className="size-8 rounded-full pointer-events-none opacity-50 group-hover:opacity-100"
                            >
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

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete background agent report?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the orchestrator, all agent runs,
              findings, screenshots, sessions, and related artifacts for{" "}
              {detail.orchestrator.url}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteOrchestratorMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteOrchestratorMutation.isPending}
              onClick={() => {
                void deleteOrchestratorMutation
                  .mutateAsync({
                    data: { orchestratorId: typedOrchestratorId },
                  })
                  .then((result) => {
                    if (!result.ok) {
                      toast.error(
                        result.reason === "active"
                          ? "Stop the orchestrator before deleting it."
                          : "Could not delete background agent report.",
                      );
                      return;
                    }

                    toast.success("Background agent report deleted.");
                    navigate({ to: "/background-agents" });
                  })
                  .catch((error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Failed to delete background agent report.",
                    ),
                  );
              }}
            >
              {deleteOrchestratorMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function canStopRunState(status: string) {
  return status === "queued" || status === "starting" || status === "running";
}

function MetricCard({
  label,
  value,
  variant = "default",
  icon,
  helperIcon,
  accentClassName,
  valueClassName,
}: {
  label: string;
  value: string;
  variant?: "default" | "summary";
  icon?: ReactNode;
  helperIcon?: ReactNode;
  accentClassName?: string;
  valueClassName?: string;
}) {
  const isSummary = variant === "summary";

  return (
    <div
      className={cn(
        isSummary
          ? "flex min-h-[84px] flex-col rounded-2xl border border-border/70 bg-background/70 p-3 transition-colors"
          : "rounded-2xl border border-border/70 bg-background/70 p-4 transition-colors",
        accentClassName,
      )}
    >
      <dt
        className={cn(
          "flex items-center gap-2 font-semibold tracking-wider text-muted-foreground uppercase",
          isSummary ? "text-[11px]" : "text-[11px]",
        )}
      >
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span>{label}</span>
        {helperIcon ? <span className="ml-auto shrink-0">{helperIcon}</span> : null}
      </dt>
      <dd
        className={cn(
          isSummary
            ? "mt-auto self-end break-all text-right text-[1.5rem] leading-none font-semibold text-foreground"
            : "mt-1 break-all text-[14px] font-medium text-foreground",
          valueClassName,
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function MetricFilterCard({
  active,
  onClick,
  accentClassName,
  ...props
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: string;
  icon?: ReactNode;
  helperIcon?: ReactNode;
  accentClassName?: string;
  valueClassName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-2xl text-left transition-colors",
        active
          ? "ring-2 ring-foreground/30"
          : "opacity-65 saturate-75 hover:opacity-90",
      )}
    >
      <MetricCard
        {...props}
        accentClassName={cn(
          accentClassName,
          active
            ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            : "border-border/50 bg-background/40",
        )}
      />
    </button>
  );
}

function FindingSourceBadge({ source }: { source: string }) {
  const normalizedSource = source.toLowerCase();
  const isBrowser = normalizedSource === "browser";

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 rounded-full border px-3 py-1 font-medium",
        isBrowser
          ? "border-cyan-500/30 text-cyan-300"
          : "border-border/70 text-muted-foreground",
      )}
    >
      {isBrowser ? (
        <IconWorldWww className="size-3" />
      ) : (
        <IconStack2 className="size-3" />
      )}
      {source}
    </Badge>
  );
}

function FindingSeverityBadge({ severity }: { severity: string }) {
  const normalizedSeverity = severity.toLowerCase();

  if (normalizedSeverity === "critical") {
    return (
      <Badge className="gap-1.5 rounded-full border-0 bg-red-500/15 px-3 py-1 font-medium text-red-300 hover:bg-red-500/20">
        <IconAlertTriangle className="size-3" />
        {severity}
      </Badge>
    );
  }

  if (normalizedSeverity === "high") {
    return (
      <Badge className="gap-1.5 rounded-full border-0 bg-amber-500/15 px-3 py-1 font-medium text-amber-300 hover:bg-amber-500/20">
        <IconShieldExclamation className="size-3" />
        {severity}
      </Badge>
    );
  }

  if (normalizedSeverity === "medium") {
    return (
      <Badge className="gap-1.5 rounded-full border-0 bg-sky-500/15 px-3 py-1 font-medium text-sky-300 hover:bg-sky-500/20">
        <IconInfoCircle className="size-3" />
        {severity}
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className="gap-1.5 rounded-full bg-muted/60 px-3 py-1 font-medium text-muted-foreground"
    >
      <IconInfoCircle className="size-3" />
      {severity}
    </Badge>
  );
}

function FindingReportCard({ finding }: { finding: any }) {
  return (
    <article className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FindingSourceBadge source={finding.source} />
        <FindingSeverityBadge severity={finding.severity} />
        {finding.browserSignal ? (
          <Badge
            variant="outline"
            className="gap-1.5 border-amber-500/30 text-amber-400"
          >
            <IconWorldWww className="size-3" />
            {finding.browserSignal}
          </Badge>
        ) : null}
      </div>
      <h3 className="mt-3 text-sm font-medium text-foreground">
        {finding.title}
      </h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground break-words text-pretty">
        {finding.description}
      </p>
      {finding.pageOrFlow ? (
        <div className="mt-3 text-xs text-muted-foreground">
          Location: {finding.pageOrFlow}
        </div>
      ) : null}
    </article>
  );
}

function EmptyStateCopy({
  body,
  icon,
  title,
}: {
  body: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-[1.75rem] border border-dashed border-border/70 bg-background/70 p-6 text-sm text-center text-muted-foreground flex flex-col items-center justify-center min-h-[16rem]">
      <div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border border-border/70 bg-card text-foreground shadow-sm">
        {icon}
      </div>
      <p className="font-medium text-foreground text-center">{title}</p>
      <p className="mt-2 text-center max-w-[16rem] leading-relaxed mx-auto">
        {body}
      </p>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status:
    | "cancelled"
    | "completed"
    | "failed"
    | "queued"
    | "running"
    | "starting";
}) {
  if (status === "failed") {
    return (
      <Badge
        variant="destructive"
        className="items-center gap-1 bg-red-500/15 text-red-500 hover:bg-red-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs"
      >
        <IconX className="size-3.5" stroke={2.5} />
        FAILED
      </Badge>
    );
  }

  if (status === "completed") {
    return (
      <Badge
        className="items-center gap-1 bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs"
        variant="secondary"
      >
        <IconCheck className="size-3.5" stroke={2.5} />
        COMPLETED
      </Badge>
    );
  }

  if (status === "running" || status === "starting") {
    return (
      <Badge
        className="items-center gap-1 bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs"
        variant="secondary"
      >
        <IconPlayerPlay className="size-3.5 animate-pulse" stroke={2.5} />
        RUNNING
      </Badge>
    );
  }

  if (status === "cancelled") {
    return (
      <Badge
        className="items-center gap-1 bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs"
        variant="secondary"
      >
        <IconX className="size-3.5" stroke={2.5} />
        CANCELLED
      </Badge>
    );
  }

  return (
    <Badge
      className="items-center gap-1 bg-yellow-500/15 text-yellow-500 hover:bg-yellow-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase text-xs"
      variant="secondary"
    >
      <IconHourglassEmpty className="size-3.5" stroke={2.5} />
      PENDING
    </Badge>
  );
}

function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4 flex flex-col justify-center">
      <div className="flex items-center gap-2">
        <Skeleton className="size-4 rounded-full shrink-0" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-5 w-8 mt-2.5" />
    </div>
  );
}

function FindingCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-4 w-48" />
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-[85%]" />
      </div>
      <Skeleton className="mt-3 h-3 w-40" />
    </div>
  );
}

function PageLoadingSkeleton() {
  return (
    <>
      <Card className="border border-border/70 bg-card/80">
        <CardHeader className="gap-4 border-b border-border/70">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-3 w-full max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="size-7 rounded-sm shrink-0 mr-0.5" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-20 rounded-md" />
              </div>
              <Skeleton className="h-8 w-[90%] sm:w-[50rem]" />
              <Skeleton className="h-5 w-[70%] sm:w-[40rem]" />
            </div>
            <div className="grid min-w-52 gap-2 sm:grid-cols-2 mt-1 lg:mt-0">
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4">
          <div className="grid gap-4 md:grid-cols-5">
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </div>
          <div className="flex h-9 items-center rounded-lg bg-background border border-border/70 p-[3px] w-[260px] shadow-sm">
             <Skeleton className="h-full w-full rounded-md" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border border-border/70 bg-card/80 h-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <div className="flex items-center gap-2">
               <Skeleton className="size-4 rounded-full shrink-0" />
               <Skeleton className="h-5 w-64" />
            </div>
            <Skeleton className="h-4 w-96 max-w-full" />
          </CardHeader>
          <CardContent className="pt-4 grid gap-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </div>
            <div className="space-y-3">
              <FindingCardSkeleton />
              <FindingCardSkeleton />
              <FindingCardSkeleton />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 h-max content-start">
          <Card className="border border-border/70 bg-card/80">
            <CardHeader className="gap-3 border-b border-border/70">
              <div className="flex items-center gap-2">
                 <Skeleton className="size-4 rounded-full shrink-0" />
                 <Skeleton className="h-5 w-40" />
              </div>
              <Skeleton className="h-4 w-72 max-w-full" />
            </CardHeader>
            <CardContent className="pt-4">
              <div className="rounded-[1.1rem] border border-border/70 bg-background/70 p-4">
                <Skeleton className="h-3 w-32" />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Skeleton className="h-6 w-32 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-6 w-48 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-36 rounded-full" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border/70 bg-card/80">
            <CardHeader className="gap-3 border-b border-border/70">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </CardHeader>
            <CardContent className="pt-4 grid gap-3">
              <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/70 p-4">
                 <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-16 rounded-md" />
                 </div>
                 <div className="flex justify-between items-center mt-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20" />
                 </div>
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/70 p-4">
                 <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-5 w-16 rounded-md" />
                 </div>
                 <div className="flex justify-between items-center mt-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-20" />
                 </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function AgentStatusDot({
  status,
}: {
  status:
    | "cancelled"
    | "completed"
    | "failed"
    | "queued"
    | "running"
    | "starting";
}) {
  if (status === "completed")
    return <div className="size-2 rounded-full bg-teal-500" />;
  if (status === "failed")
    return <div className="size-2 rounded-full bg-red-500" />;
  if (status === "cancelled")
    return <div className="size-2 rounded-full bg-zinc-400" />;
  if (status === "running" || status === "starting") {
    return (
      <div className="relative flex size-2 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
      </div>
    );
  }
  return <div className="size-2 animate-pulse rounded-full bg-amber-500" />;
}
