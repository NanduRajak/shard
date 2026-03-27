import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const runStatus = v.union(
  v.literal("queued"),
  v.literal("starting"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
)

const runMode = v.union(
  v.literal("explore"),
  v.literal("task"),
)

const browserProvider = v.union(
  v.literal("steel"),
  v.literal("local_chrome"),
  v.literal("playwright"),
)

const executionMode = v.union(
  v.literal("interactive"),
  v.literal("background"),
)

const runGoalStatus = v.union(
  v.literal("not_requested"),
  v.literal("completed"),
  v.literal("partially_completed"),
  v.literal("blocked"),
)

const queueState = v.union(
  v.literal("pending"),
  v.literal("waiting_for_worker"),
  v.literal("worker_unreachable"),
  v.literal("picked_up"),
)

const reviewStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped"),
)

const checkerStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("passed"),
  v.literal("failed"),
  v.literal("skipped"),
)

const llmStatus = v.union(
  v.literal("queued"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped"),
)

const reviewMode = v.union(v.literal("full"), v.literal("incremental"))

const githubPublicationStatus = v.union(
  v.literal("pending"),
  v.literal("published"),
  v.literal("partial"),
  v.literal("failed"),
  v.literal("skipped"),
)

const findingSource = v.union(
  v.literal("browser"),
  v.literal("perf"),
  v.literal("hygiene"),
  v.literal("test"),
)

const findingCategory = v.union(
  v.literal("Security"),
  v.literal("Maintainability"),
  v.literal("Test hygiene"),
  v.literal("Performance smell"),
)

const findingSeverity = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
)

const browserSignal = v.union(
  v.literal("console"),
  v.literal("network"),
  v.literal("pageerror"),
)

const artifactType = v.union(
  v.literal("screenshot"),
  v.literal("trace"),
  v.literal("html-report"),
  v.literal("replay"),
)

const sessionStatus = v.union(
  v.literal("creating"),
  v.literal("active"),
  v.literal("closed"),
  v.literal("failed"),
)

const localHelperStatus = v.union(
  v.literal("idle"),
  v.literal("busy"),
  v.literal("offline"),
  v.literal("error"),
)

const runEventKind = v.union(
  v.literal("status"),
  v.literal("session"),
  v.literal("navigation"),
  v.literal("agent"),
  v.literal("artifact"),
  v.literal("finding"),
  v.literal("audit"),
  v.literal("system"),
)

