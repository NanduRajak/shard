const DEFAULT_BACKGROUND_TASK_TITLE = "End-to-end QA audit"
const DEFAULT_COVERAGE_LANES = [
  "landing and primary navigation",
  "search, filters, and browse discovery",
  "forms, creation flows, and validation",
  "product detail and cart interactions",
  "account entry points and auth walls",
  "help, support, settings, and edge navigation",
] as const

export const DEFAULT_BACKGROUND_TASK_INSTRUCTIONS = [
  "Run a focused end-to-end QA audit for this website.",
  "If a stored credential is available, use it when login is required.",
  "Exercise the primary user journeys and core navigation safely.",
  "Capture important functional issues, browser issues, and helpful artifacts such as screenshots or trace output.",
  "Avoid destructive actions, final purchases, account deletion, or irreversible submissions.",
].join(" ")

export function resolveBackgroundTaskInstructions(task?: string | null) {
  const trimmedTask = task?.trim()

  return trimmedTask || DEFAULT_BACKGROUND_TASK_INSTRUCTIONS
}

export function isDefaultBackgroundTaskInstructions(task?: string | null) {
  return (task ?? "").trim() === DEFAULT_BACKGROUND_TASK_INSTRUCTIONS
}

export function getBackgroundTaskLabel(task?: string | null) {
  return isDefaultBackgroundTaskInstructions(task)
    ? DEFAULT_BACKGROUND_TASK_TITLE
    : task?.trim() || DEFAULT_BACKGROUND_TASK_TITLE
}

export function buildBackgroundAgentInstructions({
  agentIndex,
  agentCount,
  task,
}: {
  agentIndex: number
  agentCount: number
  task?: string | null
}) {
  const baseInstructions = resolveBackgroundTaskInstructions(task)

  if (agentCount <= 1) {
    return baseInstructions
  }

  const lane = DEFAULT_COVERAGE_LANES[agentIndex % DEFAULT_COVERAGE_LANES.length]

  return [
    baseInstructions,
    `Coverage lane ${agentIndex + 1} of ${agentCount}: focus primarily on ${lane}.`,
    "Favor fresh routes and flows that are meaningfully different from the other agents in this batch.",
    "Capture evidence for important issues, but avoid duplicating work when the page already looks fully exercised.",
  ].join(" ")
}
