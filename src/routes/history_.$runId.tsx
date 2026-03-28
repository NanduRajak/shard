import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { IconCircleX } from "@tabler/icons-react"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { RunReportView } from "@/components/run-report-view"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export const Route = createFileRoute("/history_/$runId")({
  component: HistoryRunDetailPage,
})

function HistoryRunDetailPage() {
  const { runId } = Route.useParams()
  const typedRunId = runId as Id<"runs">
  const { data: report } = useQuery(
    convexQuery(api.runtime.getRunReport, { runId: typedRunId }),
  )

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
    return <RunReportSkeleton />
  }

  return <RunReportView report={report} />
}

function RunReportSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr] animate-pulse">
      {/* Header Block */}
      <Card className="border border-border/70 bg-card/40 xl:col-span-2">
        <CardHeader className="gap-4 border-b border-border/70">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-3 w-full max-w-lg">
              <div className="flex items-center gap-2">
                <Skeleton className="size-7 rounded-sm bg-border/40" />
                <Skeleton className="h-6 w-28 rounded-md bg-border/40" />
                <Skeleton className="h-6 w-20 rounded-md bg-border/40" />
              </div>
              <Skeleton className="h-8 w-48 bg-border/40 mt-3" />
              <Skeleton className="h-5 w-3/4 bg-border/40" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-16 w-36 rounded-2xl bg-border/30" />
              <Skeleton className="h-16 w-36 rounded-2xl bg-border/30" />
            </div>
          </div>
          <Skeleton className="h-9 w-40 rounded-2xl bg-border/40 mt-2" />
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl bg-border/30" />
          ))}
          <Skeleton className="h-28 w-full rounded-[1.1rem] md:col-span-5 bg-border/30" />
        </CardContent>
      </Card>

      {/* Row 2: Secondary panels */}
      <Card className="border border-border/70 bg-card/40 min-h-64 flex flex-col">
        <CardHeader className="border-b border-border/70">
          <Skeleton className="h-6 w-40 bg-border/40" />
          <Skeleton className="h-4 w-64 bg-border/30 mt-2" />
        </CardHeader>
        <CardContent className="pt-4 flex-1">
          <Skeleton className="h-20 w-full rounded-2xl bg-border/30 mb-4" />
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-2xl bg-border/30" />
            <Skeleton className="h-16 w-full rounded-2xl bg-border/30" />
            <Skeleton className="h-16 w-full rounded-2xl bg-border/30" />
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/70 bg-card/40 min-h-64 flex flex-col">
        <CardHeader className="border-b border-border/70">
          <Skeleton className="h-6 w-40 bg-border/40" />
          <Skeleton className="h-4 w-64 bg-border/30 mt-2" />
        </CardHeader>
        <CardContent className="pt-4 flex-1">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Skeleton className="h-16 w-full rounded-2xl bg-border/30" />
            <Skeleton className="h-16 w-full rounded-2xl bg-border/30" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-2xl bg-border/30" />
            <Skeleton className="h-16 w-full rounded-2xl bg-border/30" />
          </div>
        </CardContent>
      </Card>
      
      {/* Row 3: Full width metric block */}
      <Card className="border border-border/70 bg-card/40 min-h-48 xl:col-span-2 flex flex-col mt-2">
        <CardHeader className="border-b border-border/70">
          <Skeleton className="h-6 w-48 bg-border/40" />
          <Skeleton className="h-4 w-80 bg-border/30 mt-2" />
        </CardHeader>
        <CardContent className="pt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl bg-border/30" />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
