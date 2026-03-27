import { createFileRoute, Link } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconArrowRight, IconTimeline, IconTrash } from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"
import { useState } from "react"
import { toast } from "sonner"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { deleteRun } from "@/lib/delete-run"
import { formatSessionDuration } from "@/lib/run-report"
import { env } from "~/env"

export const Route = createFileRoute("/history")({
  component: HistoryPage,
})

function HistoryPage() {
  const {
    data: runs,
    error,
    isPending,
  } = useQuery(convexQuery(api.runtime.listRuns, {}))
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"runs">
    label: string
  } | null>(null)
  const deleteMutation = useMutation({
    mutationFn: deleteRun,
  })

  const handleDelete = async () => {
    if (!deleteTarget) {
      return
    }

    try {
      await deleteMutation.mutateAsync({
        data: { runId: deleteTarget.id },
      })
      toast.success("Run report deleted.")
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete run report.")
    }
  }

  if (isPending) {
    return <Card className="min-h-72 border border-border/70 bg-card/70" />
  }

  if (error) {
    return (
      <Card className="border border-destructive/30 bg-card/80">
        <CardHeader>
          <CardTitle>Unable to load run history</CardTitle>
          <CardDescription>
            {error instanceof Error ? error.message : "The history query failed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connected backend: {new URL(env.VITE_CONVEX_URL).host}
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!runs || runs.length === 0) {
    return (
      <Empty className="min-h-[calc(100svh-12rem)] border border-dashed border-border/70 bg-card/60">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconTimeline />
          </EmptyMedia>
          <EmptyTitle>No runs yet.</EmptyTitle>
          <EmptyDescription>
            Runs from this shared backend will appear here once the agent starts scanning sites.
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
          {runs.map(({ currentAuditTrend, latestReportArtifact, run, session, sessionDurationMs }) => (
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{run.mode}</Badge>
                    {run.goalStatus && run.goalStatus !== "not_requested" ? (
                      <Badge variant="outline">{run.goalStatus.replaceAll("_", " ")}</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to={
                      run.status === "queued" ||
                      run.status === "starting" ||
                      run.status === "running"
                        ? "/runs/$runId"
                        : "/history/$runId"
                    }
                    params={{ runId: run._id }}
                    className={buttonVariants({
                      variant: "outline",
                      className: "rounded-2xl",
                    })}
                  >
                    {run.status === "queued" ||
                    run.status === "starting" ||
                    run.status === "running"
                      ? "View live run"
                      : "Open report"}
                    <IconArrowRight className="size-4" />
                  </Link>
                  <Button
                    variant="destructive"
                    className="rounded-2xl"
                    onClick={() => {
                      setDeleteTarget({
                        id: run._id,
                        label: run.url,
                      })
                    }}
                  >
                    <IconTrash className="size-4" />
                    Delete
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-5">
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
                <HistoryMetric
                  label="Duration"
                  value={formatSessionDuration(sessionDurationMs)}
                />
              </div>
              {run.goalSummary ? (
                <p className="mt-4 text-sm leading-6 text-muted-foreground">{run.goalSummary}</p>
              ) : null}
            </article>
          ))}
        </CardContent>
      </Card>
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogContent className="rounded-[1.4rem]">
          <DialogHeader>
            <DialogTitle>Delete run report</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `This permanently deletes the report, screenshots, session metadata, and related artifacts for ${deleteTarget.label}.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => void handleDelete()}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
