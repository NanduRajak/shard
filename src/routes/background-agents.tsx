import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  IconArrowRight,
  IconPlayerPlay,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getBackgroundTaskLabel } from "@/lib/background-agent-task";
import { isBackgroundOrchestratorActive } from "@/lib/background-orchestrator-report";
import { createBackgroundOrchestrator } from "@/lib/create-background-orchestrator";
import { makeCredentialDefault } from "@/lib/credentials-server";
import { formatSessionDuration } from "@/lib/run-report";
import {
  getMatchingCredentialsForSiteUrl,
  LAST_SELECTED_CREDENTIAL_KEY,
  NO_CREDENTIAL_SELECTED,
} from "@/lib/launcher-credentials";
import { requestBackgroundOrchestratorStop } from "@/lib/request-background-orchestrator-stop";

export const Route = createFileRoute("/background-agents")({
  component: BackgroundAgentsRoute,
});

const EMPTY_CREDENTIALS: Array<{
  _id: Id<"credentials">;
  isDefault: boolean;
  login: string;
  origin: string;
  website: string;
}> = [];

function BackgroundAgentsRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (pathname.startsWith("/background-agents/")) {
    return <Outlet />;
  }

  return <BackgroundAgentsPage />;
}

function BackgroundAgentsPage() {
  const navigate = useNavigate();
  const { data: orchestrators } = useQuery(
    convexQuery(api.backgroundAgents.listBackgroundOrchestrators, {}),
  );
  const { data: credentials } = useQuery(
    convexQuery(
      api.backgroundAgents.listCredentialsForBackgroundOrchestrators,
      {},
    ),
  );
  const createMutation = useMutation({
    mutationFn: createBackgroundOrchestrator,
  });
  const makeDefaultMutation = useMutation({
    mutationFn: makeCredentialDefault,
  });
  const stopMutation = useMutation({
    mutationFn: requestBackgroundOrchestratorStop,
  });
  const [form, setForm] = useState({
    agentCount: 2,
    siteUrl: "",
    task: "",
  });
  const [selectedCredentialId, setSelectedCredentialId] = useState<
    string | null
  >(null);
  const [stoppingOrchestratorId, setStoppingOrchestratorId] =
    useState<Id<"backgroundOrchestrators"> | null>(null);

  const availableCredentials = credentials ?? EMPTY_CREDENTIALS;
  const matchingCredentials = useMemo(
    () => getMatchingCredentialsForSiteUrl(availableCredentials, form.siteUrl),
    [availableCredentials, form.siteUrl],
  );
  const selectedCredential = useMemo(
    () =>
      availableCredentials.find(
        (credential: (typeof availableCredentials)[number]) =>
          credential._id === selectedCredentialId,
      ) ?? null,
    [availableCredentials, selectedCredentialId],
  );

  useEffect(() => {
    if (!form.siteUrl.trim()) {
      setSelectedCredentialId(null);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          LAST_SELECTED_CREDENTIAL_KEY,
          NO_CREDENTIAL_SELECTED,
        );
      }
      return;
    }

    if (!matchingCredentials.length) {
      setSelectedCredentialId(null);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          LAST_SELECTED_CREDENTIAL_KEY,
          NO_CREDENTIAL_SELECTED,
        );
      }
      return;
    }

    const nextCredential =
      matchingCredentials.find((credential) => credential.isDefault) ??
      matchingCredentials[0];

    if (!nextCredential || nextCredential._id === selectedCredentialId) {
      return;
    }

    setSelectedCredentialId(nextCredential._id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        LAST_SELECTED_CREDENTIAL_KEY,
        nextCredential._id,
      );
    }
  }, [form.siteUrl, matchingCredentials, selectedCredentialId]);

  const handleCredentialChange = async (credentialId: string) => {
    const nextCredential =
      availableCredentials.find(
        (credential: (typeof availableCredentials)[number]) =>
          credential._id === credentialId,
      ) ?? null;

    if (!nextCredential || nextCredential._id === selectedCredentialId) {
      return;
    }

    const previousCredentialId = selectedCredentialId;
    setSelectedCredentialId(nextCredential._id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        LAST_SELECTED_CREDENTIAL_KEY,
        nextCredential._id,
      );
    }

    try {
      await makeDefaultMutation.mutateAsync({
        data: {
          credentialId: nextCredential._id,
        },
      });
    } catch (error) {
      setSelectedCredentialId(previousCredentialId);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update the default credential.",
      );
    }
  };

  const handleCreateOrchestrator = async () => {
    if (!form.siteUrl.trim()) {
      toast.error("Please enter a site URL to scan.");
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        data: {
          agentCount: form.agentCount,
          credentialId:
            selectedCredential &&
            matchingCredentials.some(
              (item) => item._id === selectedCredential._id,
            )
              ? (selectedCredential._id as Id<"credentials">)
              : undefined,
          siteUrl: form.siteUrl,
          task: form.task,
        },
      });

      setForm({
        agentCount: 2,
        siteUrl: "",
        task: "",
      });
      setSelectedCredentialId(null);
      toast.success("Orchestrator started.");
      void navigate({
        to: "/background-agents/$orchestratorId",
        params: { orchestratorId: result.orchestratorId },
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create the orchestrator.",
      );
    }
  };

  const handleStop = async (orchestratorId: Id<"backgroundOrchestrators">) => {
    setStoppingOrchestratorId(orchestratorId);

    try {
      const result = await stopMutation.mutateAsync({
        data: { orchestratorId },
      });

      if (!result.ok) {
        toast.error("This orchestrator could not be stopped.");
        return;
      }

      toast.success("Stop requested.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to stop.");
    } finally {
      setStoppingOrchestratorId((current) =>
        current === orchestratorId ? null : current,
      );
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 pb-24 pt-4 md:pt-8">
      {/* Header Section */}
      <section className="space-y-6">
        <div className="space-y-4">
          <div className="inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            <IconSparkles className="mr-1.5 size-3" />
            Background Agents
          </div>
          <h1 className="text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            Autonomous Orchestrator
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground leading-relaxed text-balance">
            Fan out parallel Playwright agents to audit any site. Agents operate
            headless in the background, streaming live evidence to a centralized
            report.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 pt-4">
          <StatItem
            label="Running"
            value={`${orchestrators?.filter((item) => item.status === "running").length ?? 0}`}
          />
          <StatItem
            label="Queued"
            value={`${orchestrators?.filter((item) => item.status === "queued").length ?? 0}`}
          />
          <StatItem
            label="Completed"
            value={`${orchestrators?.filter((item) => item.status === "completed").length ?? 0}`}
          />
          <StatItem
            label="Failed"
            value={`${orchestrators?.filter((item) => item.status === "failed").length ?? 0}`}
          />
        </div>
      </section>

      {/* Launcher Form */}
      <section>
        <div className="flex flex-col gap-8 rounded-xl border border-border/40 bg-card p-6 shadow-sm sm:flex-row sm:p-8">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <Field label="Target Environment URL">
              <Input
                value={form.siteUrl}
                placeholder="https://staging.example.com"
                className="h-9 border-border/50 bg-background/50 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    siteUrl: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Audit Context & Prompt (Optional)">
              <Textarea
                value={form.task}
                placeholder="Leave blank for the standard comprehensive E2E QA sweep, or provide specific instructions (e.g. 'Focus entirely on the checkout flow')."
                className="min-h-[140px] resize-none border-border/50 bg-background/50 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    task: event.target.value,
                  }))
                }
              />
            </Field>
          </div>

          <div className="flex w-full flex-col gap-6 sm:w-[280px] shrink-0">
            <Field label="Authentication Profile">
              <Select
                value={selectedCredentialId ?? undefined}
                onValueChange={(value) => {
                  if (value) void handleCredentialChange(value);
                }}
                disabled={matchingCredentials.length === 0}
              >
                <SelectTrigger className="h-9 border-border/50 bg-background/50 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30">
                  <SelectValue
                    placeholder={
                      matchingCredentials.length
                        ? "Select a profile"
                        : "No saved profiles"
                    }
                  />
                </SelectTrigger>
                <SelectContent align="start">
                  {matchingCredentials.map((credential) => (
                    <SelectItem key={credential._id} value={credential._id}>
                      {credential.login}
                      {credential.isDefault ? " (Default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Agent Capacity (Lanes)">
              <Select
                value={String(form.agentCount)}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    agentCount: Number(value),
                  }))
                }
              >
                <SelectTrigger className="h-9 border-border/50 bg-background/50 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary/30">
                  <SelectValue placeholder="2" />
                </SelectTrigger>
                <SelectContent align="start">
                  {[1, 2, 3, 4, 5, 6].map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count} Agents
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="mt-auto sm:pt-6">
              <Button
                className="w-full text-sm font-medium"
                disabled={createMutation.isPending}
                onClick={() => {
                  void handleCreateOrchestrator();
                }}
              >
                {createMutation.isPending ? "Initializing..." : "Launch Agents"}
                {!createMutation.isPending && (
                  <IconPlayerPlay className="ml-2 size-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* History List */}
      <section className="flex flex-col">
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <h2 className="text-sm font-medium text-foreground">Recent Audits</h2>
          <span className="text-xs text-muted-foreground">
            {orchestrators?.length ?? 0} total
          </span>
        </div>

        {!orchestrators?.length ? (
          <Empty className="my-8 min-h-48 border-dashed bg-transparent">
            <EmptyHeader>
              <EmptyMedia
                variant="icon"
                className="bg-muted/50 text-muted-foreground"
              >
                <IconTargetArrow />
              </EmptyMedia>
              <EmptyTitle>No audits dispatched</EmptyTitle>
              <EmptyDescription>
                The first autonomous audit you launch will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col">
            {orchestrators.map((item) => (
              <div
                key={item.orchestrator._id}
                className="group flex flex-col gap-4 border-b border-border/40 py-4 last:border-0 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:-mx-4 sm:rounded-lg"
              >
                <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
                  <div className="mt-1 shrink-0 sm:mt-0">
                    <StatusIndicator status={item.status} />
                  </div>
                  <div className="grid min-w-0 gap-1.5 sm:gap-1">
                    <Link
                      to="/background-agents/$orchestratorId"
                      params={{ orchestratorId: item.orchestrator._id }}
                      className="truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {item.orchestrator.url}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
                      <span className="truncate max-w-[200px] sm:max-w-none">
                        {getBackgroundTaskLabel(item.orchestrator.instructions)}
                      </span>
                      <span className="hidden h-1 w-1 shrink-0 rounded-full bg-border sm:inline-block" />
                      <span className="hidden sm:inline-block">
                        {item.orchestrator.agentCount} agents
                      </span>
                      <span className="hidden h-1 w-1 shrink-0 rounded-full bg-border sm:inline-block" />
                      <span className="hidden sm:inline-block">
                        {formatSessionDuration(item.durationMs)}
                      </span>
                      <span className="hidden h-1 w-1 shrink-0 rounded-full bg-border sm:inline-block" />
                      <span className="capitalize">{item.status}</span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-3 pl-6">
                  {item.status === "running" || item.status === "queued" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      disabled={
                        stoppingOrchestratorId === item.orchestrator._id ||
                        Boolean(item.orchestrator.stopRequestedAt)
                      }
                      onClick={() => {
                        void handleStop(item.orchestrator._id);
                      }}
                    >
                      <span className="mr-1.5 size-1.5 rounded-sm bg-current" />
                      {stoppingOrchestratorId === item.orchestrator._id ||
                      item.orchestrator.stopRequestedAt
                        ? "Stopping"
                        : "Stop"}
                    </Button>
                  ) : null}
                  <Link
                    to="/background-agents/$orchestratorId"
                    params={{ orchestratorId: item.orchestrator._id }}
                    className={buttonVariants({
                      variant: "secondary",
                      size: "sm",
                      className:
                        "h-8 bg-muted/50 text-xs font-medium hover:bg-muted",
                    })}
                  >
                    {isBackgroundOrchestratorActive(item.status) ? "Open Live Run" : "View Report"}
                    <IconArrowRight className="ml-1.5 size-3.5 opacity-60" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border border-border/40 bg-muted/10 p-4 shadow-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </span>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid gap-2 text-left">
      <Label className="text-[13px] font-medium text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function StatusIndicator({
  status,
}: {
  status: "cancelled" | "completed" | "failed" | "queued" | "running";
}) {
  if (status === "completed") {
    return (
      <div className="size-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.3)]" />
    );
  }

  if (status === "failed") {
    return (
      <div className="size-2.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.3)]" />
    );
  }

  if (status === "cancelled") {
    return <div className="size-2.5 rounded-full bg-zinc-400" />;
  }

  if (status === "running") {
    return (
      <div className="relative flex size-2.5 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
        <span className="relative inline-flex size-2.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
      </div>
    );
  }

  return <div className="size-2.5 animate-pulse rounded-full bg-amber-500" />;
}
