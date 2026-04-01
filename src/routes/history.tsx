import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  IconArrowRight,
  IconTimeline,
  IconTrash,
} from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { motion, type Variants } from "motion/react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { deleteRun } from "@/lib/delete-run";
import { describeBrowserProvider } from "@/lib/run-report";
import { env } from "~/env";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 340, damping: 26 },
  },
};

const RUNS_PER_PAGE = 10;

function HistoryPage() {
  const navigate = useNavigate();
  const {
    data: runs,
    error,
    isPending,
  } = useQuery(convexQuery(api.runtime.listRuns, {}));
  const [deleteTarget, setDeleteTarget] = useState<{
    id: Id<"runs">;
    label: string;
  } | null>(null);
  const [page, setPage] = useState(1);
  const deleteMutation = useMutation({
    mutationFn: deleteRun,
  });

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    try {
      await deleteMutation.mutateAsync({
        data: { runId: deleteTarget.id },
      });
      toast.success("Run report deleted.");
      setDeleteTarget(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete run report.",
      );
    }
  };

  if (isPending) {
    return (
      <div className="grid gap-5">
        <div className="flex items-start justify-between px-0.5">
          <div className="space-y-1">
            <Skeleton className="h-6 w-36 bg-border/40" />
            <Skeleton className="h-4 w-80 bg-border/30" />
          </div>
          <Skeleton className="h-6 w-14 rounded-full bg-border/30" />
        </div>
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/80">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="border-b border-border/40 px-6 py-4 last:border-b-0"
            >
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-64 bg-border/40" />
                  <Skeleton className="h-3 w-96 bg-border/25" />
                </div>
                <div className="hidden sm:flex">
                  <Skeleton className="h-10 w-52 rounded-lg bg-border/20" />
                </div>
                <div className="flex gap-1.5">
                  <Skeleton className="h-8 w-8 rounded-md bg-border/25" />
                  <Skeleton className="h-8 w-20 rounded-md bg-border/25" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border border-destructive/30 bg-card/80">
        <CardHeader>
          <CardTitle>Unable to load run history</CardTitle>
          <CardDescription>
            {error instanceof Error
              ? error.message
              : "The history query failed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connected backend: {new URL(env.VITE_CONVEX_URL).host}
          </p>
        </CardContent>
      </Card>
    );
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
            Runs from this shared backend will appear here once the agent starts
            scanning sites.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const totalPages = Math.max(1, Math.ceil(runs.length / RUNS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const pagedRuns = runs.slice(
    (currentPage - 1) * RUNS_PER_PAGE,
    currentPage * RUNS_PER_PAGE,
  );
  const paginationItems = buildPaginationItems(currentPage, totalPages);

  return (
    <div className="grid gap-5">
      {/* Page header */}
      <div className="flex items-start justify-between px-0.5">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold tracking-tight">Run history</h1>
          <p className="text-sm text-muted-foreground">
            Every terminal run stays explorable, including cancelled sessions
            with partial artifacts.
          </p>
        </div>
        <Badge
          variant="secondary"
          className="mt-0.5 rounded-full px-2.5 py-0.5 text-xs tabular-nums font-medium"
        >
          {runs.length}
        </Badge>
      </div>

      {/* Run list */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/80">
        <motion.div
          className="divide-y divide-border/40"
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {pagedRuns.map(
            ({
              currentAuditTrend,
              latestReportArtifact,
              latestScreenshot,
              run,
              session,
            }) => {
              const hasInstruction = !!run.goalSummary;
              const isActive =
                run.status === "queued" ||
                run.status === "starting" ||
                run.status === "running";
              const targetUrl = isActive ? "/runs/$runId" : "/history/$runId";

              return (
                <motion.div
                  key={run._id}
                  variants={itemVariants}
                  onClick={() =>
                    navigate({ to: targetUrl, params: { runId: run._id } })
                  }
                  className="group cursor-pointer p-6 transition-colors hover:bg-white/[0.025]"
                >
                  <div className="flex items-center gap-4 xl:gap-6">
                    {/* Thumbnail */}
                    <RunThumbnail
                      url={run.url}
                      screenshotUrl={latestScreenshot?.url}
                    />

                    {/* Left: main info */}
                    <div className="min-w-0 flex-1 space-y-2.5">
                      {/* URL / title */}
                      <div className="flex min-w-0 items-baseline gap-2.5">
                        {hasInstruction ? (
                          <span className="truncate text-[13px] font-medium text-foreground leading-snug">
                            {run.goalSummary}
                          </span>
                        ) : (
                          <PrettyUrl url={run.url} />
                        )}
                        {hasInstruction && (
                          <PrettyUrl url={run.url} className="hidden lg:flex" muted />
                        )}
                      </div>

                      {/* Inline meta row */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs leading-none">
                        {/* Status dot — primary state */}
                        <StatusDot status={run.status} />

                        {/* Time — plain muted text, no badge */}
                        <span className="text-muted-foreground/60">
                          {formatDistanceToNow(run.startedAt, {
                            addSuffix: true,
                          })}
                        </span>

                        {/* Categorical tags — pill badges */}
                        <MetaTag>{describeBrowserProvider(run.browserProvider)}</MetaTag>
                        <MetaTag>{run.mode}</MetaTag>

                        {run.executionMode === "background" && (
                          <MetaTag className="border-indigo-500/25 bg-indigo-500/10 text-indigo-400">
                            Background
                          </MetaTag>
                        )}

                        {run.goalStatus &&
                          run.goalStatus !== "not_requested" && (
                            <MetaTag className="capitalize">
                              {run.goalStatus.replaceAll("_", " ")}
                            </MetaTag>
                          )}

                        {(session?.replayUrl ||
                          latestScreenshot ||
                          latestReportArtifact) && (
                          <MetaTag className="border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
                            Artifacts ready
                          </MetaTag>
                        )}
                      </div>
                    </div>

                    {/* Right: score grid */}
                    <div className="hidden shrink-0 overflow-hidden rounded-lg border border-border/50 sm:flex">
                      {[
                        {
                          label: "PERF",
                          value: currentAuditTrend.performance.current,
                          tone: "text-blue-400",
                        },
                        {
                          label: "A11Y",
                          value: currentAuditTrend.accessibility.current,
                          tone: "text-emerald-400",
                        },
                        {
                          label: "BP",
                          value: currentAuditTrend.bestPractices.current,
                          tone: "text-amber-400",
                        },
                        {
                          label: "SEO",
                          value: currentAuditTrend.seo.current,
                          tone: "text-violet-400",
                        },
                      ].map((metric, i) => (
                        <div
                          key={metric.label}
                          className={cn(
                            "px-4 py-2.5 text-center",
                            i < 3 && "border-r border-border/50",
                          )}
                        >
                          <p
                            className={cn(
                              "text-[9px] font-semibold uppercase tracking-[0.18em]",
                              metric.tone,
                            )}
                          >
                            {metric.label}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-sm font-semibold tabular-nums leading-none",
                              metric.tone,
                            )}
                          >
                            {formatAuditScore(metric.value)}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 rounded-md text-muted-foreground/40 hover:bg-destructive/10 hover:text-red-400 group-hover:text-muted-foreground/60"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({
                            id: run._id,
                            label: run.url,
                          });
                        }}
                      >
                        <IconTrash className="size-3.5" />
                        <span className="sr-only">Delete run</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 rounded-md border-border/50 bg-background/60 px-3 text-xs font-medium hover:border-border hover:bg-background"
                        onClick={(e) => {
                          e.stopPropagation();
                          void navigate({
                            to: targetUrl,
                            params: { runId: run._id },
                          });
                        }}
                      >
                        {isActive ? "Monitor" : "Report"}
                        <IconArrowRight className="ml-0.5 size-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Mobile score row */}
                  <div className="mt-3 flex overflow-hidden rounded-lg border border-border/50 sm:hidden">
                    {[
                      {
                        label: "PERF",
                        value: currentAuditTrend.performance.current,
                        tone: "text-blue-400",
                      },
                      {
                        label: "A11Y",
                        value: currentAuditTrend.accessibility.current,
                        tone: "text-emerald-400",
                      },
                      {
                        label: "BP",
                        value: currentAuditTrend.bestPractices.current,
                        tone: "text-amber-400",
                      },
                      {
                        label: "SEO",
                        value: currentAuditTrend.seo.current,
                        tone: "text-violet-400",
                      },
                    ].map((metric, i) => (
                      <div
                        key={metric.label}
                        className={cn(
                          "flex-1 px-3 py-2.5 text-center",
                          i < 3 && "border-r border-border/50",
                        )}
                      >
                        <p
                          className={cn(
                            "text-[9px] font-semibold uppercase tracking-[0.18em]",
                            metric.tone,
                          )}
                        >
                          {metric.label}
                        </p>
                        <p
                          className={cn(
                            "mt-1 text-sm font-semibold tabular-nums leading-none",
                            metric.tone,
                          )}
                        >
                          {formatAuditScore(metric.value)}
                        </p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              );
            },
          )}
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
                  event.preventDefault();
                  if (currentPage > 1) {
                    setPage(currentPage - 1);
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
                      event.preventDefault();
                      setPage(item);
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
                  event.preventDefault();
                  if (currentPage < totalPages) {
                    setPage(currentPage + 1);
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
            setDeleteTarget(null);
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
  );
}

function RunThumbnail({
  url,
  screenshotUrl,
}: {
  url: string;
  screenshotUrl?: string | null;
}) {
  const [screenshotError, setScreenshotError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);

  let domain = url;
  try {
    domain = new URL(url).hostname;
  } catch {}

  const showScreenshot = screenshotUrl && !screenshotError;

  return (
    <div className="relative hidden h-[52px] w-[78px] shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted/20 sm:block">
      {showScreenshot ? (
        <img
          src={screenshotUrl}
          alt=""
          draggable={false}
          className="h-full w-full object-cover object-top"
          onError={() => setScreenshotError(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {!faviconError ? (
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              draggable={false}
              className="size-5 opacity-40"
              onError={() => setFaviconError(true)}
            />
          ) : (
            <span className="text-[11px] font-medium text-muted-foreground/30 select-none">
              {domain.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PrettyUrl({
  url,
  className,
  muted,
}: {
  url: string;
  className?: string;
  muted?: boolean;
}) {
  let domain = url;
  let path = "";

  try {
    const parsed = new URL(url);
    domain = parsed.hostname;
    path = parsed.pathname === "/" ? "/" : parsed.pathname;
  } catch {
    // not a valid URL, render as-is
  }

  if (muted) {
    return (
      <span
        className={cn(
          "flex min-w-0 items-baseline font-mono text-xs leading-snug",
          className,
        )}
      >
        <span className="shrink-0 text-muted-foreground/40">{domain}</span>
        {path && (
          <span className="truncate text-muted-foreground/30">{path}</span>
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex min-w-0 items-baseline font-mono text-sm leading-snug",
        className,
      )}
    >
      <span className="shrink-0 font-medium text-foreground">{domain}</span>
      {path && (
        <span className="truncate text-muted-foreground/50">{path}</span>
      )}
    </span>
  );
}

function MetaTag({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border border-border/50 bg-muted/40 text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function StatusDot({
  status,
}: {
  status:
    | "cancelled"
    | "completed"
    | "failed"
    | "queued"
    | "running"
    | "starting";
}) {
  const config: Record<
    string,
    { color: string; dotColor: string; label: string; pulse?: boolean }
  > = {
    running: {
      color: "text-sky-400",
      dotColor: "bg-sky-400",
      label: "Running",
      pulse: true,
    },
    starting: {
      color: "text-sky-400",
      dotColor: "bg-sky-400",
      label: "Starting",
      pulse: true,
    },
    completed: {
      color: "text-teal-400",
      dotColor: "bg-teal-400",
      label: "Completed",
    },
    failed: {
      color: "text-red-400",
      dotColor: "bg-red-400",
      label: "Failed",
    },
    cancelled: {
      color: "text-amber-400",
      dotColor: "bg-amber-400",
      label: "Cancelled",
    },
    queued: {
      color: "text-yellow-400",
      dotColor: "bg-yellow-400",
      label: "Queued",
    },
  };

  const { color, dotColor, label, pulse } = config[status] ?? config.queued;

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", color)}>
      <span
        className={cn("inline-block size-1.5 rounded-full", dotColor, pulse && "animate-pulse")}
      />
      {label}
    </span>
  );
}

function formatAuditScore(value: number | null) {
  if (value === null) {
    return "--";
  }

  return Math.round(value * 100).toString();
}

function buildPaginationItems(currentPage: number, totalPages: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, "ellipsis", totalPages] as const;
  }

  if (currentPage >= totalPages - 2) {
    return [
      1,
      "ellipsis",
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ] as const;
  }

  return [
    1,
    "ellipsis",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis",
    totalPages,
  ] as const;
}