export default defineSchema({
  githubConnections: defineTable({
    avatarUrl: v.optional(v.string()),
    createdAt: v.number(),
    encryptedAccessToken: v.string(),
    githubUserId: v.number(),
    login: v.string(),
    name: v.optional(v.string()),
    sessionToken: v.string(),
    updatedAt: v.number(),
  })
    .index("by_session_token", ["sessionToken"])
    .index("by_github_user_id", ["githubUserId"]),

  backgroundBatches: defineTable({
    title: v.string(),
    totalRuns: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_created_at", ["createdAt"]),

  runs: defineTable({
    url: v.string(),
    mode: v.optional(runMode),
    browserProvider: v.optional(browserProvider),
    executionMode: v.optional(executionMode),
    backgroundBatchId: v.optional(v.id("backgroundBatches")),
    credentialNamespace: v.optional(v.string()),
    credentialProfileId: v.optional(v.id("credentials")),
    instructions: v.optional(v.string()),
    agentOrdinal: v.optional(v.number()),
    status: runStatus,
    queueState: v.optional(queueState),
    currentStep: v.optional(v.string()),
    currentUrl: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    goalStatus: v.optional(runGoalStatus),
    goalSummary: v.optional(v.string()),
    stopRequestedAt: v.optional(v.number()),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
    finalScore: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_started_at", ["startedAt"])
    .index("by_background_batch", ["backgroundBatchId"])
    .index("by_execution_mode_started_at", ["executionMode", "startedAt"]),

  findings: defineTable({
    runId: v.optional(v.id("runs")),
    prReviewId: v.optional(v.id("prReviews")),
    category: v.optional(findingCategory),
    checker: v.optional(v.string()),
    source: findingSource,
    browserSignal: v.optional(browserSignal),
    title: v.string(),
    description: v.string(),
    severity: findingSeverity,
    confidence: v.number(),
    filePath: v.optional(v.string()),
    line: v.optional(v.number()),
    impact: v.optional(v.number()),
    score: v.optional(v.number()),
    stepIndex: v.optional(v.number()),
    pageOrFlow: v.optional(v.string()),
    artifactId: v.optional(v.id("artifacts")),
    screenshotUrl: v.optional(v.string()),
    suggestedFix: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_pr_review", ["prReviewId"])
    .index("by_run_and_severity", ["runId", "severity"])
    .index("by_pr_review_and_severity", ["prReviewId", "severity"]),

  artifacts: defineTable({
    runId: v.id("runs"),
    type: artifactType,
    fileLocation: v.string(),
    storageId: v.optional(v.id("_storage")),
    title: v.optional(v.string()),
    pageUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_and_type", ["runId", "type"])
    .index("by_run_and_created_at", ["runId", "createdAt"]),

  prReviews: defineTable({
    trackedPullRequestId: v.id("trackedPullRequests"),
    repo: v.string(),
    prNumber: v.number(),
    headSha: v.string(),
    previousReviewedHeadSha: v.optional(v.string()),
    reviewMode: reviewMode,
    isManualTrigger: v.optional(v.boolean()),
    reviewedCommitCountDelta: v.optional(v.number()),
    changedFiles: v.array(v.string()),
    includedFiles: v.optional(v.array(v.string())),
    diffSummary: v.string(),
    fileSummaries: v.array(
      v.object({
        path: v.string(),
        summary: v.string(),
      }),
    ),
    nearbyCode: v.array(
      v.object({
        excerpt: v.string(),
        filePath: v.string(),
        lineEnd: v.number(),
        lineStart: v.number(),
      }),
    ),
    checkerResults: v.array(
      v.object({
        category: v.optional(findingCategory),
        checker: v.string(),
        details: v.optional(v.string()),
        status: checkerStatus,
      }),
    ),
    status: reviewStatus,
    currentStep: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    summary: v.optional(v.string()),
    riskSummary: v.optional(v.string()),
    testSuggestions: v.optional(v.string()),
    inlineComments: v.optional(
      v.array(
        v.object({
          body: v.string(),
          filePath: v.string(),
          line: v.optional(v.number()),
        }),
      ),
    ),
    githubPublicationStatus: v.optional(githubPublicationStatus),
    githubPublicationError: v.optional(v.string()),
    githubSummaryCommentId: v.optional(v.number()),
    githubWalkthroughCommentId: v.optional(v.number()),
    githubSummaryUpdatedAt: v.optional(v.number()),
    publishedInlineCommentCount: v.optional(v.number()),
    skippedFileCount: v.optional(v.number()),
    llmStatus: v.optional(llmStatus),
    browserRunId: v.optional(v.id("runs")),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_tracked_pull_request", ["trackedPullRequestId"])
    .index("by_repo_and_pr_number", ["repo", "prNumber"])
    .index("by_status", ["status"]),

  sessions: defineTable({
    runId: v.id("runs"),
    provider: browserProvider,
    externalSessionId: v.string(),
    status: sessionStatus,
    debugUrl: v.optional(v.string()),
    replayUrl: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_run", ["runId"])
    .index("by_external_session_id", ["externalSessionId"])
    .index("by_run_and_started_at", ["runId", "startedAt"]),

  localHelpers: defineTable({
    helperId: v.string(),
    machineLabel: v.string(),
    status: localHelperStatus,
    version: v.optional(v.string()),
    currentClaimedRunId: v.optional(v.id("runs")),
    lastHeartbeatAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_helper_id", ["helperId"])
    .index("by_updated_at", ["updatedAt"])
    .index("by_status", ["status"]),

  trackedRepos: defineTable({
    connectionId: v.id("githubConnections"),
    createdAt: v.number(),
    defaultBranch: v.string(),
    fullName: v.string(),
    installationId: v.number(),
    isPrivate: v.boolean(),
    name: v.string(),
    owner: v.string(),
    updatedAt: v.number(),
  })
    .index("by_connection", ["connectionId"])
    .index("by_connection_and_full_name", ["connectionId", "fullName"]),

  trackedPullRequests: defineTable({
    authorLogin: v.optional(v.string()),
    baseBranch: v.string(),
    baseSha: v.string(),
    createdAt: v.number(),
    headBranch: v.string(),
    headSha: v.string(),
    latestReviewId: v.optional(v.id("prReviews")),
    prNumber: v.number(),
    repoFullName: v.string(),
    state: v.union(v.literal("closed"), v.literal("open")),
    title: v.string(),
    trackedRepoId: v.id("trackedRepos"),
    updatedAt: v.number(),
    url: v.string(),
  })
    .index("by_tracked_repo", ["trackedRepoId"])
    .index("by_repo_and_pr_number", ["repoFullName", "prNumber"]),
  runEvents: defineTable({
    runId: v.id("runs"),
    kind: runEventKind,
    title: v.string(),
    body: v.optional(v.string()),
    status: v.optional(runStatus),
    stepIndex: v.optional(v.number()),
    pageUrl: v.optional(v.string()),
    sessionId: v.optional(v.id("sessions")),
    artifactId: v.optional(v.id("artifacts")),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_and_created_at", ["runId", "createdAt"]),

  performanceAudits: defineTable({
    runId: v.id("runs"),
    pageUrl: v.string(),
    performanceScore: v.number(),
    accessibilityScore: v.number(),
    bestPracticesScore: v.number(),
    seoScore: v.number(),
    reportArtifactId: v.optional(v.id("artifacts")),
    createdAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_run_and_created_at", ["runId", "createdAt"]),

  credentials: defineTable({
    namespace: v.string(),
    website: v.string(),
    origin: v.string(),
    profileLabel: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    username: v.string(),
    passwordEncrypted: v.string(),
    totpSecretEncrypted: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_namespace", ["namespace"])
    .index("by_namespace_origin", ["namespace", "origin"])
    .index("by_namespace_origin_profile", ["namespace", "origin", "profileLabel"]),
})
