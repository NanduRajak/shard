import { createFileRoute } from "@tanstack/react-router"
import {
  buildGitHubOAuthUrl,
  getGitHubConfigState,
} from "../../../../app/server/github"
import {
  REVIEW_BOT_OAUTH_STATE_COOKIE,
  REVIEW_BOT_SESSION_COOKIE,
  createReviewBotSessionToken,
  getReviewBotCookieOptions,
  getReviewBotOAuthCookieOptions,
  serializeCookie,
} from "../../../../app/server/review-bot-session"

export const Route = createFileRoute("/api/github/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getGitHubConfigState()
        const requestUrl = new URL(request.url)

        if (!config.isReady) {
          return Response.redirect(
            new URL(
              `/review-bot?error=${encodeURIComponent(
                `GitHub connect is not configured yet. Missing: ${config.missing.join(", ")}`
              )}`,
              requestUrl
            ).toString()
            ,
            302
          )
        }

        const sessionToken = createReviewBotSessionToken()
        const oauthState = createReviewBotSessionToken()
        const response = new Response(null, {
          headers: {
            Location: buildGitHubOAuthUrl(oauthState),
          },
          status: 302,
        })

        response.headers.append(
          "Set-Cookie",
          serializeCookie(
            REVIEW_BOT_SESSION_COOKIE,
            sessionToken,
            getReviewBotCookieOptions(requestUrl)
          )
        )
        response.headers.append(
          "Set-Cookie",
          serializeCookie(
            REVIEW_BOT_OAUTH_STATE_COOKIE,
            oauthState,
            getReviewBotOAuthCookieOptions(requestUrl)
          )
        )

        return response
      },
    },
  },
})
