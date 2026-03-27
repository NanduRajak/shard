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
    return <div className="min-h-72 rounded-3xl border border-border/70 bg-card/70" />
  }

  return <RunReportView report={report} />
}
