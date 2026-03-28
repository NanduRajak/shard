import { useNavigate } from "@tanstack/react-router"
import { motion, type Variants } from "motion/react"
import { useState, Fragment } from "react"
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBolt,
  IconChartBar,
  IconCircleCheck,
  IconExternalLink,
  IconFileAnalytics,
  IconPhoto,
  IconPlayerPlay,
  IconRadar2,
  IconX,
  IconCheck,
  IconHourglassEmpty,
} from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"
import type { ReactNode } from "react"
import { SteelReplayPlayer } from "@/components/steel-replay-player"
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
import { describeBrowserProvider, formatSessionDuration } from "@/lib/run-report"

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

  return (
    <motion.div 
      className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={itemVariants} className="xl:col-span-2">
        <Card className="border border-border/70 bg-card/80">
          <CardHeader className="gap-4 border-b border-border/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="icon" 
                    className="size-7 rounded-sm text-foreground/80 hover:bg-background/80 transition-colors bg-background/50 border-border/70 mr-0.5"
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
              </div>
              <div className="grid min-w-52 gap-2 sm:grid-cols-2">
                <MetricCard
                  label="Overall score"
                  value={run.finalScore?.toFixed(0) ?? scoreSummary.overall.toFixed(0)}
                />
                <MetricCard label="Findings" value={scoreSummary.counts.findings.toString()} />
              </div>
            </div>
            
            <div className="flex h-9 items-center rounded-lg bg-background border border-border/70 p-[3px] text-muted-foreground mt-4 mb-2 w-fit shadow-sm relative">
              <button
                onClick={() => setActiveTab("report")}
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
                Timeline
              </button>
            </div>
          </CardHeader>
          
          {activeTab === "report" && (
            <CardContent className="grid gap-4 pt-4 md:grid-cols-5">
              <MetricCard label="Final step" value={run.currentStep ?? "Finished"} />
              <MetricCard label="Last URL" value={run.currentUrl ?? run.url} />
              <MetricCard
                label="Browser backend"
                value={describeBrowserProvider(run.browserProvider)}
              />
              <MetricCard label="Session" value={session?.status ?? "Not started"} />
              <MetricCard label="Run mode" value={run.mode} />
              <MetricCard label="Session duration" value={formatSessionDuration(sessionDurationMs)} />
              {run.instructions ? (
                <div className="rounded-[1.1rem] border border-border/70 bg-background/70 p-4 md:col-span-5">
                  <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Task instructions
                  </p>
                  <p className="mt-2 text-[14px] leading-relaxed text-foreground/90">{run.instructions}</p>
                </div>
              ) : null}
              {run.goalStatus && run.goalStatus !== "not_requested" ? (
                <div className="rounded-[1.1rem] border border-border/70 bg-background/70 p-4 md:col-span-5">
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
          <motion.div variants={itemVariants} className="xl:col-span-2 flex h-full">
            <Card className="border border-border/70 bg-card/80 w-full">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconCheck className="size-4" />
                  Actionable Summary
                </CardTitle>
                <CardDescription>
                  The shortest path to what a QA engineer should inspect next.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 pt-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Critical" value={criticalFindings.length.toString()} />
                <MetricCard label="High" value={highFindings.length.toString()} />
                <MetricCard
                  label="Coverage routes"
                  value={(coverageUrls?.length ?? 0).toString()}
                />
                <MetricCard
                  label="Task status"
                  value={
                    run.goalStatus && run.goalStatus !== "not_requested"
                      ? run.goalStatus.replaceAll("_", " ")
                      : run.mode === "task"
                        ? "Not proven"
                        : "Exploration"
                  }
                />
                <div className="rounded-[1.1rem] border border-border/70 bg-background/70 p-4 md:col-span-2 xl:col-span-4">
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
        <Card className="overflow-hidden border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconPlayerPlay className="size-4" />
              Session archive
            </CardTitle>
            <CardDescription>
              Replay and artifact links stay attached to the archived run for later review.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <EmptyStateCopy
              icon={<IconCircleCheck className="size-4" />}
              title={
                isSteelRun
                  ? session?.replayUrl
                    ? "Replay is available"
                    : "No replay stored"
                  : screenshots.length
                    ? "Session artifacts are available"
                    : "No session replay stored"
              }
              body={
                isSteelRun
                  ? session?.replayUrl
                    ? "The active browser session has been archived. Open the Steel replay or the latest HTML report below."
                    : "This run finished without a stored Steel replay URL."
                  : screenshots.length
                    ? "This local Chrome run finished with captured screenshots and the same shared QA report format."
                    : "This local Chrome run finished without a replay stream. Review findings, screenshots, and report artifacts below."
              }
            />
            <div className="grid gap-3">
              <InfoRow
                label={isSteelRun ? "Replay" : "Latest screenshot"}
                value={
                  isSteelRun
                    ? session?.replayUrl ?? "Not available yet"
                    : screenshots[0]?.url ?? "Not available yet"
                }
              />
              <InfoRow label="Duration" value={formatSessionDuration(sessionDurationMs)} />
              <InfoRow
                label="Last update"
                value={formatDistanceToNow(run.updatedAt, { addSuffix: true })}
              />
            </div>
            {isSteelRun && session?.externalSessionId ? (
              <SteelReplayPlayer sessionId={session.externalSessionId} />
            ) : null}
            {session?.replayUrl || latestReportArtifact || (!isSteelRun && screenshots[0]?.url) ? (
              <div className="grid gap-2">
                {isSteelRun && session?.replayUrl ? (
                  <a
                    href={session.replayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({
                      variant: "outline",
                      className: "w-full justify-between rounded-2xl",
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
                      className: "w-full justify-between rounded-2xl",
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
                      className: "w-full justify-between rounded-2xl",
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
              <IconBolt className="size-4" />
              Quality summary
            </CardTitle>
            <CardDescription>
              Source-level scores and report totals for the archived run.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                label="Performance audits"
                value={scoreSummary.counts.performanceAudits.toString()}
              />
              <MetricCard
                label="Screenshots"
                value={scoreSummary.counts.screenshots.toString()}
              />
            </div>
            {sourceScores.length ? (
              <div className="grid gap-3">
                {sourceScores.map(([source, score]) => (
                  <InfoRow
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
        <Card className="border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="text-base">Browser signals</CardTitle>
            <CardDescription>
              Console, network, and page runtime issues captured during the run.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-4">
            <InfoRow label="Console issues" value={consoleFindings.length.toString()} />
            <InfoRow label="Network issues" value={networkFindings.length.toString()} />
            <InfoRow label="Page errors" value={pageErrorFindings.length.toString()} />
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="xl:col-span-2 flex h-full">
        <Card className="border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconRadar2 className="size-4" />
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

      <motion.div variants={itemVariants} className="flex h-full">
        <Card className="border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconAlertTriangle className="size-4" />
              Findings
            </CardTitle>
            <CardDescription>
              Browser and Lighthouse issues sorted by highest penalty first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {sortedFindings.length ? (
              sortedFindings.map((finding: any) => (
                <article
                  key={finding._id}
                  className="rounded-2xl border border-border/70 bg-background/70 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{finding.source}</Badge>
                    <Badge variant="secondary">{finding.severity}</Badge>
                    <span className="text-xs text-muted-foreground">
                      Score {finding.score.toFixed(1)}
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-medium text-foreground">{finding.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {finding.description}
                  </p>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                    <span>{finding.pageOrFlow ?? "No page context"}</span>
                    {finding.suggestedFix ? <span>{finding.suggestedFix}</span> : null}
                  </div>
                </article>
              ))
            ) : (
              <EmptyStateCopy
                icon={<IconCircleCheck className="size-4" />}
                title="No findings recorded"
                body="This run finished without persisted browser or Lighthouse findings."
              />
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={itemVariants} className="flex h-full">
        <Card className="border border-border/70 bg-card/80 w-full">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconChartBar className="size-4" />
              Lighthouse reports
            </CardTitle>
            <CardDescription>
              Stored performance reports from the autonomous QA workflow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {(performanceAudits as any[]).length ? (
              (performanceAudits as any[]).map((audit: any) => (
                <article
                  key={audit._id}
                  className="rounded-2xl border border-border/70 bg-background/70 p-4"
                >
                  <p className="break-all text-sm font-medium text-foreground">{audit.pageUrl}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                        className: "mt-3 w-full justify-between rounded-2xl",
                      })}
                    >
                      Open HTML report
                      <IconExternalLink className="size-4" />
                    </a>
                  ) : null}
                </article>
              ))
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
              <IconPhoto className="size-4" />
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
                    className="space-y-3 rounded-2xl border border-border/70 bg-background/70 p-3"
                  >
                    {artifact.url ? (
                      <img
                        alt={artifact.title ?? "Run screenshot"}
                        src={artifact.url}
                        className="h-48 w-full rounded-xl border border-border/70 object-cover"
                      />
                    ) : (
                      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border/70 text-sm text-muted-foreground">
                        Processing screenshot
                      </div>
                    )}
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {artifact.title ?? "Screenshot"}
                      </p>
                      <p className="break-all text-xs text-muted-foreground">
                        {artifact.pageUrl ?? "No page URL"}
                      </p>
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

      <motion.div variants={itemVariants} className="xl:col-span-2 flex h-full mb-10">
        <Card className="border border-border/70 bg-card/80 w-full mb-2">
          <CardHeader className="gap-3 border-b border-border/70">
            <CardTitle className="text-base">Top findings snapshot</CardTitle>
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
                      <Badge variant="outline">{finding.severity}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {finding.score.toFixed(1)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-medium text-foreground">{finding.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {finding.pageOrFlow ?? "No page context"}
                    </p>
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
        </Fragment>
      ) : (
        <RunTimelineView report={report} />
      )}
    </motion.div>
  )
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 break-all text-sm text-foreground">{value}</p>
    </div>
  )
}

function AuditMetric({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{Math.round(score * 100)}/100</p>
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
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-lg font-medium text-foreground">
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
