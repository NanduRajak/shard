import { createFileRoute, Link } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { IconArrowRight, IconLayoutDashboard } from "@tabler/icons-react"
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

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
})

function DashboardPage() {
  const { data: runs } = useQuery(convexQuery(api.runtime.getDashboardRuns, {}))

  if (!runs) {
    return <Card className="min-h-72 border border-border/70 bg-card/70" />
  }

  if (runs.length === 0) {
    return (
      <Empty className="min-h-[calc(100svh-12rem)] border border-dashed border-border/70 bg-card/60">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconLayoutDashboard />
          </EmptyMedia>
          <EmptyTitle>Dashboard is waiting on your first real run.</EmptyTitle>
          <EmptyDescription>
            Once scans complete, this page turns into the high-level quality overview.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const completedRuns = runs.filter((item) => item.run.status === "completed").length
  const cancelledRuns = runs.filter((item) => item.run.status === "cancelled").length
  const failedRuns = runs.filter((item) => item.run.status === "failed").length

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <OverviewCard label="Completed" value={completedRuns.toString()} />
        <OverviewCard label="Cancelled" value={cancelledRuns.toString()} />
        <OverviewCard label="Failed" value={failedRuns.toString()} />
      </div>

      <Card className="border border-border/70 bg-card/80">
        <CardHeader className="border-b border-border/70">
          <CardTitle>Recent QA runs</CardTitle>
          <CardDescription>
            Lighthouse deltas compare each run against the previous run on the same URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4">
          {runs.map(({ currentAuditTrend, findingsCount, run }) => (
            <article
              key={run._id}
              className="rounded-2xl border border-border/70 bg-background/70 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={run.status} />
                    <Badge variant="outline">
                      Score {run.finalScore?.toFixed(0) ?? "Pending"}
                    </Badge>
                    <Badge variant="secondary">{findingsCount} findings</Badge>
                  </div>
                  <p className="break-all text-sm font-medium text-foreground">{run.url}</p>
                </div>
                <Link
                  to="/runs/$runId"
                  params={{ runId: run._id }}
                  className={buttonVariants({
                    variant: "outline",
                    className: "rounded-2xl",
                  })}
                >
                  View run
                  <IconArrowRight className="size-4" />
                </Link>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <DashboardMetric
                  label="Performance"
                  current={currentAuditTrend.performance.current}
                  delta={currentAuditTrend.performance.delta}
                />
                <DashboardMetric
                  label="Accessibility"
                  current={currentAuditTrend.accessibility.current}
                  delta={currentAuditTrend.accessibility.delta}
                />
                <DashboardMetric
                  label="Best practices"
                  current={currentAuditTrend.bestPractices.current}
                  delta={currentAuditTrend.bestPractices.delta}
                />
                <DashboardMetric
                  label="SEO"
                  current={currentAuditTrend.seo.current}
                  delta={currentAuditTrend.seo.delta}
                />
              </div>
            </article>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function OverviewCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border border-border/70 bg-card/80">
      <CardContent className="p-5">
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          {label}
        </p>
        <p className="mt-2 text-3xl font-medium text-foreground">{value}</p>
      </CardContent>
    </Card>
  )
}

function DashboardMetric({
  current,
  delta,
  label,
}: {
  current: number | null
  delta: number | null
  label: string
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">
        {current === null ? "Pending" : `${Math.round(current * 100)}/100`}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{formatTrendMetric(delta)}</p>
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
