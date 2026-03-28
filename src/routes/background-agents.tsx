import { createFileRoute, Link } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  IconArrowRight,
  IconClock,
  IconExternalLink,
  IconHourglass,
  IconLoader3,
  IconPhoto,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconRobot,
  IconTrash,
} from "@tabler/icons-react"
import { useMemo, useState, type ReactNode } from "react"
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
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { createBackgroundBatch } from "@/lib/create-background-batch"
import { getBackgroundTaskLabel } from "@/lib/background-agent-task"
import { requestRunStop } from "@/lib/request-run-stop"
import { isActiveRunStatus } from "@/lib/run-report"

export const Route = createFileRoute("/background-agents")({
  component: BackgroundAgentsPage,
})

type AssignmentRow = {
  credentialId: string
  id: string
  siteUrl: string
  task: string
}

const EMPTY_ROW = (): AssignmentRow => ({
  credentialId: "none",
  id: crypto.randomUUID(),
  siteUrl: "",
  task: "",
})

function BackgroundAgentsPage() {
  const { data: overview } = useQuery(
    convexQuery(api.backgroundAgents.getBackgroundAgentsOverview, {}),
  )
  const { data: credentials } = useQuery(
    convexQuery(api.backgroundAgents.listCredentialsForBackgroundRuns, {}),
  )
  const [rows, setRows] = useState<AssignmentRow[]>([EMPTY_ROW()])
  const [selectedRunId, setSelectedRunId] = useState<Id<"runs"> | null>(null)
  const createMutation = useMutation({
    mutationFn: createBackgroundBatch,
  })
  const stopMutation = useMutation({
    mutationFn: requestRunStop,
  })
  const { data: detail } = useQuery({
    ...convexQuery(api.backgroundAgents.getBackgroundRunDetail, {
      runId: selectedRunId ?? undefined,
    }),
    enabled: Boolean(selectedRunId),
  })

  const totalAgentsRequested = useMemo(
    () => rows.filter((row) => row.siteUrl.trim()).length || rows.length,
    [rows],
  )

  const handleCreateBatch = async () => {
    try {
      await createMutation.mutateAsync({
        data: {
          assignments: rows.map((row) => ({
            credentialId: row.credentialId !== "none" ? row.credentialId : undefined,
            siteUrl: row.siteUrl,
            task: row.task,
          })),
        },
      })

      setRows([EMPTY_ROW()])
      toast.success("Background agents queued.")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create background batch.",
      )
    }
  }

  const handleStopRun = async (runId: Id<"runs">) => {
    try {
      const result = await stopMutation.mutateAsync({
        data: { runId },
      })

      if (!result.ok) {
        toast.error(
          result.reason === "not_active"
            ? "This agent is no longer active."
            : "The agent could not be found.",
        )
        return
      }

      toast.success("Stop requested for background agent.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop background agent.")
    }
  }

  return (
    <>
      <div className="grid gap-5">
        <Card className="overflow-hidden border border-border/60 bg-card shadow-[0_28px_80px_-42px_rgba(0,0,0,0.65)]">
          <CardHeader className="gap-5 border-b border-border/60 bg-muted/10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl space-y-3">
                <Badge
                  variant="outline"
                  className="border-border/70 bg-background/60 text-muted-foreground"
                >
                  Background Agents
                </Badge>
                <CardTitle className="font-heading text-[2rem] leading-tight tracking-tight md:text-[2.2rem]">
                  Queue simple background QA runs without babysitting a live browser.
                </CardTitle>
                <CardDescription className="max-w-2xl text-sm/6 text-muted-foreground">
                  Each row creates one isolated agent. Add a website, optionally attach a
                  saved login, and add a task if you want something more specific than the
                  default end-to-end QA audit.
                </CardDescription>
              </div>
              <div className="grid min-w-60 gap-3 sm:grid-cols-2">
                <HeroMetric label="Queued" value={`${overview?.queuedRuns.length ?? 0}`} />
                <HeroMetric label="Running" value={`${overview?.activeRuns.length ?? 0}`} />
                <HeroMetric label="Completed" value={`${overview?.completedRuns.length ?? 0}`} />
                <HeroMetric label="Failed" value={`${overview?.failedRuns.length ?? 0}`} />
              </div>
            </div>
          </CardHeader>
        </Card>

        <Card className="overflow-hidden border border-border/60 bg-card shadow-[0_20px_55px_-42px_rgba(0,0,0,0.78)]">
          <CardHeader className="gap-4 border-b border-border/60 bg-muted/15">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <Badge
                  variant="secondary"
                  className="w-fit rounded-full px-3 py-1 text-[11px] tracking-[0.16em] uppercase"
                >
                  Launch agents
                </Badge>
                <CardTitle>Create background agents</CardTitle>
                <CardDescription className="max-w-2xl text-pretty">
                  Keep it lightweight: one row is one agent. Leave the task blank to run the
                  built-in end-to-end QA pass.
                </CardDescription>
              </div>
              <Badge variant="outline" className="tabular-nums">
                {totalAgentsRequested} agent{totalAgentsRequested === 1 ? "" : "s"} ready
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 pt-5">
            {rows.map((row, index) => (
              <AssignmentComposerRow
                key={row.id}
                row={row}
                index={index}
                canRemove={rows.length > 1}
                credentials={credentials ?? []}
                onChange={(nextRow) => {
                  setRows((current) =>
                    current.map((item) => (item.id === row.id ? nextRow : item)),
                  )
                }}
                onRemove={() => {
                  setRows((current) =>
                    current.length === 1
                      ? current
                      : current.filter((item) => item.id !== row.id),
                  )
                }}
              />
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-border/60 bg-muted/20 p-3">
              <Button
                variant="outline"
                className="min-h-11 rounded-2xl border-border/70 bg-background/80"
                onClick={() => {
                  setRows((current) => [...current, EMPTY_ROW()])
                }}
              >
                <IconPlus className="size-4" />
                Add another agent
              </Button>
              <Button
                className="min-h-11 rounded-2xl"
                disabled={createMutation.isPending}
                onClick={() => {
                  void handleCreateBatch()
                }}
              >
                {createMutation.isPending ? "Starting..." : "Start agents"}
                <IconPlayerPlay className="size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <RunBucket
            title="Active agents"
            description="Agents currently running in the background."
            icon={<IconLoader3 className="size-4" />}
            items={overview?.activeRuns ?? []}
            onSelect={setSelectedRunId}
            emptyTitle="No active agents"
            emptyBody="Running agents will appear here."
          />
          <RunBucket
            title="Queued agents"
            description="Agents waiting for a Playwright worker."
            icon={<IconHourglass className="size-4" />}
            items={overview?.queuedRuns ?? []}
            onSelect={setSelectedRunId}
            emptyTitle="No queued agents"
            emptyBody="Create one or more rows above to queue QA work."
          />
          <RunBucket
            title="Completed agents"
            description="Finished agents with saved artifacts and findings."
            icon={<IconRobot className="size-4" />}
            items={overview?.completedRuns ?? []}
            onSelect={setSelectedRunId}
            emptyTitle="No completed agents"
            emptyBody="Completed reports stay visible here."
          />
          <RunBucket
            title="Failed agents"
            description="Runs that failed or were cancelled."
            icon={<IconClock className="size-4" />}
            items={overview?.failedRuns ?? []}
            onSelect={setSelectedRunId}
            emptyTitle="No failed agents"
            emptyBody="Failed jobs stay here for debugging."
          />
        </div>
      </div>

      <Drawer
        direction="right"
        open={Boolean(selectedRunId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRunId(null)
          }
        }}
      >
        <DrawerContent className="data-[vaul-drawer-direction=right]:sm:max-w-2xl">
          <DrawerHeader className="gap-3 border-b border-border/60 bg-muted/10">
            <DrawerTitle>Background agent detail</DrawerTitle>
            <DrawerDescription className="text-pretty">
              Review the saved output, findings, artifacts, and progress for this agent.
            </DrawerDescription>
          </DrawerHeader>
          <div className="grid h-full min-h-0 gap-4 overflow-y-auto bg-background/60 p-4">
            {!detail ? (
              <Card className="min-h-72 border border-border/60 bg-card/80" />
            ) : (
              <>
                <Card className="border border-border/60 bg-card shadow-[0_20px_48px_-38px_rgba(0,0,0,0.85)]">
                  <CardContent className="grid gap-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">Agent {detail.run.agentOrdinal ?? "?"}</Badge>
                      <StatusBadge status={detail.run.status} />
                      {detail.batch ? (
                        <Badge variant="outline">{detail.batch.title}</Badge>
                      ) : null}
                    </div>
                    <p className="break-all text-sm font-medium text-foreground">
                      {detail.run.url}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {detail.run.currentStep ?? "Queued for background QA"}
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <InfoMetric
                        label="Task"
                        value={getBackgroundTaskLabel(detail.run.instructions)}
                      />
                      <InfoMetric
                        label="Findings"
                        value={`${detail.findings.length} total`}
                      />
                      <InfoMetric
                        label="Console / network / page"
                        value={`${detail.consoleFindings.length} / ${detail.networkFindings.length} / ${detail.pageErrorFindings.length}`}
                      />
                      <InfoMetric
                        label="Artifacts"
                        value={`${detail.artifacts.length} saved`}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isActiveRunStatus(detail.run.status) ? (
                        <Button
                          variant="destructive"
                          className="rounded-2xl"
                          disabled={
                            stopMutation.isPending || Boolean(detail.run.stopRequestedAt)
                          }
                          onClick={() => {
                            void handleStopRun(detail.run._id)
                          }}
                        >
                          {stopMutation.isPending || detail.run.stopRequestedAt
                            ? "Stopping..."
                            : "Stop agent"}
                          <IconPlayerStop className="size-4" />
                        </Button>
                      ) : null}
                      <Link
                        to={
                          detail.run.status === "queued" ||
                          detail.run.status === "starting" ||
                          detail.run.status === "running"
                            ? "/runs/$runId"
                            : "/history/$runId"
                        }
                        params={{ runId: detail.run._id }}
                        className={buttonVariants({
                          variant: "outline",
                          className: "rounded-2xl",
                        })}
                      >
                        Open full view
                        <IconArrowRight className="size-4" />
                      </Link>
                      {detail.traceArtifact?.url ? (
                        <a
                          href={detail.traceArtifact.url}
                          target="_blank"
                          rel="noreferrer"
                          className={buttonVariants({
                            variant: "outline",
                            className: "rounded-2xl",
                          })}
                        >
                          Open Playwright trace
                          <IconExternalLink className="size-4" />
                        </a>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border border-border/60 bg-card shadow-[0_20px_48px_-38px_rgba(0,0,0,0.82)]">
                  <CardHeader className="gap-2 border-b border-border/60 bg-muted/10">
                    <CardTitle className="text-base">Agent output</CardTitle>
                    <CardDescription className="text-pretty">
                      Step-by-step status from the background worker.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 p-4">
                    {detail.runEvents.map((event: any) => (
                      <article
                        key={event._id}
                        className="rounded-[1.35rem] border border-border/60 bg-background/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{event.title}</p>
                          {event.stepIndex !== undefined ? (
                            <Badge variant="outline">Step {event.stepIndex}</Badge>
                          ) : null}
                        </div>
                        {event.body ? (
                          <p className="mt-2 text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
                            {event.body}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border border-border/60 bg-card shadow-[0_20px_48px_-38px_rgba(0,0,0,0.82)]">
                  <CardHeader className="gap-2 border-b border-border/60 bg-muted/10">
                    <CardTitle className="text-base">Findings snapshot</CardTitle>
                    <CardDescription className="text-pretty">
                      Browser issues and QA findings captured during the run.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 p-4">
                    {detail.findings.slice(0, 8).map((finding: any) => (
                      <article
                        key={finding._id}
                        className="rounded-[1.35rem] border border-border/60 bg-background/75 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{finding.source}</Badge>
                          <Badge variant="secondary">{finding.severity}</Badge>
                          {finding.browserSignal ? (
                            <Badge variant="outline">{finding.browserSignal}</Badge>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm font-medium text-foreground">{finding.title}</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          {finding.description}
                        </p>
                      </article>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border border-border/60 bg-card shadow-[0_20px_48px_-38px_rgba(0,0,0,0.82)]">
                  <CardHeader className="gap-2 border-b border-border/60 bg-muted/10">
                    <CardTitle className="text-base">Artifacts</CardTitle>
                    <CardDescription className="text-pretty">
                      Latest screenshots, trace exports, and saved outputs.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 p-4">
                    {detail.latestScreenshot?.url ? (
                      <a
                        href={detail.latestScreenshot.url}
                        target="_blank"
                        rel="noreferrer"
                        className="overflow-hidden rounded-[1.45rem] border border-border/60 bg-background/75 shadow-[0_20px_45px_-35px_rgba(0,0,0,0.85)] outline outline-1 outline-white/5"
                      >
                        <img
                          alt={detail.latestScreenshot.title ?? "Background QA screenshot"}
                          src={detail.latestScreenshot.url}
                          className="aspect-[16/10] w-full object-cover"
                        />
                        <div className="flex items-center justify-between gap-3 p-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {detail.latestScreenshot.title ?? "Latest screenshot"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {detail.latestScreenshot.pageUrl ?? detail.run.currentUrl ?? detail.run.url}
                            </p>
                          </div>
                          <IconPhoto className="size-4 text-muted-foreground" />
                        </div>
                      </a>
                    ) : (
                      <Empty className="min-h-40 rounded-[1.4rem] border border-dashed border-border/60 bg-background/70">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <IconPhoto />
                          </EmptyMedia>
                          <EmptyTitle>No screenshot saved yet.</EmptyTitle>
                          <EmptyDescription>
                            This agent has not stored a screenshot yet.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

function AssignmentComposerRow({
  canRemove,
  credentials,
  index,
  onChange,
  onRemove,
  row,
}: {
  canRemove: boolean
  credentials: Array<{
    _id: Id<"credentials">
    isDefault: boolean
    login: string
    origin: string
    website: string
  }>
  index: number
  onChange: (row: AssignmentRow) => void
  onRemove: () => void
  row: AssignmentRow
}) {
  const siteOrigin = safeOrigin(row.siteUrl)
  const matchingCredentials = siteOrigin
    ? credentials.filter((credential) => credential.origin === siteOrigin)
    : credentials

  return (
    <div className="rounded-[1.7rem] border border-border/60 bg-background/95 p-4 shadow-[0_20px_45px_-36px_rgba(0,0,0,0.82)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Agent {index + 1}</p>
          <p className="text-sm text-muted-foreground">
            Add a URL, optionally attach a saved login, and leave the task blank if you
            want the default QA pass.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-background/80 text-muted-foreground">
              {siteOrigin ? siteOrigin.replace(/^https?:\/\//, "") : "URL decides site scope"}
            </Badge>
            <Badge variant="secondary" className="bg-secondary/80">
              {matchingCredentials.length} matching credential
              {matchingCredentials.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!canRemove}
          className="min-h-10 min-w-10 rounded-full"
          onClick={onRemove}
        >
          <IconTrash className="size-4" />
          <span className="sr-only">Remove assignment</span>
        </Button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="URL">
          <Input
            value={row.siteUrl}
            placeholder="https://app.example.com"
            className="h-11 rounded-2xl border-border/70 bg-background/80 shadow-none"
            onChange={(event) => onChange({ ...row, siteUrl: event.target.value })}
          />
        </Field>
        <Field label="Credential">
          <Select
            value={row.credentialId}
            onValueChange={(value) => onChange({ ...row, credentialId: value ?? "none" })}
          >
            <SelectTrigger className="h-11 rounded-2xl border-border/70 bg-background/80">
              <SelectValue placeholder="No credential" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="none">No credential</SelectItem>
              {matchingCredentials.map((credential) => (
                <SelectItem key={credential._id} value={credential._id}>
                  {credential.login}
                  {credential.isDefault ? " · default" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Task">
          <Textarea
            value={row.task}
            placeholder="Optional. Leave blank for the default end-to-end QA audit."
            className="min-h-28 rounded-[1.45rem] border-border/70 bg-background/80 shadow-none"
            onChange={(event) => onChange({ ...row, task: event.target.value })}
          />
        </Field>
      </div>
    </div>
  )
}

function RunBucket({
  description,
  emptyBody,
  emptyTitle,
  icon,
  items,
  onSelect,
  title,
}: {
  description: string
  emptyBody: string
  emptyTitle: string
  icon: ReactNode
  items: any[]
  onSelect: (runId: Id<"runs">) => void
  title: string
}) {
  return (
    <Card className="overflow-hidden border border-border/60 bg-card shadow-[0_22px_55px_-42px_rgba(0,0,0,0.82)]">
      <CardHeader className="gap-3 border-b border-border/60 bg-muted/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2 text-base">
              {icon}
              {title}
            </CardTitle>
            <CardDescription className="text-pretty">{description}</CardDescription>
          </div>
          <Badge variant="outline" className="tabular-nums">
            {items.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 p-4">
        {items.length === 0 ? (
          <Empty className="min-h-52 rounded-[1.6rem] border border-dashed border-border/60 bg-background/60">
            <EmptyHeader>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              <EmptyDescription>{emptyBody}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          items.map((item) => (
            <button
              key={item.run._id}
              type="button"
              onClick={() => onSelect(item.run._id)}
              className="group rounded-[1.55rem] border border-border/60 bg-background/95 p-4 text-left shadow-[0_18px_45px_-36px_rgba(0,0,0,0.8)] transition-[transform,box-shadow,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-[0_26px_60px_-38px_rgba(0,0,0,0.88)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Agent {item.run.agentOrdinal ?? "?"}</Badge>
                  <StatusBadge status={item.run.status} />
                </div>
                {item.batch ? (
                  <Badge variant="outline" className="max-w-full truncate">
                    {item.batch.title}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-4 line-clamp-1 text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">
                {safeOrigin(item.run.url)?.replace(/^https?:\/\//, "") ?? item.run.url}
              </p>
              <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">
                {getBackgroundTaskLabel(item.run.instructions)}
              </p>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {item.run.currentStep ?? "Queued for background QA"}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-background/80 px-2.5 py-1 tabular-nums">
                  {item.findingsCount} findings
                </span>
                {item.traceArtifact ? (
                  <span className="rounded-full bg-background/80 px-2.5 py-1">Trace ready</span>
                ) : null}
                {item.latestEvent?.stepIndex !== undefined ? (
                  <span className="rounded-full bg-background/80 px-2.5 py-1 tabular-nums">
                    Step {item.latestEvent.stepIndex}
                  </span>
                ) : null}
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm font-medium text-foreground/85 transition-transform duration-200 group-hover:translate-x-0.5">
                Open agent detail
                <IconArrowRight className="size-4" />
              </div>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border border-border/60 bg-background/65 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-2 text-3xl font-medium text-foreground tabular-nums">{value}</p>
    </div>
  )
}

function Field({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <div className="grid gap-2">
      <Label className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </Label>
      {children}
    </div>
  )
}

function InfoMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] border border-border/60 bg-background/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
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

  if (status === "cancelled") {
    return <Badge variant="secondary">cancelled</Badge>
  }

  return <Badge variant="secondary">{status}</Badge>
}

function safeOrigin(siteUrl: string) {
  try {
    return new URL(siteUrl).origin
  } catch {
    return null
  }
}
