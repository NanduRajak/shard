import { createFileRoute, Link } from "@tanstack/react-router";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  IconActivity,
  IconAlertCircle,
  IconArrowRight,
  IconBrandGithub,
  IconBug,
  IconChartAreaLine,
  IconCircleDotted,
  IconLayoutDashboard,
  IconServerCog,
  IconWorldWww,
} from "@tabler/icons-react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { getReviewBotState } from "@/lib/review-bot";
import { describeBrowserProvider } from "@/lib/run-report";
import { format, formatDistanceToNow } from "date-fns";

const OUTCOME_META = {
  completed: { color: "#10b981", label: "Completed" },
  failed: { color: "#ef4444", label: "Failed" },
  active: { color: "#3b82f6", label: "In flight" },
  cancelled: { color: "#8b5cf6", label: "Cancelled" },
} as const;

const WORKFLOW_META = {
  explore: { color: "#3b82f6", label: "Explore" },
  task: { color: "#f59e0b", label: "Task" },
  background: { color: "#8b5cf6", label: "Autonomous" },
} as const;

const AGENT_META = {
  completed: { color: "#10b981", label: "Completed" },
  running: { color: "#3b82f6", label: "Running" },
  queued: { color: "#f59e0b", label: "Queued" },
  failed: { color: "#ef4444", label: "Failed" },
} as const;

const pulseChartConfig = {
  findings: { label: "Findings", color: "#3b82f6" },
} satisfies ChartConfig;

const outcomeChartConfig = {
  completed: {
    label: OUTCOME_META.completed.label,
    color: OUTCOME_META.completed.color,
  },
  failed: {
    label: OUTCOME_META.failed.label,
    color: OUTCOME_META.failed.color,
  },
  active: {
    label: OUTCOME_META.active.label,
    color: OUTCOME_META.active.color,
  },
  cancelled: {
    label: OUTCOME_META.cancelled.label,
    color: OUTCOME_META.cancelled.color,
  },
} satisfies ChartConfig;

const workflowChartConfig = {
  explore: {
    label: WORKFLOW_META.explore.label,
    color: WORKFLOW_META.explore.color,
  },
  task: { label: WORKFLOW_META.task.label, color: WORKFLOW_META.task.color },
  background: {
    label: WORKFLOW_META.background.label,
    color: WORKFLOW_META.background.color,
  },
} satisfies ChartConfig;

const agentChartConfig = {
  completed: {
    label: AGENT_META.completed.label,
    color: AGENT_META.completed.color,
  },
  running: { label: AGENT_META.running.label, color: AGENT_META.running.color },
  queued: { label: AGENT_META.queued.label, color: AGENT_META.queued.color },
  failed: { label: AGENT_META.failed.label, color: AGENT_META.failed.color },
} satisfies ChartConfig;

