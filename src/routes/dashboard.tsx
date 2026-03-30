import { createFileRoute, Link } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import {
  IconActivity,
  IconAlertCircle,
  IconArrowRight,
  IconBug,
  IconBrandGithub,
  IconChartAreaLine,
  IconCircleDotted,
  IconLayoutDashboard,
  IconServerCog,
  IconWorldWww,
} from "@tabler/icons-react"
import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  Sector,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"
import { api } from "../../convex/_generated/api"
import { getReviewBotState } from "@/lib/review-bot"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { describeBrowserProvider } from "@/lib/run-report"
import { formatDistanceToNow } from "date-fns"

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
})

function DashboardPage() {
  const { data: runs } = useQuery(convexQuery(api.runtime.getDashboardRuns, {}))
  const { data: reviewBotState } = useQuery({
    queryFn: () => getReviewBotState(),
    queryKey: ["review-bot-state"],
    refetchInterval: 5_000,
  })
  const { data: orchestrators } = useQuery(
    convexQuery(api.backgroundAgents.listBackgroundOrchestrators, {}),
  )

  // 1. KPI Calculations (Real Data)
  const stats = useMemo(() => {
    if (!runs) return { total: 0, failed: 0, findings: 0, avgPerf: 0 }
    const total = runs.length
    const failed = runs.filter((r) => r.run.status === "failed").length
    const findings = runs.reduce((acc, r) => acc + (r.findingsCount || 0), 0)
    
    // Average performance score of completed runs that have a score
    const scoredRuns = runs.filter((r) => r.currentAuditTrend?.performance?.current != null)
    let avgPerf = 0
    if (scoredRuns.length > 0) {
      const sum = scoredRuns.reduce((acc, r) => acc + (r.currentAuditTrend?.performance?.current || 0), 0)
      avgPerf = sum / scoredRuns.length
    }
    
    return { total, failed, findings, avgPerf: Math.round(avgPerf * 100) }
  }, [runs])

  // 2. Latest Lighthouse Audit (Radial Chart)
  const lighthouseData = useMemo(() => {
    if (!runs) return []
    const latest = runs.find((r) => r.run.status === "completed" && r.currentAuditTrend?.performance?.current != null)
    if (!latest) return []
    
    const colors = [
      { key: "seo", label: "SEO", color: "#8b5cf6" },
      { key: "bestPractices", label: "Best Practices", color: "#f59e0b" },
      { key: "accessibility", label: "Accessibility", color: "#10b981" },
      { key: "performance", label: "Performance", color: "#3b82f6" },
    ] as const

    return colors.map((c) => ({
      category: c.label,
      score: Math.round((latest.currentAuditTrend?.[c.key]?.current || 0) * 100),
      fill: c.color,
      trackFill: withAlpha(c.color, 0.28),
    }))
  }, [runs])

  // 3. Agent Workload (aggregated agent status counts)
  const agentsChartData = useMemo(() => {
    if (!orchestrators) return []
    const completed = orchestrators.reduce((total, item) => total + item.counts.completed, 0)
    const queued = orchestrators.reduce((total, item) => total + item.counts.queued, 0)
    const running = orchestrators.reduce((total, item) => total + item.counts.running, 0)
    const failed = orchestrators.reduce((total, item) => total + item.counts.failed, 0)
    
    // If all are zero, return a ghost segment or empty
    if (completed === 0 && queued === 0 && running === 0 && failed === 0) return []

    return [
      { status: "Completed", count: completed, fill: "#10b981" }, // Emerald 500
      { status: "Running", count: running, fill: "#3b82f6" },     // Blue 500
      { status: "Queued", count: queued, fill: "#64748b" },       // Slate 500
      { status: "Failed", count: failed, fill: "#ef4444" },       // Red 500
    ]
  }, [orchestrators])

  const totalAgentCount = useMemo(
    () => agentsChartData.reduce((total, entry) => total + entry.count, 0),
    [agentsChartData],
  )

  // 4. Review Bot Storage (Re-structured)
  const reviewBotChartData = useMemo(() => {
    if (!reviewBotState) return []
    const tracked = reviewBotState.trackedRepos.length
    const untracked = reviewBotState.accessibleRepositories.length - tracked
    return [
      { name: "Tracked", value: tracked, fill: "#8b5cf6" },       // Violet 500
      { name: "Available", value: untracked, fill: "#1e293b" },   // Slate 800
    ]
  }, [reviewBotState])

  const lighthouseConfig = {
    score: { label: "Score" },
    performance: { label: "Performance", color: "#3b82f6" },
    accessibility: { label: "Accessibility", color: "#10b981" },
    bestPractices: { label: "Best Practices", color: "#f59e0b" },
    seo: { label: "SEO", color: "#8b5cf6" },
  }

  const agentsChartConfig = {
    Completed: { label: "Completed", color: "#10b981" },
    Running: { label: "Running", color: "#3b82f6" },
    Queued: { label: "Queued", color: "#64748b" },
    Failed: { label: "Failed", color: "#ef4444" },
  }
  
  const botConfig = {
    Tracked: { label: "Active Monitors", color: "#8b5cf6" },
    Available: { label: "Unmonitored", color: "#1e293b" },
  }

  if (!runs || !reviewBotState || !orchestrators) {
    return (
      <div className="grid gap-6 pb-12 animate-in fade-in duration-500">
        {/* SECTION 1: TOP KPI CARDS SKELETON */}
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

        {/* SECTION 2: TRENDS & INTELLIGENCE PANELS SKELETON */}
        <div className="grid gap-6 md:grid-cols-12">
          {/* Main Panel Skeleton */}
          <Card className="flex flex-col border-border/50 bg-card/40 shadow-sm md:col-span-8">
            <CardHeader className="items-center pb-0 border-b border-border/30 pt-4">
              <Skeleton className="h-6 w-[200px] mb-2" />
              <Skeleton className="h-4 w-[150px] mb-4" />
            </CardHeader>
          </Card>

          <div className="grid gap-6 md:col-span-4">
            {/* Side Panel 1 Skeleton */}
            <Card className="border-border/50 bg-card/40 shadow-sm min-h-[190px]">
               <CardHeader className="border-b border-border/30 pb-4">
                <Skeleton className="h-5 w-[140px]" />
              </CardHeader>
            </Card>

            {/* Side Panel 2 Skeleton */}
            <Card className="border-border/50 bg-card/40 shadow-sm min-h-[190px]">
              <CardHeader className="border-b border-border/30 pb-4">
                <Skeleton className="h-5 w-[170px]" />
              </CardHeader>
            </Card>
          </div>
        </div>

        {/* SECTION 3: RECENT RUNS DIAGNOSTICS LOG SKELETON */}
        <Card className="border-border/60 bg-card/60 shadow-sm">
          <CardHeader className="border-b border-border/40 bg-zinc-950/20 pb-4">
            <Skeleton className="h-6 w-[220px] mb-2" />
            <Skeleton className="h-4 w-[380px]" />
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/40">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
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
    )
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
            Your AI-powered QA dashboard will populate once diagnostic runs are completed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="grid gap-6 pb-12">
      {/* SECTION 1: TOP KPI CARDS */}
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

      {/* SECTION 2: TRENDS & INTELLIGENCE PANELS */}
      <div className="grid gap-6 md:grid-cols-12">
        
        {/* Main Panel: Lighthouse Testing Radial Chart */}
        <Card className="flex flex-col overflow-hidden border-border/50 bg-card/40 pt-0 shadow-sm transition-all hover:bg-card/50 md:col-span-8">
          <CardHeader className="border-b border-border/30 px-5 py-4">
            <CardTitle className="text-lg font-semibold tracking-tight">Lighthouse Intelligence</CardTitle>
            <CardDescription>Most Recent Run Audit</CardDescription>
          </CardHeader>
          <CardContent className="relative px-5 py-4">
            <ChartContainer
              config={lighthouseConfig}
              className="mx-auto aspect-square max-h-[280px] pb-10"
            >
              {lighthouseData.length > 0 ? (
                <RadialBarChart
                  data={lighthouseData}
                  startAngle={90}
                  endAngle={-270}
                  innerRadius={30}
                  outerRadius={120}
                >
                  <PolarAngleAxis
                    type="number"
                    domain={[0, 100]}
                    angleAxisId={0}
                    tick={false}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel nameKey="category" />}
                  />
                  <RadialBar
                    dataKey="score"
                    background={false}
                    shape={LighthouseRingShape}
                  >
                    {lighthouseData.map((entry) => (
                      <Cell key={`${entry.category}-value`} fill={entry.fill} />
                    ))}
                  </RadialBar>
                </RadialBarChart>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No Lighthouse data available yet.
                </div>
              )}
            </ChartContainer>
            {lighthouseData.length > 0 ? (
              <div className="absolute right-5 bottom-4 flex flex-wrap justify-end gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                {lighthouseData.map((entry) => (
                  <div key={`${entry.category}-legend`} className="flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: entry.fill }}
                    />
                    <span>{entry.category}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-6 md:col-span-4">
          {/* Side Panel: Agent Workload */}
          <Card className="border-border/50 bg-card/40 shadow-sm transition-all hover:bg-card/50">
            <CardHeader className="border-b border-border/30 pb-4">
              <CardTitle className="text-md font-semibold tracking-tight flex items-center gap-2">
                <IconServerCog className="size-4 text-muted-foreground" />
                Agent Workload
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {agentsChartData.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-2xl font-semibold text-foreground">{totalAgentCount}</div>
                      <div className="text-xs text-muted-foreground">Total agent runs tracked</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {agentsChartData.find((entry) => entry.status === "Running")?.count ?? 0} active now
                    </div>
                  </div>
                  <ChartContainer config={agentsChartConfig} className="h-[160px] w-full">
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
                        width={64}
                      />
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Bar dataKey="count" radius={6}>
                        {agentsChartData.map((entry, index) => (
                          <Cell key={`agent-bar-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </div>
              ) : (
                 <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                   No background agents active
                 </div>
              )}
            </CardContent>
          </Card>

          {/* Side Panel: PR Review Integration */}
          <Card className="border-border/50 bg-card/40 shadow-sm transition-all hover:bg-card/50">
            <CardHeader className="border-b border-border/30 pb-4">
              <CardTitle className="text-md font-semibold tracking-tight flex items-center gap-2">
                 <IconBrandGithub className="size-4 text-muted-foreground" />
                 Review Bot Telemetry
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 flex flex-col justify-center">
              {reviewBotChartData.length > 0 && reviewBotChartData[0].value > 0 || reviewBotChartData[1].value > 0 ? (
                <ChartContainer config={botConfig} className="h-[140px] w-full">
                  <PieChart>
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Pie data={reviewBotChartData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={2} stroke="none" dataKey="value" nameKey="name">
                      {reviewBotChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              ) : (
                  <div className="flex h-[140px] items-center justify-center text-sm text-muted-foreground">
                    No GitHub repositories synced
                  </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>

      {/* SECTION 3: RECENT RUNS DIAGNOSTICS LOG */}
      <Card className="border-border/60 bg-card/60 shadow-sm">
        <CardHeader className="border-b border-border/40 bg-zinc-950/20 pb-4">
          <CardTitle className="flex items-center gap-2">
             <IconCircleDotted className="size-5 text-blue-500 animate-[spin_4s_linear_infinite]" />
             Live Diagnostics Feed
          </CardTitle>
          <CardDescription>Real-time view of autonomous operations across all environments.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/40">
            {runs.slice(0, 10).map(({ currentAuditTrend, findingsCount, run }) => (
              <article key={run._id} className="group relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between hover:bg-muted/30 transition-colors">
                
                {/* Info Block */}
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <StatusIndicator status={run.status} />
                    <span className="font-medium text-foreground max-w-[200px] sm:max-w-[400px] truncate" title={run.url}>
                      {run.url}
                    </span>
                    <span className="text-muted-foreground text-xs hidden sm:inline-block">
                      {formatDistanceToNow(run.startedAt, { addSuffix: true })}
                    </span>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Badge variant="outline" className="bg-background/80 font-normal">
                       <IconWorldWww className="mr-1 size-3 text-muted-foreground" />
                       {describeBrowserProvider(run.browserProvider)}
                    </Badge>
                    
                    {run.executionMode === "background" && (
                      <Badge variant="outline" className="bg-background/80 font-normal border-blue-500/30 text-blue-400">
                        Autonomous
                      </Badge>
                    )}
                    
                    {run.status === "completed" && (
                      <>
                        <Badge variant="outline" className="bg-background/80 font-normal border-amber-500/30 text-amber-500">
                          {findingsCount} issues found
                        </Badge>
                        {run.finalScore != null && (
                          <Badge variant="outline" className="bg-background/80 font-normal border-emerald-500/30 text-emerald-500">
                            System Score: {run.finalScore.toFixed(0)}
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Micro-metrics area */}
                {run.status === "completed" && (
                  <div className="hidden lg:flex items-center gap-6 mr-6">
                    <MicroMetric label="Perf" value={currentAuditTrend.performance.current} />
                    <MicroMetric label="A11y" value={currentAuditTrend.accessibility.current} />
                    <MicroMetric label="BP" value={currentAuditTrend.bestPractices.current} />
                    <MicroMetric label="SEO" value={currentAuditTrend.seo.current} />
                  </div>
                )}

                {/* Action Frame */}
                <div className="flex-shrink-0">
                  {run.status === "queued" || run.status === "starting" || run.status === "running" ? (
                    <Link
                      to="/runs/$runId"
                      params={{ runId: run._id }}
                      className={buttonVariants({ variant: "default", size: "sm", className: "w-full sm:w-auto shadow-md" })}
                    >
                      Monitor Live <IconArrowRight className="ml-2 size-4" />
                    </Link>
                  ) : (
                    <Link
                      to="/history/$runId"
                      params={{ runId: run._id }}
                      className={buttonVariants({ variant: "outline", size: "sm", className: "w-full sm:w-auto hover:bg-background" })}
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
  )
}

// Subcomponents

function withAlpha(color: string, alpha: number) {
  if (!color.startsWith("#")) {
    return color
  }

  const normalized = color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color

  const red = Number.parseInt(normalized.slice(1, 3), 16)
  const green = Number.parseInt(normalized.slice(3, 5), 16)
  const blue = Number.parseInt(normalized.slice(5, 7), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function LighthouseRingShape(props: any) {
  const { background, cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload } = props
  const gapFill = payload?.trackFill
  const backgroundStart = background?.startAngle
  const backgroundEnd = background?.endAngle
  const hasGap = gapFill && backgroundStart != null && backgroundEnd != null && backgroundEnd !== endAngle

  return (
    <>
      {hasGap ? (
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          startAngle={backgroundEnd}
          endAngle={endAngle}
          fill={gapFill}
        />
      ) : null}
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
    </>
  )
}

function KpiCard({ title, value, icon, description }: { title: string; value: number | string; icon: React.ReactNode; description: string }) {
  return (
    <Card className="border-border/50 bg-card/40 shadow-sm transition-all hover:bg-card/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tighter">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  )
}

function StatusIndicator({ status }: { status: string }) {
  if (status === "running" || status === "starting") {
    return <span className="relative flex h-2.5 w-2.5 mr-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span></span>
  }
  if (status === "failed") {
    return <span className="relative flex h-2.5 w-2.5 mr-1"><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span></span>
  }
  if (status === "completed") {
    return <span className="relative flex h-2.5 w-2.5 mr-1"><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span></span>
  }
  return <span className="relative flex h-2.5 w-2.5 mr-1"><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-slate-500"></span></span>
}

function MicroMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
      <span className="text-sm font-medium text-foreground">{value === null ? "--" : Math.round(value * 100)}</span>
    </div>
  )
}
