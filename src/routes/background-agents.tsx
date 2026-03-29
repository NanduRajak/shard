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
  IconCircleCheck,
  IconChevronDown,
  IconClockHour4,
  IconAlertTriangle,
  IconHistory,
  IconPlayerPlay,
  IconTargetArrow,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getBackgroundTaskLabel } from "@/lib/background-agent-task";
import { isBackgroundOrchestratorActive } from "@/lib/background-orchestrator-report";
import { createBackgroundOrchestrator } from "@/lib/create-background-orchestrator";
import { makeCredentialDefault } from "@/lib/credentials-server";
import { formatSessionDuration } from "@/lib/run-report";
import {
  getMatchingCredentialsForSiteUrl,
  getPreferredCredentialId,
  LAST_SELECTED_CREDENTIAL_KEY,
  NO_CREDENTIAL_SELECTED,
} from "@/lib/launcher-credentials";
import { requestBackgroundOrchestratorStop } from "@/lib/request-background-orchestrator-stop";
import { validateRunUrl } from "@/lib/run-url";
import { cn } from "@/lib/utils";

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

type CredentialOption = {
  label: string;
  value: string;
  domain?: string;
  isDefault?: boolean;
};

type SimpleDropdownOption = {
  label: string;
  value: string;
};

function CredentialDropdown({
  value,
  options,
  disabled = false,
  onChange,
}: {
  value?: string;
  options: CredentialOption[];
  disabled?: boolean;
  onChange?: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [triggerWidth, setTriggerWidth] = useState(0);
  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!triggerRef.current) return;

    const measure = () => setTriggerWidth(triggerRef.current?.offsetWidth ?? 0);
    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(triggerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;

    const handler = (event: MouseEvent) => {
      if (
        triggerRef.current?.contains(event.target as Node) ||
        menuRef.current?.contains(event.target as Node)
      ) {
        return;
      }

      setOpen(false);
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        className={cn(
          "flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3.5 text-sm transition-all duration-200",
          disabled && "cursor-not-allowed opacity-50",
          open
            ? "border-neutral-600 bg-neutral-800 text-neutral-100"
            : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center overflow-hidden text-left">
          {selected ? (
            <span className="block min-w-0 flex-1 truncate font-medium tracking-[-0.01em]">
              {selected.label}
            </span>
          ) : (
            <span className="block min-w-0 flex-1 truncate text-neutral-500">
              Select login
            </span>
          )}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="shrink-0 text-neutral-500"
        >
          <IconChevronDown className="size-4" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -4, scaleY: 0.96 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
            style={{
              width: triggerWidth > 0 ? Math.max(triggerWidth, 320) : 320,
              transformOrigin: "top",
            }}
            className="absolute left-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 p-2 shadow-2xl shadow-black/50"
          >
            <div className="flex flex-col gap-1">
              {options.map((option, index) => {
                const isSelected = option.value === value;

                return (
                  <motion.div
                    key={option.value}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 30,
                      delay: index * 0.03,
                    }}
                    className="px-1"
                  >
                    <button
                      type="button"
                      title={option.label}
                      onClick={() => {
                        onChange?.(isSelected ? null : option.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "group relative mx-auto flex min-h-12 w-full cursor-pointer items-center rounded-xl px-3 py-1.5 pr-10 text-left outline-none transition-all duration-150",
                        isSelected
                          ? "bg-neutral-800/70 text-neutral-100"
                          : "text-neutral-300 hover:bg-neutral-800/50 hover:text-neutral-100",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="truncate text-[15px] font-medium tracking-[-0.01em] text-inherit">
                            {option.label}
                          </div>
                          {option.domain ? (
                            <div className="truncate text-[10px] leading-3.5 text-neutral-500 transition-colors group-hover:text-neutral-400">
                              {option.domain}
                            </div>
                          ) : null}
                        </div>
                        {option.isDefault ? (
                          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-black">
                            Default
                          </span>
                        ) : null}
                      </div>
                      {isSelected ? (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 500, damping: 25 }}
                          className="absolute right-4 size-2 rounded-full bg-emerald-400"
                        />
                      ) : null}
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SimpleDropdown({
  value,
  options,
  onChange,
}: {
  value?: string;
  options: SimpleDropdownOption[];
  onChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [triggerWidth, setTriggerWidth] = useState(0);
  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!triggerRef.current) return;

    const measure = () => setTriggerWidth(triggerRef.current?.offsetWidth ?? 0);
    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(triggerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;

    const handler = (event: MouseEvent) => {
      if (
        triggerRef.current?.contains(event.target as Node) ||
        menuRef.current?.contains(event.target as Node)
      ) {
        return;
      }

      setOpen(false);
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((current) => !current);
        }}
        className={cn(
          "flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3.5 text-sm transition-all duration-200",
          open
            ? "border-neutral-600 bg-neutral-800 text-neutral-100"
            : "border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800",
        )}
      >
        <span className="block min-w-0 flex-1 truncate text-left font-medium tracking-[-0.01em]">
          {selected?.label ?? "Select"}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="shrink-0 text-neutral-500"
        >
          <IconChevronDown className="size-4" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -4, scaleY: 0.96 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
            style={{
              width: triggerWidth > 0 ? Math.max(triggerWidth, 220) : 220,
              transformOrigin: "top",
            }}
            className="absolute left-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 p-2 shadow-2xl shadow-black/50"
          >
            <div className="flex flex-col gap-1">
              {options.map((option, index) => {
                const isSelected = option.value === value;

                return (
                  <motion.div
                    key={option.value}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 30,
                      delay: index * 0.03,
                    }}
                    className="px-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onChange?.(option.value);
                        setOpen(false);
                      }}
                      className={cn(
                        "relative mx-auto flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-sm outline-none transition-all duration-150",
                        isSelected
                          ? "bg-neutral-800/70 text-neutral-100"
                          : "text-neutral-300 hover:bg-neutral-800/50 hover:text-neutral-100",
                      )}
                    >
                      <span className="truncate">{option.label}</span>
                      {isSelected ? (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 500, damping: 25 }}
                          className="absolute right-4 size-2 rounded-full bg-emerald-400"
                        />
                      ) : null}
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

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

  const isLoadingOrchestrators = orchestrators === undefined;

  const validSiteUrl = useMemo(
    () => validateRunUrl(form.siteUrl),
    [form.siteUrl],
  );
  const hasValidUrl = Boolean(validSiteUrl);
  const availableCredentials = credentials ?? EMPTY_CREDENTIALS;
  const availableCredentialCount = availableCredentials.length;
  const matchingCredentials = useMemo(
    () => getMatchingCredentialsForSiteUrl(availableCredentials, validSiteUrl ?? ""),
    [availableCredentials, validSiteUrl],
  );
  const credentialOptions = useMemo(
    () =>
      matchingCredentials.map((credential) => ({
        label: credential.login,
        value: credential._id,
        domain: credential.origin.replace(/^https?:\/\//, ""),
        isDefault: credential.isDefault,
      })),
    [matchingCredentials],
  );
  const agentOptions = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6].map((count) => ({
        label: `${count} ${count === 1 ? "agent" : "agents"}`,
        value: String(count),
      })),
    [],
  );
  const selectedCredential = useMemo(
    () =>
      availableCredentials.find(
        (credential: (typeof availableCredentials)[number]) =>
          credential._id === selectedCredentialId,
      ) ?? null,
    [availableCredentials, selectedCredentialId],
  );
  const selectedCredentialMatchesUrl = Boolean(
    selectedCredential &&
      matchingCredentials.some((credential) => credential._id === selectedCredential._id),
  );
  const canLaunchAgents = Boolean(hasValidUrl && selectedCredentialMatchesUrl);
  const credentialActionMode =
    credentials === undefined
      ? ("loading" as const)
      : !hasValidUrl
        ? ("disabled-add" as const)
        : matchingCredentials.length > 0
          ? ("select" as const)
          : ("add" as const);

  useEffect(() => {
    if (!availableCredentials.length) {
      setSelectedCredentialId(null);
      return;
    }

    const storedId =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_SELECTED_CREDENTIAL_KEY)
        : null;

    if (storedId === NO_CREDENTIAL_SELECTED) {
      setSelectedCredentialId(null);
      return;
    }

    const restoredCredential = storedId
      ? availableCredentials.find(
          (credential: (typeof availableCredentials)[number]) =>
            credential._id === storedId,
        )
      : null;

    if (restoredCredential) {
      setSelectedCredentialId(restoredCredential._id);
    } else {
      const nextDefaultId = getPreferredCredentialId(availableCredentials);
      const nextDefault =
        availableCredentials.find(
          (credential: (typeof availableCredentials)[number]) =>
            credential._id === nextDefaultId,
        ) ?? null;
      setSelectedCredentialId(nextDefault?._id ?? null);
    }
  }, [availableCredentials]);

  useEffect(() => {
    if (!hasValidUrl) {
      setSelectedCredentialId(null);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          LAST_SELECTED_CREDENTIAL_KEY,
          NO_CREDENTIAL_SELECTED,
        );
      }
      return;
    }

    if (availableCredentialCount === 0) {
      return;
    }

    if (!matchingCredentials.length) {
      if (selectedCredentialId !== null) {
        setSelectedCredentialId(null);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            LAST_SELECTED_CREDENTIAL_KEY,
            NO_CREDENTIAL_SELECTED,
          );
        }
      }
      return;
    }

    const nextCredentialId = getPreferredCredentialId(matchingCredentials);
    const nextCredential =
      matchingCredentials.find(
        (credential: (typeof matchingCredentials)[number]) =>
          credential._id === nextCredentialId,
      ) ?? null;

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
  }, [
    availableCredentialCount,
    hasValidUrl,
    matchingCredentials,
    selectedCredentialId,
  ]);

  const handleCredentialChange = async (credentialId: string | null) => {
    if (!credentialId) {
      setSelectedCredentialId(null);
      setForm((current) => ({
        ...current,
        siteUrl: "",
      }));
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_SELECTED_CREDENTIAL_KEY, NO_CREDENTIAL_SELECTED);
      }
      return;
    }

    const nextCredential =
      availableCredentials.find(
        (credential: (typeof availableCredentials)[number]) =>
          credential._id === credentialId,
      ) ?? null;

    if (!nextCredential || nextCredential._id === selectedCredentialId) {
      return;
    }

    const previousCredentialId = selectedCredentialId;
    const previousSiteUrl = form.siteUrl;
    setSelectedCredentialId(nextCredential._id);
    setForm((current) => ({
      ...current,
      siteUrl: nextCredential.website,
    }));
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
      setForm((current) => ({
        ...current,
        siteUrl: previousSiteUrl,
      }));
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update the default credential.",
      );
    }
  };

  const handleCreateOrchestrator = async () => {
    if (!hasValidUrl) {
      toast.error("Please enter a valid site URL to scan.");
      return;
    }

    if (!selectedCredentialMatchesUrl) {
      toast.error("Please select saved credentials for this website.");
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        data: {
          agentCount: form.agentCount,
          credentialId: selectedCredential._id as Id<"credentials">,
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
            icon={<IconPlayerPlay className="size-4 text-sky-400" />}
            isLoading={isLoadingOrchestrators}
          />
          <StatItem
            label="Queued"
            value={`${orchestrators?.filter((item) => item.status === "queued").length ?? 0}`}
            icon={<IconClockHour4 className="size-4 text-amber-400" />}
            isLoading={isLoadingOrchestrators}
          />
          <StatItem
            label="Completed"
            value={`${orchestrators?.filter((item) => item.status === "completed").length ?? 0}`}
            icon={<IconCircleCheck className="size-4 text-emerald-400" />}
            isLoading={isLoadingOrchestrators}
          />
          <StatItem
            label="Failed"
            value={`${orchestrators?.filter((item) => item.status === "failed").length ?? 0}`}
            icon={<IconAlertTriangle className="size-4 text-rose-400" />}
            isLoading={isLoadingOrchestrators}
          />
        </div>
      </section>

      {/* Launcher Form */}
      <section>
        <form
          className="flex flex-col gap-8 rounded-xl border border-border/40 bg-card p-6 shadow-sm sm:flex-row sm:p-8"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateOrchestrator();
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <Field label="Enter URL">
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
            <Field label="Add credentials">
              <div className="space-y-2">
                {credentialActionMode === "select" ? (
                  <CredentialDropdown
                    value={selectedCredentialId ?? undefined}
                    options={credentialOptions}
                    onChange={(value) => {
                      void handleCredentialChange(value);
                    }}
                  />
                ) : (
                  <div
                    className={cn(
                      "flex h-10 items-center rounded-lg border px-3.5 text-sm",
                      credentialActionMode === "loading"
                        ? "animate-pulse border-neutral-800 bg-neutral-900"
                        : "border-dashed border-border/60 bg-muted/20 text-muted-foreground",
                    )}
                  >
                    {credentialActionMode === "loading"
                      ? null
                      : credentialActionMode === "disabled-add"
                        ? "Enter a valid URL first"
                        : "No saved profiles for this URL"}
                  </div>
                )}

                {credentialActionMode !== "disabled-add" &&
                !(credentialActionMode === "select" && selectedCredential) ? (
                  <p className="text-xs text-muted-foreground">
                    {credentialActionMode === "loading"
                      ? "Checking saved website logins."
                      : credentialActionMode === "add"
                        ? "No saved login matches this website origin yet."
                        : "Choose which saved login background agents should use if sign-in is required."}
                  </p>
                ) : null}
              </div>
            </Field>

            <Field label="Agents">
              <SimpleDropdown
                value={String(form.agentCount)}
                options={agentOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    agentCount: Number(value),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Choose how many parallel agents should run.
              </p>
            </Field>

            <div className="mt-auto sm:pt-6">
              <Button
                type="submit"
                className="w-full text-sm font-medium"
                disabled={createMutation.isPending || !canLaunchAgents}
              >
                {createMutation.isPending ? "Initializing..." : "Launch Agents"}
                {!createMutation.isPending && (
                  <IconPlayerPlay className="ml-2 size-3.5" />
                )}
              </Button>
            </div>
          </div>
        </form>
      </section>

      {/* History List */}
      <section className="flex flex-col">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2.5">
            <IconHistory className="size-4 text-sky-400" />
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-foreground">Recent Audits</h2>
              <span className="text-sm font-medium text-muted-foreground">
                {orchestrators?.length ?? 0}
              </span>
            </div>
          </div>
        </div>

        {isLoadingOrchestrators ? (
          <div className="mt-3 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <HistoryItemSkeleton key={i} />
            ))}
          </div>
        ) : !orchestrators?.length ? (
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
          <div className="mt-3 flex flex-col gap-3">
            {orchestrators.map((item) => (
              <div
                key={item.orchestrator._id}
                className="group flex flex-col gap-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
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
                    className="inline-flex cursor-pointer items-center text-xs font-medium text-foreground transition-colors hover:text-sky-400"
                  >
                    {isBackgroundOrchestratorActive(item.status) ? "Open Live Run" : "View Report"}
                    <IconArrowRight className="ml-1.5 size-3.5 opacity-70" />
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

function StatItem({
  label,
  value,
  icon,
  isLoading,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  isLoading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-border/60 bg-muted/30 p-4 shadow-none">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-muted-foreground/90">{label}</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-8 w-12 rounded-lg" />
      ) : (
        <span className="text-2xl font-semibold tracking-tight text-foreground/95">
          {value}
        </span>
      )}
    </div>
  );
}

function HistoryItemSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-muted/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-start gap-4 sm:items-center">
        <Skeleton className="size-2.5 rounded-full shrink-0 mt-1 sm:mt-0" />
        <div className="grid min-w-0 gap-2 flex-1">
          <Skeleton className="h-4 w-48 sm:w-64" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-1 w-1 rounded-full shrink-0 hidden sm:block" />
            <Skeleton className="h-3 w-16 hidden sm:block" />
            <Skeleton className="h-1 w-1 rounded-full shrink-0 hidden sm:block" />
            <Skeleton className="h-3 w-12 hidden sm:block" />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end pl-6">
        <Skeleton className="h-4 w-20" />
      </div>
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
