import { createFileRoute } from "@tanstack/react-router"

async function createInngestHandler() {
  const [{ serve }, { functions, inngest }, { serverEnv }] = await Promise.all([
    import("inngest/next"),
    import("../../inngest/client"),
    import("~/server-env"),
  ])

  const serveOrigin =
    serverEnv.INNGEST_SERVE_ORIGIN ??
    (serverEnv.INNGEST_DEV === "1" ? "http://host.docker.internal:3000" : undefined)

  return serve({
    client: inngest,
    functions,
    serveOrigin,
    servePath: "/api/inngest",
  })
}

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const handler = await createInngestHandler()
        return await handler.GET(request as never, undefined)
      },
      POST: async ({ request }) => {
        const handler = await createInngestHandler()
        return await handler.POST(request as never, undefined)
      },
      PUT: async ({ request }) => {
        const handler = await createInngestHandler()
        return await handler.PUT(request as never, undefined)
      },
    },
  },
})
