import { randomBytes } from "node:crypto"

export const REVIEW_BOT_SESSION_COOKIE = "shard_review_bot_session"
export const REVIEW_BOT_OAUTH_STATE_COOKIE = "shard_review_bot_oauth_state"

export function createReviewBotSessionToken() {
  return randomBytes(24).toString("hex")
}

export function getReviewBotCookieOptions(url: URL) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: url.protocol === "https:",
    maxAge: 60 * 60 * 24 * 30,
  }
}

export function getReviewBotOAuthCookieOptions(url: URL) {
  return {
    ...getReviewBotCookieOptions(url),
    maxAge: 60 * 10,
  }
}

export function getCookieValueFromHeader(
  cookieHeader: string | null,
  name: string
) {
  if (!cookieHeader) {
    return null
  }

  const segments = cookieHeader.split(";")

  for (const segment of segments) {
    const [rawName, ...rawValue] = segment.trim().split("=")

    if (rawName === name) {
      return decodeURIComponent(rawValue.join("="))
    }
  }

  return null
}

export function serializeCookie(
  name: string,
  value: string,
  options: ReturnType<typeof getReviewBotCookieOptions>
) {
  const parts = [`${name}=${encodeURIComponent(value)}`]

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`)
  }

  if (options.path) {
    parts.push(`Path=${options.path}`)
  }

  if (options.httpOnly) {
    parts.push("HttpOnly")
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`)
  }

  if (options.secure) {
    parts.push("Secure")
  }

  return parts.join("; ")
}

export function serializeExpiredCookie(
  name: string,
  url: URL,
  options = getReviewBotCookieOptions(url)
) {
  return serializeCookie(name, "", {
    ...options,
    maxAge: 0,
  })
}
