export function buildSteelReplayManifestPath(sessionId: string) {
  return `/api/steel/${encodeURIComponent(sessionId)}/hls`
}

export function buildSteelReplayMediaPath({
  sessionId,
  targetUrl,
}: {
  sessionId: string
  targetUrl: string
}) {
  const searchParams = new URLSearchParams({
    url: targetUrl,
  })

  return `/api/steel/${encodeURIComponent(sessionId)}/media?${searchParams.toString()}`
}

export function rewriteSteelHlsPlaylist({
  playlist,
  sessionId,
  sourceUrl,
}: {
  playlist: string
  sessionId: string
  sourceUrl: string
}) {
  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith("#")) {
        return line
      }

      return buildSteelReplayMediaPath({
        sessionId,
        targetUrl: new URL(trimmed, sourceUrl).toString(),
      })
    })
    .join("\n")
}

export function isAllowedSteelReplayTarget({
  sessionId,
  targetUrl,
}: {
  sessionId: string
  targetUrl: string
}) {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(targetUrl)
  } catch {
    return false
  }

  if (parsedUrl.protocol !== "https:") {
    return false
  }

  if (parsedUrl.hostname !== "api.steel.dev") {
    return false
  }

  return parsedUrl.pathname.startsWith(`/v1/sessions/${sessionId}/`)
}
