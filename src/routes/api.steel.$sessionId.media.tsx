import { createFileRoute } from "@tanstack/react-router"
import { api } from "../../convex/_generated/api"
import { serverEnv } from "~/server-env"
import { isAllowedSteelReplayTarget, rewriteSteelHlsPlaylist } from "@/lib/steel-replay"

export const Route = createFileRoute("/api/steel/$sessionId/media")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { createConvexServerClient } = await import("~/server/convex")
        const convex = createConvexServerClient()
        const sessionAccess = await convex.query(api.runtime.getSessionReplayAccess, {
          externalSessionId: params.sessionId,
        })

        if (!sessionAccess) {
          return new Response("Replay not found.", { status: 404 })
        }

        const requestUrl = new URL(request.url)
        const targetUrl = requestUrl.searchParams.get("url")

        if (!targetUrl) {
          return new Response("Missing target URL.", { status: 400 })
        }

        let resolvedUrl: URL

        try {
          resolvedUrl = new URL(targetUrl)
        } catch {
          return new Response("Invalid target URL.", { status: 400 })
        }

        if (
          !isAllowedSteelReplayTarget({
            sessionId: params.sessionId,
            targetUrl: resolvedUrl.toString(),
          })
        ) {
          return new Response("Unsupported replay target URL.", { status: 400 })
        }

        const response = await fetch(resolvedUrl, {
          headers: {
            "steel-api-key": serverEnv.STEEL_API_KEY,
          },
        })

        if (!response.ok) {
          return new Response("Replay segment unavailable.", {
            status: response.status,
          })
        }

        const contentType = response.headers.get("content-type") ?? "application/octet-stream"

        if (contentType.includes("mpegurl") || resolvedUrl.pathname.endsWith(".m3u8")) {
          const playlist = await response.text()

          return new Response(
            rewriteSteelHlsPlaylist({
              playlist,
              sessionId: params.sessionId,
              sourceUrl: resolvedUrl.toString(),
            }),
            {
              headers: {
                "Content-Type": contentType,
              },
            },
          )
        }

        return new Response(response.body, {
          headers: {
            "Content-Type": contentType,
          },
        })
      },
    },
  },
})
