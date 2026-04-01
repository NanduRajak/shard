import type { Document } from "@mendable/firecrawl-js"
import Firecrawl from "@mendable/firecrawl-js"

export type FirecrawlCrawlOptions = {
  url: string
  limit?: number
  maxDepth?: number
  includePaths?: string[]
  excludePaths?: string[]
  scrapeOptions?: {
    formats?: ("markdown" | "html")[]
  }
}

export type FirecrawlPageResult = {
  url: string
  markdown?: string
  html?: string
  metadata?: {
    title?: string
    description?: string
    statusCode?: number
    sourceURL?: string
    links?: string[]
  }
}

async function getClient(): Promise<Firecrawl> {
  const { serverEnv } = await import("~/server-env")
  return new Firecrawl({
    apiKey: serverEnv.FIRECRAWL_API_KEY ?? "",
    apiUrl: serverEnv.FIRECRAWL_API_URL ?? "http://localhost:3002",
  })
}

function mapDocumentToPageResult(doc: Document): FirecrawlPageResult {
  return {
    url: doc.metadata?.sourceURL ?? doc.metadata?.url ?? "",
    markdown: doc.markdown,
    html: doc.html,
    metadata: {
      title: doc.metadata?.title,
      description: doc.metadata?.description,
      statusCode: doc.metadata?.statusCode,
      sourceURL: doc.metadata?.sourceURL,
      links: doc.links,
    },
  }
}

export async function startCrawl(
  options: FirecrawlCrawlOptions,
): Promise<{ id: string }> {
  const client = await getClient()
  const { url, ...params } = options

  const response = await client.startCrawl(url, params)
  return { id: response.id }
}

export async function getCrawlStatus(jobId: string) {
  const client = await getClient()
  return client.getCrawlStatus(jobId)
}

export async function cancelCrawl(jobId: string): Promise<void> {
  const client = await getClient()
  await client.cancelCrawl(jobId)
}

export async function pollCrawlUntilDone(
  jobId: string,
  onBatch: (pages: FirecrawlPageResult[]) => Promise<void>,
): Promise<void> {
  const client = await getClient()
  let seenCount = 0

  while (true) {
    const status = await client.getCrawlStatus(jobId, { autoPaginate: true })

    const allPages = (status.data ?? []).map(mapDocumentToPageResult)

    if (allPages.length > seenCount) {
      const newPages = allPages.slice(seenCount)
      await onBatch(newPages)
      seenCount = allPages.length
    }

    if (status.status === "completed") {
      return
    }

    if (status.status === "failed") {
      throw new Error("Firecrawl crawl job failed")
    }

    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}
