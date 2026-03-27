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

const findingSource = v.union(
  v.literal("browser"),
  v.literal("perf"),
  v.literal("hygiene"),
  v.literal("test"),
)

const findingSeverity = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
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
  runs: defineTable({
    url: v.string(),
    mode: v.optional(runMode),
    credentialNamespace: v.optional(v.string()),
    instructions: v.optional(v.string()),
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
    .index("by_started_at", ["startedAt"]),

  findings: defineTable({
    runId: v.optional(v.id("runs")),
    prReviewId: v.optional(v.id("prReviews")),
    source: findingSource,
    title: v.string(),
    description: v.string(),
    severity: findingSeverity,
    confidence: v.number(),
    impact: v.number(),
    score: v.number(),
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
    repo: v.string(),
    prNumber: v.number(),
    changedFiles: v.array(v.string()),
    diffSummary: v.string(),
    status: reviewStatus,
    summary: v.optional(v.string()),
    browserRunId: v.optional(v.id("runs")),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_repo_and_pr_number", ["repo", "prNumber"])
    .index("by_status", ["status"]),

  sessions: defineTable({
    runId: v.id("runs"),
    provider: v.literal("steel"),
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
    username: v.string(),
    passwordEncrypted: v.string(),
    totpSecretEncrypted: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_namespace", ["namespace"])
    .index("by_namespace_origin", ["namespace", "origin"]),
})
