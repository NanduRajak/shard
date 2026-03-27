import { createFileRoute } from "@tanstack/react-router"
import { api } from "../../convex/_generated/api"
import { serverEnv } from "~/server-env"
import { rewriteSteelHlsPlaylist } from "@/lib/steel-replay"

export const Route = createFileRoute("/api/steel/$sessionId/hls")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { createConvexServerClient } = await import("~/server/convex")
        const convex = createConvexServerClient()
        const sessionAccess = await convex.query(api.runtime.getSessionReplayAccess, {
          externalSessionId: params.sessionId,
        })

        if (!sessionAccess) {
          return new Response("Replay not found.", { status: 404 })
        }

        const response = await fetch(
          `https://api.steel.dev/v1/sessions/${params.sessionId}/hls`,
          {
            headers: {
              "steel-api-key": serverEnv.STEEL_API_KEY,
            },
          },
        )

        if (!response.ok) {
          return new Response("Replay manifest unavailable.", {
            status: response.status,
          })
        }

        const playlist = await response.text()

        return new Response(
          rewriteSteelHlsPlaylist({
            playlist,
            sessionId: params.sessionId,
            sourceUrl: response.url,
          }),
          {
            headers: {
              "Content-Type": response.headers.get("content-type") ?? "application/vnd.apple.mpegurl",
            },
          },
        )
      },
    },
  },
})
