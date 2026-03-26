import { createFileRoute } from "@tanstack/react-router"
import {
  buildGitHubInstallUrl,
  getGitHubConfigState,
} from "../../../../app/server/github"
import {
  REVIEW_BOT_SESSION_COOKIE,
  getCookieValueFromHeader,
} from "../../../../app/server/review-bot-session"

export const Route = createFileRoute("/api/github/install")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const config = getGitHubConfigState()
        const requestUrl = new URL(request.url)

        if (!config.isReady) {
          return Response.redirect(
            new URL(
              `/review-bot?error=${encodeURIComponent(
                `GitHub install is not configured yet. Missing: ${config.missing.join(", ")}`
              )}`,
              requestUrl
            ).toString(),
            302
          )
        }

        const sessionToken = getCookieValueFromHeader(
          request.headers.get("cookie"),
          REVIEW_BOT_SESSION_COOKIE
        )

        if (!sessionToken) {
          return Response.redirect(
            new URL("/review-bot?error=Connect GitHub first.", requestUrl).toString(),
            302
          )
        }

        return Response.redirect(buildGitHubInstallUrl(sessionToken), 302)
      },
    },
  },
})
