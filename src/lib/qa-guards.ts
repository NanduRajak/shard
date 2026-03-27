const MAX_REPEAT_COUNT = 3
const MAX_NO_OP_COUNT = 4

export type ActionSignature = {
  action: string
  pageUrl: string
  target?: string
}

export function isSameHostname(startUrl: string, candidateUrl: string) {
  return new URL(startUrl).hostname === new URL(candidateUrl).hostname
}

export function resolveSameHostUrl({
  currentUrl,
  nextUrl,
  startUrl,
}: {
  currentUrl: string
  nextUrl: string
  startUrl: string
}) {
  const resolved = new URL(nextUrl, currentUrl).toString()

  if (!isSameHostname(startUrl, resolved)) {
    return null
  }

  return resolved
}

export function buildActionSignature(signature: ActionSignature) {
  return [signature.action, signature.pageUrl, signature.target ?? ""].join("::")
}

export function shouldStopForRepeatActions(actionHistory: string[]) {
  if (actionHistory.length < MAX_REPEAT_COUNT) {
    return false
  }

  const recentActions = actionHistory.slice(-MAX_REPEAT_COUNT)
  return new Set(recentActions).size === 1
}

export function shouldStopForNoOps(noOpCount: number) {
  return noOpCount >= MAX_NO_OP_COUNT
}

export function wouldExceedPageLimit({
  maxPages,
  nextUrl,
  visitedPages,
}: {
  maxPages: number
  nextUrl: string
  visitedPages: Set<string>
}) {
  return !visitedPages.has(nextUrl) && visitedPages.size >= maxPages
}