const githubBotChartConfig = {
  trackedRepos: { label: "Tracked repos", color: "#8b5cf6" },
  trackedPullRequests: { label: "Active PRs", color: "#3b82f6" },
  visibleRepos: { label: "Visible repos", color: "#10b981" },
} satisfies ChartConfig;

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: runs } = useQuery(
    convexQuery(api.runtime.getDashboardRuns, {}),
  );
  const { data: reviewBotState } = useQuery({
    queryFn: () => getReviewBotState(),
    queryKey: ["review-bot-state"],
    refetchInterval: 5_000,
  });
  const { data: orchestrators } = useQuery(
    convexQuery(api.backgroundAgents.listBackgroundOrchestrators, {}),
  );

  const stats = useMemo(() => {
    if (!runs) return { total: 0, failed: 0, findings: 0, avgPerf: 0 };
    const total = runs.length;
    const failed = runs.filter((r) => r.run.status === "failed").length;
    const findings = runs.reduce((acc, r) => acc + (r.findingsCount || 0), 0);

    const scoredRuns = runs.filter(
      (r) => r.currentAuditTrend?.performance?.current != null,
    );
    let avgPerf = 0;
    if (scoredRuns.length > 0) {
      const sum = scoredRuns.reduce(
        (acc, r) => acc + (r.currentAuditTrend?.performance?.current || 0),
        0,
      );
      avgPerf = sum / scoredRuns.length;
    }

    return { total, failed, findings, avgPerf: Math.round(avgPerf * 100) };
  }, [runs]);

  const recentRunPulseData = useMemo(() => {
    if (!runs) return [];

    return runs
      .slice(0, 8)
      .reverse()
      .map(({ findingsCount, run }) => {
        const outcomeKey = getOutcomeKey(run.status);

        return {
          findings: findingsCount,
          fill: OUTCOME_META[outcomeKey].color,
          fullLabel: format(new Date(run.startedAt), "MMM d, h:mm a"),
          provider: describeBrowserProvider(run.browserProvider),
          statusLabel: OUTCOME_META[outcomeKey].label,
          urlHost: getUrlHost(run.url),
          workflow: getWorkflowLabel(run.executionMode, run.mode),
          xLabel: format(new Date(run.startedAt), "HH:mm"),
        };
      });
  }, [runs]);

  const recentRunPulseSummary = useMemo(() => {
    if (recentRunPulseData.length === 0) {
      return { active: 0, avgFindings: 0, completed: 0 };
    }

    const completed = recentRunPulseData.filter(
      (entry) => entry.statusLabel === "Completed",
    ).length;
    const active = recentRunPulseData.filter(
      (entry) => entry.statusLabel === "In flight",
    ).length;
    const avgFindings = Math.round(
      recentRunPulseData.reduce((sum, entry) => sum + entry.findings, 0) /
        recentRunPulseData.length,
    );

    return { active, avgFindings, completed };
  }, [recentRunPulseData]);

  const runOutcomeChartData = useMemo(() => {
    if (!runs) return [];

    const counts = {
      active: 0,
      cancelled: 0,
      completed: 0,
      failed: 0,
    };

    for (const { run } of runs) {
      counts[getOutcomeKey(run.status)] += 1;
    }

    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({
        fill: OUTCOME_META[key as keyof typeof OUTCOME_META].color,
        key,
        label: OUTCOME_META[key as keyof typeof OUTCOME_META].label,
        value: count,
      }));
  }, [runs]);

  const workflowMixData = useMemo(() => {
    if (!runs) return [];

    const counts = {
      background: 0,
      explore: 0,
      task: 0,
    };

    for (const { run } of runs) {
      counts[getWorkflowKey(run.executionMode, run.mode)] += 1;
    }

    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({
        count,
        fill: WORKFLOW_META[key as keyof typeof WORKFLOW_META].color,
        key,
        label: WORKFLOW_META[key as keyof typeof WORKFLOW_META].label,
      }));
  }, [runs]);

  const agentsChartData = useMemo(() => {
    if (!orchestrators) return [];
    const completed = orchestrators.reduce(
      (total, item) => total + item.counts.completed,
      0,
    );
    const queued = orchestrators.reduce(
      (total, item) => total + item.counts.queued,
      0,
    );
    const running = orchestrators.reduce(
      (total, item) => total + item.counts.running,
      0,
    );
    const failed = orchestrators.reduce(
      (total, item) => total + item.counts.failed,
      0,
    );

    if (completed === 0 && queued === 0 && running === 0 && failed === 0)
      return [];

    return [
      {
        count: completed,
        fill: AGENT_META.completed.color,
        key: "completed",
        status: AGENT_META.completed.label,
      },
      {
        count: running,
        fill: AGENT_META.running.color,
        key: "running",
        status: AGENT_META.running.label,
      },
      {
        count: queued,
        fill: AGENT_META.queued.color,
        key: "queued",
        status: AGENT_META.queued.label,
      },
      {
        count: failed,
        fill: AGENT_META.failed.color,
        key: "failed",
        status: AGENT_META.failed.label,
      },
    ];
  }, [orchestrators]);

  const githubBotChartData = useMemo(() => {
    if (!reviewBotState) return [];

    return [
      {
        fill: "#8b5cf6",
        key: "trackedRepos",
        label: "Tracked repos",
        value: reviewBotState.trackedRepos.length,
      },
      {
        fill: "#3b82f6",
        key: "trackedPullRequests",
        label: "Active PRs",
        value: reviewBotState.trackedPullRequests.length,
      },
      {
        fill: "#10b981",
        key: "visibleRepos",
        label: "Visible repos",
        value: reviewBotState.accessibleRepositories.length,
      },
    ];
  }, [reviewBotState]);

  const githubBotSummary = useMemo(() => {
    if (!reviewBotState) {
      return {
        connected: false,
        coverage: 0,
        hasData: false,
        loadIssue: false,
      };
    }

    const visibleRepos = reviewBotState.accessibleRepositories.length;
    const trackedRepos = reviewBotState.trackedRepos.length;

    return {
      connected: reviewBotState.connection != null,
      coverage:
        visibleRepos > 0 ? Math.round((trackedRepos / visibleRepos) * 100) : 0,
      hasData:
        visibleRepos > 0 ||
        trackedRepos > 0 ||
        reviewBotState.trackedPullRequests.length > 0,
      loadIssue: reviewBotState.repositoryLoadIssue != null,
    };
  }, [reviewBotState]);

  const totalAgentCount = useMemo(
    () => agentsChartData.reduce((total, entry) => total + entry.count, 0),
    [agentsChartData],
  );

  if (!runs || !orchestrators || !reviewBotState) {
    return (
      <div className="grid gap-6 pb-12 animate-in fade-in duration-500">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-border/50 bg-card/40 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-5 w-5 rounded-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-[60px] mb-2 mt-1" />
                <Skeleton className="h-3 w-[140px]" />
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 md:grid-cols-12">
          <Card className="flex flex-col border-border/50 bg-card/40 shadow-sm md:col-span-7">
            <CardHeader className="items-center pb-0 border-b border-border/30 pt-4">
              <Skeleton className="h-6 w-[200px] mb-2" />
              <Skeleton className="h-4 w-[150px] mb-4" />
            </CardHeader>
          </Card>

          <div className="grid gap-6 md:col-span-5">
            <Card className="border-border/50 bg-card/40 shadow-sm min-h-[190px]">
              <CardHeader className="border-b border-border/30 pb-4">
                <Skeleton className="h-5 w-[140px]" />
              </CardHeader>
            </Card>

            <Card className="border-border/50 bg-card/40 shadow-sm min-h-[190px]">
              <CardHeader className="border-b border-border/30 pb-4">
                <Skeleton className="h-5 w-[170px]" />
              </CardHeader>
            </Card>

            <Card className="border-border/50 bg-card/40 shadow-sm min-h-[190px]">
              <CardHeader className="border-b border-border/30 pb-4">
                <Skeleton className="h-5 w-[160px]" />
              </CardHeader>
            </Card>
          </div>
        </div>

        <Card className="border-border/60 bg-card/60 shadow-sm">
          <CardHeader className="border-b border-border/40 bg-zinc-950/20 pb-4">
            <Skeleton className="h-6 w-[220px] mb-2" />
            <Skeleton className="h-4 w-[380px]" />
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/40">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-1 flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-2.5 w-2.5 rounded-full" />
                      <Skeleton className="h-4 w-[200px] sm:w-[350px]" />
                      <Skeleton className="h-3 w-[80px] hidden sm:block" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Skeleton className="h-6 w-[100px] rounded-md" />
                      <Skeleton className="h-6 w-[90px] rounded-md" />
                      <Skeleton className="h-6 w-[120px] rounded-md" />
                    </div>
                  </div>
                  <div className="hidden lg:flex items-center gap-6 mr-6">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <div key={j} className="flex flex-col items-end gap-1">
                        <Skeleton className="h-3 w-8" />
                        <Skeleton className="h-4 w-6" />
                      </div>
                    ))}
                  </div>
                  <Skeleton className="h-9 w-full sm:w-[120px] rounded-md flex-shrink-0" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <Empty className="min-h-[calc(100svh-12rem)] border border-dashed border-border/70 bg-card/60">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconLayoutDashboard className="text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>Command center standing by</EmptyTitle>
          <EmptyDescription>
            Your AI-powered QA dashboard will populate once diagnostic runs are
            completed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-6 pb-12">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total QA Runs"
          value={stats.total}
          icon={<IconActivity className="size-5 text-blue-500" />}
          description="Lifetime systemic diagnostic parses"
        />
        <KpiCard
          title="Defect Findings"
          value={stats.findings}
          icon={<IconBug className="size-5 text-amber-500" />}
          description="Total issues analyzed by intelligence"
        />
        <KpiCard
          title="Failed Executions"
          value={stats.failed}
          icon={<IconAlertCircle className="size-5 text-red-500" />}
          description="Hard aborts or execution crashes"
        />
        <KpiCard
          title="System Health"
          value={stats.avgPerf > 0 ? `${stats.avgPerf}/100` : "Pending"}
          icon={<IconChartAreaLine className="size-5 text-emerald-500" />}
          description="Average baseline performance score"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-12">
        <div className="grid gap-6 md:col-span-7">
          <Card className="flex flex-col overflow-hidden border-border/50 bg-card/40 pt-0 shadow-sm transition-all hover:bg-card/50">
            <CardHeader className="border-b border-border/30 px-5 py-4">
              <CardTitle className="text-lg font-semibold tracking-tight">
                QA Run Pulse
              </CardTitle>
              <CardDescription>
                Recent findings across the latest eight runs.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 py-4">
              {recentRunPulseData.length > 0 ? (
                <div className="flex flex-col gap-5">
                  <ChartContainer
                    config={pulseChartConfig}
                    className="h-[280px] w-full"
                  >
                    <BarChart
                      data={recentRunPulseData}
                      margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="xLabel"
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                        width={28}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            formatter={(_, __, item) => {
                              const payload = item.payload as {
                                findings: number;
                                provider: string;
                                statusLabel: string;
                                urlHost: string;
                                workflow: string;
                              };

                              return (
                                <div className="flex flex-col gap-1">
                                  <span className="font-medium text-foreground">
                                    {payload.urlHost}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {payload.findings} findings ·{" "}
                                    {payload.statusLabel}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {payload.workflow} · {payload.provider}
                                  </span>
                                </div>
                              );
                            }}
                            labelFormatter={(_, payload) =>
                              payload[0]?.payload?.fullLabel ?? null
                            }
                          />
                        }
                      />
                      <Bar dataKey="findings" radius={8}>
                        {recentRunPulseData.map((entry) => (
                          <Cell
                            key={`${entry.fullLabel}-${entry.urlHost}`}
                            fill={entry.fill}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <SignalStat
                      label="Completed"
                      value={recentRunPulseSummary.completed}
                      tone="text-emerald-400"
                    />
                    <SignalStat
                      label="In flight"
                      value={recentRunPulseSummary.active}
                      tone="text-blue-400"
                    />
                    <SignalStat
                      label="Avg findings / run"
                      value={recentRunPulseSummary.avgFindings}
                      tone="text-amber-400"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                  No QA runs have been recorded yet.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-start gap-6">
            <Card className="w-fit border-border/50 bg-card/40 shadow-sm transition-all hover:bg-card/50">
              <CardHeader className="border-b border-border/30 pb-4">
                <CardTitle className="text-md font-semibold tracking-tight">
                  Run Outcomes
                </CardTitle>
                <CardDescription>
                  How the latest dashboard runs finished.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                {runOutcomeChartData.length > 0 ? (
                  <div className="grid items-center gap-6 sm:grid-cols-[156px_1fr]">
                    <ChartContainer
                      config={outcomeChartConfig}
                      className="mx-auto h-[156px] w-full max-w-[156px]"
                    >
                      <PieChart>
                        <ChartTooltip
                          cursor={false}
                          content={
                            <ChartTooltipContent hideLabel nameKey="label" />
                          }
                        />
                        <Pie
                          data={runOutcomeChartData}
                          dataKey="value"
                          innerRadius={44}
                          outerRadius={68}
                          paddingAngle={3}
                          stroke="none"
                        >
                          {runOutcomeChartData.map((entry) => (
                            <Cell key={entry.key} fill={entry.fill} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ChartContainer>
                    <div className="flex flex-col gap-3">
                      {runOutcomeChartData.map((entry) => (
                        <LegendRow
                          key={entry.key}
                          color={entry.fill}
                          label={entry.label}
                          value={entry.value}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[132px] items-center justify-center text-sm text-muted-foreground">
                    Waiting for run history.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-[320px] flex-1 border-border/50 bg-card/40 shadow-sm transition-all hover:bg-card/50">
              <CardHeader className="border-b border-border/30 pb-4">
                <CardTitle className="flex items-center gap-2 text-md font-semibold tracking-tight">
                  <IconBrandGithub className="size-4 text-muted-foreground" />
                  GitHub Bot Coverage
                </CardTitle>
                <CardDescription>
                  Repository monitoring and live PR watch coverage.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                {githubBotSummary.connected && githubBotSummary.hasData ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-end justify-between">
                      <div className="flex flex-col gap-1">
                        <div className="text-2xl font-semibold text-foreground">
                          {githubBotSummary.coverage}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          repo coverage across visible installations
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {reviewBotState.trackedPullRequests.length} PRs under watch
                      </div>
                    </div>
                    <ChartContainer
                      config={githubBotChartConfig}
                      className="h-[156px] w-full"
                    >
                      <BarChart
                        data={githubBotChartData}
                        layout="vertical"
                        margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
                      >
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="label"
                          axisLine={false}
                          tickLine={false}
                          width={92}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={
                            <ChartTooltipContent hideLabel nameKey="label" />
                          }
                        />
                        <Bar dataKey="value" radius={6}>
                          {githubBotChartData.map((entry) => (
                            <Cell key={entry.key} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  </div>
                ) : (
                  <div className="flex h-[156px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                    <span>
                      {githubBotSummary.loadIssue
                        ? "GitHub is connected, but Shard could not load repository coverage right now."
                        : "Connect the GitHub review bot to start tracking repositories and PRs here."}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid gap-6 md:col-span-5">
          <Card className="border-border/50 bg-card/40 shadow-sm transition-all hover:bg-card/50">
            <CardHeader className="border-b border-border/30 pb-4">
              <CardTitle className="text-md font-semibold tracking-tight">
                Workflow Mix
              </CardTitle>
              <CardDescription>
                Where recent activity is coming from.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {workflowMixData.length > 0 ? (
                <div className="flex flex-col gap-4">
                  <ChartContainer
                    config={workflowChartConfig}
                    className="h-[168px] w-full"
                  >
                    <BarChart
                      data={workflowMixData}
                      layout="vertical"
                      margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        width={84}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent hideLabel nameKey="label" />
                        }
                      />
                      <Bar dataKey="count" radius={6}>
                        {workflowMixData.map((entry) => (
                          <Cell key={entry.key} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {workflowMixData.map((entry) => (
                      <SignalStat
                        key={entry.key}
                        label={entry.label}
                        tone="text-foreground"
                        value={entry.count}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-[168px] items-center justify-center text-sm text-muted-foreground">
                  Workflow mix will appear after the first runs land.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/40 shadow-sm transition-all hover:bg-card/50">
            <CardHeader className="border-b border-border/30 pb-4">
              <CardTitle className="text-md font-semibold tracking-tight flex items-center gap-2">
                <IconServerCog className="size-4 text-muted-foreground" />
                Agent Workload
              </CardTitle>
              <CardDescription>
                Live background-agent capacity at a glance.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              {agentsChartData.length > 0 ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-end justify-between">
                    <div className="flex flex-col gap-1">
                      <div className="text-2xl font-semibold text-foreground">
                        {totalAgentCount}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Total agent runs tracked
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {agentsChartData.find((entry) => entry.key === "running")
                        ?.count ?? 0}{" "}
                      active now
                    </div>
                  </div>
                  <ChartContainer
                    config={agentChartConfig}
                    className="h-[160px] w-full"
                  >
                    <BarChart
                      data={agentsChartData}
                      layout="vertical"
                      margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
                    >
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="status"
                        axisLine={false}
                        tickLine={false}
                        width={72}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent hideLabel />}
                      />
                      <Bar dataKey="count" radius={6}>
                        {agentsChartData.map((entry) => (
                          <Cell
                            key={`agent-bar-${entry.key}`}
                            fill={entry.fill}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </div>
              ) : (
                <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                  No background agents active.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-border/60 bg-card/60 shadow-sm">
        <CardHeader className="border-b border-border/40 bg-zinc-950/20 pb-4">
          <CardTitle className="flex items-center gap-2">
            <IconCircleDotted className="size-5 text-blue-500 animate-[spin_4s_linear_infinite]" />
            Live Diagnostics Feed
          </CardTitle>
          <CardDescription>
            Real-time view of autonomous operations across all environments.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/40">
            {runs
              .slice(0, 10)
              .map(({ currentAuditTrend, findingsCount, run }) => (
                <article
                  key={run._id}
                  className="group relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between hover:bg-muted/30 transition-colors"
                >
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <StatusIndicator status={run.status} />
                      <span
                        className="font-medium text-foreground max-w-[200px] sm:max-w-[400px] truncate"
                        title={run.url}
                      >
                        {run.url}
                      </span>
                      <span className="text-muted-foreground text-xs hidden sm:inline-block">
                        {formatDistanceToNow(run.startedAt, {
                          addSuffix: true,
                        })}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <Badge
                        variant="outline"
                        className="bg-background/80 font-normal"
                      >
                        <IconWorldWww className="mr-1 size-3 text-muted-foreground" />
                        {describeBrowserProvider(run.browserProvider)}
                      </Badge>

                      {run.executionMode === "background" && (
                        <Badge
                          variant="outline"
                          className="bg-background/80 font-normal border-blue-500/30 text-blue-400"
                        >
                          Autonomous
                        </Badge>
                      )}

                      {run.status === "completed" && (
                        <>
                          <Badge
                            variant="outline"
                            className="bg-background/80 font-normal border-amber-500/30 text-amber-500"
                          >
                            {findingsCount} issues found
                          </Badge>
                          {run.finalScore != null && (
                            <Badge
                              variant="outline"
                              className="bg-background/80 font-normal border-emerald-500/30 text-emerald-500"
                            >
                              System Score: {run.finalScore.toFixed(0)}
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {run.status === "completed" && (
                    <div className="hidden lg:flex items-center gap-6 mr-6">
                      <MicroMetric
                        label="Perf"
                        value={currentAuditTrend.performance.current}
                      />
                      <MicroMetric
                        label="A11y"
                        value={currentAuditTrend.accessibility.current}
                      />
                      <MicroMetric
                        label="BP"
                        value={currentAuditTrend.bestPractices.current}
                      />
                      <MicroMetric
                        label="SEO"
                        value={currentAuditTrend.seo.current}
                      />
                    </div>
                  )}

                  <div className="flex-shrink-0">
                    {run.status === "queued" ||
                    run.status === "starting" ||
                    run.status === "running" ? (
                      <Link
                        to="/runs/$runId"
                        params={{ runId: run._id }}
                        className={buttonVariants({
                          variant: "default",
                          size: "sm",
                          className: "w-full sm:w-auto shadow-md",
                        })}
                      >
                        Monitor Live <IconArrowRight className="ml-2 size-4" />
                      </Link>
                    ) : (
                      <Link
                        to="/history/$runId"
                        params={{ runId: run._id }}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                          className: "w-full sm:w-auto hover:bg-background",
                        })}
                      >
                        Report <IconArrowRight className="ml-2 size-4" />
                      </Link>
                    )}
                  </div>
                </article>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getOutcomeKey(status: string) {
  if (status === "completed") {
    return "completed" as const;
  }

  if (status === "failed") {
    return "failed" as const;
  }

  if (status === "queued" || status === "starting" || status === "running") {
    return "active" as const;
  }

  return "cancelled" as const;
}

function getWorkflowKey(executionMode?: string, mode?: string) {
  if (executionMode === "background") {
    return "background" as const;
  }

  if (mode === "task") {
    return "task" as const;
  }

  return "explore" as const;
}

function getWorkflowLabel(executionMode?: string, mode?: string) {
  return WORKFLOW_META[getWorkflowKey(executionMode, mode)].label;
}

function getUrlHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function KpiCard({
  title,
  value,
  icon,
  description,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  description: string;
}) {
  return (
    <Card className="border-border/50 bg-card/40 shadow-sm transition-all hover:bg-card/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tighter">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

function LegendRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function SignalStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/50 px-3 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${tone}`}>
        {value}
      </div>
    </div>
  );
}

function StatusIndicator({ status }: { status: string }) {
  if (status === "running" || status === "starting") {
    return (
      <span className="relative flex h-2.5 w-2.5 mr-1">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="relative flex h-2.5 w-2.5 mr-1">
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="relative flex h-2.5 w-2.5 mr-1">
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
      </span>
    );
  }
  return (
    <span className="relative flex h-2.5 w-2.5 mr-1">
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-500"></span>
    </span>
  );
}

function MicroMetric({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
      <span className="text-sm font-medium text-foreground">
        {value === null ? "--" : Math.round(value * 100)}
      </span>
    </div>
  );
}
