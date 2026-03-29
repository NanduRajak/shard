type TerminalRunStatus = "cancelled" | "completed" | "failed"
type ActiveRunStatus = "queued" | "running" | "starting"

export type BackgroundOrchestratorRunStatus = ActiveRunStatus | TerminalRunStatus
export type BackgroundOrchestratorStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "queued"
  | "running"

type DurationRun = {
  finishedAt?: number
  startedAt: number
}

type DedupeFinding = {
  browserSignal?: string
  pageOrFlow?: string
  score?: number
  source: string
  title: string
}

export function deriveBackgroundOrchestratorStatus(
  statuses: BackgroundOrchestratorRunStatus[],
): BackgroundOrchestratorStatus {
  if (!statuses.length || statuses.every((status) => status === "queued")) {
    return "queued"
  }

  if (
    statuses.some((status) => status === "starting" || status === "running" || status === "queued")
  ) {
    return "running"
  }

  if (statuses.every((status) => status === "cancelled")) {
    return "cancelled"
  }

  if (statuses.some((status) => status === "failed" || status === "cancelled")) {
    return "failed"
  }

  return "completed"
}

export function isBackgroundOrchestratorActive(status: BackgroundOrchestratorStatus) {
  return status === "queued" || status === "running"
}

export function isBackgroundOrchestratorReportReady(status: BackgroundOrchestratorStatus) {
  return !isBackgroundOrchestratorActive(status)
}

export function getAgentDurationMs(run: DurationRun, now = Date.now()) {
  const finishedAt = run.finishedAt ?? now
  return Math.max(0, finishedAt - run.startedAt)
}

export function getOrchestratorDurationMs(runs: DurationRun[], now = Date.now()) {
  if (!runs.length) {
    return 0
  }

  const startedAt = Math.min(...runs.map((run) => run.startedAt))
  const finishedAt = Math.max(...runs.map((run) => run.finishedAt ?? now))

  return Math.max(0, finishedAt - startedAt)
}

export function getMergedFindingKey(finding: DedupeFinding) {
  return [
    finding.source,
    finding.browserSignal ?? "",
    finding.title.trim().toLowerCase(),
    (finding.pageOrFlow ?? "").trim().toLowerCase(),
  ].join("::")
}

export function dedupeMergedFindings<T extends DedupeFinding>(findings: T[]) {
  const dedupedFindings = new Map<string, T>()

  for (const finding of findings) {
    const key = getMergedFindingKey(finding)
    const existingFinding = dedupedFindings.get(key)

    if (!existingFinding || (finding.score ?? 0) > (existingFinding.score ?? 0)) {
      dedupedFindings.set(key, finding)
    }
  }

  return [...dedupedFindings.values()].sort(
    (left, right) => (right.score ?? 0) - (left.score ?? 0),
  )
}
