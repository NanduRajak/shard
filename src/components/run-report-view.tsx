import { useNavigate } from "@tanstack/react-router"
import { AnimatePresence, motion, type Variants } from "motion/react"
import { useEffect, useState, Fragment } from "react"
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBolt,
  IconChartBar,
  IconCircleCheck,
  IconClock,
  IconExternalLink,
  IconFileAnalytics,
  IconClipboardList,
  IconLink,
  IconArchive,
  IconArrowsMaximize,
  IconTerminal2,
  IconPhoto,
  IconPlayerPlay,
  IconRadar2,
  IconWorldWww,
  IconX,
  IconCheck,
  IconHourglassEmpty,
} from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"
import type { ReactNode } from "react"
import { RunTimelineView } from "./run-timeline-view"
import { Badge } from "@/components/ui/badge"
import { buttonVariants, Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { formatSessionDuration } from "@/lib/run-report"

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

export function RunReportView({ report }: { report: any }) {
  const [activeTab, setActiveTab] = useState<"report" | "timeline">("report")
  const [showAllLighthouseReports, setShowAllLighthouseReports] = useState(false)
  const [selectedScreenshot, setSelectedScreenshot] = useState<any | null>(null)
  const [selectedSignal, setSelectedSignal] = useState<"console" | "network" | "pageerror" | null>(null)
  const navigate = useNavigate()
  const {
    artifacts,
    coverageUrls,
    currentAuditTrend,
    findings,
    latestReportArtifact,
    performanceAudits,
    run,
    scoreSummary,
    session,
    sessionDurationMs,
  } = report
  const screenshots = (artifacts as any[]).filter((artifact: any) => artifact.type === "screenshot")
  const sortedFindings = (findings as any[])
    .slice()
    .sort((left: any, right: any) => right.score - left.score)
  const topFindings = sortedFindings.slice(0, 5)
  const sourceScores = Object.entries(scoreSummary.bySource) as Array<[string, number]>
  const isSteelRun = (run.browserProvider ?? "steel") === "steel"
  const consoleFindings = sortedFindings.filter((finding: any) => finding.browserSignal === "console")
  const networkFindings = sortedFindings.filter((finding: any) => finding.browserSignal === "network")
  const pageErrorFindings = sortedFindings.filter((finding: any) => finding.browserSignal === "pageerror")
  const criticalFindings = sortedFindings.filter((finding: any) => finding.severity === "critical")
  const highFindings = sortedFindings.filter((finding: any) => finding.severity === "high")
  const visiblePerformanceAudits = showAllLighthouseReports
    ? (performanceAudits as any[])
    : (performanceAudits as any[]).slice(0, 4)
  const archivePrimaryUrl = isSteelRun ? session?.replayUrl : screenshots[0]?.url
  const archivePrimaryLabel = isSteelRun ? "Replay" : "Latest screenshot"
  const archiveStatusLabel = isSteelRun
    ? session?.replayUrl
      ? "Replay stored"
      : "Replay missing"
    : screenshots.length
      ? "Artifacts stored"
      : "Artifacts missing"
  const archiveStatusTone = isSteelRun
    ? session?.replayUrl
      ? "text-emerald-300"
      : "text-muted-foreground"
    : screenshots.length
      ? "text-emerald-300"
      : "text-muted-foreground"
  const archiveSummary = isSteelRun
    ? session?.replayUrl
      ? "Steel session replay and latest report are attached to this run."
      : "This Steel run completed without a stored replay URL."
    : screenshots.length
      ? "Local artifacts were captured and attached to this archived run."
      : "This local run finished without stored replay artifacts."
  const consoleSignalMeta = signalMeta("console")
  const networkSignalMeta = signalMeta("network")
  const pageErrorSignalMeta = signalMeta("pageerror")
  const selectedSignalFindings = selectedSignal === "console"
    ? consoleFindings
    : selectedSignal === "network"
      ? networkFindings
      : selectedSignal === "pageerror"
        ? pageErrorFindings
        : []
  const selectedSignalMeta = signalMeta(selectedSignal ?? "pageerror")
  const hasReportIntroContent = Boolean(run.instructions)
    || Boolean(run.goalStatus && run.goalStatus !== "not_requested")

  useEffect(() => {
    if (!selectedScreenshot) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedScreenshot(null)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedScreenshot])

  return (
    <motion.div 
      className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={itemVariants} className="xl:col-span-2">
        <Card className="border border-border/70 bg-card/80">
          <CardHeader className={hasReportIntroContent && activeTab === "report" ? "gap-3 border-b border-border/70" : "gap-3"}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="size-7 rounded-lg text-foreground/80 transition-colors bg-background/50 border-border/70 hover:bg-background/80 mr-0.5"
                    onClick={() => navigate({ to: "/history" })}
                  >
                    <IconArrowLeft className="size-4" />
                  </Button>
                  <Badge variant="outline" className="tracking-[0.18em] uppercase">
                    Archived run
                  </Badge>
                  <StatusBadge status={run.status} />
                  {run.executionMode === "background" ? (
                    <Badge variant="secondary">Background agent</Badge>
                  ) : null}
                </div>
                <CardTitle className="text-2xl leading-tight">QA report</CardTitle>
                <CardDescription className="max-w-3xl break-all text-sm/6">
                  {run.url}
                </CardDescription>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <IconClock className="size-4 text-emerald-300" />
                  <span>Time taken {formatSessionDuration(sessionDurationMs)}</span>
                </div>
              </div>
              <div className="grid min-w-52 gap-2 sm:grid-cols-2">
                <MetricCard
                  label="Overall score"
                  value={run.finalScore?.toFixed(0) ?? scoreSummary.overall.toFixed(0)}
                />
                <MetricCard label="Findings" value={scoreSummary.counts.findings.toString()} />
              </div>
            </div>
            
            <div className="relative mt-3 flex h-9 w-fit items-center rounded-xl border border-border/70 bg-background p-[3px] text-muted-foreground shadow-sm">
              <button
                onClick={() => setActiveTab("report")}
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
                Timeline
              </button>
            </div>
          </CardHeader>
          
          {activeTab === "report" && hasReportIntroContent && (
            <CardContent className="grid gap-4 pt-4">
              {run.instructions ? (
                <div className="rounded-[1.1rem] border border-border/70 bg-background/70 p-4">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Task instructions
                  </p>
                  <p className="mt-2 text-[14px] leading-relaxed text-foreground/90">{run.instructions}</p>
                </div>
              ) : null}
              {run.goalStatus && run.goalStatus !== "not_requested" ? (
                <div className="rounded-[1.1rem] border border-border/70 bg-background/70 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      Task outcome
                    </p>
                    <Badge variant="outline">{run.goalStatus.replaceAll("_", " ")}</Badge>
                  </div>
                  <p className="mt-2 text-[14px] leading-relaxed text-foreground/90">
                    {run.goalSummary ?? "No task summary was recorded."}
                  </p>
                </div>
              ) : null}
            </CardContent>
          )}
        </Card>
      </motion.div>

      {activeTab === "report" ? (
        <Fragment>
          <motion.div variants={itemVariants} className="flex h-full">
            <Card className="border border-border/70 bg-card/80 w-full">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconClipboardList className="size-4 text-sky-300" />
                  Actionable Summary
                </CardTitle>
                <CardDescription>
                  The shortest path to what a QA engineer should inspect next.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 pt-4 md:grid-cols-2 xl:grid-cols-4">
                <HighlightMetricCard
                  label="Critical"
                  value={criticalFindings.length.toString()}
                  icon={<IconAlertTriangle className="size-4" />}
                  toneClassName="border-red-500/20 bg-red-500/8 text-red-300"
                />
                <HighlightMetricCard
                  label="High"
                  value={highFindings.length.toString()}
                  icon={<IconBolt className="size-4" />}
                  toneClassName="border-amber-500/20 bg-amber-500/8 text-amber-300"
                />
                <HighlightMetricCard
                  label="Coverage routes"
                  value={(coverageUrls?.length ?? 0).toString()}
                  icon={<IconRadar2 className="size-4" />}
                  toneClassName="border-blue-500/20 bg-blue-500/8 text-blue-300"
                />
                <HighlightMetricCard
                  label="Task status"
                  value={
                    run.goalStatus && run.goalStatus !== "not_requested"
                      ? run.goalStatus.replaceAll("_", " ")
                      : run.mode === "task"
                        ? "Not proven"
                        : "Exploration"
                  }
                  icon={<IconCheck className="size-4" />}
                  toneClassName="border-emerald-500/20 bg-emerald-500/8 text-emerald-300"
                />
                <div className="rounded-[1.1rem] border border-foreground/10 bg-background/70 p-4 md:col-span-2 xl:col-span-4">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    What matters most
                  </p>
                  <p className="mt-2 text-sm leading-6 text-foreground/90">
                    {topFindings.length
                      ? topFindings
                          .slice(0, 3)
                          .map((finding: any) => `${finding.title}${finding.pageOrFlow ? ` on ${finding.pageOrFlow}` : ""}`)
                          .join(" • ")
                      : "No critical QA issues were persisted during this run."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>

      <motion.div variants={itemVariants} className="flex h-full">
        <Card className="border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconBolt className="size-4 text-amber-300" />
              Quality summary
            </CardTitle>
            <CardDescription>
              Source-level scores and report totals for the archived run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <HighlightMetricCard
                label="Performance audits"
                value={scoreSummary.counts.performanceAudits.toString()}
                icon={<IconChartBar className="size-4" />}
                toneClassName="border-blue-500/20 bg-blue-500/8 text-blue-300"
              />
              <HighlightMetricCard
                label="Screenshots"
                value={scoreSummary.counts.screenshots.toString()}
                icon={<IconPhoto className="size-4" />}
                toneClassName="border-violet-500/20 bg-violet-500/8 text-violet-300"
              />
            </div>
            {sourceScores.length ? (
              <div className="grid gap-3">
                {sourceScores.map(([source, score]) => (
                  <ToneInfoRow
                    key={source}
                    label={`${source} score`}
                    value={`${Number(score).toFixed(0)}/100`}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
                No findings have been scored yet.
              </div>
            )}
            {run.errorMessage ? (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {run.errorMessage}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </motion.div>

          <motion.div variants={itemVariants} className="flex h-full">
        <Card className="overflow-hidden border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconArchive className="size-4 text-amber-300" />
              Session archive
            </CardTitle>
            <CardDescription>
              Replay, artifacts, and report access for this archived run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="rounded-[1rem] border border-border/70 bg-background/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 shrink-0 text-emerald-300">
                    <IconPlayerPlay className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      Archive status
                    </p>
                    <p className="mt-1 text-sm text-foreground">{archiveSummary}</p>
                  </div>
                </div>
                <Badge variant="outline" className={archiveStatusTone}>
                  {archiveStatusLabel}
                </Badge>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoRow
                label={archivePrimaryLabel}
                value={archivePrimaryUrl ? compactUrl(archivePrimaryUrl) : "Not stored"}
                icon={isSteelRun ? <IconLink className="size-4" /> : <IconPhoto className="size-4" />}
                iconClassName={isSteelRun ? "text-sky-300" : "text-violet-300"}
              />
              <InfoRow
                label="Duration"
                value={formatSessionDuration(sessionDurationMs)}
                icon={<IconHourglassEmpty className="size-4" />}
                iconClassName="text-amber-300"
              />
              <InfoRow
                label="Updated"
                value={formatDistanceToNow(run.updatedAt, { addSuffix: true })}
                icon={<IconClock className="size-4" />}
                iconClassName="text-emerald-300"
              />
              <InfoRow
                label="Report artifact"
                value={latestReportArtifact?.url ? "Available" : "Not stored"}
                icon={<IconFileAnalytics className="size-4" />}
                iconClassName="text-rose-300"
              />
            </div>
            {session?.replayUrl || latestReportArtifact || (!isSteelRun && screenshots[0]?.url) ? (
              <div className="flex flex-wrap gap-2">
                {isSteelRun && session?.replayUrl ? (
                  <a
                    href={session.replayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({
                      variant: "outline",
                      className: "justify-between rounded-lg",
                    })}
                  >
                    Open Steel replay
                    <IconExternalLink className="size-4" />
                  </a>
                ) : null}
                {!isSteelRun && screenshots[0]?.url ? (
                  <a
                    href={screenshots[0].url}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({
                      variant: "outline",
                      className: "justify-between rounded-lg",
                    })}
                  >
                    Open latest screenshot
                    <IconPhoto className="size-4" />
                  </a>
                ) : null}
                {latestReportArtifact?.url ? (
                  <a
                    href={latestReportArtifact.url}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({
                      variant: "outline",
                      className: "justify-between rounded-lg",
                    })}
                  >
                    Open latest report artifact
                    <IconFileAnalytics className="size-4" />
                  </a>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="flex h-full">
        <Card className="border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconWorldWww className="size-4 text-sky-300" />
              Browser signals
            </CardTitle>
            <CardDescription>
              Console, network, and page runtime issues captured during the run.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-4">
              <SignalTriggerRow
                label={consoleSignalMeta.title}
                value={consoleFindings.length.toString()}
                onClick={() => setSelectedSignal("console")}
                icon={consoleSignalMeta.icon}
                iconClassName={consoleSignalMeta.iconClassName}
              />
              <SignalTriggerRow
                label={networkSignalMeta.title}
                value={networkFindings.length.toString()}
                onClick={() => setSelectedSignal("network")}
                icon={networkSignalMeta.icon}
                iconClassName={networkSignalMeta.iconClassName}
              />
              <SignalTriggerRow
                label={pageErrorSignalMeta.title}
                value={pageErrorFindings.length.toString()}
                onClick={() => setSelectedSignal("pageerror")}
                icon={pageErrorSignalMeta.icon}
                iconClassName={pageErrorSignalMeta.iconClassName}
              />
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="xl:col-span-2 flex h-full">
        <Card className="border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconRadar2 className="size-4 text-cyan-300" />
              Coverage And Lighthouse
            </CardTitle>
            <CardDescription>
              Coverage shows where the run actually went. Lighthouse deltas compare against the immediately previous run for the same URL.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <TrendMetricCard
                label="Performance"
                current={currentAuditTrend.performance.current}
                delta={currentAuditTrend.performance.delta}
              />
              <TrendMetricCard
                label="Accessibility"
                current={currentAuditTrend.accessibility.current}
                delta={currentAuditTrend.accessibility.delta}
              />
              <TrendMetricCard
                label="Best practices"
                current={currentAuditTrend.bestPractices.current}
                delta={currentAuditTrend.bestPractices.delta}
              />
              <TrendMetricCard
                label="SEO"
                current={currentAuditTrend.seo.current}
                delta={currentAuditTrend.seo.delta}
              />
            </div>
            <div className="rounded-[1.1rem] border border-border/70 bg-background/70 p-4">
              <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Covered routes
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(coverageUrls ?? []).slice(0, 18).map((route: string) => (
                  <Badge key={route} variant="outline" className="max-w-full truncate">
                    {route}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="xl:col-span-2 flex h-full">
        <Card className="border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconChartBar className="size-4 text-blue-300" />
              Lighthouse reports
            </CardTitle>
            <CardDescription>
              Stored performance reports from the autonomous QA workflow.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {(performanceAudits as any[]).length ? (
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  {visiblePerformanceAudits.map((audit: any) => (
                    <article
                      key={audit._id}
                      className="flex h-full flex-col rounded-2xl border border-border/70 bg-background/70 p-4"
                    >
                      <div className="rounded-[1rem] border border-border/70 bg-card/70 p-3">
                        <div className="flex items-start gap-3">
                          <div className="shrink-0 text-sky-300">
                            <IconWorldWww className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                              Page URL
                            </p>
                            <p className="mt-1 break-all text-sm font-medium text-foreground">
                              {audit.pageUrl}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <AuditMetric label="Performance" score={audit.performanceScore} />
                        <AuditMetric label="Accessibility" score={audit.accessibilityScore} />
                        <AuditMetric label="Best practices" score={audit.bestPracticesScore} />
                        <AuditMetric label="SEO" score={audit.seoScore} />
                      </div>
                      {audit.reportUrl ? (
                        <a
                          href={audit.reportUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonVariants({
                            variant: "outline",
                            className: "mt-3 w-full justify-center gap-2 rounded-2xl",
                          })}
                        >
                          Open HTML report
                          <IconArrowLeft className="size-4 rotate-180" />
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
                {(performanceAudits as any[]).length > 4 ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-lg"
                      onClick={() => setShowAllLighthouseReports((current) => !current)}
                    >
                      {showAllLighthouseReports ? "View less" : `View more (${(performanceAudits as any[]).length - 4})`}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyStateCopy
                icon={<IconChartBar className="size-4" />}
                title="No Lighthouse audits stored"
                body="This run ended before the performance stage completed or no audit results were saved."
              />
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="xl:col-span-2 flex h-full">
        <Card className="border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPhoto className="size-4 text-violet-300" />
              Screenshot timeline
            </CardTitle>
            <CardDescription>
              Screenshots remain attached as historical artifacts after the run stops.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {screenshots.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {screenshots.map((artifact: any) => (
                  <article
                    key={artifact._id}
                    className="group rounded-2xl border border-border/70 bg-background/70 p-3"
                  >
                    {artifact.url ? (
                      <div className="relative overflow-hidden rounded-xl border border-border/70">
                        <img
                          alt={artifact.title ?? "Run screenshot"}
                          src={artifact.url}
                          className="h-48 w-full cursor-zoom-in object-cover"
                          onClick={() => setSelectedScreenshot(artifact)}
                        />
                      </div>
                    ) : (
                      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border/70 text-sm text-muted-foreground">
                        Processing screenshot
                      </div>
                    )}
                    <div className="mt-3 space-y-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium text-foreground">
                          {artifact.title ?? "Screenshot"}
                        </p>
                        {artifact.url ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
                            onClick={() => setSelectedScreenshot(artifact)}
                          >
                            <IconArrowsMaximize className="size-4" />
                            <span className="sr-only">Open fullscreen screenshot</span>
                          </Button>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <IconWorldWww className="size-3" />
                          URL
                        </div>
                        <p className="break-all text-xs text-muted-foreground">
                          {artifact.pageUrl ?? "No page URL"}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyStateCopy
                icon={<IconPhoto className="size-4" />}
                title="No screenshots stored"
                body="The run ended before any screenshots were uploaded."
              />
            )}
          </CardContent>
        </Card>
      </motion.div>

      <AnimatePresence>
        {selectedScreenshot?.url ? (
          <>
            <motion.button
              type="button"
              aria-label="Close fullscreen screenshot"
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              onClick={() => setSelectedScreenshot(null)}
            />
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8"
              onClick={() => setSelectedScreenshot(null)}
            >
              <motion.div
                className="relative w-full max-w-6xl"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                onClick={(event) => event.stopPropagation()}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-3 top-3 z-10 size-9 rounded-full text-white/70 hover:bg-white/10 hover:text-white"
                  onClick={() => setSelectedScreenshot(null)}
                >
                  <IconX className="size-4" />
                </Button>
                <img
                  alt={selectedScreenshot.title ?? "Run screenshot"}
                  src={selectedScreenshot.url}
                  className="max-h-[88vh] w-full object-contain"
                />
              </motion.div>
            </div>
          </>
        ) : null}
      </AnimatePresence>

      <motion.div variants={itemVariants} className="xl:col-span-2 flex h-full mb-10">
        <Card className="border border-border/70 bg-card/80 w-full mb-2">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconAlertTriangle className="size-4 text-rose-300" />
              Top findings snapshot
            </CardTitle>
            <CardDescription>
              The highest-impact issues captured by the archived run.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            {topFindings.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {topFindings.map((finding: any) => (
                  <div
                    key={finding._id}
                    className="rounded-2xl border border-border/70 bg-background/70 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge className={["gap-1 border-0 capitalize", severityBadgeClassName(finding.severity)].join(" ")} variant="secondary">
                        {severityIcon(finding.severity)}
                        {finding.severity}
                      </Badge>
                      <div className="text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Score
                        </p>
                        <p className="text-lg font-semibold text-amber-300">
                          {finding.score.toFixed(1)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-start gap-2.5">
                      <span className={findingSnapshotMeta(finding).iconClassName}>
                        {findingSnapshotMeta(finding).icon}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {findingSnapshotMeta(finding).label}
                        </p>
                        <p className="mt-1 text-sm font-medium text-foreground">{finding.title}</p>
                      </div>
                    </div>
                    <div className="mt-3 border-t border-border/60 pt-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <IconWorldWww className="size-3" />
                        URL
                      </div>
                      <p className="mt-1 break-all text-sm text-muted-foreground">
                        {finding.pageOrFlow ?? "No page context"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyStateCopy
                icon={<IconCircleCheck className="size-4" />}
                title="Report summary is empty"
                body="No findings were captured for this archived run."
              />
            )}
          </CardContent>
        </Card>
      </motion.div>

      <Sheet open={selectedSignal !== null} onOpenChange={(open) => {
        if (!open) {
          setSelectedSignal(null)
        }
      }}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader className="border-b border-border/70">
            <SheetTitle className="flex items-center gap-2">
              <span className={selectedSignalMeta.iconClassName}>
                {selectedSignalMeta.icon}
              </span>
              {selectedSignalMeta.title}
            </SheetTitle>
            <SheetDescription>{selectedSignalMeta.description}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {selectedSignalFindings.length ? (
              selectedSignalFindings.map((finding: any) => (
                <FindingSheetCard key={finding._id} finding={finding} />
              ))
            ) : (
              <EmptyStateCopy
                icon={<IconCircleCheck className="size-4" />}
                title={`No ${selectedSignalMeta.title.toLowerCase()} recorded`}
                body="This run finished without persisted issues for this signal type."
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
        </Fragment>
      ) : (
        <RunTimelineView report={report} />
      )}
    </motion.div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1rem] border border-border/70 bg-background/70 p-4">
      <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 break-all text-[14px] font-medium text-foreground">{value}</dd>
    </div>
  )
}

function HighlightMetricCard({
  icon,
  label,
  toneClassName,
  value,
}: {
  icon: ReactNode
  label: string
  toneClassName: string
  value: string
}) {
  return (
    <div className={["rounded-[1rem] border p-4", toneClassName].join(" ")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider uppercase text-white/60">
            {label}
          </p>
          <p className="mt-1 break-all text-[14px] font-medium text-white">{value}</p>
        </div>
        <div className="mt-0.5 text-current/90">{icon}</div>
      </div>
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

function InfoRow({
  icon,
  iconClassName,
  label,
  value,
}: {
  icon?: ReactNode
  iconClassName?: string
  label: string
  value: string
}) {
  return (
    <div className="rounded-[1rem] border border-border/70 bg-background/70 p-4">
      <div className="flex items-start gap-3">
        {icon ? (
          <div className={["shrink-0", iconClassName ?? "text-foreground"].join(" ")}>
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {label}
          </p>
          <p className="mt-1 break-all text-sm text-foreground">{value}</p>
        </div>
      </div>
    </div>
  )
}

function SignalTriggerRow({
  icon,
  iconClassName,
  label,
  onClick,
  value,
}: {
  icon?: ReactNode
  iconClassName?: string
  label: string
  onClick: () => void
  value: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[1rem] border border-border/70 bg-background/70 p-4 text-left transition-colors hover:border-foreground/20 hover:bg-background/85"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <div className={["shrink-0", iconClassName ?? "text-foreground"].join(" ")}>
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {label}
            </p>
            <p className="mt-1 break-all text-sm text-foreground">{value}</p>
          </div>
        </div>
        <span className="inline-flex shrink-0 cursor-pointer items-center self-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground group-hover:underline">
          View all
          <IconArrowLeft className="size-3 rotate-180" />
        </span>
      </div>
    </button>
  )
}

function FindingSheetCard({ finding }: { finding: any }) {
  return (
    <article className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <IconWorldWww className="size-3.5" />
          {finding.source}
        </Badge>
        <Badge className={["gap-1 border-0", severityBadgeClassName(finding.severity)].join(" ")} variant="secondary">
          {severityIcon(finding.severity)}
          {finding.severity}
        </Badge>
        <span className="text-xs font-semibold text-amber-300">
          Score {finding.score.toFixed(1)}
        </span>
      </div>
      <div className="mt-3">
        <h3 className="text-sm font-medium text-foreground">{finding.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {finding.description}
        </p>
      </div>
      <div className="mt-4 grid gap-2 text-sm">
        <LabeledValue
          label="URL"
          value={finding.pageOrFlow ?? "No page context"}
        />
        {finding.suggestedFix ? (
          <LabeledValue
            label="Fix"
            value={finding.suggestedFix}
          />
        ) : null}
      </div>
    </article>
  )
}

function LabeledValue({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="border-t border-border/60 pt-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground/70">
        {label}
      </div>
      <p className="mt-1 break-all text-sm text-foreground">{value}</p>
    </div>
  )
}

function ToneInfoRow({ label, value }: { label: string; value: string }) {
  const toneClassName = summaryToneClassName(label)

  return (
    <div className={["rounded-[1rem] border bg-background/70 p-4", toneClassName].join(" ")}>
      <p className="text-[11px] font-semibold tracking-wider uppercase text-white/60">
        {label}
      </p>
      <p className="mt-1 break-all text-sm text-white">{value}</p>
    </div>
  )
}

function AuditMetric({ label, score }: { label: string; score: number }) {
  const toneClassName = auditToneClassName(label)

  return (
    <div className="rounded-[1rem] border border-border/70 bg-card p-3">
      <p className={["text-[11px] font-semibold tracking-wider uppercase", toneClassName].join(" ")}>
        {label}
      </p>
      <p className={["mt-1 text-sm font-medium", toneClassName].join(" ")}>
        {Math.round(score * 100)}/100
      </p>
    </div>
  )
}

function TrendMetricCard({
  current,
  delta,
  label,
}: {
  current: number | null
  delta: number | null
  label: string
}) {
  const toneClassName = auditToneClassName(label)

  return (
    <div className="rounded-[1rem] border border-border/70 bg-background/70 p-4">
      <p className={["text-[11px] font-semibold tracking-wider uppercase", toneClassName].join(" ")}>
        {label}
      </p>
      <p className={["mt-1 text-lg font-medium", toneClassName].join(" ")}>
        {current === null ? "Pending" : `${Math.round(current * 100)}/100`}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{formatDelta(delta)}</p>
    </div>
  )
}

function formatDelta(delta: number | null) {
  if (delta === null) {
    return "No previous run yet"
  }

  if (delta === 0) {
    return "No change from last run"
  }

  return `${delta > 0 ? "+" : ""}${delta} from last run`
}

function compactUrl(value: string) {
  try {
    const url = new URL(value)
    const path = url.pathname.length > 28 ? `...${url.pathname.slice(-28)}` : url.pathname
    return `${url.hostname}${path}`
  } catch {
    return value
  }
}

function findingSnapshotMeta(finding: any) {
  const title = String(finding.title ?? "").toLowerCase()
  const signal = String(finding.browserSignal ?? "").toLowerCase()

  if (signal === "console" || title.includes("console")) {
    return {
      label: "Console signal",
      icon: <IconTerminal2 className="size-4" />,
      iconClassName: "text-amber-300",
    }
  }

  if (signal === "pageerror" || title.includes("crash") || title.includes("error")) {
    return {
      label: "Runtime issue",
      icon: <IconAlertTriangle className="size-4" />,
      iconClassName: "text-rose-300",
    }
  }

  if (title.includes("redirect")) {
    return {
      label: "Navigation flow",
      icon: <IconArrowLeft className="size-4 rotate-180" />,
      iconClassName: "text-sky-300",
    }
  }

  if (signal === "network") {
    return {
      label: "Network issue",
      icon: <IconWorldWww className="size-4" />,
      iconClassName: "text-sky-300",
    }
  }

  return {
    label: "Archived finding",
    icon: <IconBolt className="size-4" />,
    iconClassName: "text-violet-300",
  }
}

function signalMeta(signal: "console" | "network" | "pageerror") {
  if (signal === "console") {
    return {
      title: "Console logs",
      description: "All persisted console-related issues captured during the run.",
      icon: <IconTerminal2 className="size-4" />,
      iconClassName: "text-amber-300",
    }
  }

  if (signal === "network") {
    return {
      title: "Network issues",
      description: "All persisted network-related issues captured during the run.",
      icon: <IconWorldWww className="size-4" />,
      iconClassName: "text-sky-300",
    }
  }

  return {
    title: "Page errors",
    description: "All persisted page runtime errors captured during the run.",
    icon: <IconAlertTriangle className="size-4" />,
    iconClassName: "text-red-300",
  }
}

function auditToneClassName(label: string) {
  const normalized = label.toLowerCase()

  if (normalized.includes("performance")) return "text-blue-400"
  if (normalized.includes("accessibility")) return "text-emerald-400"
  if (normalized.includes("best")) return "text-amber-400"
  if (normalized.includes("seo")) return "text-violet-400"

  return "text-foreground"
}

function summaryToneClassName(label: string) {
  const normalized = label.toLowerCase()

  if (normalized.includes("perf")) return "border-blue-500/20 text-blue-300"
  if (normalized.includes("browser")) return "border-emerald-500/20 text-emerald-300"
  if (normalized.includes("hygiene")) return "border-amber-500/20 text-amber-300"
  if (normalized.includes("test")) return "border-violet-500/20 text-violet-300"

  return "border-border/70 text-foreground"
}

function severityBadgeClassName(severity: string) {
  if (severity === "critical") return "bg-red-500/15 text-red-300"
  if (severity === "high") return "bg-red-500/15 text-red-300"
  if (severity === "medium") return "bg-blue-500/15 text-blue-300"
  return "bg-muted text-muted-foreground"
}

function severityIcon(severity: string) {
  if (severity === "critical" || severity === "high") {
    return <IconAlertTriangle className="size-3.5" />
  }

  if (severity === "medium") {
    return <IconBolt className="size-3.5" />
  }

  return <IconCheck className="size-3.5" />
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
    <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
      <div className="mb-2 inline-flex size-8 items-center justify-center rounded-xl border border-border/70 bg-background text-foreground">
        {icon}
      </div>
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 leading-6">{body}</p>
    </div>
  )
}
