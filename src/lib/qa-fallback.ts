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

export type QaFallbackInteractive = {
  href?: string | null
  label: string
  tagName: string
}

export type QaFallbackAction =
  | {
      kind: "navigate"
      reason: string
      targetLabel: string
      url: string
    }
  | {
      kind: "screenshot"
      reason: string
    }

export function pickQaFallbackAction({
  currentUrl,
  interactives,
  maxPages,
  startUrl,
  visitedPages,
}: {
  currentUrl: string
  interactives: QaFallbackInteractive[]
  maxPages: number
  startUrl: string
  visitedPages: Iterable<string>
}): QaFallbackAction {
  const visited = new Set(visitedPages)

  const candidates = interactives
    .flatMap((interactive) => {
      if (!interactive.href) {
        return []
      }

      try {
        const resolvedUrl = new URL(interactive.href, currentUrl).toString()

        if (new URL(resolvedUrl).hostname !== new URL(startUrl).hostname) {
          return []
        }

        return [
          {
            label: interactive.label,
            score: scoreNavigationCandidate(interactive.label, resolvedUrl, visited),
            url: resolvedUrl,
            visited: visited.has(resolvedUrl),
          },
        ]
      } catch {
        return []
      }
    })
    .filter((candidate) => !candidate.visited)
    .sort((left, right) => right.score - left.score)

  const nextCandidate = candidates[0]

  if (nextCandidate && visited.size < maxPages) {
    return {
      kind: "navigate",
      reason: `The planner did not choose a tool, so the run is following the next high-signal public path: ${nextCandidate.label}.`,
      targetLabel: nextCandidate.label,
      url: nextCandidate.url,
    }
  }

  return {
    kind: "screenshot",
    reason:
      "The planner did not choose a tool and no fresh high-signal links were available, so the run captured the current state and continued.",
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
