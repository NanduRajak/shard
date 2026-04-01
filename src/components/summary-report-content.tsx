import { formatDistanceToNow } from "date-fns";
import {
  IconBug,
  IconClock,
  IconCpu,
  IconFileDescription,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import {
  filterTimelineEventsForQaView,
  formatSessionDuration,
  sortTimelineEvents,
} from "@/lib/run-report";

export function SummaryReportContent({ report }: { report: any }) {
  const { run, runEvents, findings, coverageUrls, sessionDurationMs, performanceAudits } = report;

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
  const severitySummary = buildSeveritySummary(sortedFindings);

  return (
    <>
      <div className="flex flex-wrap gap-2 px-6 pb-4 text-xs text-muted-foreground">
        <MetaPill icon={<IconClock className="size-3.5" />}>
          {formatSessionDuration(sessionDurationMs)}
        </MetaPill>
        <MetaPill icon={<IconFileDescription className="size-3.5" />}>
          {coverageUrls?.length ?? 0} pages covered
        </MetaPill>
        <MetaPill icon={<IconBug className="size-3.5" />}>
          {sortedFindings.length} issues logged
        </MetaPill>
        <MetaPill icon={<IconFileDescription className="size-3.5" />}>
          Updated {formatDistanceToNow(run.updatedAt, { addSuffix: true })}
        </MetaPill>
      </div>

      <CardContent className="space-y-6 border-t border-border/70 pt-4">
        <ReportSection title="Run overview">
          <div className="space-y-4 text-sm leading-6 text-foreground/90">
            <DetailRow label="Target URL" value={run.url} mono />
            {run.instructions ? (
              <DetailRow label="Requested task" value={run.instructions} />
            ) : null}
            <DetailRow
              label="Run outcome"
              value={run.goalSummary?.trim() || "No explicit run outcome was stored."}
            />
            <DetailRow
              label="Run coverage"
              value={`${coverageUrls?.length ?? 0} page${(coverageUrls?.length ?? 0) === 1 ? "" : "s"} explored, ${executionEntries.length} recorded live session step${executionEntries.length === 1 ? "" : "s"}, ${performanceAudits?.length ?? 0} audit${(performanceAudits?.length ?? 0) === 1 ? "" : "s"}, and ${sortedFindings.length} issue${sortedFindings.length === 1 ? "" : "s"} found.`}
            />
          </div>
        </ReportSection>

        <ReportSection title="What the agent did in the live session">
          {executionEntries.length ? (
            <div className="space-y-3">
              {executionEntries.map((entry, index) => (
                <div key={`${entry.title}-${index}`} className="border-l border-border/60 pl-3">
                  <p className="text-sm font-medium text-foreground">
                    {index + 1}. {entry.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {entry.description}
                  </p>
                  {entry.pageLabel && entry.pageHref ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      URL:{" "}
                      <a
                        href={entry.pageHref}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all font-mono text-sky-300 underline underline-offset-2 hover:text-sky-200"
                      >
                        {entry.pageLabel}
                      </a>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No live session actions were stored for this run.
            </p>
          )}
        </ReportSection>

        <ReportSection title="Issues found">
          <div className="space-y-4">
            <p className="text-sm leading-6 text-foreground/90">
              The run logged {sortedFindings.length} issue{sortedFindings.length === 1 ? "" : "s"} in total, including {severitySummary.critical} critical, {severitySummary.high} high, and {severitySummary.other} other findings.
            </p>
            {sortedFindings.length ? (
              <div className="space-y-2">
                {sortedFindings.slice(0, 6).map((finding, index) => (
                  <div key={`${finding._id ?? finding.title}-${index}`} className="rounded-lg border border-border/60 bg-background/60 p-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{finding.title}</p>
                      <Badge variant="outline" className="capitalize">
                        {finding.severity ?? "issue"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {finding.pageOrFlow
                        ? `Observed from ${compactPageLabel(finding.pageOrFlow, run.url)}.`
                        : "Observed during the run."}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No notable issues were persisted during this run.
              </p>
            )}
          </div>
        </ReportSection>
      </CardContent>
    </>
  );
}

export function buildExecutionEntries(events: any[], runUrl: string) {
  return events
    .filter((event) => event.title)
    .slice(0, 24)
    .map((event) => {
      const pageHref = resolveEntryUrl(event.pageUrl, runUrl);
      return {
        title: toNarrativeTitle(normalizeStepTitle(event.title)),
        description: summarizeEventBody(event),
        pageHref,
        pageLabel: pageHref ? formatEntryUrlLabel(pageHref, runUrl) : null,
      };
    });
}

export function buildSeveritySummary(findings: any[]) {
  const critical = findings.filter((finding) => finding.severity === "critical").length;
  const high = findings.filter((finding) => finding.severity === "high").length;
  return { critical, high, other: Math.max(findings.length - critical - high, 0) };
}

export function buildHeaderSummary({
  run,
  executionEntries,
  sortedFindings,
}: {
  run: any;
  executionEntries: Array<{ title: string }>;
  sortedFindings: any[];
}) {
  const taskSentence = run.instructions
    ? `Task given: ${run.instructions}.`
    : "No explicit task was provided.";
  const actionPreview = executionEntries.slice(0, 3).map((entry) => entry.title).join(", ");
  const actionSentence = actionPreview
    ? `The agent then ${actionPreview.charAt(0).toLowerCase()}${actionPreview.slice(1)}${executionEntries.length > 3 ? ", and continued through the live flow." : "."}`
    : "No live session actions were stored.";
  const findingSentence = sortedFindings.length
    ? `It finished with ${sortedFindings.length} issue${sortedFindings.length === 1 ? "" : "s"} recorded.`
    : "No issues were recorded in the final report.";
  return `${taskSentence} ${actionSentence} ${findingSentence}`;
}

function summarizeEventBody(event: any) {
  const body = String(event.body ?? "").trim();
  if (!body) return defaultDescriptionForTitle(event.title);
  const firstLine = body
    .split("\n")
    .map((line: string) => line.trim())
    .find((line: string) => line.length > 0 && !line.startsWith("Task:")) ?? body;
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}

function normalizeStepTitle(title: string) {
  if (title === "Target page loaded") return "Opened the requested page";
  if (title === "Autonomous QA agent booted") return "Started the QA agent";
  return title;
}

function toNarrativeTitle(title: string) {
  if (title === "Opened the requested page") return "Opened the requested page";
  if (title === "Started the QA agent") return "Started the QA agent";
  if (title === "Navigated to page") return "Navigated to another page";
  if (title === "Agent decision") return "Recorded an agent decision";
  if (title === "Agent fallback decision" || title === "Fallback action selected") return "Used a fallback action";
  return title;
}

function defaultDescriptionForTitle(title: string) {
  if (/^Clicked /i.test(title) || /^Filled /i.test(title)) return "No additional detail was stored for this action.";
  if (title === "Navigated to page") return "No additional detail was stored for this action.";
  if (title === "Captured screenshot") return "A screenshot artifact was captured.";
  if (title === "Task completed") return "The final task status was stored.";
  return "No additional detail was stored for this step.";
}

function compactPageLabel(pageUrl: string, fallbackUrl?: string) {
  try {
    const parsed = new URL(pageUrl);
    const fallback = fallbackUrl ? new URL(fallbackUrl) : null;
    const isSameOrigin = fallback ? fallback.origin === parsed.origin : false;
    return isSameOrigin ? `${parsed.pathname || "/"}${parsed.search}` : parsed.href;
  } catch {
    return pageUrl;
  }
}

function resolveEntryUrl(pageUrl?: string, runUrl?: string) {
  const candidate = pageUrl?.trim() || runUrl?.trim();
  if (!candidate) return null;
  try {
    return new URL(candidate).href;
  } catch {
    return candidate;
  }
}

function formatEntryUrlLabel(pageUrl: string, runUrl?: string) {
  try {
    const parsed = new URL(pageUrl);
    const fallback = runUrl ? new URL(runUrl) : null;
    const isSameOrigin = fallback ? fallback.origin === parsed.origin : false;
    const path = `${parsed.pathname || "/"}${parsed.search}${parsed.hash}`;
    if (!isSameOrigin) return parsed.href;
    if (!path || path === "/") return parsed.origin;
    return `${parsed.origin}${path}`;
  } catch {
    return pageUrl;
  }
}

function MetaPill({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5">
      <span className="text-foreground/70">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <IconCpu className="size-4 text-sky-300" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="rounded-[1rem] border border-border/70 bg-background/70 p-3">
        {children}
      </div>
    </section>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className={`text-sm leading-6 text-foreground ${mono ? "break-all font-mono text-xs" : ""}`}>
        {value}
      </p>
    </div>
  );
}
