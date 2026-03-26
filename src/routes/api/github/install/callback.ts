import { createFileRoute } from "@tanstack/react-router"
import {
  REVIEW_BOT_SESSION_COOKIE,
  getCookieValueFromHeader,
} from "../../../../../app/server/review-bot-session"

export const Route = createFileRoute("/api/github/install/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url)
        const state = requestUrl.searchParams.get("state")
        const sessionToken = getCookieValueFromHeader(
          request.headers.get("cookie"),
          REVIEW_BOT_SESSION_COOKIE
        )

        if (!sessionToken || !state || state !== sessionToken) {
          return Response.redirect(
            new URL(
              "/review-bot?error=GitHub App installation could not be verified.",
              requestUrl
            ).toString(),
            302
          )
        }

        return Response.redirect(
          new URL("/review-bot?connected=1", requestUrl).toString(),
          302
        )
      },
    },
  },
})
