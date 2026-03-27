import { v } from "convex/values"
import type { Doc, Id } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"

const reviewStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped")
)

const checkerStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("passed"),
  v.literal("failed"),
  v.literal("skipped")
)

const llmStatus = v.union(
  v.literal("queued"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped")
)

const reviewMode = v.union(v.literal("full"), v.literal("incremental"))

const githubPublicationStatus = v.union(
  v.literal("pending"),
  v.literal("published"),
  v.literal("partial"),
  v.literal("failed"),
  v.literal("skipped")
)

const findingCategory = v.union(
  v.literal("Security"),
  v.literal("Maintainability"),
  v.literal("Test hygiene"),
  v.literal("Performance smell")
)

const checkerResultValidator = v.object({
  category: v.optional(findingCategory),
  checker: v.string(),
  details: v.optional(v.string()),
  status: checkerStatus,
})

const fileSummaryValidator = v.object({
  path: v.string(),
  summary: v.string(),
})

const inlineCommentValidator = v.object({
  body: v.string(),
  filePath: v.string(),
  line: v.optional(v.number()),
})

const nearbyCodeValidator = v.object({
  excerpt: v.string(),
  filePath: v.string(),
  lineEnd: v.number(),
  lineStart: v.number(),
})

const findingInputValidator = v.object({
  category: v.optional(findingCategory),
  checker: v.optional(v.string()),
  confidence: v.number(),
  description: v.string(),
  filePath: v.optional(v.string()),
  line: v.optional(v.number()),
  severity: v.union(
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("critical")
  ),
  source: v.union(
    v.literal("browser"),
    v.literal("perf"),
    v.literal("hygiene"),
    v.literal("test")
  ),
  suggestedFix: v.optional(v.string()),
  title: v.string(),
})

function sortByUpdatedAtDescending<
  TRecord extends {
    updatedAt: number
  },
>(records: Array<TRecord>) {
  return [...records].sort((left, right) => right.updatedAt - left.updatedAt)
}

export const upsertConnection = mutation({
  args: {
    avatarUrl: v.optional(v.union(v.string(), v.null())),
    encryptedAccessToken: v.string(),
    githubUserId: v.number(),
    login: v.string(),
    name: v.optional(v.union(v.string(), v.null())),
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existingConnection = await ctx.db
      .query("githubConnections")
      .withIndex("by_session_token", (query) =>
        query.eq("sessionToken", args.sessionToken)
      )
      .unique()

    if (existingConnection) {
      await ctx.db.patch(existingConnection._id, {
        avatarUrl: args.avatarUrl ?? undefined,
        encryptedAccessToken: args.encryptedAccessToken,
        githubUserId: args.githubUserId,
        login: args.login,
        name: args.name ?? undefined,
        updatedAt: now,
      })

      return existingConnection._id
    }

    return await ctx.db.insert("githubConnections", {
      avatarUrl: args.avatarUrl ?? undefined,
      encryptedAccessToken: args.encryptedAccessToken,
      githubUserId: args.githubUserId,
      login: args.login,
      name: args.name ?? undefined,
      sessionToken: args.sessionToken,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const getConnectionBySessionToken = query({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("githubConnections")
      .withIndex("by_session_token", (query) =>
        query.eq("sessionToken", args.sessionToken)
      )
      .unique()
  },
})

export const removeConnectionBySessionToken = mutation({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("githubConnections")
      .withIndex("by_session_token", (query) =>
        query.eq("sessionToken", args.sessionToken)
      )
      .unique()

    if (!connection) {
      return
    }

    const trackedRepos = await ctx.db
      .query("trackedRepos")
      .withIndex("by_connection", (query) => query.eq("connectionId", connection._id))
      .take(100)

    for (const trackedRepo of trackedRepos) {
      const trackedPullRequests = await ctx.db
        .query("trackedPullRequests")
        .withIndex("by_tracked_repo", (query) =>
          query.eq("trackedRepoId", trackedRepo._id)
        )
        .take(100)

      for (const trackedPullRequest of trackedPullRequests) {
        const reviews = await ctx.db
          .query("prReviews")
          .withIndex("by_tracked_pull_request", (query) =>
            query.eq("trackedPullRequestId", trackedPullRequest._id)
          )
          .take(50)

        for (const review of reviews) {
          const findings = await ctx.db
            .query("findings")
            .withIndex("by_pr_review", (query) => query.eq("prReviewId", review._id))
            .take(200)

          for (const finding of findings) {
            await ctx.db.delete(finding._id)
          }

          await ctx.db.delete(review._id)
        }

        await ctx.db.delete(trackedPullRequest._id)
      }

      await ctx.db.delete(trackedRepo._id)
    }

    await ctx.db.delete(connection._id)
  },
})

export const upsertTrackedRepo = mutation({
  args: {
    connectionId: v.id("githubConnections"),
    defaultBranch: v.string(),
    fullName: v.string(),
    installationId: v.number(),
    isPrivate: v.boolean(),
    name: v.string(),
    owner: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existingRepo = await ctx.db
      .query("trackedRepos")
      .withIndex("by_connection_and_full_name", (query) =>
        query.eq("connectionId", args.connectionId).eq("fullName", args.fullName)
      )
      .unique()

    if (existingRepo) {
      await ctx.db.patch(existingRepo._id, {
        defaultBranch: args.defaultBranch,
        installationId: args.installationId,
        isPrivate: args.isPrivate,
        name: args.name,
        owner: args.owner,
        updatedAt: now,
      })

      return existingRepo._id
    }

    return await ctx.db.insert("trackedRepos", {
      connectionId: args.connectionId,
      defaultBranch: args.defaultBranch,
      fullName: args.fullName,
      installationId: args.installationId,
      isPrivate: args.isPrivate,
      name: args.name,
      owner: args.owner,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const getTrackedRepoByFullName = query({
  args: {
    connectionId: v.id("githubConnections"),
    fullName: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("trackedRepos")
      .withIndex("by_connection_and_full_name", (query) =>
        query.eq("connectionId", args.connectionId).eq("fullName", args.fullName)
      )
      .unique()
  },
})

export const upsertTrackedPullRequest = mutation({
  args: {
    authorLogin: v.optional(v.union(v.string(), v.null())),
    baseBranch: v.string(),
    baseSha: v.string(),
    headBranch: v.string(),
    headSha: v.string(),
    prNumber: v.number(),
    repoFullName: v.string(),
    state: v.union(v.literal("closed"), v.literal("open")),
    title: v.string(),
    trackedRepoId: v.id("trackedRepos"),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existingPullRequest = await ctx.db
      .query("trackedPullRequests")
      .withIndex("by_repo_and_pr_number", (query) =>
        query.eq("repoFullName", args.repoFullName).eq("prNumber", args.prNumber)
      )
      .unique()

    const patch = {
      authorLogin: args.authorLogin ?? undefined,
      baseBranch: args.baseBranch,
      baseSha: args.baseSha,
      headBranch: args.headBranch,
      headSha: args.headSha,
      state: args.state,
      title: args.title,
      trackedRepoId: args.trackedRepoId,
      updatedAt: now,
      url: args.url,
    }

    if (existingPullRequest) {
      await ctx.db.patch(existingPullRequest._id, patch)

      return existingPullRequest._id
    }

    return await ctx.db.insert("trackedPullRequests", {
      ...patch,
      prNumber: args.prNumber,
      repoFullName: args.repoFullName,
      createdAt: now,
    })
  },
})

export const updateTrackedPullRequestLatestReview = mutation({
  args: {
    headSha: v.optional(v.string()),
    trackedPullRequestId: v.id("trackedPullRequests"),
    reviewId: v.id("prReviews"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.trackedPullRequestId, {
      headSha: args.headSha,
      latestReviewId: args.reviewId,
      updatedAt: Date.now(),
    })
  },
})

export const getTrackedPullRequestByRepoAndNumber = query({
  args: {
    prNumber: v.number(),
    repoFullName: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("trackedPullRequests")
      .withIndex("by_repo_and_pr_number", (query) =>
        query.eq("repoFullName", args.repoFullName).eq("prNumber", args.prNumber)
      )
      .unique()
  },
})

export const createPrReview = mutation({
  args: {
    changedFiles: v.array(v.string()),
    checkerResults: v.array(checkerResultValidator),
    currentStep: v.optional(v.string()),
    diffSummary: v.string(),
    fileSummaries: v.array(fileSummaryValidator),
    headSha: v.string(),
    isManualTrigger: v.optional(v.boolean()),
    nearbyCode: v.array(nearbyCodeValidator),
    previousReviewedHeadSha: v.optional(v.string()),
    prNumber: v.number(),
    repo: v.string(),
    reviewMode: reviewMode,
    trackedPullRequestId: v.id("trackedPullRequests"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    return await ctx.db.insert("prReviews", {
      changedFiles: args.changedFiles,
      checkerResults: args.checkerResults,
      currentStep: args.currentStep,
      diffSummary: args.diffSummary,
      fileSummaries: args.fileSummaries,
      headSha: args.headSha,
      isManualTrigger: args.isManualTrigger,
      nearbyCode: args.nearbyCode,
      previousReviewedHeadSha: args.previousReviewedHeadSha,
      prNumber: args.prNumber,
      repo: args.repo,
      reviewMode: args.reviewMode,
      status: "queued",
      trackedPullRequestId: args.trackedPullRequestId,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const updatePrReview = mutation({
  args: {
    changedFiles: v.optional(v.array(v.string())),
    checkerResults: v.optional(v.array(checkerResultValidator)),
    currentStep: v.optional(v.union(v.string(), v.null())),
    diffSummary: v.optional(v.string()),
    errorMessage: v.optional(v.union(v.string(), v.null())),
    fileSummaries: v.optional(v.array(fileSummaryValidator)),
    finishedAt: v.optional(v.union(v.number(), v.null())),
    githubPublicationError: v.optional(v.union(v.string(), v.null())),
    githubPublicationStatus: v.optional(githubPublicationStatus),
    githubSummaryCommentId: v.optional(v.union(v.number(), v.null())),
    githubSummaryUpdatedAt: v.optional(v.union(v.number(), v.null())),
    githubWalkthroughCommentId: v.optional(v.union(v.number(), v.null())),
    includedFiles: v.optional(v.array(v.string())),
    inlineComments: v.optional(v.array(inlineCommentValidator)),
    llmStatus: v.optional(llmStatus),
    nearbyCode: v.optional(v.array(nearbyCodeValidator)),
    previousReviewedHeadSha: v.optional(v.union(v.string(), v.null())),
    publishedInlineCommentCount: v.optional(v.union(v.number(), v.null())),
    reviewId: v.id("prReviews"),
    reviewMode: v.optional(reviewMode),
    reviewedCommitCountDelta: v.optional(v.union(v.number(), v.null())),
    riskSummary: v.optional(v.union(v.string(), v.null())),
    skippedFileCount: v.optional(v.union(v.number(), v.null())),
    status: v.optional(reviewStatus),
    summary: v.optional(v.union(v.string(), v.null())),
    testSuggestions: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const patch: Partial<Doc<"prReviews">> = {
      updatedAt: Date.now(),
    }

    if (args.changedFiles !== undefined) {
      patch.changedFiles = args.changedFiles
    }

    if (args.checkerResults !== undefined) {
      patch.checkerResults = args.checkerResults
    }

    if (args.currentStep !== undefined) {
      patch.currentStep = args.currentStep ?? undefined
    }

    if (args.diffSummary !== undefined) {
      patch.diffSummary = args.diffSummary
    }

    if (args.errorMessage !== undefined) {
      patch.errorMessage = args.errorMessage ?? undefined
    }

    if (args.fileSummaries !== undefined) {
      patch.fileSummaries = args.fileSummaries
    }

    if (args.finishedAt !== undefined) {
      patch.finishedAt = args.finishedAt ?? undefined
    }

    if (args.githubPublicationError !== undefined) {
      patch.githubPublicationError = args.githubPublicationError ?? undefined
    }

    if (args.githubPublicationStatus !== undefined) {
      patch.githubPublicationStatus = args.githubPublicationStatus
    }

    if (args.githubSummaryCommentId !== undefined) {
      patch.githubSummaryCommentId = args.githubSummaryCommentId ?? undefined
    }

    if (args.githubSummaryUpdatedAt !== undefined) {
      patch.githubSummaryUpdatedAt = args.githubSummaryUpdatedAt ?? undefined
    }

    if (args.githubWalkthroughCommentId !== undefined) {
      patch.githubWalkthroughCommentId = args.githubWalkthroughCommentId ?? undefined
    }

    if (args.includedFiles !== undefined) {
      patch.includedFiles = args.includedFiles
    }

    if (args.inlineComments !== undefined) {
      patch.inlineComments = args.inlineComments
    }

    if (args.llmStatus !== undefined) {
      patch.llmStatus = args.llmStatus
    }

    if (args.nearbyCode !== undefined) {
      patch.nearbyCode = args.nearbyCode
    }

    if (args.previousReviewedHeadSha !== undefined) {
      patch.previousReviewedHeadSha = args.previousReviewedHeadSha ?? undefined
    }

    if (args.publishedInlineCommentCount !== undefined) {
      patch.publishedInlineCommentCount = args.publishedInlineCommentCount ?? undefined
    }

    if (args.reviewMode !== undefined) {
      patch.reviewMode = args.reviewMode
    }

    if (args.reviewedCommitCountDelta !== undefined) {
      patch.reviewedCommitCountDelta = args.reviewedCommitCountDelta ?? undefined
    }

    if (args.riskSummary !== undefined) {
      patch.riskSummary = args.riskSummary ?? undefined
    }

    if (args.skippedFileCount !== undefined) {
      patch.skippedFileCount = args.skippedFileCount ?? undefined
    }

    if (args.status !== undefined) {
      patch.status = args.status
    }

    if (args.summary !== undefined) {
      patch.summary = args.summary ?? undefined
    }

    if (args.testSuggestions !== undefined) {
      patch.testSuggestions = args.testSuggestions ?? undefined
    }

    await ctx.db.patch(args.reviewId, patch)
  },
})

export const replacePrReviewFindings = mutation({
  args: {
    findings: v.array(findingInputValidator),
    prReviewId: v.id("prReviews"),
  },
  handler: async (ctx, args) => {
    const existingFindings = await ctx.db
      .query("findings")
      .withIndex("by_pr_review", (query) => query.eq("prReviewId", args.prReviewId))
      .take(200)

    for (const finding of existingFindings) {
      await ctx.db.delete(finding._id)
    }

    for (const finding of args.findings) {
      await ctx.db.insert("findings", {
        category: finding.category,
        checker: finding.checker,
        confidence: finding.confidence,
        createdAt: Date.now(),
        description: finding.description,
        filePath: finding.filePath,
        line: finding.line,
        prReviewId: args.prReviewId,
        severity: finding.severity,
        source: finding.source,
        suggestedFix: finding.suggestedFix,
        title: finding.title,
      })
    }
  },
})

export const getReviewBotSnapshot = query({
  args: {
    connectionId: v.id("githubConnections"),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId)

    if (!connection) {
      return null
    }

    const trackedRepos = sortByUpdatedAtDescending(
      await ctx.db
        .query("trackedRepos")
        .withIndex("by_connection", (query) => query.eq("connectionId", args.connectionId))
        .take(50)
    )

    const trackedPullRequests = sortByUpdatedAtDescending(
      (
        await Promise.all(
          trackedRepos.map((trackedRepo) =>
            ctx.db
              .query("trackedPullRequests")
              .withIndex("by_tracked_repo", (query) =>
                query.eq("trackedRepoId", trackedRepo._id)
              )
              .take(50)
          )
        )
      ).flat()
    )

    const latestReviews = (
      await Promise.all(
        trackedPullRequests
          .map((trackedPullRequest) => trackedPullRequest.latestReviewId)
          .filter((reviewId): reviewId is Id<"prReviews"> => !!reviewId)
          .map(async (reviewId) => await ctx.db.get(reviewId))
      )
    ).filter((review): review is Doc<"prReviews"> => !!review)

    return {
      connection: {
        _id: connection._id,
        avatarUrl: connection.avatarUrl,
        githubUserId: connection.githubUserId,
        login: connection.login,
        name: connection.name,
      },
      trackedPullRequests: trackedPullRequests.map((trackedPullRequest) => ({
        ...trackedPullRequest,
        latestReview: latestReviews.find(
          (review) => review._id === trackedPullRequest.latestReviewId
        ),
      })),
      trackedRepos,
    }
  },
})

export const getTrackedPullRequestDetail = query({
  args: {
    trackedPullRequestId: v.id("trackedPullRequests"),
  },
  handler: async (ctx, args) => {
    const trackedPullRequest = await ctx.db.get(args.trackedPullRequestId)

    if (!trackedPullRequest) {
      return null
    }

    const trackedRepo = await ctx.db.get(trackedPullRequest.trackedRepoId)
    const reviews = sortByUpdatedAtDescending(
      await ctx.db
        .query("prReviews")
        .withIndex("by_tracked_pull_request", (query) =>
          query.eq("trackedPullRequestId", args.trackedPullRequestId)
        )
        .take(10)
    )

    const latestReview = reviews[0]
    const findings = latestReview
      ? await ctx.db
          .query("findings")
          .withIndex("by_pr_review", (query) => query.eq("prReviewId", latestReview._id))
          .take(200)
      : []

    return {
      findings,
      latestReview,
      reviewHistory: reviews,
      trackedPullRequest,
      trackedRepo,
    }
  },
})

export const getPrReviewWorkflowContext = query({
  args: {
    reviewId: v.id("prReviews"),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId)

    if (!review) {
      return null
    }

    const trackedPullRequest = await ctx.db.get(review.trackedPullRequestId)

    if (!trackedPullRequest) {
      return null
    }

    const trackedRepo = await ctx.db.get(trackedPullRequest.trackedRepoId)

    if (!trackedRepo) {
      return null
    }

    const reviewHistory = sortByUpdatedAtDescending(
      await ctx.db
        .query("prReviews")
        .withIndex("by_tracked_pull_request", (query) =>
          query.eq("trackedPullRequestId", review.trackedPullRequestId)
        )
        .take(20)
    )

    return {
      review,
      reviewHistory,
      trackedPullRequest,
      trackedRepo,
    }
  },
})
