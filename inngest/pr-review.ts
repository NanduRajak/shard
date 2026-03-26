import { NonRetriableError } from "inngest"
import type { Id } from "../convex/_generated/dataModel"
import { api } from "../convex/_generated/api"
import { createConvexServerClient } from "~/server/convex"
import {
  buildDiffSummary,
  buildFileSummaries,
  buildNearbyCode,
  captureReviewFiles,
  runReviewCheckers,
  summarizeReviewWithAI,
} from "~/server/review-bot-review"
import {
  getPullRequestDetails,
  getRepositoryFileContent,
  listPullRequestFiles,
} from "~/server/github"
import { inngest } from "./core"

type PrReviewRequestedEvent = {
  data: {
    reviewId: Id<"prReviews">
  }
}

export const prReview = inngest.createFunction(
  {
    id: "pr-review",
    retries: 1,
    triggers: [{ event: "app/pr-review.requested" }],
    onFailure: async ({ event, error }) => {
      const convex = createConvexServerClient()
      const failedEvent = event as unknown as PrReviewRequestedEvent

      await convex.mutation(api.reviewBot.updatePrReview, {
        currentStep: "PR review failed",
        errorMessage: error.message,
        finishedAt: Date.now(),
        reviewId: failedEvent.data.reviewId,
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

    const { review, trackedPullRequest, trackedRepo } = context

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
      const files = await listPullRequestFiles({
        installationId: trackedRepo.installationId,
        owner: trackedRepo.owner,
        pullNumber: trackedPullRequest.prNumber,
        repo: trackedRepo.name,
      })
      const capturedFiles = await captureReviewFiles({
        files,
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

      const diffSummary = buildDiffSummary(files)
      const fileSummaries = buildFileSummaries(capturedFiles)
      const nearbyCode = buildNearbyCode(capturedFiles)

      await convex.mutation(api.reviewBot.updatePrReview, {
        changedFiles: files.map((file) => file.filename),
        currentStep: "Running hygiene checks",
        diffSummary,
        fileSummaries,
        nearbyCode,
        reviewId: review._id,
        status: "running",
      })

      const checkerRun = await runReviewCheckers({
        fullName: trackedRepo.fullName,
        headSha: pullRequest.headSha,
        installationId: trackedRepo.installationId,
      })

      await convex.mutation(api.reviewBot.replacePrReviewFindings, {
        findings: checkerRun.findings,
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
        changedFiles: files.map((file) => file.filename),
        diffSummary,
        fileSummaries,
        findings: checkerRun.findings,
        nearbyCode,
        repo: trackedRepo.fullName,
        title: pullRequest.title,
      })

      await convex.mutation(api.reviewBot.updatePrReview, {
        currentStep: "PR review completed",
        finishedAt: Date.now(),
        inlineComments: aiSummary.inlineComments,
        llmStatus: aiSummary.status,
        reviewId: review._id,
        riskSummary: aiSummary.riskSummary,
        status: "completed",
        summary: aiSummary.summary,
        testSuggestions: aiSummary.testSuggestions,
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
