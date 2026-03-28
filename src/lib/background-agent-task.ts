const DEFAULT_BACKGROUND_TASK_TITLE = "End-to-end QA audit"

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
