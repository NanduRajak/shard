import { NonRetriableError } from "inngest"
import type { Id } from "../convex/_generated/dataModel"
import { api } from "../convex/_generated/api"
import { createConvexServerClient } from "~/server/convex"
import {
  applyReviewPathFilters,
  getMatchedPathInstructions,
  loadReviewBotConfig,
  shouldAutoReviewPullRequest,
} from "~/server/review-bot-config"
import {
  buildInlineReviewCommentBody,
  buildSummaryComment,
  buildWalkthroughComment,
} from "~/server/review-bot-publish"
import {
  buildDiffSummary,
  buildFileSummaries,
  buildNearbyCode,
  captureReviewFiles,
  filterFindingsToIncludedFiles,
  resolvePatchPositionForLine,
  runReviewCheckers,
  summarizeReviewWithAI,
} from "~/server/review-bot-review"
import {
  compareCommitRange,
  createIssueComment,
  createPullRequestReview,
  getPullRequestDetails,
  getRepositoryFileContent,
  listPullRequestFiles,
  updateIssueComment,
} from "~/server/github"
import { inngest } from "./core"

type PrReviewRequestedEvent = {
  data: {
    reviewId: Id<"prReviews">
  }
}

function getAccumulatedReviewedCommits(
  reviewHistory: Array<{
    _id: Id<"prReviews">
    reviewMode: "full" | "incremental"
    reviewedCommitCountDelta?: number
    status: "completed" | "failed" | "queued" | "running" | "skipped"
  }>,
  currentReviewId: Id<"prReviews">
) {
  let total = 0

  for (const historyReview of reviewHistory) {
    if (historyReview._id === currentReviewId || historyReview.status !== "completed") {
      continue
    }

    if (historyReview.reviewMode === "full") {
      break
    }

    total += historyReview.reviewedCommitCountDelta ?? 0
  }

  return total
}

function getReusableCommentId(
  reviewHistory: Array<{
    _id: Id<"prReviews">
    githubSummaryCommentId?: number
  }>,
  currentReviewId: Id<"prReviews">
) {
  return (
    reviewHistory.find(
      (historyReview) =>
        historyReview._id !== currentReviewId &&
        typeof historyReview.githubSummaryCommentId === "number"
    )?.githubSummaryCommentId ?? null
  )
}

