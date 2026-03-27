import { createFileRoute, Link } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { IconArrowRight, IconTimeline } from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"
import { api } from "../../convex/_generated/api"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export const Route = createFileRoute("/history")({
  component: HistoryPage,
})

function HistoryPage() {
  const { data: runs } = useQuery(convexQuery(api.runtime.listRuns, {}))

  if (!runs) {
    return <Card className="min-h-72 border border-border/70 bg-card/70" />
  }

  if (runs.length === 0) {
    return (
      <Empty className="min-h-[calc(100svh-12rem)] border border-dashed border-border/70 bg-card/60">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconTimeline />
          </EmptyMedia>
          <EmptyTitle>No runs yet.</EmptyTitle>
          <EmptyDescription>
            Completed, failed, and cancelled runs will collect here once the agent starts scanning sites.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="grid gap-4">
      <Card className="border border-border/70 bg-card/80">
        <CardHeader className="border-b border-border/70">
          <CardTitle>Run history</CardTitle>
          <CardDescription>
            Every terminal run stays explorable, including cancelled sessions with partial artifacts.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4">
          {runs.map(({ currentAuditTrend, latestReportArtifact, run, session }) => (
            <article
              key={run._id}
              className="rounded-2xl border border-border/70 bg-background/70 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={run.status} />
                    <Badge variant="outline">{run.finalScore?.toFixed(0) ?? "Pending"}</Badge>
                  </div>
                  <p className="break-all text-sm font-medium text-foreground">{run.url}</p>
                  <p className="text-sm text-muted-foreground">
                    Started {formatDistanceToNow(run.startedAt, { addSuffix: true })}
                  </p>
                </div>
                <Link
                  to="/history/$runId"
                  params={{ runId: run._id }}
                  className={buttonVariants({
                    variant: "outline",
                    className: "rounded-2xl",
                  })}
                >
                  Open report
                  <IconArrowRight className="size-4" />
                </Link>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <HistoryMetric
                  label="Performance"
                  value={formatTrendMetric(currentAuditTrend.performance.delta)}
                />
                <HistoryMetric
                  label="Accessibility"
                  value={formatTrendMetric(currentAuditTrend.accessibility.delta)}
                />
                <HistoryMetric
                  label="Replay"
                  value={session?.replayUrl ? "Available" : "Missing"}
                />
                <HistoryMetric
                  label="Report artifact"
                  value={latestReportArtifact ? "Available" : "Missing"}
                />
              </div>
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function HistoryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
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

function formatTrendMetric(delta: number | null) {
  if (delta === null) {
    return "No baseline"
  }

  if (delta === 0) {
    return "No change"
  }

  return `${delta > 0 ? "+" : ""}${delta} from last run`
}
