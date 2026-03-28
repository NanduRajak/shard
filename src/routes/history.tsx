import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  IconTimeline,
  IconTrash,
  IconX,
  IconCheck,
  IconHourglassEmpty,
  IconPlayerPlay,
  IconBrandChrome,
  IconServer,
  IconListCheck,
  IconClock,
  IconSubtask
} from "@tabler/icons-react"
import { formatDistanceToNow } from "date-fns"
import { useState } from "react"
import { toast } from "sonner"
import { motion, type Variants } from "motion/react"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
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
import { describeBrowserProvider, formatSessionDuration } from "@/lib/run-report"
import { env } from "~/env"

export const Route = createFileRoute("/history")({
  component: HistoryPage,
})

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
}

function HistoryPage() {
  const navigate = useNavigate()
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
    return (
      <div className="grid gap-4">
        <Card className="border border-border/70 bg-card/80">
          <CardHeader className="border-b border-border/70">
            <CardTitle>Run history</CardTitle>
            <CardDescription>
              Every terminal run stays explorable, including cancelled sessions with partial artifacts.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 px-2 sm:px-6">
            <div className="grid gap-5 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-[1.35rem] border border-border/70 bg-background/50 p-5 shadow-sm h-full flex flex-col">
                  {/* Top Header & Right Badges */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2 pb-2">
                      <Skeleton className="h-6 w-4/5 bg-border/40" />
                      <Skeleton className="h-4 w-3/4 bg-border/40 mt-3" />
                      <Skeleton className="h-4 w-1/2 bg-border/40" />
                    </div>
                    {/* Top Right */}
                    <div className="flex flex-col items-end gap-2 shrink-0 max-w-[120px]">
                      <Skeleton className="size-8 rounded-full bg-border/40 mb-1" />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Skeleton className="h-6 w-20 rounded-lg bg-border/40" />
                        <Skeleton className="h-6 w-16 rounded-lg bg-border/40" />
                        <Skeleton className="h-6 w-24 rounded-lg bg-border/40" />
                      </div>
                    </div>
                  </div>
                  {/* Grid of metrics mapped to remaining space */}
                  <div className="mt-auto pt-4 grid grid-cols-2 gap-2">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <Skeleton key={j} className="h-16 w-full rounded-xl bg-border/20" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
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
        <CardContent className="pt-4 px-2 sm:px-6">
          <motion.div 
            className="grid gap-5 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3"
            variants={containerVariants}
            initial="hidden"
            animate="show"
          >
            {runs.map(({ currentAuditTrend, latestReportArtifact, latestScreenshot, run, session, sessionDurationMs }) => {
              const isSteelRun = (run.browserProvider ?? "steel") === "steel"
              const hasInstruction = !!run.goalSummary
              const targetUrl = run.status === "queued" || run.status === "starting" || run.status === "running"
                  ? "/runs/$runId"
                  : "/history/$runId"

              return (
                <motion.div
                  key={run._id}
                  variants={itemVariants}
                  onClick={() => navigate({ to: targetUrl, params: { runId: run._id } })}
                  className="group relative cursor-pointer overflow-hidden rounded-[1.35rem] border border-border/70 bg-background/50 hover:bg-background/80 transition-colors duration-300 p-5 shadow-sm h-full flex flex-col"
                >
                  <div className="flex items-start justify-between gap-5 pb-4">
                    {/* Left: Header Block */}
                    <div className="flex-1 space-y-2 min-w-0">
                      <h3 className="line-clamp-3 text-[1.05rem] font-semibold text-foreground tracking-tight leading-snug">
                        {hasInstruction ? run.goalSummary : run.url}
                      </h3>
                      <div className="flex flex-col gap-1.5 text-[13px] text-muted-foreground/80 pt-1">
                        {hasInstruction && (
                          <span className="truncate w-full block bg-background/40 py-1 px-2 rounded-md border border-border/40">{run.url}</span>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className="flex items-center gap-1 whitespace-nowrap px-1.5 py-[3px] rounded bg-muted/30 border border-border/30 text-xs font-medium text-muted-foreground/90">
                            <IconClock className="size-[14px] opacity-70" stroke={2.5} />
                            {formatDistanceToNow(run.startedAt, { addSuffix: true })}
                          </span>
                          
                          <span className="flex items-center gap-1 whitespace-nowrap px-1.5 py-[3px] rounded bg-muted/30 border border-border/30 text-xs font-medium text-muted-foreground/90 capitalize">
                            <IconBrandChrome className="size-[14px] opacity-70" stroke={2} />
                            {describeBrowserProvider(run.browserProvider)}
                          </span>

                          <span className="flex items-center gap-1 whitespace-nowrap px-1.5 py-[3px] rounded bg-muted/30 border border-border/30 text-xs font-medium text-muted-foreground/90 capitalize">
                            <IconSubtask className="size-[14px] opacity-70" stroke={2} />
                            {run.mode}
                          </span>

                          {run.executionMode === "background" && (
                            <span className="flex items-center gap-1 whitespace-nowrap px-1.5 py-[3px] rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-medium">
                              <IconServer className="size-[14px]" stroke={2} />
                              Background
                            </span>
                          )}

                          {run.goalStatus && run.goalStatus !== "not_requested" && (
                            <span className="flex items-center gap-1 whitespace-nowrap px-1.5 py-[3px] rounded bg-muted/30 border border-border/30 text-xs font-medium text-muted-foreground/90 capitalize">
                              <IconListCheck className="size-[14px] opacity-70" stroke={2} />
                              {run.goalStatus.replaceAll("_", " ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Essential Badges Group */}
                    <div className="flex flex-col items-end gap-2 shrink-0 max-w-[120px] relative z-10">
                      {/* Delete icon first */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors -mr-1"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteTarget({
                            id: run._id,
                            label: run.url,
                          })
                        }}
                      >
                        <IconTrash className="size-4" />
                        <span className="sr-only">Delete action</span>
                      </Button>
                      
                      {/* Essential Badges aligned right */}
                      <div className="flex flex-col items-end gap-1.5 mt-[-4px]">
                        <StatusBadge status={run.status} />
                        <Badge variant="outline" className="gap-1 border-border/60 bg-background/50 rounded-lg py-1 px-2.5 shadow-none text-muted-foreground font-semibold uppercase text-[10px] tracking-wider">
                          SCORE {run.finalScore?.toFixed(0) ?? "PENDING"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Minimal Metrics Grid aligned to bottom */}
                  <div className="mt-auto grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3 gap-2 pt-2">
                    <HistoryMetric
                      label="Performance"
                      value={formatTrendMetric(currentAuditTrend.performance.delta)}
                    />
                    <HistoryMetric
                      label="Accessibility"
                      value={formatTrendMetric(currentAuditTrend.accessibility.delta)}
                    />
                    <HistoryMetric
                      label={isSteelRun ? "Replay" : "Screenshot"}
                      value={
                        isSteelRun
                          ? session?.replayUrl
                            ? "Available"
                            : "Missing"
                          : latestScreenshot
                            ? "Available"
                            : "Missing"
                      }
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
                </motion.div>
              )
            })}
          </motion.div>
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
    <div className="rounded-xl border border-border/40 bg-black/20 p-2.5 transition-colors group-hover:bg-black/40">
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground/80 uppercase mb-1 drop-shadow-sm">
        {label}
      </p>
      <p className="text-sm font-medium text-foreground/90">{value}</p>
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
      <Badge variant="destructive" className="items-center gap-1 bg-red-500/15 text-red-500 hover:bg-red-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none">
        <IconX className="size-3.5" stroke={2.5} />
        FAILED
      </Badge>
    )
  }

  if (status === "completed") {
    return (
      <Badge className="items-center gap-1 bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none" variant="secondary">
        <IconCheck className="size-3.5" stroke={2.5} />
        COMPLETED
      </Badge>
    )
  }

  if (status === "running" || status === "starting") {
    return (
      <Badge className="items-center gap-1 bg-sky-500/15 text-sky-400 hover:bg-sky-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none" variant="secondary">
        <IconPlayerPlay className="size-3.5 animate-pulse" stroke={2.5} />
        RUNNING
      </Badge>
    )
  }

  if (status === "cancelled") {
    return (
      <Badge className="items-center gap-1 bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none" variant="secondary">
        <IconX className="size-3.5" stroke={2.5} />
        CANCELLED
      </Badge>
    )
  }

  return (
    <Badge className="items-center gap-1 bg-yellow-500/15 text-yellow-500 hover:bg-yellow-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none uppercase" variant="secondary">
      <IconHourglassEmpty className="size-3.5" stroke={2.5} />
      PENDING
    </Badge>
  )
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
