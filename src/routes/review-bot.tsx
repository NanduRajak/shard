import { createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import {
  IconArrowRight,
  IconBrandGithub,
  IconExternalLink,
  IconGitPullRequest,
  IconLoader2,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
} from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
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
  const [selectedPullRequestNumber, setSelectedPullRequestNumber] = useState("")
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
      setSelectedPullRequestNumber("")
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
  const { data: pullRequestOptions } = useQuery({
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
  const trackedPullRequests = reviewBotState?.trackedPullRequests ?? []

  useEffect(() => {
    if (
      !selectedTrackedPullRequestId &&
      trackedPullRequests.length > 0
    ) {
      setSelectedTrackedPullRequestId(trackedPullRequests[0]._id)
    }

    if (
      selectedTrackedPullRequestId &&
      !trackedPullRequests.some(
        (trackedPullRequest: any) =>
          trackedPullRequest._id === selectedTrackedPullRequestId
      )
    ) {
      setSelectedTrackedPullRequestId(trackedPullRequests[0]?._id ?? "")
    }
  }, [selectedTrackedPullRequestId, trackedPullRequests])

  const { data: trackedPullRequestDetail } = useQuery({
    enabled: Boolean(selectedTrackedPullRequestId),
    queryFn: () =>
      getTrackedPullRequestDetail({
        data: { trackedPullRequestId: selectedTrackedPullRequestId },
      }),
    queryKey: ["tracked-pull-request-detail", selectedTrackedPullRequestId],
    refetchInterval: 5_000,
  })

  if (isLoading && !reviewBotState) {
    return (
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="min-h-72 border border-border/70 bg-card/70" />
        <Card className="min-h-72 border border-border/70 bg-card/70" />
      </div>
    )
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
            Pick a repository, track the PRs you care about, and Review Bot will
            keep the latest feedback here.
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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <Badge variant="outline" className="w-fit tracking-[0.18em] uppercase">
                    Review Bot
                  </Badge>
                  <CardTitle className="text-2xl">
                    Connected as @{reviewBotState.connection.login}
                  </CardTitle>
                  <CardDescription className="max-w-3xl text-sm/6">
                    Track only the repositories and pull requests you care
                    about. Review Bot runs deterministic hygiene checks first,
                    then adds an AI-written summary only when that step is
                    configured.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonVariants({
                      variant: "outline",
                      className: "rounded-2xl",
                    })}
                    onClick={() => {
                      window.location.assign("/api/github/install")
                    }}
                  >
                    Manage repo access
                    <IconExternalLink className="size-4" />
                  </button>
                    <Button
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => {
                        void disconnectMutation.mutateAsync({})
                      }}
                      disabled={disconnectMutation.isPending}
                    >
                    Disconnect
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4 md:grid-cols-3">
              <Metric
                label="Tracked Repositories"
                value={String(reviewBotState.trackedRepos.length)}
              />
              <Metric
                label="Tracked PRs"
                value={String(reviewBotState.trackedPullRequests.length)}
              />
              <Metric
                label="Installed Repos Available"
                value={String(reviewBotState.accessibleRepositories.length)}
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <Card className="border border-border/70 bg-card/80">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="text-lg">Add repo and PR</CardTitle>
                <CardDescription>
                  Pick a repository from your installed GitHub App access, then
                  track the pull requests that should stay in Review Bot.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 pt-5">
                {reviewBotState.repositoryLoadError ? (
                  <Alert variant="destructive">
                    <IconShieldCheck />
                    <AlertTitle>Repositories could not be loaded</AlertTitle>
                    <AlertDescription>
                      {reviewBotState.repositoryLoadError}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <FieldSet>
                  <FieldGroup>
                    <Field>
                      <FieldLabel>
                        <FieldContent>
                          <FieldTitle>Select repository</FieldTitle>
                          <FieldDescription>
                            Installed repositories available to this connected
                            GitHub account.
                          </FieldDescription>
                        </FieldContent>
                        <NativeSelect
                          value={selectedRepositoryFullName}
                          onChange={(event) => {
                            setSelectedRepositoryFullName(event.target.value)
                            setSelectedPullRequestNumber("")
                          }}
                        >
                          <NativeSelectOption value="">
                            Choose a repository
                          </NativeSelectOption>
                          {reviewBotState.accessibleRepositories.map((repository) => (
                            <NativeSelectOption
                              key={`${repository.installationId}:${repository.fullName}`}
                              value={repository.fullName}
                            >
                              {repository.fullName}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </FieldLabel>
                    </Field>
                    <div className="flex justify-end">
                      <Button
                        className="rounded-2xl"
                        variant="outline"
                        disabled={!selectedRepository || trackRepositoryMutation.isPending}
                        onClick={() => {
                          if (!selectedRepository) {
                            return
                          }

                          void trackRepositoryMutation.mutateAsync({
                            data: selectedRepository,
                          })
                        }}
                      >
                        {trackRepositoryMutation.isPending ? (
                          <IconLoader2 className="size-4 animate-spin" />
                        ) : (
                          <IconBrandGithub className="size-4" />
                        )}
                        Add repository
                      </Button>
                    </div>
                  </FieldGroup>

                  <Separator />

                  <FieldGroup>
                    <Field>
                      <FieldLabel>
                        <FieldContent>
                          <FieldTitle>Select open PR</FieldTitle>
                          <FieldDescription>
                            Review Bot will create a tracked PR entry and start
                            a background review immediately.
                          </FieldDescription>
                        </FieldContent>
                        <NativeSelect
                          value={selectedPullRequestNumber}
                          onChange={(event) => {
                            setSelectedPullRequestNumber(event.target.value)
                          }}
                          disabled={!selectedRepository}
                        >
                          <NativeSelectOption value="">
                            Choose an open pull request
                          </NativeSelectOption>
                          {(pullRequestOptions ?? []).map((pullRequest) => (
                            <NativeSelectOption
                              key={pullRequest.number}
                              value={String(pullRequest.number)}
                            >
                              #{pullRequest.number} {pullRequest.title}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </FieldLabel>
                    </Field>
                    <div className="flex justify-end">
                      <Button
                        className="rounded-2xl"
                        disabled={
                          !selectedRepository ||
                          !selectedPullRequestNumber ||
                          trackPullRequestMutation.isPending
                        }
                        onClick={() => {
                          if (!selectedRepository || !selectedPullRequestNumber) {
                            return
                          }

                          void trackPullRequestMutation.mutateAsync({
                            data: {
                              installationId: selectedRepository.installationId,
                              prNumber: Number(selectedPullRequestNumber),
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
                        Track PR
                      </Button>
                    </div>
                  </FieldGroup>
                </FieldSet>
              </CardContent>
            </Card>

            <Card className="border border-border/70 bg-card/80">
              <CardHeader className="gap-3 border-b border-border/70">
                <CardTitle className="text-lg">Tracked pull requests</CardTitle>
                <CardDescription>
                  These are the PRs Review Bot will keep in sync when new commits
                  arrive through GitHub webhooks.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-5">
                {trackedPullRequests.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
                    No tracked PRs yet. Add a repository and choose an open pull
                    request to start the first review.
                  </div>
                ) : (
                  trackedPullRequests.map((trackedPullRequest: any) => (
                    <button
                      key={trackedPullRequest._id}
                      type="button"
                      onClick={() => {
                        setSelectedTrackedPullRequestId(trackedPullRequest._id)
                      }}
                      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                        trackedPullRequest._id === selectedTrackedPullRequestId
                          ? "border-primary/50 bg-primary/5"
                          : "border-border/70 bg-background/70 hover:bg-muted/70"
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
                        <Badge
                          variant={
                            trackedPullRequest.latestReview?.status === "failed"
                              ? "destructive"
                              : trackedPullRequest.latestReview?.status === "completed"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {trackedPullRequest.latestReview?.status ?? "queued"}
                        </Badge>
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
          </div>

          <Card className="border border-border/70 bg-card/80">
            <CardHeader className="gap-3 border-b border-border/70">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="text-lg">
                    {trackedPullRequestDetail?.trackedPullRequest
                      ? `#${trackedPullRequestDetail.trackedPullRequest.prNumber} ${trackedPullRequestDetail.trackedPullRequest.title}`
                      : "Review detail"}
                  </CardTitle>
                  <CardDescription>
                    {trackedPullRequestDetail?.trackedRepo
                      ? trackedPullRequestDetail.trackedRepo.fullName
                      : "Select a tracked pull request to inspect the latest review output."}
                  </CardDescription>
                </div>
                {trackedPullRequestDetail?.trackedPullRequest ? (
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
                      Open on GitHub
                      <IconExternalLink className="size-4" />
                    </a>
                    <Button
                      className="rounded-2xl"
                      variant="outline"
                      disabled={rerunMutation.isPending}
                      onClick={() => {
                        void rerunMutation.mutateAsync({
                          data: {
                            trackedPullRequestId:
                              trackedPullRequestDetail.trackedPullRequest!._id,
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
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              {!trackedPullRequestDetail?.trackedPullRequest ? (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-5 text-sm text-muted-foreground">
                  Select a tracked PR from the list above to inspect its summary,
                  findings, checker states, and inline feedback.
                </div>
              ) : (
                <Tabs defaultValue="overview" className="gap-4">
                  <TabsList variant="line">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="findings">
                      Findings ({trackedPullRequestDetail.findings.length})
                    </TabsTrigger>
                    <TabsTrigger value="context">Context</TabsTrigger>
                  </TabsList>

                  <TabsContent value="overview" className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="grid gap-4">
                      <MetricGrid
                        metrics={[
                          {
                            label: "Status",
                            value: trackedPullRequestDetail.latestReview?.status ?? "queued",
                          },
                          {
                            label: "Current Step",
                            value:
                              trackedPullRequestDetail.latestReview?.currentStep ??
                              "Waiting for review",
                          },
                          {
                            label: "Head SHA",
                            value: truncateSha(
                              trackedPullRequestDetail.trackedPullRequest.headSha
                            ),
                          },
                          {
                            label: "Last Update",
                            value: formatDistanceToNow(
                              trackedPullRequestDetail.trackedPullRequest.updatedAt,
                              { addSuffix: true }
                            ),
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
                      <Card className="border border-border/70 bg-background/70">
                        <CardHeader className="gap-2 border-b border-border/70">
                          <CardTitle className="text-base">Checker status</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-4">
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
                                  <Badge
                                    variant={
                                      checkerResult.status === "failed"
                                        ? "destructive"
                                        : checkerResult.status === "passed"
                                          ? "default"
                                          : "secondary"
                                    }
                                  >
                                    {checkerResult.status}
                                  </Badge>
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

                      <Card className="border border-border/70 bg-background/70">
                        <CardHeader className="gap-2 border-b border-border/70">
                          <CardTitle className="text-base">Inline comments</CardTitle>
                          <CardDescription>
                            High-confidence line-level feedback generated after
                            deterministic checks complete.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 pt-4">
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
                            <Badge
                              variant={
                                finding.severity === "critical" ||
                                finding.severity === "high"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {finding.severity}
                            </Badge>
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
                    <Card className="border border-border/70 bg-background/70">
                      <CardHeader className="gap-2 border-b border-border/70">
                        <CardTitle className="text-base">Changed files</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 pt-4">
                        {(trackedPullRequestDetail.latestReview?.changedFiles ?? []).map(
                          (filePath: string) => (
                            <div
                              key={filePath}
                              className="rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-sm text-foreground"
                            >
                              {filePath}
                            </div>
                          )
                        )}
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70 bg-background/70">
                      <CardHeader className="gap-2 border-b border-border/70">
                        <CardTitle className="text-base">File summaries</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-4">
                        {(trackedPullRequestDetail.latestReview?.fileSummaries ?? []).map(
                          (summary: any) => (
                            <div
                              key={summary.path}
                              className="rounded-xl border border-border/70 bg-card/80 p-3"
                            >
                              <p className="text-xs font-medium text-muted-foreground">
                                {summary.path}
                              </p>
                              <p className="mt-2 text-sm text-foreground">
                                {summary.summary}
                              </p>
                            </div>
                          )
                        )}
                      </CardContent>
                    </Card>
                    <Card className="border border-border/70 bg-background/70 lg:col-span-2">
                      <CardHeader className="gap-2 border-b border-border/70">
                        <CardTitle className="text-base">Nearby code</CardTitle>
                        <CardDescription>
                          Stored code windows around changed lines to help the
                          summary step stay grounded in the PR context.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-4">
                        {(trackedPullRequestDetail.latestReview?.nearbyCode ?? []).map(
                          (snippet: any, index: number) => (
                            <div
                              key={`${snippet.filePath}:${snippet.lineStart}:${index}`}
                              className="overflow-hidden rounded-2xl border border-border/70 bg-card/80"
                            >
                              <div className="border-b border-border/70 px-4 py-3 text-xs font-medium text-muted-foreground">
                                {snippet.filePath} ({snippet.lineStart}-{snippet.lineEnd})
                              </div>
                              <pre className="overflow-x-auto px-4 py-4 text-xs leading-6 text-foreground">
                                {snippet.excerpt}
                              </pre>
                            </div>
                          )
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 rounded-2xl border border-border/70 bg-background/70 p-4">
      <dt className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  )
}

function MetricGrid({
  metrics,
}: {
  metrics: Array<{
    label: string
    value: string
  }>
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {metrics.map((metric) => (
        <Metric key={metric.label} label={metric.label} value={metric.value} />
      ))}
    </div>
  )
}

function InfoPanel({ title, body }: { body: string; title: string }) {
  return (
    <Card className="border border-border/70 bg-background/70">
      <CardHeader className="gap-2 border-b border-border/70">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4 text-sm/6 text-foreground">{body}</CardContent>
    </Card>
  )
}

function truncateSha(value: string) {
  return value.slice(0, 8)
}
