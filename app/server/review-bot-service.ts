import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { createConvexServerClient } from "~/server/convex"
import { inngest } from "../../inngest/core"
import { createQueuedCheckerResults } from "~/server/review-bot-review"

export async function getConnectionBySessionToken(sessionToken: string) {
  const convex = createConvexServerClient()

  return await convex.query(api.reviewBot.getConnectionBySessionToken, {
    sessionToken,
  })
}

export async function enqueueTrackedPullRequestReview(
  trackedPullRequestId: Id<"trackedPullRequests">
) {
  const convex = createConvexServerClient()
  const detail = await convex.query(api.reviewBot.getTrackedPullRequestDetail, {
    trackedPullRequestId,
  })

  if (!detail?.trackedPullRequest) {
    throw new Error("Tracked pull request could not be found.")
  }

  const reviewId = await convex.mutation(api.reviewBot.createPrReview, {
    changedFiles: [],
    checkerResults: createQueuedCheckerResults().map((checker) => ({
      checker: checker.checker,
      status: checker.status,
    })),
    currentStep: "Queued for PR review",
    diffSummary: "Collecting pull request context.",
    fileSummaries: [],
    headSha: detail.trackedPullRequest.headSha,
    nearbyCode: [],
    prNumber: detail.trackedPullRequest.prNumber,
    repo: detail.trackedPullRequest.repoFullName,
    trackedPullRequestId,
  })

  await convex.mutation(api.reviewBot.updateTrackedPullRequestLatestReview, {
    headSha: detail.trackedPullRequest.headSha,
    reviewId,
    trackedPullRequestId,
  })

  await inngest.send({
    data: { reviewId },
    name: "app/pr-review.requested",
  })

  return reviewId
}

export async function handleTrackedPullRequestWebhook(input: {
  authorLogin: string | null
  baseBranch: string
  baseSha: string
  headBranch: string
  headSha: string
  prNumber: number
  repoFullName: string
  state: "closed" | "open"
  title: string
  url: string
}) {
  const convex = createConvexServerClient()
  const trackedPullRequest = await convex.query(
    api.reviewBot.getTrackedPullRequestByRepoAndNumber,
    {
      prNumber: input.prNumber,
      repoFullName: input.repoFullName,
    }
  )

  if (!trackedPullRequest) {
    return {
      queued: false,
      reason: "untracked",
    } as const
  }

  if (trackedPullRequest.headSha === input.headSha) {
    return {
      queued: false,
      reason: "duplicate-head-sha",
    } as const
  }

  await convex.mutation(api.reviewBot.upsertTrackedPullRequest, {
    authorLogin: input.authorLogin,
    baseBranch: input.baseBranch,
    baseSha: input.baseSha,
    headBranch: input.headBranch,
    headSha: input.headSha,
    prNumber: input.prNumber,
    repoFullName: input.repoFullName,
    state: input.state,
    title: input.title,
    trackedRepoId: trackedPullRequest.trackedRepoId,
    url: input.url,
  })

  const reviewId = await enqueueTrackedPullRequestReview(trackedPullRequest._id)

  return {
    queued: true,
    reason: "queued",
    reviewId,
  } as const
}
