export type RunStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "queued"
  | "running"
  | "starting"

export type TimelineEvent = {
  createdAt: number
}

export type QueueState =
  | "pending"
  | "picked_up"
  | "waiting_for_worker"
  | "worker_unreachable"

export type ExecutionState =
  | "preview_active"
  | "queued"
  | "session_active"
  | "session_creating"
  | "terminal"
  | "waiting_for_worker"
  | "worker_picked_up"
  | "worker_unreachable"

export function isActiveRunStatus(status: RunStatus) {
  return status === "queued" || status === "starting" || status === "running"
}

export function buildSteelEmbedUrl(debugUrl?: string) {
  if (!debugUrl) {
    return null
  }

  return `${debugUrl}${debugUrl.includes("?") ? "&" : "?"}interactive=false&showControls=false`
}

export function formatSessionDuration(durationMs: number | null | undefined) {
  if (!durationMs || durationMs < 1000) {
    return "Less than a second"
  }

  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes === 0) {
    return `${seconds}s`
  }

  if (seconds === 0) {
    return `${minutes}m`
  }

  return `${minutes}m ${seconds}s`
}

export function sortTimelineEvents<T extends TimelineEvent>(events: T[]) {
  return events.slice().sort((left, right) => left.createdAt - right.createdAt)
}

export function describeExecutionState(executionState: ExecutionState) {
  switch (executionState) {
    case "session_active":
      return "active"
    case "session_creating":
      return "creating"
    case "worker_picked_up":
      return "picked_up"
    case "waiting_for_worker":
      return "waiting"
    case "worker_unreachable":
      return "worker_unreachable"
    case "preview_active":
      return "active"
    case "terminal":
      return "terminal"
    default:
      return "queued"
  }
}
