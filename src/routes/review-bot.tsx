import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import {
  IconActivity,
  IconArrowRight,
  IconBox,
  IconCheck,
  IconBrandGithub,
  IconChevronDown,
  IconCircleDot,
  IconClock,
  IconCode,
  IconDots,
  IconExternalLink,
  IconFileCode,
  IconFileDescription,
  IconFolder,
  IconGitCommit,
  IconGitPullRequest,
  IconLoader2,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
} from "@tabler/icons-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { FileViewer } from "@/components/ui/file-viewer"
import {
  FieldDescription,
  FieldTitle,
} from "@/components/ui/field"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  disconnectGitHub,
  getRepositoryPullRequests,
  getReviewBotState,
  getTrackedPullRequestDetail,
  rerunTrackedPullRequestReview,
  trackPullRequest,
  trackRepository,
} from "@/lib/review-bot"
import { cn } from "@/lib/utils"

const LAST_REVIEW_BOT_REPO_KEY = "review-bot:last-repo"

export const Route = createFileRoute("/review-bot")({
  component: ReviewBotPage,
  validateSearch: (search: Record<string, unknown>) => ({
    connected: typeof search.connected === "string" ? search.connected : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
})

function ReviewBotPage() {
  const search = Route.useSearch()
  const [selectedRepositoryFullName, setSelectedRepositoryFullName] = useState("")
  const [selectedTrackedPullRequestId, setSelectedTrackedPullRequestId] = useState("")
  const [isRepoPickerOpen, setIsRepoPickerOpen] = useState(false)
  const [repoPickerMenuStyle, setRepoPickerMenuStyle] = useState<React.CSSProperties>({})
  const [isDisconnectDialogOpen, setIsDisconnectDialogOpen] = useState(false)
  const repoPickerRef = useRef<HTMLDivElement | null>(null)
  const {
    data: reviewBotState,
    isLoading,
    refetch,
  } = useQuery({
    queryFn: () => getReviewBotState(),
    queryKey: ["review-bot-state"],
    refetchInterval: 5_000,
  })

  const trackRepositoryMutation = useMutation({
    mutationFn: trackRepository,
    onSuccess: async () => {
      await refetch()
    },
  })
  const trackPullRequestMutation = useMutation({
    mutationFn: trackPullRequest,
    onSuccess: async (result) => {
      setSelectedTrackedPullRequestId(result.trackedPullRequestId)
      await refetch()
    },
  })
  const rerunMutation = useMutation({
    mutationFn: rerunTrackedPullRequestReview,
    onSuccess: async () => {
      await refetch()
    },
  })
  const disconnectMutation = useMutation({
    mutationFn: disconnectGitHub,
    onSuccess: async () => {
      setSelectedRepositoryFullName("")
      setSelectedTrackedPullRequestId("")
      await refetch()
    },
  })

  const selectedRepository = useMemo(
    () =>
      reviewBotState?.accessibleRepositories.find(
        (repository) => repository.fullName === selectedRepositoryFullName
      ) ?? null,
    [reviewBotState?.accessibleRepositories, selectedRepositoryFullName]
  )
  const trackedPullRequests = reviewBotState?.trackedPullRequests ?? []
  const trackedRepoFullNames = useMemo(
    () => new Set((reviewBotState?.trackedRepos ?? []).map((repo) => repo.fullName)),
    [reviewBotState?.trackedRepos]
  )
  const selectedRepositoryIsTracked = selectedRepository
    ? trackedRepoFullNames.has(selectedRepository.fullName)
    : false
  const selectedRepositoryStatus = selectedRepositoryIsTracked ? "ready" : "preparing"
  const selectedRepositoryStatusLabel =
    selectedRepositoryIsTracked ? "Repo ready" : "Preparing repo"

  useEffect(() => {
    if (
      !selectedRepository ||
      selectedRepositoryIsTracked ||
      trackRepositoryMutation.isPending
    ) {
      return
    }

    void trackRepositoryMutation.mutateAsync({
      data: selectedRepository,
    })
  }, [selectedRepository, selectedRepositoryIsTracked, trackRepositoryMutation])

  const {
    data: pullRequestOptions,
    isLoading: isPullRequestsLoading,
  } = useQuery({
    enabled: Boolean(selectedRepository),
    queryFn: () =>
      getRepositoryPullRequests({
        data: {
          fullName: selectedRepository!.fullName,
          installationId: selectedRepository!.installationId,
        },
      }),
    queryKey: [
      "review-bot-pull-requests",
      selectedRepository?.fullName,
      selectedRepository?.installationId,
    ],
    refetchInterval: 30_000,
  })
  const selectedRepositoryTrackedPullRequests = useMemo(
    () =>
      selectedRepository
        ? trackedPullRequests.filter(
            (trackedPullRequest: any) =>
              trackedPullRequest.repoFullName === selectedRepository.fullName
          )
        : [],
    [selectedRepository, trackedPullRequests]
  )
  const trackedPullRequestsForDisplay = selectedRepository
    ? selectedRepositoryTrackedPullRequests
    : []

  useEffect(() => {
    if (typeof window === "undefined" || selectedRepositoryFullName) {
      return
    }

    const storedRepository = window.localStorage.getItem(LAST_REVIEW_BOT_REPO_KEY)

    if (!storedRepository) {
      return
    }

    const exists = reviewBotState?.accessibleRepositories.some(
      (repository) => repository.fullName === storedRepository
    )

    if (exists) {
      setSelectedRepositoryFullName(storedRepository)
    }
  }, [reviewBotState?.accessibleRepositories, selectedRepositoryFullName])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    if (!selectedRepositoryFullName) {
      window.localStorage.removeItem(LAST_REVIEW_BOT_REPO_KEY)
      return
    }

    window.localStorage.setItem(LAST_REVIEW_BOT_REPO_KEY, selectedRepositoryFullName)
  }, [selectedRepositoryFullName])

  useEffect(() => {
    if (!isRepoPickerOpen || typeof window === "undefined") {
      return
    }

    const container = repoPickerRef.current

    if (!container) {
      return
    }

    const rect = container.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const minimumSpaceBelow = 260
    const minimumSpaceAbove = 320
    const placement =
      spaceBelow < minimumSpaceBelow && spaceAbove > minimumSpaceAbove
        ? "top"
        : "bottom"

    setRepoPickerMenuStyle({
      left: rect.left,
      position: "fixed",
      top: placement === "bottom" ? rect.bottom + 8 : undefined,
      bottom:
        placement === "top" ? window.innerHeight - rect.top + 8 : undefined,
      width: rect.width,
      zIndex: 60,
    })
  }, [isRepoPickerOpen])

  useEffect(() => {
    if (!isRepoPickerOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!repoPickerRef.current?.contains(event.target as Node)) {
        setIsRepoPickerOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsRepoPickerOpen(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [isRepoPickerOpen])

  useEffect(() => {
    if (!selectedRepository) {
      setSelectedTrackedPullRequestId("")
      return
    }

    if (!selectedTrackedPullRequestId && trackedPullRequestsForDisplay.length > 0) {
      setSelectedTrackedPullRequestId(trackedPullRequestsForDisplay[0]._id)
    }

    if (
      selectedTrackedPullRequestId &&
      !trackedPullRequestsForDisplay.some(
        (trackedPullRequest: any) =>
          trackedPullRequest._id === selectedTrackedPullRequestId
      )
    ) {
      setSelectedTrackedPullRequestId(trackedPullRequestsForDisplay[0]?._id ?? "")
    }
  }, [
    selectedRepository,
    selectedTrackedPullRequestId,
    trackedPullRequestsForDisplay,
  ])

  const { data: trackedPullRequestDetail } = useQuery({
    enabled: Boolean(selectedRepository && selectedTrackedPullRequestId),
    queryFn: () =>
      getTrackedPullRequestDetail({
        data: { trackedPullRequestId: selectedTrackedPullRequestId },
      }),
    queryKey: ["tracked-pull-request-detail", selectedTrackedPullRequestId],
    refetchInterval: 5_000,
  })
  const reviewFiles = useMemo(() => {
    const changedFiles = trackedPullRequestDetail?.latestReview?.changedFiles ?? []
    const nearbyCode = trackedPullRequestDetail?.latestReview?.nearbyCode ?? []
    const snippetsByPath = new Map<string, Array<any>>()

    for (const snippet of nearbyCode) {
      const snippets = snippetsByPath.get(snippet.filePath) ?? []
      snippets.push(snippet)
      snippetsByPath.set(snippet.filePath, snippets)
    }

    const allPaths = Array.from(
      new Set([
        ...changedFiles,
        ...nearbyCode.map((snippet: any) => snippet.filePath),
      ])
    )

    return allPaths.map((filePath) => {
      const snippets = (snippetsByPath.get(filePath) ?? []).sort(
        (a, b) => a.lineStart - b.lineStart
      )

      return {
        content:
          snippets.length > 0
            ? snippets
                .map(
                  (snippet) =>
                    `// Lines ${snippet.lineStart}-${snippet.lineEnd}\n${snippet.excerpt}`
                )
                .join("\n\n")
            : "No stored review code for this file.",
        path: filePath,
      }
    })
  }, [
    trackedPullRequestDetail?.latestReview?.changedFiles,
    trackedPullRequestDetail?.latestReview?.nearbyCode,
  ])

  if (isLoading && !reviewBotState) {
    return <ReviewBotLoadingState />
  }

  return (
    <div className="grid gap-4">
      {search.error ? (
        <Alert variant="destructive">
          <IconShieldCheck />
          <AlertTitle>GitHub flow needs attention</AlertTitle>
          <AlertDescription>{search.error}</AlertDescription>
        </Alert>
      ) : null}
      {search.connected ? (
        <Alert>
          <IconSparkles />
          <AlertTitle>GitHub is connected</AlertTitle>
          <AlertDescription>
            Pick a repository and the open pull requests will appear instantly
            so you can start tracking reviews with fewer clicks.
          </AlertDescription>
        </Alert>
      ) : null}
      {!reviewBotState?.config.isReady ? (
        <Alert variant="destructive">
          <IconShieldCheck />
          <AlertTitle>Review Bot is not configured yet</AlertTitle>
          <AlertDescription>
            Missing env vars: {reviewBotState?.config.missing.join(", ")}
          </AlertDescription>
        </Alert>
      ) : null}

      {!reviewBotState?.connection ? (
        <Empty className="min-h-[calc(100svh-12rem)] border border-dashed border-border/70 bg-card/60">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconBrandGithub />
            </EmptyMedia>
            <EmptyTitle>Connect GitHub to unlock Review Bot.</EmptyTitle>
            <EmptyDescription>
              Connect GitHub, install the app on selected repos, then add pull
              requests here to receive in-app review feedback.
            </EmptyDescription>
          </EmptyHeader>
          <button
            type="button"
            className={buttonVariants({
              className: "mx-auto mt-6 rounded-2xl px-5",
            })}
            onClick={() => {
              window.location.assign("/api/github/connect")
            }}
          >
            Connect GitHub
            <IconArrowRight className="size-4" />
          </button>
        </Empty>
      ) : (
        <>
          <Card className="border border-border/70 bg-card/80">
            <CardHeader className="gap-3 border-b border-border/70">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="flex w-fit items-center gap-1.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground/80">
                    <IconShieldCheck className="size-4" />
                    Review Bot
                  </span>
                  <div className="relative w-fit pt-1">
                    <div className="flex items-center gap-2 pr-4">
                      <IconBrandGithub className="size-6 text-foreground/75" />
                      <CardTitle className="text-3xl leading-tight">
                        {reviewBotState.connection.login}
                      </CardTitle>
                    </div>
                    <span className="absolute right-0 top-2.5 size-2.5 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(34,197,94,0.8)] animate-pulse" />
                  </div>
                  <CardDescription className="max-w-2xl pt-2 text-sm/6">
                    Track only the repositories and pull requests you care about; Review Bot runs deterministic hygiene checks first, then adds an AI-generated summary when enabled
                  </CardDescription>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-2xl border-transparent bg-transparent shadow-none hover:bg-transparent focus-visible:bg-transparent"
                        aria-label="Open review bot actions"
                      />
                    }
                  >
                    <IconDots className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={8} className="min-w-52">
                    <DropdownMenuItem
                      onClick={() => {
                        window.location.assign("/api/github/install")
                      }}
                    >
                      Manage repo access
                      <IconExternalLink className="ml-auto size-4" />
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => {
                        setIsDisconnectDialogOpen(true)
                      }}
                    >
                      Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2.5 rounded-full border border-border/40 bg-background/50 px-4 py-2 text-sm transition-colors hover:bg-background/80">
                  <IconFolder className="size-4 text-muted-foreground/80" />
                  <span className="text-muted-foreground">Tracked Repos</span>
                  <span className="font-semibold text-foreground">{reviewBotState.trackedRepos.length}</span>
                </div>
                <div className="flex items-center gap-2.5 rounded-full border border-border/40 bg-background/50 px-4 py-2 text-sm transition-colors hover:bg-background/80">
                  <IconGitPullRequest className="size-4 text-muted-foreground/80" />
                  <span className="text-muted-foreground">Tracked PRs</span>
                  <span className="font-semibold text-foreground">{reviewBotState.trackedPullRequests.length}</span>
                </div>
                <div className="flex items-center gap-2.5 rounded-full border border-border/40 bg-background/50 px-4 py-2 text-sm transition-colors hover:bg-background/80">
                  <IconBox className="size-4 text-muted-foreground/80" />
                  <span className="text-muted-foreground">Available Repos</span>
                  <span className="font-semibold text-foreground">{reviewBotState.accessibleRepositories.length}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <AlertDialog
            open={isDisconnectDialogOpen}
            onOpenChange={setIsDisconnectDialogOpen}
          >
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
                <AlertDialogDescription>
                  Review Bot will stop syncing repositories and pull requests for this
                  connection. You can connect GitHub again anytime.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={disconnectMutation.isPending}>
                  Keep connected
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={disconnectMutation.isPending}
                  onClick={() => {
                    void disconnectMutation.mutateAsync({})
                  }}
                >
                  {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <Card className="border border-border/50 bg-card/60 shadow-sm transition-colors hover:border-border/60">
              <CardHeader className="gap-2 pb-4">
                <CardTitle className="text-lg">Choose repo and track PRs</CardTitle>
                <CardDescription className="text-sm/6">
                  Select a repository once. Review Bot will prepare it
                  automatically and load the open pull requests right below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-2">
                {reviewBotState.repositoryLoadError ? (
                  <Alert variant="destructive">
                    <IconShieldCheck />
                    <AlertTitle>Repositories could not be loaded</AlertTitle>
                    <AlertDescription>
                      {reviewBotState.repositoryLoadError}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-5">
                  <section className="rounded-2xl border border-border/40 bg-background/40 p-4 sm:p-5 transition-colors hover:bg-background/50">
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <FieldTitle>Select repository</FieldTitle>
                        <FieldDescription>
                          Search across installed repositories and jump straight into the one you want to review.
                        </FieldDescription>
                      </div>

                      <div ref={repoPickerRef} className="relative">
                        <Button
                          type="button"
                          variant="outline"
                          aria-expanded={isRepoPickerOpen}
                          className="h-12 w-full min-w-0 justify-between rounded-2xl border-border/70 bg-background/80 px-4 font-normal shadow-sm transition-[background-color,border-color,box-shadow] hover:bg-background"
                          onClick={() => {
                            setIsRepoPickerOpen((open) => !open)
                          }}
                        >
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-left",
                              !selectedRepository && "text-muted-foreground"
                            )}
                          >
                            {selectedRepository?.fullName ?? "Search and choose a repository"}
                          </span>
                          <span className="ml-3 flex size-4 shrink-0 items-center justify-center">
                            <IconChevronDown
                              className={cn(
                                "size-4 text-muted-foreground transition-transform duration-200 ease-out",
                                isRepoPickerOpen &&
                                  (repoPickerMenuStyle.bottom !== undefined
                                    ? "rotate-180"
                                    : "rotate-0"),
                                !isRepoPickerOpen && "rotate-0"
                              )}
                            />
                          </span>
                        </Button>

                        {isRepoPickerOpen ? (
                          <div
                            className="z-50"
                            style={repoPickerMenuStyle}
                          >
                            <Command className="rounded-2xl border border-border/70 bg-popover p-2 shadow-2xl ring-1 ring-foreground/10">
                              <CommandInput
                                autoFocus
                                placeholder="Search repositories..."
                              />
                              <CommandList className="max-h-64 sm:max-h-72">
                                <CommandEmpty>No repositories found.</CommandEmpty>
                                <CommandGroup>
                                  {reviewBotState.accessibleRepositories.map((repository) => (
                                    <CommandItem
                                      key={`${repository.installationId}:${repository.fullName}`}
                                      value={`${repository.fullName} ${repository.owner} ${repository.name}`}
                                      onSelect={() => {
                                        setSelectedRepositoryFullName(repository.fullName)
                                        setSelectedTrackedPullRequestId("")
                                        setIsRepoPickerOpen(false)
                                      }}
                                    >
                                      <div className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate">{repository.fullName}</span>
                                        <span className="text-xs text-muted-foreground">
                                          {repository.isPrivate ? "Private repo" : "Public repo"}
                                        </span>
                                      </div>
                                      <IconCheck
                                        className={cn(
                                          "ml-auto size-4",
                                          selectedRepositoryFullName === repository.fullName
                                            ? "opacity-100"
                                            : "opacity-0"
                                        )}
                                      />
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </div>
                        ) : null}
                      </div>

                      {selectedRepository ? (
                        <div className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-foreground">
                                {selectedRepository.fullName}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Pull requests refresh automatically for this repository.
                              </p>
                            </div>
                            <StatusBadge
                              status={selectedRepositoryStatus}
                            >
                              {selectedRepositoryStatusLabel}
                            </StatusBadge>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  <Separator />

                  <section className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <FieldTitle>Open pull requests</FieldTitle>
                        <FieldDescription>
                          Start from any active PR without extra setup steps.
                        </FieldDescription>
                      </div>
                      {selectedRepository && pullRequestOptions ? (
                        <Badge variant="outline" className="tracking-normal">
                          {pullRequestOptions.length} open
                        </Badge>
                      ) : null}
                    </div>

                    {!selectedRepository ? (
                      <div className="rounded-2xl border border-dashed border-border/40 bg-background/30 px-5 py-6 text-center text-sm text-muted-foreground">
                        Choose a repository and the open PRs will appear here automatically.
                      </div>
                    ) : isPullRequestsLoading ? (
                      <PullRequestListSkeleton />
                    ) : (pullRequestOptions ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/40 bg-background/30 px-5 py-6 text-center text-sm text-muted-foreground">
                        This repository does not have any open pull requests yet.
                        Open one on GitHub and it will show up here automatically.
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {(pullRequestOptions ?? []).map((pullRequest, index) => {
                          const trackedPullRequest = selectedRepositoryTrackedPullRequests.find(
                            (item: any) => item.prNumber === pullRequest.number
                          )

                          return (
                            <div
                              key={pullRequest.number}
                              className="rounded-2xl border border-border/70 bg-background/70 p-4 opacity-0 shadow-sm transition-all duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-2 hover:border-border hover:bg-background/80"
                              style={{
                                animationDelay: `${index * 40}ms`,
                                animationFillMode: "forwards",
                              }}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-foreground">
                                    #{pullRequest.number} {pullRequest.title}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {pullRequest.authorLogin
                                      ? `@${pullRequest.authorLogin} • `
                                      : ""}
                                    Updated{" "}
                                    {formatDistanceToNow(new Date(pullRequest.updatedAt), {
                                      addSuffix: true,
                                    })}
                                  </p>
                                </div>
                                {trackedPullRequest ? (
                                  <Button
                                    variant="outline"
                                    className="rounded-2xl"
                                    onClick={() => {
                                      setSelectedTrackedPullRequestId(trackedPullRequest._id)
                                    }}
                                  >
                                    View review
                                  </Button>
                                ) : (
                                  <Button
                                    className="rounded-2xl"
                                    disabled={trackPullRequestMutation.isPending}
                                    onClick={() => {
                                      void trackPullRequestMutation.mutateAsync({
                                        data: {
                                          installationId: selectedRepository.installationId,
                                          prNumber: pullRequest.number,
                                          repo: selectedRepository,
                                        },
                                      })
                                    }}
                                  >
                                    {trackPullRequestMutation.isPending ? (
                                      <IconLoader2 className="size-4 animate-spin" />
                                    ) : (
                                      <IconGitPullRequest className="size-4" />
                                    )}
                                    Track review
                                  </Button>
                                )}
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <StatusBadge status={pullRequest.state} />
                                  <Badge
                                    variant="outline"
                                    className="border-slate-700/80 bg-slate-800 text-slate-100"
                                  >
                                    {pullRequest.headBranch}
                                  </Badge>
                                {trackedPullRequest?.latestReview?.status ? (
                                  <StatusBadge status={trackedPullRequest.latestReview.status} />
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>
                </div>
              </CardContent>
            </Card>

            {selectedRepository ? (
              <Card className="border border-border/50 bg-card/60 shadow-sm transition-colors hover:border-border/60">
                <CardHeader className="gap-2 pb-4">
                  <CardTitle className="text-lg">Tracked pull requests</CardTitle>
                  <CardDescription className="text-sm/6">
                    These are the tracked PRs for {selectedRepository.fullName}.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-2">
                  {trackedPullRequestsForDisplay.length === 0 ? (
                    <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 px-4 py-8 text-center">
                      <div className="flex size-16 items-center justify-center">
                        <IconGitPullRequest
                          aria-hidden="true"
                          className="size-8 text-foreground/75"
                          strokeWidth={2.2}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-base font-medium text-foreground">
                          No tracked pull requests yet
                        </p>
                        <p className="max-w-sm text-sm text-muted-foreground">
                          Choose any open pull request from this repository and
                          Review Bot will start the first review automatically.
                        </p>
                      </div>
                    </div>
                  ) : (
                    trackedPullRequestsForDisplay.map((trackedPullRequest: any) => (
                      <button
                        key={trackedPullRequest._id}
                        type="button"
                        onClick={() => {
                          setSelectedTrackedPullRequestId(trackedPullRequest._id)
                        }}
                        className={`w-full rounded-2xl border p-4 text-left transition-all duration-200 ease-out ${
                          trackedPullRequest._id === selectedTrackedPullRequestId
                            ? "border-primary/40 bg-primary/5 shadow-sm"
                            : "border-border/70 bg-background/70 hover:-translate-y-0.5 hover:bg-muted/70"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">
                              #{trackedPullRequest.prNumber} {trackedPullRequest.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {trackedPullRequest.repoFullName}
                            </p>
                          </div>
                          <StatusBadge status={trackedPullRequest.latestReview?.status ?? "queued"}>
                            {trackedPullRequest.latestReview?.status ?? "queued"}
                          </StatusBadge>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {trackedPullRequest.latestReview?.currentStep ??
                            "Waiting for the first review run."}
                        </p>
                        {trackedPullRequest.latestCommitMessage ? (
                          <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
                            Latest commit: {trackedPullRequest.latestCommitMessage}
                          </p>
                        ) : null}
                        <p className="mt-3 text-xs text-muted-foreground">
                          Updated{" "}
                          {formatDistanceToNow(trackedPullRequest.updatedAt, {
                            addSuffix: true,
                          })}
                        </p>
                      </button>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="border border-border/50 bg-card/60 shadow-sm transition-colors hover:border-border/60">
                <CardHeader className="gap-2 pb-4">
                  <CardTitle className="text-lg">Tracked pull requests</CardTitle>
                  <CardDescription className="text-sm/6">
                    Select a repository first to see its tracked PRs and recent commits.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 px-4 py-8 text-center opacity-80">
                    <div className="flex size-16 items-center justify-center">
                      <IconGitPullRequest
                        aria-hidden="true"
                        className="size-8 text-foreground/75"
                        strokeWidth={2.2}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-base font-medium text-foreground">
                        No repository selected
                      </p>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        Choose a repository to see its tracked pull requests and recent commits.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {trackedPullRequestDetail?.trackedPullRequest ? (
            <Card className="border border-border/50 bg-card/60 shadow-sm transition-colors hover:border-border/60">
            <CardHeader className="gap-4 pb-5">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="space-y-1">
                  <span className="flex w-fit items-center gap-1.5 text-xs font-semibold tracking-widest uppercase text-muted-foreground/80">
                    <IconGitPullRequest className="size-4" />
                    Tracked PR
                  </span>
                  <CardTitle className="pt-1 text-3xl leading-tight">
                    #{trackedPullRequestDetail.trackedPullRequest.prNumber}{" "}
                    {trackedPullRequestDetail.trackedPullRequest.title}
                  </CardTitle>
                  <CardDescription className="pt-1 text-sm/6">
                    {trackedPullRequestDetail.trackedRepo?.fullName}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={trackedPullRequestDetail.trackedPullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({
                      variant: "outline",
                      className: "rounded-2xl",
                    })}
                  >
                    <IconBrandGithub className="size-4" />
                    Open on GitHub
                  </a>
                  <Button
                    className="rounded-2xl"
                    variant="outline"
                    disabled={rerunMutation.isPending}
                    onClick={() => {
                      void rerunMutation.mutateAsync({
                        data: {
                          trackedPullRequestId:
                            trackedPullRequestDetail.trackedPullRequest._id,
                        },
                      })
                    }}
                  >
                    {rerunMutation.isPending ? (
                      <IconLoader2 className="size-4 animate-spin" />
                    ) : (
                      <IconRefresh className="size-4" />
                    )}
                    Review again
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
                <Tabs defaultValue="overview" className="gap-4">
                  <TabsList variant="line">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="findings">
                      Findings ({trackedPullRequestDetail.findings.length})
                    </TabsTrigger>
                    <TabsTrigger value="context">Context</TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="overview"
                    className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]"
                  >
                    <div className="grid gap-4">
                      <MetricGrid
                        metrics={[
                          {
                            label: "Status",
                            value: trackedPullRequestDetail.latestReview?.status ?? "queued",
                            icon: IconActivity,
                          },
                          {
                            label: "Current Step",
                            value:
                              trackedPullRequestDetail.latestReview?.currentStep ??
                              "Waiting for review",
                            icon: IconCircleDot,
                          },
                          {
                            label: "Head SHA",
                            value: truncateSha(
                              trackedPullRequestDetail.trackedPullRequest.headSha
                            ),
                            icon: IconGitCommit,
                          },
                          {
                            label: "Last Update",
                            value: formatDistanceToNow(
                              trackedPullRequestDetail.trackedPullRequest.updatedAt,
                              { addSuffix: true }
                            ),
                            icon: IconClock,
                          },
                        ]}
                      />
                      {trackedPullRequestDetail.latestReview?.summary ? (
                        <InfoPanel
                          title="PR summary"
                          body={trackedPullRequestDetail.latestReview.summary}
                        />
                      ) : null}
                      {trackedPullRequestDetail.latestReview?.riskSummary ? (
                        <InfoPanel
                          title="Risk summary"
                          body={trackedPullRequestDetail.latestReview.riskSummary}
                        />
                      ) : null}
                      {trackedPullRequestDetail.latestReview?.testSuggestions ? (
                        <InfoPanel
                          title="Test suggestions"
                          body={trackedPullRequestDetail.latestReview.testSuggestions}
                        />
                      ) : null}
                      {trackedPullRequestDetail.latestReview?.errorMessage ? (
                        <Alert variant="destructive">
                          <IconShieldCheck />
                          <AlertTitle>Review run reported an error</AlertTitle>
                          <AlertDescription>
                            {trackedPullRequestDetail.latestReview.errorMessage}
                          </AlertDescription>
                        </Alert>
                      ) : null}
                    </div>
                    <div className="grid gap-4">
                      <Card className="border border-border/40 bg-background/40 shadow-none">
                        <CardHeader className="gap-2 pb-3">
                          <CardTitle className="text-lg">Checker status</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-0">
                          {(trackedPullRequestDetail.latestReview?.checkerResults ?? []).map(
                            (checkerResult: any) => (
                              <div
                                key={checkerResult.checker}
                                className="rounded-2xl border border-border/70 bg-card/80 p-3"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-medium capitalize">
                                    {checkerResult.checker}
                                  </p>
                                  <StatusBadge status={checkerResult.status}>
                                    {checkerResult.status}
                                  </StatusBadge>
                                </div>
                                {checkerResult.details ? (
                                  <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                                    {checkerResult.details}
                                  </p>
                                ) : null}
                              </div>
                            )
                          )}
                        </CardContent>
                      </Card>

                      <Card className="border border-border/40 bg-background/40 shadow-none">
                        <CardHeader className="gap-2 pb-3">
                          <CardTitle className="text-lg">Inline comments</CardTitle>
                          <CardDescription className="text-sm/6">
                            High-confidence line-level feedback generated after
                            deterministic checks complete.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-0">
                          {(trackedPullRequestDetail.latestReview?.inlineComments ?? [])
                            .length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No inline comments were generated for the latest
                              review.
                            </p>
                          ) : (
                            trackedPullRequestDetail.latestReview?.inlineComments?.map(
                              (comment: any, index: number) => (
                                <div
                                  key={`${comment.filePath}:${comment.line ?? index}`}
                                  className="rounded-2xl border border-border/70 bg-card/80 p-3"
                                >
                                  <p className="text-xs font-medium text-muted-foreground">
                                    {comment.filePath}
                                    {comment.line ? `:${comment.line}` : ""}
                                  </p>
                                  <p className="mt-2 text-sm text-foreground">
                                    {comment.body}
                                  </p>
                                </div>
                              )
                            )
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </TabsContent>

                  <TabsContent value="findings" className="grid gap-3">
                    {trackedPullRequestDetail.findings.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-5 text-sm text-muted-foreground">
                        No normalized findings are stored for the latest review
                        yet.
                      </div>
                    ) : (
                      trackedPullRequestDetail.findings.map((finding: any) => (
                        <div
                          key={finding._id}
                          className="rounded-2xl border border-border/70 bg-background/70 p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-foreground">
                                {finding.title}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {[finding.category, finding.checker, finding.filePath]
                                  .filter(Boolean)
                                  .join(" • ")}
                                {finding.line ? `:${finding.line}` : ""}
                              </p>
                            </div>
                            <StatusBadge status={finding.severity}>
                              {finding.severity}
                            </StatusBadge>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                            {finding.description}
                          </p>
                          {finding.suggestedFix ? (
                            <p className="mt-3 text-sm text-foreground">
                              Suggested fix: {finding.suggestedFix}
                            </p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="context" className="grid gap-4 lg:grid-cols-2">
                    <Card className="border border-border/40 bg-background/40 shadow-none lg:col-span-2">
                      <CardHeader className="gap-2 pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <IconCode className="size-4 text-muted-foreground/80" />
                          Review code
                        </CardTitle>
                        <CardDescription className="text-sm/6">
                          Select a file from the list to inspect the stored review
                          context beside it.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <FileViewer
                          files={reviewFiles}
                          emptyMessage="No changed files or stored code context are available for this review."
                        />
                      </CardContent>
                    </Card>
                    <Card className="border border-border/40 bg-background/40 shadow-none">
                      <CardHeader className="gap-2 pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <IconFileDescription className="size-4 text-muted-foreground/80" />
                          File summaries
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-0">
                        {(trackedPullRequestDetail.latestReview?.fileSummaries ?? []).map(
                          (summary: any) => (
                            <div
                              key={summary.path}
                              className="rounded-xl border border-border/70 bg-card/80 p-4"
                            >
                              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                <IconFileCode className="size-3.5" />
                                {summary.path}
                              </p>
                              <p className="mt-3 text-sm leading-relaxed text-foreground">
                                {summary.summary}
                              </p>
                            </div>
                          )
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
            </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon?: any }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-border/40 bg-background/40 p-5 transition-colors hover:bg-background/50">
      <dt className="flex items-center gap-2 text-muted-foreground">
        {Icon ? <Icon className="size-4 opacity-80" /> : null}
        <span className="text-[11px] font-semibold tracking-[0.18em] uppercase">
          {label}
        </span>
      </dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  )
}

function ReviewBotLoadingState() {
  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden border border-border/70 bg-card/80">
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-3">
            <Skeleton className="h-4 w-28 rounded-full bg-muted/70" />
            <Skeleton className="h-8 w-64 bg-muted/70" />
            <Skeleton className="h-4 w-full max-w-2xl bg-muted/60" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="rounded-2xl border border-border/60 bg-background/60 p-4"
              >
                <Skeleton className="h-3 w-28 bg-muted/60" />
                <Skeleton className="mt-3 h-7 w-16 bg-muted/70" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden border border-border/70 bg-card/80">
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-2">
              <Skeleton className="h-7 w-64 bg-muted/70" />
              <Skeleton className="h-4 w-full max-w-xl bg-muted/60" />
            </div>
            <div className="rounded-[1.35rem] border border-border/60 bg-background/50 p-5">
              <Skeleton className="h-4 w-32 bg-muted/60" />
              <Skeleton className="mt-2 h-4 w-56 bg-muted/50" />
              <Skeleton className="mt-4 h-12 w-full rounded-2xl bg-muted/70" />
              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-background/60 px-4 py-3">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40 bg-muted/60" />
                  <Skeleton className="h-3 w-48 bg-muted/50" />
                </div>
                <Skeleton className="h-6 w-24 rounded-full bg-muted/70" />
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-36 bg-muted/60" />
                  <Skeleton className="h-4 w-56 bg-muted/50" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full bg-muted/70" />
              </div>
              <PullRequestListSkeleton />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border border-border/70 bg-card/80">
          <CardContent className="space-y-5 pt-6">
            <div className="space-y-2">
              <Skeleton className="h-7 w-52 bg-muted/70" />
              <Skeleton className="h-4 w-64 bg-muted/60" />
            </div>
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={index}
                className="rounded-2xl border border-border/60 bg-background/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-72 max-w-full bg-muted/70" />
                    <Skeleton className="h-4 w-32 bg-muted/50" />
                  </div>
                  <Skeleton className="h-6 w-24 rounded-full bg-muted/70" />
                </div>
                <Skeleton className="mt-4 h-4 w-40 bg-muted/50" />
                <Skeleton className="mt-3 h-4 w-full bg-muted/50" />
                <Skeleton className="mt-4 h-4 w-32 bg-muted/50" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricGrid({
  metrics,
}: {
  metrics: Array<{
    label: string
    value: string
    icon?: any
  }>
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {metrics.map((metric) => (
        <Metric key={metric.label} label={metric.label} value={metric.value} icon={metric.icon} />
      ))}
    </div>
  )
}

function InfoPanel({ title, body }: { body: string; title: string }) {
  return (
    <Card className="border border-border/40 bg-background/40 shadow-none transition-colors hover:bg-background/50">
      <CardHeader className="gap-2 pb-3">
        <CardTitle className="text-[15px] font-semibold tracking-tight">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm/relaxed text-muted-foreground">{body}</CardContent>
    </Card>
  )
}

function PullRequestListSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-border/70 bg-background/70 p-4 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/4 bg-muted/70" />
              <Skeleton className="mt-3 h-3 w-1/3 bg-muted/50" />
            </div>
            <Skeleton className="h-9 w-28 rounded-2xl bg-muted/70" />
          </div>
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-6 w-16 rounded-full bg-muted/70" />
            <Skeleton className="h-6 w-20 rounded-full bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  )
}

function StatusBadge({
  children,
  status,
}: {
  children?: ReactNode
  status: string
}) {
  const normalizedStatus = status.toLowerCase()

  return (
    <Badge
      variant="outline"
      className={cn(
        "border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
        normalizedStatus === "completed" ||
          normalizedStatus === "passed" ||
          normalizedStatus === "open" ||
          normalizedStatus === "ready"
          ? "border-emerald-700/80 bg-emerald-950/80 text-emerald-200"
          : normalizedStatus === "failed" ||
              normalizedStatus === "critical" ||
              normalizedStatus === "high"
            ? "border-rose-700/80 bg-rose-950/80 text-rose-200"
            : normalizedStatus === "queued" ||
                normalizedStatus === "running" ||
                normalizedStatus === "preparing" ||
                normalizedStatus === "pending"
              ? "border-amber-700/80 bg-amber-950/80 text-amber-200"
              : "border-slate-700/80 bg-slate-800 text-slate-100"
      )}
    >
      {children ?? status}
    </Badge>
  )
}

function truncateSha(value: string) {
  return value.slice(0, 8)
}
