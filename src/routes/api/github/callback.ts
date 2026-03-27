import { createFileRoute } from "@tanstack/react-router"
import { api } from "../../../../convex/_generated/api"
import { createConvexServerClient } from "../../../../app/server/convex"
import {
  buildGitHubInstallUrl,
  exchangeGitHubOAuthCode,
  getGitHubViewer,
} from "../../../../app/server/github"
import { encryptReviewBotSecret } from "../../../../app/server/review-bot-crypto"
import {
  REVIEW_BOT_OAUTH_STATE_COOKIE,
  REVIEW_BOT_SESSION_COOKIE,
  getCookieValueFromHeader,
  getReviewBotOAuthCookieOptions,
  serializeExpiredCookie,
} from "../../../../app/server/review-bot-session"

export const Route = createFileRoute("/api/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url)
        const code = requestUrl.searchParams.get("code")
        const state = requestUrl.searchParams.get("state")
        const cookieHeader = request.headers.get("cookie")
        const expectedState = getCookieValueFromHeader(
          cookieHeader,
          REVIEW_BOT_OAUTH_STATE_COOKIE
        )
        const sessionToken = getCookieValueFromHeader(
          cookieHeader,
          REVIEW_BOT_SESSION_COOKIE
        )

        if (!code || !state || !expectedState || state !== expectedState || !sessionToken) {
          return Response.redirect(
            new URL(
              "/review-bot?error=GitHub authorization could not be verified.",
              requestUrl
            ).toString(),
            302
          )
        }

        try {
          const accessToken = await exchangeGitHubOAuthCode(code)
          const viewer = await getGitHubViewer(accessToken)
          const convex = createConvexServerClient()

          await convex.mutation(api.reviewBot.upsertConnection, {
            avatarUrl: viewer.avatarUrl,
            encryptedAccessToken: encryptReviewBotSecret(accessToken),
            githubUserId: viewer.id,
            login: viewer.login,
            name: viewer.name,
            sessionToken,
          })

          const response = new Response(null, {
            headers: {
              Location: buildGitHubInstallUrl(sessionToken),
            },
            status: 302,
          })

          response.headers.append(
            "Set-Cookie",
            serializeExpiredCookie(
              REVIEW_BOT_OAUTH_STATE_COOKIE,
              requestUrl,
              getReviewBotOAuthCookieOptions(requestUrl)
            )
          )

          return response
        } catch (error) {
          return Response.redirect(
            new URL(
              `/review-bot?error=${encodeURIComponent(
                error instanceof Error ? error.message : "GitHub authorization failed."
              )}`,
              requestUrl
            ).toString(),
            302
          )
        }
      },
    },
  },
})