export const prReview = inngest.createFunction(
  {
    id: "pr-review",
    retries: 1,
    triggers: [{ event: "app/pr-review.requested" }],
    onFailure: async ({ event, error }) => {
      const convex = createConvexServerClient()
      const failedEvent = event as unknown as PrReviewRequestedEvent
      const reviewId = failedEvent?.data?.reviewId

      if (!reviewId) {
        return
      }

      await convex.mutation(api.reviewBot.updatePrReview, {
        currentStep: "PR review failed",
        errorMessage: error.message,
        finishedAt: Date.now(),
        reviewId,
        status: "failed",
      })
    },
  },
  async ({ event }: { event: PrReviewRequestedEvent }) => {
    const convex = createConvexServerClient()
    const context = await convex.query(api.reviewBot.getPrReviewWorkflowContext, {
      reviewId: event.data.reviewId,
    })

    if (!context) {
      throw new NonRetriableError("PR review context could not be loaded.")
    }

    const { review, reviewHistory, trackedPullRequest, trackedRepo } = context

    try {
      await convex.mutation(api.reviewBot.updatePrReview, {
        currentStep: "Refreshing pull request context",
        errorMessage: null,
        reviewId: review._id,
        status: "running",
      })

      const pullRequest = await getPullRequestDetails({
        installationId: trackedRepo.installationId,
        owner: trackedRepo.owner,
        pullNumber: trackedPullRequest.prNumber,
        repo: trackedRepo.name,
      })
      const configResult = await loadReviewBotConfig({
        installationId: trackedRepo.installationId,
        owner: trackedRepo.owner,
        ref: pullRequest.headSha,
        repo: trackedRepo.name,
      })

      if (!review.isManualTrigger) {
        const autoReviewDecision = shouldAutoReviewPullRequest({
          authorLogin: pullRequest.authorLogin,
          baseBranch: pullRequest.baseBranch,
          config: configResult.config,
          defaultBranch: trackedRepo.defaultBranch,
          isDraft: pullRequest.isDraft,
          title: pullRequest.title,
        })

        if (!autoReviewDecision.allowed) {
          await convex.mutation(api.reviewBot.updatePrReview, {
            currentStep: autoReviewDecision.reason,
            finishedAt: Date.now(),
            githubPublicationStatus: "skipped",
            llmStatus: "skipped",
            reviewId: review._id,
            status: "skipped",
          })

          return
        }
      }

      if (
        !review.isManualTrigger &&
        review.reviewMode === "incremental" &&
        !configResult.config.reviews.autoReview.autoIncrementalReview
      ) {
        await convex.mutation(api.reviewBot.updatePrReview, {
          currentStep: "Incremental reviews are disabled by repo config.",
          finishedAt: Date.now(),
          githubPublicationStatus: "skipped",
          llmStatus: "skipped",
          reviewId: review._id,
          status: "skipped",
        })

        return
      }

      const files = await listPullRequestFiles({
        installationId: trackedRepo.installationId,
        owner: trackedRepo.owner,
        pullNumber: trackedPullRequest.prNumber,
        repo: trackedRepo.name,
      })
      let reviewMode = review.reviewMode
      let reviewScopeFiles = files
      let reviewedCommitCountDelta = 0

      if (reviewMode === "incremental" && review.previousReviewedHeadSha) {
        try {
          const comparison = await compareCommitRange({
            baseRef: review.previousReviewedHeadSha,
            headRef: pullRequest.headSha,
            installationId: trackedRepo.installationId,
            owner: trackedRepo.owner,
            repo: trackedRepo.name,
          })

          reviewedCommitCountDelta = comparison.totalCommits

          if (comparison.totalCommits === 0 || comparison.files.length === 0) {
            await convex.mutation(api.reviewBot.updatePrReview, {
              currentStep: "No new changes were detected for incremental review.",
              finishedAt: Date.now(),
              githubPublicationStatus: "skipped",
              llmStatus: "skipped",
              reviewId: review._id,
              reviewMode,
              reviewedCommitCountDelta,
              status: "skipped",
            })

            return
          }

          const reviewScopePaths = new Set(
            comparison.files.map((file) => file.filename)
          )
          const scopedFiles = files.filter((file) => reviewScopePaths.has(file.filename))

          if (scopedFiles.length > 0) {
            reviewScopeFiles = scopedFiles
          } else {
            reviewMode = "full"
            reviewedCommitCountDelta = 0
          }
        } catch {
          reviewMode = "full"
          reviewedCommitCountDelta = 0
        }
      } else if (reviewMode === "incremental") {
        reviewMode = "full"
      }

      if (
        !review.isManualTrigger &&
        reviewMode === "incremental" &&
        configResult.config.reviews.autoReview.autoPauseAfterReviewedCommits > 0
      ) {
        const accumulatedReviewedCommits = getAccumulatedReviewedCommits(
          reviewHistory,
          review._id
        )

        if (
          accumulatedReviewedCommits >=
          configResult.config.reviews.autoReview.autoPauseAfterReviewedCommits
        ) {
          await convex.mutation(api.reviewBot.updatePrReview, {
            currentStep: "Incremental review auto-paused after the configured commit threshold.",
            finishedAt: Date.now(),
            githubPublicationStatus: "skipped",
            llmStatus: "skipped",
            reviewId: review._id,
            reviewMode,
            status: "skipped",
          })

          return
        }
      }

      const { includedFiles, skippedFiles } = applyReviewPathFilters(
        reviewScopeFiles,
        configResult.config
      )

      if (includedFiles.length === 0) {
        await convex.mutation(api.reviewBot.updatePrReview, {
          changedFiles: reviewScopeFiles.map((file) => file.filename),
          currentStep: "All changed files were filtered out by review config.",
          finishedAt: Date.now(),
          githubPublicationStatus: "skipped",
          includedFiles: [],
          llmStatus: "skipped",
          reviewId: review._id,
          reviewMode,
          reviewedCommitCountDelta,
          skippedFileCount: skippedFiles.length,
          status: "skipped",
        })

        return
      }

      const pathInstructionMatches = getMatchedPathInstructions(
        includedFiles,
        configResult.config
      )
      const capturedFiles = await captureReviewFiles({
        files: includedFiles,
        getFileContent: async (path) =>
          await getRepositoryFileContent({
            installationId: trackedRepo.installationId,
            owner: trackedRepo.owner,
            path,
            ref: pullRequest.headSha,
            repo: trackedRepo.name,
          }),
      })

      await convex.mutation(api.reviewBot.upsertTrackedPullRequest, {
        authorLogin: pullRequest.authorLogin,
        baseBranch: pullRequest.baseBranch,
        baseSha: pullRequest.baseSha,
        headBranch: pullRequest.headBranch,
        headSha: pullRequest.headSha,
        prNumber: pullRequest.number,
        repoFullName: trackedPullRequest.repoFullName,
        state: pullRequest.state,
        title: pullRequest.title,
        trackedRepoId: trackedRepo._id,
        url: pullRequest.url,
      })

      const filteredDiffSummary = buildDiffSummary(includedFiles)
      const fileSummaries = buildFileSummaries(capturedFiles)
      const nearbyCode = buildNearbyCode(capturedFiles)

      await convex.mutation(api.reviewBot.updatePrReview, {
        changedFiles: reviewScopeFiles.map((file) => file.filename),
        currentStep: "Running hygiene checks",
        diffSummary: filteredDiffSummary,
        fileSummaries,
        includedFiles: includedFiles.map((file) => file.filename),
        nearbyCode,
        previousReviewedHeadSha: review.previousReviewedHeadSha ?? null,
        reviewId: review._id,
        reviewMode,
        reviewedCommitCountDelta,
        skippedFileCount: skippedFiles.length,
        status: "running",
      })

      const checkerRun = await runReviewCheckers({
        fullName: trackedRepo.fullName,
        headSha: pullRequest.headSha,
        installationId: trackedRepo.installationId,
      })
      const filteredFindings = filterFindingsToIncludedFiles(
        checkerRun.findings,
        includedFiles.map((file) => file.filename)
      )

      await convex.mutation(api.reviewBot.replacePrReviewFindings, {
        findings: filteredFindings,
        prReviewId: review._id,
      })
      await convex.mutation(api.reviewBot.updatePrReview, {
        checkerResults: checkerRun.checkerResults.map((result) => ({
          category: result.category,
          checker: result.checker,
          details: result.details,
          status: result.status,
        })),
        currentStep: "Drafting review summary",
        reviewId: review._id,
        status: "running",
      })

      const aiSummary = await summarizeReviewWithAI({
        changedFiles: includedFiles.map((file) => file.filename),
        diffSummary: filteredDiffSummary,
        fileSummaries,
        findings: filteredFindings,
        nearbyCode,
        pathInstructions: pathInstructionMatches,
        repo: trackedRepo.fullName,
        reviewMode,
        title: pullRequest.title,
      })

      const reviewFilesByPath = new Map(
        files.map((file) => [file.filename, file])
      )
      const includedFileSet = new Set(includedFiles.map((file) => file.filename))
      const storedInlineComments = (aiSummary.inlineComments ?? []).filter((comment) =>
        includedFileSet.has(comment.filePath)
      )
      const persistedInlineComments = storedInlineComments.map((comment) => ({
        body: comment.body,
        filePath: comment.filePath,
        line: comment.line,
      }))
      const reviewComments: Array<{
        body: string
        path: string
        position: number
      }> = []
      let publishedInlineCommentCount = 0
      let publishedSummary = false
      let publishedReview = false
      let githubPublicationStatus: "failed" | "partial" | "pending" | "published" | "skipped" =
        "published"
      let githubPublicationError: string | null = configResult.error
      let githubSummaryCommentId = getReusableCommentId(reviewHistory, review._id)
      let githubWalkthroughCommentId: number | null = null

      try {
        const summaryBody = buildSummaryComment({
          headSha: pullRequest.headSha,
          summary: aiSummary,
        })

        if (githubSummaryCommentId) {
          try {
            const updatedComment = await updateIssueComment({
              body: summaryBody,
              commentId: githubSummaryCommentId,
              installationId: trackedRepo.installationId,
              owner: trackedRepo.owner,
              repo: trackedRepo.name,
            })
            githubSummaryCommentId = updatedComment.id
          } catch {
            const createdComment = await createIssueComment({
              body: summaryBody,
              installationId: trackedRepo.installationId,
              issueNumber: trackedPullRequest.prNumber,
              owner: trackedRepo.owner,
              repo: trackedRepo.name,
            })
            githubSummaryCommentId = createdComment.id
          }
        } else {
          const createdComment = await createIssueComment({
            body: summaryBody,
            installationId: trackedRepo.installationId,
            issueNumber: trackedPullRequest.prNumber,
            owner: trackedRepo.owner,
            repo: trackedRepo.name,
          })
          githubSummaryCommentId = createdComment.id
        }

        publishedSummary = true
      } catch (error) {
        githubPublicationStatus = "partial"
        githubPublicationError =
          error instanceof Error ? error.message : "PR summary could not be published."
      }

      for (const comment of storedInlineComments) {
        const file = reviewFilesByPath.get(comment.filePath)

        if (!file?.patch) {
          continue
        }

        const position = resolvePatchPositionForLine(file.patch, comment.line)

        if (!position) {
          continue
        }

        reviewComments.push({
          body: buildInlineReviewCommentBody({
            comment,
          }),
          path: file.filename,
          position,
        })
      }

      if (reviewComments.length > 0) {
        const walkthroughBody = buildWalkthroughComment({
          headSha: pullRequest.headSha,
        })

        try {
          const reviewComment = await createPullRequestReview({
            body: walkthroughBody,
            comments: reviewComments,
            commitId: pullRequest.headSha,
            event: "COMMENT",
            installationId: trackedRepo.installationId,
            owner: trackedRepo.owner,
            pullNumber: trackedPullRequest.prNumber,
            repo: trackedRepo.name,
          })
          githubWalkthroughCommentId = reviewComment.id
          publishedInlineCommentCount = reviewComments.length
          publishedReview = true
        } catch (error) {
          githubPublicationStatus =
            githubPublicationStatus === "published" ? "partial" : githubPublicationStatus
          githubPublicationError =
            error instanceof Error
              ? error.message
              : "PR review could not be published."
        }
      }

      if (githubPublicationStatus === "published" && !publishedSummary && !publishedReview) {
        githubPublicationStatus = "skipped"
      }

      await convex.mutation(api.reviewBot.updatePrReview, {
        currentStep: "PR review completed",
        finishedAt: Date.now(),
        githubPublicationError,
        githubPublicationStatus,
        githubSummaryUpdatedAt: publishedSummary ? Date.now() : null,
        githubWalkthroughCommentId,
        inlineComments: persistedInlineComments,
        llmStatus: aiSummary.status,
        publishedInlineCommentCount,
        reviewId: review._id,
        reviewMode,
        reviewedCommitCountDelta,
        status: "completed",
        summary: aiSummary.summaryParagraph,
      })
    } catch (error) {
      const workflowError =
        error instanceof Error ? error : new Error("Unknown PR review error")

      await convex.mutation(api.reviewBot.updatePrReview, {
        currentStep: "PR review failed",
        errorMessage: workflowError.message,
        finishedAt: Date.now(),
        llmStatus: "failed",
        reviewId: review._id,
        status: "failed",
      })

      throw workflowError
    }
  }
)
