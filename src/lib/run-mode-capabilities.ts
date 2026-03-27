export type BrowserProvider = "steel" | "local_chrome"
export type LocalHelperStatus = "busy" | "error" | "idle" | "offline"

export const LOCAL_HELPER_STALE_MS = 30_000

export type LocalHelperSnapshot = {
  machineLabel: string
  status: LocalHelperStatus
  lastHeartbeatAt: number
} | null

export type LocalHelperOverview = {
  available: boolean
  helper: {
    machineLabel: string
    status: LocalHelperStatus
  } | null
  lastHeartbeatAt: number | null
}

export type RawRunModeCapabilities = {
  steel: {
    provider: "steel"
  }
  local_chrome: {
    provider: "local_chrome"
    helperAvailable: boolean
    helper: LocalHelperOverview["helper"]
    lastHeartbeatAt: number | null
  }
}

export type RunModeCapability = {
  provider: BrowserProvider
  label: string
  placeholder: string
  detail: string
  runnable: boolean
  reason: string | null
  statusLabel?: string
}

export type RunModeCapabilities = Record<BrowserProvider, RunModeCapability>

export function resolveLocalHelperOverview({
  helper,
  now = Date.now(),
}: {
  helper: LocalHelperSnapshot
  now?: number
}): LocalHelperOverview {
  if (!helper) {
    return {
      available: false,
      helper: null,
      lastHeartbeatAt: null,
    }
  }

  const status =
    now - helper.lastHeartbeatAt < LOCAL_HELPER_STALE_MS ? helper.status : "offline"
  const available = status === "idle" || status === "busy"

  return {
    available,
    helper: {
      machineLabel: helper.machineLabel,
      status,
    },
    lastHeartbeatAt: helper.lastHeartbeatAt,
  }
}

export function buildRawRunModeCapabilities(
  localHelperOverview: LocalHelperOverview,
): RawRunModeCapabilities {
  return {
    steel: {
      provider: "steel",
    },
    local_chrome: {
      provider: "local_chrome",
      helperAvailable: localHelperOverview.available,
      helper: localHelperOverview.helper,
      lastHeartbeatAt: localHelperOverview.lastHeartbeatAt,
    },
  }
}

export function resolveRunModeCapabilities(
  raw: RawRunModeCapabilities,
  options: {
    hasLocalHelperSecret: boolean
  },
): RunModeCapabilities {
  const localReason = !options.hasLocalHelperSecret
    ? "Local mode is unavailable because LOCAL_HELPER_SECRET is not configured on the app server."
    : raw.local_chrome.helperAvailable
      ? null
      : raw.local_chrome.helper
        ? `Reconnect the local Chrome helper on ${raw.local_chrome.helper.machineLabel} before creating a local run.`
        : "Start the local Chrome helper before creating a local run."

  return {
    steel: {
      provider: raw.steel.provider,
      label: "Cloud",
      placeholder: "Paste a URL for a hosted Steel run, then add optional instructions...",
      detail: "Cloud mode runs in a hosted Steel browser session with live replay in the run view.",
      runnable: true,
      reason: null,
      statusLabel: "Steel cloud",
    },
    local_chrome: {
      provider: raw.local_chrome.provider,
      label: "Local",
      placeholder: "Paste a URL for your own Chrome window, then add optional instructions...",
      detail: raw.local_chrome.helperAvailable
        ? raw.local_chrome.helper?.status === "busy"
          ? "Local mode uses your own Chrome through the connected helper. New runs will queue until the helper is free."
          : "Local mode uses your own Chrome through the connected helper."
        : "Local mode uses your own Chrome through the local helper.",
      runnable: localReason === null,
      reason: localReason,
      statusLabel: raw.local_chrome.helper?.machineLabel ?? "No helper connected",
    },
  }
}

