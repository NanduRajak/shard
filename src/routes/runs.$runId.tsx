import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  IconAlertTriangle,
  IconBolt,
  IconChartBar,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconFileAnalytics,
  IconPhoto,
  IconPlayerPlay,
  IconPlayerStop,
  IconRadar2,
} from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"
import type { ReactNode } from "react"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
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
import { requestRunStop } from "@/lib/request-run-stop"

export const Route = createFileRoute("/runs/$runId")({
  component: RunPage,
})

function RunPage() {
  const { runId } = Route.useParams()
  const typedRunId = runId as Id<"runs">
  const { data: report } = useQuery(
    convexQuery(api.runtime.getRunReport, { runId: typedRunId }),
  )
  const stopMutation = useMutation({
    mutationFn: requestRunStop,
  })

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
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="min-h-72 border border-border/70 bg-card/70" />
        <Card className="min-h-72 border border-border/70 bg-card/70" />
      </div>
    )
  }

  const {
    artifacts,
    currentAuditTrend,
    findings,
    latestReportArtifact,
    performanceAudits,
    run,
    scoreSummary,
    session,
  } = report
  const screenshots = artifacts.filter((artifact) => artifact.type === "screenshot")
  const sortedFindings = findings.slice().sort((left, right) => right.score - left.score)
  const topFindings = sortedFindings.slice(0, 5)
  const sourceScores = Object.entries(scoreSummary.bySource)
  const isActive =
    run.status === "queued" || run.status === "starting" || run.status === "running"
  const liveEmbedUrl = session?.debugUrl
    ? `${session.debugUrl}${session.debugUrl.includes("?") ? "&" : "?"}interactive=false&showControls=false`
    : null

  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <Card className="border border-border/70 bg-card/80 xl:col-span-2">
        <CardHeader className="gap-4 border-b border-border/70">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="tracking-[0.18em] uppercase">
                  QA Run
                </Badge>
                <StatusBadge status={run.status} />
              </div>
              <CardTitle className="text-2xl leading-tight">Live automated QA report</CardTitle>
              <CardDescription className="max-w-3xl break-all text-sm/6">
                {run.url}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-start justify-end gap-2">
              <div className="grid min-w-52 gap-2 sm:grid-cols-2">
                <MetricCard
                  label="Overall score"
                  value={run.finalScore?.toFixed(0) ?? "In progress"}
                />
                <MetricCard
                  label="Findings"
                  value={scoreSummary.counts.findings.toString()}
                />
              </div>
              {isActive ? (
                <Button
                  variant="destructive"
                  className="rounded-2xl"
                  disabled={stopMutation.isPending}
                  onClick={() => {
                    void stopMutation.mutateAsync({ data: { runId: typedRunId } })
                  }}
                >
                  {stopMutation.isPending ? "Stopping..." : "Stop run"}
                  <IconPlayerStop className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 md:grid-cols-4">
          <MetricCard label="Current step" value={run.currentStep ?? "Queued"} />
          <MetricCard label="Current URL" value={run.currentUrl ?? run.url} />
          <MetricCard label="Session" value={session?.status ?? "Not started"} />
          <MetricCard
            label="Started"
            value={formatDistanceToNow(run.startedAt, { addSuffix: true })}
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden border border-border/70 bg-card/80">
        <CardHeader className="gap-3 border-b border-border/70">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconPlayerPlay className="size-4" />
            Live session
          </CardTitle>
          <CardDescription>
            Steel stays embedded while the run is active so the browser can be watched in place.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {isActive && liveEmbedUrl ? (
            <iframe
              title="Steel live session"
              src={liveEmbedUrl}
              sandbox="allow-scripts"
              className="h-[360px] w-full rounded-2xl border border-border/70 bg-background"
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
              {session?.replayUrl
                ? "The live session has ended. Use the replay link below to inspect the final browser recording."
                : "Steel session details have not been created yet."}
            </div>
          )}
          <div className="grid gap-3">
            <InfoRow label="Replay" value={session?.replayUrl ?? "Not available yet"} />
            <InfoRow
              label="Last update"
              value={formatDistanceToNow(run.updatedAt, { addSuffix: true })}
            />
          </div>
          {!isActive && (session?.replayUrl || latestReportArtifact) ? (
            <div className="grid gap-2">
              {session?.replayUrl ? (
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

      <Card className="border border-border/70 bg-card/80">
        <CardHeader className="gap-3 border-b border-border/70">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconBolt className="size-4" />
            Quality summary
          </CardTitle>
          <CardDescription>
            Source-level scores and report totals update in realtime.
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
                  value={`${score.toFixed(0)}/100`}
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

      <Card className="border border-border/70 bg-card/80 xl:col-span-2">
        <CardHeader className="gap-3 border-b border-border/70">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconRadar2 className="size-4" />
            Lighthouse trend
          </CardTitle>
          <CardDescription>
            Score deltas compare this run against the immediately previous run for the same URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-2 xl:grid-cols-4">
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
        </CardContent>
      </Card>

      <Card className="border border-border/70 bg-card/80">
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
            sortedFindings.map((finding) => (
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
                <h3 className="mt-3 text-sm font-medium text-foreground">
                  {finding.title}
                </h3>
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
              title="No findings recorded yet"
              body="This list updates as the browser agent and Lighthouse discover issues."
            />
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/70 bg-card/80">
        <CardHeader className="gap-3 border-b border-border/70">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconChartBar className="size-4" />
            Lighthouse reports
          </CardTitle>
          <CardDescription>
            Focused audits run after exploration finishes or stop early if the run is cancelled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {performanceAudits.length ? (
            performanceAudits.map((audit) => (
              <article
                key={audit._id}
                className="rounded-2xl border border-border/70 bg-background/70 p-4"
              >
                <p className="break-all text-sm font-medium text-foreground">
                  {audit.pageUrl}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <AuditMetric label="Performance" score={audit.performanceScore} />
                  <AuditMetric label="Accessibility" score={audit.accessibilityScore} />
                  <AuditMetric
                    label="Best practices"
                    score={audit.bestPracticesScore}
                  />
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
              title={run.status === "completed" || run.status === "cancelled" ? "No Lighthouse audits stored" : "Audits pending"}
              body={
                run.status === "completed" || run.status === "cancelled"
                  ? "This run ended without stored Lighthouse audit results."
                  : "The performance stage begins after exploration finishes."
              }
            />
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/70 bg-card/80 xl:col-span-2">
        <CardHeader className="gap-3 border-b border-border/70">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconPhoto className="size-4" />
            Screenshot timeline
          </CardTitle>
          <CardDescription>
            Screenshots remain as historical artifacts even though the live panel now uses Steel.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {screenshots.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {screenshots.map((artifact) => (
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
              title="No screenshots yet"
              body="The screenshot timeline populates after meaningful navigation or page changes."
            />
          )}
        </CardContent>
      </Card>

      <Card className="border border-border/70 bg-card/80 xl:col-span-2">
        <CardHeader className="gap-3 border-b border-border/70">
          <CardTitle className="text-base">Top findings snapshot</CardTitle>
          <CardDescription>
            The highest-impact issues and current completion state.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {topFindings.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {topFindings.map((finding) => (
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
                  <p className="mt-3 text-sm font-medium text-foreground">
                    {finding.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {finding.pageOrFlow ?? "No page context"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyStateCopy
              icon={<IconCircleCheck className="size-4" />}
              title="Report summary is still empty"
              body="Once the run records findings, the top issues will be pinned here."
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <dt className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 break-all text-sm font-medium text-foreground">{value}</dd>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 break-all text-sm text-foreground">{value}</p>
    </div>
  )
}

function AuditMetric({ label, score }: { label: string; score: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">
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
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-lg font-medium text-foreground">
        {current === null ? "Pending" : `${Math.round(current * 100)}/100`}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatDelta(delta)}
      </p>
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
