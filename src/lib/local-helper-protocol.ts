import { z } from "zod"

export const localHelperStatusSchema = z.enum(["idle", "busy", "offline", "error"])

export const runStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "completed",
  "failed",
  "cancelled",
])

export const queueStateSchema = z.enum([
  "pending",
  "waiting_for_worker",
  "worker_unreachable",
  "picked_up",
])

export const goalStatusSchema = z.enum([
  "not_requested",
  "completed",
  "partially_completed",
  "blocked",
])

export const sessionStatusSchema = z.enum(["creating", "active", "closed", "failed"])

export const browserProviderSchema = z.enum(["steel", "local_chrome", "playwright"])

export const runEventKindSchema = z.enum([
  "status",
  "session",
  "navigation",
  "agent",
  "artifact",
  "finding",
  "audit",
  "system",
])

export const artifactTypeSchema = z.enum([
  "screenshot",
  "trace",
  "html-report",
  "replay",
])

export const findingSeveritySchema = z.enum(["low", "medium", "high", "critical"])

export const findingSourceSchema = z.enum(["browser", "perf", "hygiene", "test"])
export const browserSignalSchema = z.enum(["console", "network", "pageerror"])

export const registerLocalHelperRequestSchema = z.object({
  helperId: z.string().min(1),
  machineLabel: z.string().min(1),
  version: z.string().min(1).optional(),
  status: localHelperStatusSchema,
  currentClaimedRunId: z.string().min(1).optional(),
})

export const claimLocalRunRequestSchema = z.object({
  helperId: z.string().min(1),
})

export const getLocalRunStateRequestSchema = z.object({
  runId: z.string().min(1),
})

export const updateLocalRunRequestSchema = z.object({
  runId: z.string().min(1),
  status: runStatusSchema.optional(),
  queueState: queueStateSchema.optional(),
  currentStep: z.string().optional(),
  currentUrl: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  stopRequestedAt: z.number().nullable().optional(),
  goalStatus: goalStatusSchema.nullable().optional(),
  goalSummary: z.string().nullable().optional(),
  finishedAt: z.number().optional(),
  finalScore: z.number().optional(),
})

export const upsertLocalSessionRequestSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  provider: browserProviderSchema,
  externalSessionId: z.string().min(1),
  status: sessionStatusSchema,
  debugUrl: z.string().optional(),
  replayUrl: z.string().optional(),
  finishedAt: z.number().nullable().optional(),
})

export const appendRunEventRequestSchema = z.object({
  runId: z.string().min(1),
  kind: runEventKindSchema,
  title: z.string().min(1),
  body: z.string().optional(),
  status: runStatusSchema.optional(),
  stepIndex: z.number().optional(),
  pageUrl: z.string().optional(),
  sessionId: z.string().optional(),
  artifactId: z.string().optional(),
})

export const appendFindingRequestSchema = z.object({
  runId: z.string().min(1),
  source: findingSourceSchema,
  browserSignal: browserSignalSchema.optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  severity: findingSeveritySchema,
  confidence: z.number().min(0).max(1),
  impact: z.number(),
  score: z.number(),
  stepIndex: z.number().optional(),
  pageOrFlow: z.string().optional(),
  artifactId: z.string().optional(),
  screenshotUrl: z.string().optional(),
  suggestedFix: z.string().optional(),
})

export const uploadArtifactRequestSchema = z.object({
  runId: z.string().min(1),
  type: artifactTypeSchema,
  contentType: z.string().min(1),
  base64: z.string().min(1),
  pageUrl: z.string().optional(),
  title: z.string().optional(),
})

export const finalizeLocalRunRequestSchema = z.object({
  helperId: z.string().min(1),
  runId: z.string().min(1),
  status: z.enum(["completed", "failed", "cancelled"]),
  currentStep: z.string().optional(),
  currentUrl: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  goalStatus: goalStatusSchema.nullable().optional(),
  goalSummary: z.string().nullable().optional(),
  finishedAt: z.number().optional(),
  finalScore: z.number().optional(),
  sessionId: z.string().optional(),
  sessionStatus: sessionStatusSchema.optional(),
  debugUrl: z.string().optional(),
  replayUrl: z.string().optional(),
})
