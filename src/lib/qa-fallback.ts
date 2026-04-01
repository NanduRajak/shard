const NAVIGATION_PRIORITY_KEYWORDS = [
  "pricing",
  "product",
  "features",
  "docs",
  "documentation",
  "about",
  "contact",
  "support",
  "help",
  "faq",
  "demo",
  "tour",
  "solutions",
]

const COVERAGE_CLICK_KEYWORDS = [
  "tab",
  "menu",
  "drawer",
  "modal",
  "dialog",
  "filter",
  "sort",
  "apply",
  "next",
  "previous",
  "prev",
  "show more",
  "load more",
  "details",
  "view",
  "open",
  "expand",
  "accordion",
  "add to cart",
  "cart",
]

const DANGEROUS_ACTION_KEYWORDS = [
  "delete",
  "remove",
  "destroy",
  "purge",
  "erase",
  "deactivate",
  "disable",
  "terminate",
  "confirm purchase",
  "complete purchase",
  "complete order",
  "place order",
  "pay now",
  "submit payment",
]

export type QaFallbackInteractive = {
  href?: string | null
  id: number
  label: string
  tagName: string
  type?: string | null
}

export type CrawlSuggestion = {
  url: string
  pageType: string
  title?: string
}

export type QaFallbackAction =
  | {
      kind: "navigate"
      reason: string
      targetLabel: string
      url: string
    }
  | {
      id: number
      kind: "click"
      reason: string
      targetLabel: string
    }
  | {
      id: number
      kind: "fill"
      reason: string
      submitOnEnter?: boolean
      targetLabel: string
      value: string
    }
  | {
      kind: "screenshot"
      reason: string
    }

export function pickQaFallbackAction({
  crawlSuggestions,
  currentUrl,
  interactives,
  maxPages,
  startUrl,
  triedActions,
  visitedPages,
}: {
  crawlSuggestions?: CrawlSuggestion[]
  currentUrl: string
  interactives: QaFallbackInteractive[]
  maxPages: number
  startUrl: string
  triedActions: Iterable<string>
  visitedPages: Iterable<string>
}): QaFallbackAction {
  const visited = new Set(visitedPages)
  const tried = new Set(triedActions)

  const candidates = interactives
    .flatMap((interactive) => {
      const label = normalizeLabel(interactive.label)
      const resolvedHref = interactive.href
        ? resolveHref(interactive.href, currentUrl)
        : null
      const actionCandidates: Array<
        {
          action: QaFallbackAction
          score: number
          signature: string
        }
      > = []

      if (isDangerousLabel(label)) {
        return actionCandidates
      }

      if (isSafeSearchInput(interactive)) {
        actionCandidates.push({
          action: {
            kind: "fill",
            id: interactive.id,
            value: "test search",
            submitOnEnter: true,
            reason:
              "The planner did not choose a tool, so the run is exercising a visible search or filter field before leaving the page.",
            targetLabel: interactive.label,
          },
          score: scoreInputCandidate(interactive),
          signature: `fill::${currentUrl}::${interactive.id}::submit`,
        })
      }

      if (
        isSafeClickCandidate(interactive) &&
        (!resolvedHref || new URL(resolvedHref).hostname === new URL(startUrl).hostname) &&
        (!resolvedHref || !visited.has(resolvedHref))
      ) {
        actionCandidates.push({
          action: {
            kind: "click",
            id: interactive.id,
            reason:
              "The planner did not choose a tool, so the run is exercising a reversible visible control on the current page.",
            targetLabel: interactive.label,
          },
          score: scoreClickCandidate(interactive, resolvedHref, visited),
          signature: `click::${currentUrl}::${interactive.id}`,
        })
      }

      if (resolvedHref) {
        if (new URL(resolvedHref).hostname !== new URL(startUrl).hostname) {
          return actionCandidates
        }

        if (visited.size < maxPages && !visited.has(resolvedHref)) {
          actionCandidates.push({
            action: {
              kind: "navigate",
              reason: `The planner did not choose a tool, so the run is following the next useful same-host path: ${interactive.label}.`,
              targetLabel: interactive.label,
              url: resolvedHref,
            },
            score: scoreNavigationCandidate(interactive.label, resolvedHref, visited),
            signature: `navigate::${resolvedHref}`,
          })
        }
      }

      return actionCandidates
    })
    .filter((candidate) => !tried.has(candidate.signature))
    .sort((left, right) => right.score - left.score)

  // Inject crawl-suggested navigation candidates
  if (crawlSuggestions && visited.size < maxPages) {
    for (const suggestion of crawlSuggestions) {
      if (visited.has(suggestion.url)) continue
      const sig = `navigate::${suggestion.url}`
      if (tried.has(sig)) continue

      let score = 50
      // Boost high-value page types
      if (["product", "checkout", "auth"].includes(suggestion.pageType)) score += 20
      if (["form"].includes(suggestion.pageType)) score += 15

      candidates.push({
        action: {
          kind: "navigate",
          reason: "Pre-crawled unvisited page",
          targetLabel: suggestion.title ?? suggestion.url,
          url: suggestion.url,
        },
        score,
        signature: sig,
      })
    }

    candidates.sort((left, right) => right.score - left.score)
  }

  const nextCandidate = candidates[0]

  if (nextCandidate) {
    return nextCandidate.action
  }

  return {
    kind: "screenshot",
    reason:
      "The planner did not choose a tool and no fresh reversible actions remained, so the run captured the current state and continued.",
  }
}

