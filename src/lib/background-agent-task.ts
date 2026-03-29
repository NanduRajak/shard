const DEFAULT_BACKGROUND_TASK_TITLE = "End-to-end QA audit"

type BackgroundCoverageLane = {
  avoid: string[]
  label: string
  objective: string
  priorities: string[]
}

const DEFAULT_COVERAGE_LANES: readonly BackgroundCoverageLane[] = [
  {
    label: "landing and primary navigation",
    objective:
      "map the homepage, global navigation, and top-level entry points that introduce the product or app structure",
    priorities: [
      "hero CTAs",
      "header and footer navigation",
      "menus, drawers, and tabs",
      "same-host links discovered directly from the landing page",
    ],
    avoid: [
      "deep search and filter interactions",
      "multi-step forms",
      "cart and checkout flows unless they are the main landing CTA",
    ],
  },
  {
    label: "search, filters, and browse discovery",
    objective:
      "exercise discovery tools that help users find content, products, or records across listing surfaces",
    priorities: [
      "search inputs and suggestions",
      "filters and sort controls",
      "pagination and load-more patterns",
      "browse categories and result lists",
    ],
    avoid: [
      "repeating basic landing-page exploration after discovery entry points are known",
      "forms unrelated to browse discovery",
      "checkout completion or account settings flows",
    ],
  },
  {
    label: "forms, creation flows, and validation",
    objective:
      "stress safe form entry, inline validation, reversible submissions, and record creation or edit flows when allowed",
    priorities: [
      "text inputs and selects",
      "validation states and required fields",
      "safe create, draft, or edit flows",
      "confirmation, error, and retry states after form actions",
    ],
    avoid: [
      "search-only exploration",
      "static marketing navigation with no form interactions",
      "irreversible submissions or destructive account actions",
    ],
  },
  {
    label: "product detail and cart interactions",
    objective:
      "inspect deeper item detail surfaces, drawers, modals, add-to-cart actions, and reversible pre-checkout states",
    priorities: [
      "detail pages and modal previews",
      "option selectors and quantity controls",
      "add-to-cart and cart drawer interactions",
      "checkout entry pages without final submission",
    ],
    avoid: [
      "basic homepage-only browsing",
      "auth walls unless checkout requires one",
      "forms that are unrelated to product or item interactions",
    ],
  },
  {
    label: "account entry points and auth walls",
    objective:
      "probe account-related entry points, login gates, profile surfaces, and permission boundaries without performing destructive actions",
    priorities: [
      "sign-in and account entry links",
      "stored-login flows when required",
      "profile, dashboard, and account navigation",
      "logged-in redirects and protected-route behavior",
    ],
    avoid: [
      "generic browse discovery once account areas are reachable",
      "product-only exploration unless auth blocks it",
      "help-center browsing that does not affect account state",
    ],
  },
  {
    label: "help, support, settings, and edge navigation",
    objective:
      "cover lower-traffic utility surfaces and edge navigation that still matter to end-to-end quality",
    priorities: [
      "help center and support pages",
      "settings, preferences, and utility menus",
      "secondary navigation and empty states",
      "footer links, edge routes, and less obvious entry points",
    ],
    avoid: [
      "repeating the main conversion path already covered by other lanes",
      "deep product or search flows unless they are required to reach settings",
      "long form sequences that belong to the validation lane",
    ],
  },
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

  const lane = getBackgroundAgentLane({ agentCount, agentIndex })

  return [
    baseInstructions,
    `Lane assignment: you are agent ${agentIndex + 1} of ${agentCount}, and you exclusively own ${lane.label}.`,
    `Lane objective: ${lane.objective}.`,
    `Prioritize these actions before anything else: ${lane.priorities.join(", ")}.`,
    `Treat these areas as lower priority and avoid duplicating them unless they are required to unblock your lane: ${lane.avoid.join(", ")}.`,
    "Do not mirror another agent's path. When a page or flow looks like it belongs to another lane, pivot immediately to a different route, interaction type, or user journey.",
    "Prefer untouched routes, untested buttons, fresh forms, and navigation states that expand total site coverage.",
  ].join(" ")
}

export function getBackgroundAgentLaneLabel({
  agentCount,
  agentIndex,
}: {
  agentCount: number
  agentIndex: number
}) {
  if (agentCount <= 1) {
    return "full-site coverage"
  }

  return getBackgroundAgentLane({ agentCount, agentIndex }).label
}

function getBackgroundAgentLane({
  agentCount,
  agentIndex,
}: {
  agentCount: number
  agentIndex: number
}) {
  if (agentCount <= 1) {
    return {
      avoid: [],
      label: "full-site coverage",
      objective: "cover the full site with balanced breadth and depth",
      priorities: ["fresh routes", "high-signal user journeys"],
    } satisfies BackgroundCoverageLane
  }

  return DEFAULT_COVERAGE_LANES[agentIndex % DEFAULT_COVERAGE_LANES.length]!
}
