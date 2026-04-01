import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  IconArrowLeft,
  IconCircleCheck,
  IconCircleX,
  IconCpu,
} from "@tabler/icons-react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  SummaryReportContent,
  buildExecutionEntries,
  buildHeaderSummary,
} from "@/components/summary-report-content";
import {
  filterTimelineEventsForQaView,
  sortTimelineEvents,
} from "@/lib/run-report";

export const Route = createFileRoute("/report/$runId")({
  component: ReportSummaryPage,
});

function ReportSummaryPage() {
  const { runId } = Route.useParams();
  const typedRunId = runId as Id<"runs">;
  const { data: report, isLoading } = useQuery(
    convexQuery(api.runtime.getRunReport, { runId: typedRunId }),
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100svh-12rem)] items-center justify-center text-muted-foreground animate-pulse">
        Loading summary...
      </div>
    );
  }

  if (!report) {
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
    );
  }

  const { run, runEvents, findings } = report;

  if (
    run.status === "queued" ||
    run.status === "starting" ||
    run.status === "running"
  ) {
    return (
      <Empty className="min-h-[calc(100svh-12rem)] border border-dashed border-border/70 bg-card/60 animate-in fade-in duration-500">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-blue-500/10 text-blue-500">
            <IconCpu className="animate-pulse" />
          </EmptyMedia>
          <EmptyTitle>Run in progress</EmptyTitle>
          <EmptyDescription>
            This agent is currently executing. The summary report will be available once the run completes.
          </EmptyDescription>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/dashboard">
              <Button variant="outline">Back to Dashboard</Button>
            </Link>
            <Link to="/runs/$runId" params={{ runId }}>
              <Button>Monitor Live</Button>
            </Link>
          </div>
        </EmptyHeader>
      </Empty>
    );
  }

  const timelineEvents = sortTimelineEvents(
    filterTimelineEventsForQaView((runEvents ?? []) as any[]),
  );
  const sortedFindings = [...((findings ?? []) as any[])].sort(
    (left, right) => (right.score ?? 0) - (left.score ?? 0),
  );
  const activityEvents = timelineEvents.filter(
    (event) => event.kind !== "finding" && event.kind !== "audit" && event.kind !== "status",
  );
  const executionEntries = buildExecutionEntries(activityEvents, run.url);
  const headerSummary = buildHeaderSummary({ run, executionEntries, sortedFindings });

  return (
    <div className="grid gap-5">
      <Card className="overflow-hidden border border-border/60 bg-card/90">
        <CardHeader className="gap-3 border-b border-border/70">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/dashboard"
                  className={buttonVariants({
                    variant: "outline",
                    size: "icon",
                    className: "size-8 rounded-lg",
                  })}
                >
                  <IconArrowLeft className="size-4" />
                </Link>
                <Badge variant="outline" className="uppercase tracking-[0.18em]">
                  Summary report
                </Badge>
                <StatusBadge status={run.status} />
                {run.goalStatus && run.goalStatus !== "not_requested" ? (
                  <Badge variant="secondary" className="capitalize">
                    {run.goalStatus.replaceAll("_", " ")}
                  </Badge>
                ) : null}
              </div>
              <div className="space-y-1">
                <CardTitle className="text-2xl tracking-tight">
                  Agent execution summary
                </CardTitle>
                <CardDescription className="max-w-3xl break-all text-sm/6">
                  {run.url}
                </CardDescription>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {headerSummary}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link to="/history/$runId" params={{ runId }}>
                <Button variant="outline" className="rounded-lg">
                  Open detailed report
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <SummaryReportContent report={report} />
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <Badge className="border-emerald-500/25 bg-emerald-500/10 text-emerald-300" variant="outline">
        <IconCircleCheck className="size-3.5" />
        Completed
      </Badge>
    );
  }

  if (status === "failed") {
    return (
      <Badge className="border-red-500/25 bg-red-500/10 text-red-300" variant="outline">
        <IconCircleX className="size-3.5" />
        Failed
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="capitalize">
      {status}
    </Badge>
  );
}