function scoreNavigationCandidate(label: string, url: string, visited: Set<string>) {
  const haystack = `${label} ${url}`.toLowerCase()
  let score = 0

  for (const keyword of NAVIGATION_PRIORITY_KEYWORDS) {
    if (haystack.includes(keyword)) {
      score += 10
    }
  }

  if (label.trim().length > 0) {
    score += 2
  }

  if (visited.has(url)) {
    score -= 100
  }

  return score
}

function scoreClickCandidate(
  interactive: QaFallbackInteractive,
  resolvedHref: string | null,
  visited: Set<string>,
) {
  const haystack = normalizeLabel(`${interactive.label} ${interactive.tagName}`)
  let score = interactive.tagName === "button" ? 22 : 14

  for (const keyword of COVERAGE_CLICK_KEYWORDS) {
    if (haystack.includes(keyword)) {
      score += 12
    }
  }

  if (haystack.includes("add to cart")) {
    score += 8
  }

  if (resolvedHref) {
    score += scoreNavigationCandidate(interactive.label, resolvedHref, visited)
  }

  return score
}

function scoreInputCandidate(interactive: QaFallbackInteractive) {
  const haystack = normalizeLabel(`${interactive.label} ${interactive.type ?? ""}`)
  let score = 30

  if (haystack.includes("search")) {
    score += 16
  }

  if (haystack.includes("filter") || haystack.includes("sort")) {
    score += 10
  }

  return score
}

function isSafeClickCandidate(interactive: QaFallbackInteractive) {
  const label = normalizeLabel(interactive.label)

  if (!label || isDangerousLabel(label)) {
    return false
  }

  if (interactive.tagName === "input") {
    return false
  }

  return true
}

function isSafeSearchInput(interactive: QaFallbackInteractive) {
  if (interactive.tagName !== "input") {
    return false
  }

  const type = interactive.type?.toLowerCase() ?? "text"
  const label = normalizeLabel(interactive.label)

  if (!["search", "text", "email", "url", "tel"].includes(type)) {
    return false
  }

  return (
    label.includes("search") ||
    label.includes("find") ||
    label.includes("filter") ||
    label.includes("query")
  )
}

function isDangerousLabel(label: string) {
  return DANGEROUS_ACTION_KEYWORDS.some((keyword) => label.includes(keyword))
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase()
}

function resolveHref(href: string, currentUrl: string) {
  try {
    return new URL(href, currentUrl).toString()
  } catch {
    return null
  }
}
