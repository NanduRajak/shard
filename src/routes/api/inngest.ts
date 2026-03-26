import { createFileRoute } from "@tanstack/react-router"

async function createInngestHandler() {
  const [{ serve }, { functions, inngest }] = await Promise.all([
    import("inngest/next"),
    import("../../../inngest/review-bot-client"),
  ])

  return serve({
    client: inngest,
    functions,
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
