import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  IconArrowRight,
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
import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { motion, type Variants } from "motion/react"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
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
import { describeBrowserProvider } from "@/lib/run-report"
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

const RUNS_PER_PAGE = 10

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
  const [page, setPage] = useState(1)
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
        <div className="space-y-1 px-1">
          <h1 className="text-2xl font-semibold tracking-tight">Run history</h1>
          <p className="text-sm text-muted-foreground">
            Every terminal run stays explorable, including cancelled sessions with partial artifacts.
          </p>
        </div>
        <div className="overflow-hidden rounded-[1.5rem] border border-border/60 bg-card/80">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border-b border-border/50 px-4 py-4 last:border-b-0 sm:px-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="space-y-3 xl:min-w-0 xl:flex-1">
                  <Skeleton className="h-6 w-3/4 bg-border/40" />
                  <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-6 w-24 rounded-md bg-border/40" />
                    <Skeleton className="h-6 w-24 rounded-md bg-border/40" />
                    <Skeleton className="h-6 w-24 rounded-md bg-border/40" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[320px]">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-14 w-full rounded-2xl bg-border/20" />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
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

  const totalPages = Math.max(1, Math.ceil(runs.length / RUNS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const pagedRuns = runs.slice(
    (currentPage - 1) * RUNS_PER_PAGE,
    currentPage * RUNS_PER_PAGE,
  )
  const paginationItems = buildPaginationItems(currentPage, totalPages)

  return (
    <div className="grid gap-4">
      <div className="space-y-1 px-1">
        <h1 className="text-2xl font-semibold tracking-tight">Run history</h1>
        <p className="text-sm text-muted-foreground">
          Every terminal run stays explorable, including cancelled sessions with partial artifacts.
        </p>
      </div>
      <div className="overflow-hidden rounded-[1.5rem] border border-border/60 bg-card/80">
        <motion.div
          className="divide-y divide-border/50"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
            {pagedRuns.map(({ currentAuditTrend, latestReportArtifact, latestScreenshot, run, session }) => {
              const hasInstruction = !!run.goalSummary
              const targetUrl = run.status === "queued" || run.status === "starting" || run.status === "running"
                  ? "/runs/$runId"
                  : "/history/$runId"

              return (
                <motion.div
                  key={run._id}
                  variants={itemVariants}
                  onClick={() => navigate({ to: targetUrl, params: { runId: run._id } })}
                  className="group cursor-pointer px-4 py-4 transition-colors duration-200 hover:bg-muted/20 sm:px-5"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0 space-y-3 xl:flex-1">
                      <div className="flex items-center gap-3">
                        <span className={statusDotClassName(run.status)} />
                        <h3 className="truncate text-lg font-semibold tracking-tight text-foreground">
                          {hasInstruction ? run.goalSummary : run.url}
                        </h3>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {hasInstruction && (
                          <Badge variant="outline" className="max-w-full truncate rounded-md border-border/50 bg-background/70 px-3 py-1 font-normal text-muted-foreground">
                            {run.url}
                          </Badge>
                        )}
                        <StatusBadge status={run.status} />
                        <MetaBadge icon={<IconClock className="size-3.5" stroke={2.2} />}>
                          {formatDistanceToNow(run.startedAt, { addSuffix: true })}
                        </MetaBadge>
                        <MetaBadge icon={<IconBrandChrome className="size-3.5" stroke={2} />}>
                          {describeBrowserProvider(run.browserProvider)}
                        </MetaBadge>
                        <MetaBadge icon={<IconSubtask className="size-3.5" stroke={2} />}>
                          {run.mode}
                        </MetaBadge>
                        {run.executionMode === "background" && (
                          <Badge className="rounded-md border border-indigo-500/25 bg-indigo-500/10 px-3 py-1 text-indigo-300" variant="outline">
                            <IconServer className="size-3.5" stroke={2} />
                            Background
                          </Badge>
                        )}
                        {run.goalStatus && run.goalStatus !== "not_requested" && (
                          <Badge variant="outline" className="rounded-md border-border/50 bg-background/70 px-3 py-1 capitalize text-muted-foreground">
                            <IconListCheck className="size-3.5" stroke={2} />
                            {run.goalStatus.replaceAll("_", " ")}
                          </Badge>
                        )}
                        {!session?.replayUrl && !latestScreenshot && !latestReportArtifact ? null : (
                          <Badge variant="outline" className="rounded-md border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                            Artifacts ready
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 xl:items-end">
                      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 rounded-md text-red-400 hover:bg-destructive/10 hover:text-red-300"
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
                        <Button variant="outline" className="rounded-md border-border/60 bg-background/70 px-4">
                          {run.status === "queued" || run.status === "starting" || run.status === "running" ? "Monitor" : "Report"}
                          <IconArrowRight className="size-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-white/14 bg-transparent sm:grid-cols-4 xl:min-w-[360px]">
                        <ScoreCell
                          label="Perf"
                          value={currentAuditTrend.performance.current}
                          toneClassName="text-blue-400"
                          className="border-b border-white/16 sm:border-b-0 sm:border-r"
                        />
                        <ScoreCell
                          label="A11y"
                          value={currentAuditTrend.accessibility.current}
                          toneClassName="text-emerald-400"
                          className="border-b border-white/16 sm:border-b-0 sm:border-r"
                        />
                        <ScoreCell
                          label="BP"
                          value={currentAuditTrend.bestPractices.current}
                          toneClassName="text-amber-400"
                          className="sm:border-r sm:border-white/16"
                        />
                        <ScoreCell
                          label="SEO"
                          value={currentAuditTrend.seo.current}
                          toneClassName="text-violet-400"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
        </motion.div>
      </div>

      {totalPages > 1 ? (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#history-pagination"
                text="Previous"
                className="rounded-md"
                aria-disabled={currentPage === 1}
                onClick={(event) => {
                  event.preventDefault()
                  if (currentPage > 1) {
                    setPage(currentPage - 1)
                  }
                }}
              />
            </PaginationItem>
            {paginationItems.map((item, index) => (
              <PaginationItem key={`${item}-${index}`}>
                {item === "ellipsis" ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationLink
                    href="#history-pagination"
                    isActive={item === currentPage}
                    className="rounded-md"
                    onClick={(event) => {
                      event.preventDefault()
                      setPage(item)
                    }}
                  >
                    {item}
                  </PaginationLink>
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href="#history-pagination"
                text="Next"
                className="rounded-md"
                aria-disabled={currentPage === totalPages}
                onClick={(event) => {
                  event.preventDefault()
                  if (currentPage < totalPages) {
                    setPage(currentPage + 1)
                  }
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : null}
      
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

function ScoreCell({
  label,
  value,
  className,
  toneClassName,
}: {
  label: string
  value: number | null
  className?: string
  toneClassName?: string
}) {
  return (
    <div className={["px-3 py-2.5 text-center", className].filter(Boolean).join(" ")}>
      <p className={["text-[10px] font-semibold uppercase tracking-[0.22em]", toneClassName ?? "text-muted-foreground/70"].filter(Boolean).join(" ")}>
        {label}
      </p>
      <p className={["mt-1 text-2xl font-semibold tracking-tight", toneClassName ?? "text-foreground"].filter(Boolean).join(" ")}>
        {formatAuditScore(value)}
      </p>
    </div>
  )
}

function MetaBadge({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <Badge variant="outline" className="rounded-md border-border/50 bg-background/70 px-3 py-1 font-normal text-muted-foreground">
      {icon}
      {children}
    </Badge>
  )
}

function StatusBadge({
  status,
}: {
  status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting"
}) {
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="items-center gap-1 rounded-md border-0 bg-red-500/15 px-3 py-1 text-red-400 shadow-none hover:bg-red-500/25">
        <IconX className="size-3.5" stroke={2.5} />
        FAILED
      </Badge>
    )
  }

  if (status === "completed") {
    return (
      <Badge className="items-center gap-1 rounded-md border-0 bg-teal-500/15 px-3 py-1 text-teal-300 shadow-none hover:bg-teal-500/25" variant="secondary">
        <IconCheck className="size-3.5" stroke={2.5} />
        COMPLETED
      </Badge>
    )
  }

  if (status === "running" || status === "starting") {
    return (
      <Badge className="items-center gap-1 rounded-md border-0 bg-sky-500/15 px-3 py-1 text-sky-300 shadow-none hover:bg-sky-500/25" variant="secondary">
        <IconPlayerPlay className="size-3.5 animate-pulse" stroke={2.5} />
        RUNNING
      </Badge>
    )
  }

  if (status === "cancelled") {
    return (
      <Badge className="items-center gap-1 rounded-md border-0 bg-amber-500/15 px-3 py-1 text-amber-400 shadow-none hover:bg-amber-500/25" variant="secondary">
        <IconX className="size-3.5" stroke={2.5} />
        CANCELLED
      </Badge>
    )
  }

  return (
    <Badge className="items-center gap-1 rounded-md border-0 bg-yellow-500/15 px-3 py-1 text-yellow-400 shadow-none uppercase hover:bg-yellow-500/25" variant="secondary">
      <IconHourglassEmpty className="size-3.5" stroke={2.5} />
      PENDING
    </Badge>
  )
}

function formatAuditScore(value: number | null) {
  if (value === null) {
    return "--"
  }

  return Math.round(value * 100).toString()
}

function statusDotClassName(status: "cancelled" | "completed" | "failed" | "queued" | "running" | "starting") {
  if (status === "completed") return "h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.5)]"
  if (status === "failed") return "h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.45)]"
  if (status === "running" || status === "starting") return "h-2.5 w-2.5 rounded-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.5)]"
  if (status === "cancelled") return "h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]"
  return "h-2.5 w-2.5 rounded-full bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.45)]"
}

function buildPaginationItems(currentPage: number, totalPages: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, "ellipsis", totalPages] as const
  }

  if (currentPage >= totalPages - 2) {
    return [1, "ellipsis", totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as const
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages] as const
}
