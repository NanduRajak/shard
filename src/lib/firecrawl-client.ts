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

export type FirecrawlCrawlStatus = {
  status: "scraping" | "completed" | "failed"
  total: number
  completed: number
  data: FirecrawlPageResult[]
  next?: string
}

async function getFirecrawlBaseUrl(): Promise<string> {
  const { serverEnv } = await import("~/server-env")
  return serverEnv.FIRECRAWL_API_URL ?? "http://localhost:3002"
}

async function getFirecrawlHeaders() {
  const { serverEnv } = await import("~/server-env")

  return {
    "Content-Type": "application/json",
    ...(serverEnv.FIRECRAWL_API_KEY
      ? { Authorization: `Bearer ${serverEnv.FIRECRAWL_API_KEY}` }
      : {}),
  }
}

export async function startCrawl(
  options: FirecrawlCrawlOptions,
): Promise<{ id: string }> {
  const baseUrl = await getFirecrawlBaseUrl()
  const headers = await getFirecrawlHeaders()

  const response = await fetch(`${baseUrl}/v1/crawl`, {
    method: "POST",
    headers,
    body: JSON.stringify(options),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `Firecrawl startCrawl failed (${response.status}): ${text}`,
    )
  }

  const data = (await response.json()) as { id: string }
  return data
}

export async function getCrawlStatus(
  jobId: string,
): Promise<FirecrawlCrawlStatus> {
  const baseUrl = await getFirecrawlBaseUrl()
  const headers = await getFirecrawlHeaders()

  const response = await fetch(`${baseUrl}/v1/crawl/${jobId}`, { headers })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `Firecrawl getCrawlStatus failed (${response.status}): ${text}`,
    )
  }

  return (await response.json()) as FirecrawlCrawlStatus
}

async function fetchJson(url: string): Promise<FirecrawlCrawlStatus> {
  const headers = await getFirecrawlHeaders()
  const response = await fetch(url, { headers })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `Firecrawl pagination fetch failed (${response.status}): ${text}`,
    )
  }

  return (await response.json()) as FirecrawlCrawlStatus
}

export async function pollCrawlUntilDone(
  jobId: string,
  onBatch: (pages: FirecrawlPageResult[]) => Promise<void>,
): Promise<void> {
  let seenCount = 0

  while (true) {
    // Collect all pages from this poll (including paginated results)
    const allPages: FirecrawlPageResult[] = []
    let currentStatus: FirecrawlCrawlStatus

    // Fetch main status + follow pagination
    currentStatus = await getCrawlStatus(jobId)
    allPages.push(...currentStatus.data)

    let nextUrl = currentStatus.next
    while (nextUrl) {
      const nextPage = await fetchJson(nextUrl)
      allPages.push(...nextPage.data)
      nextUrl = nextPage.next
    }

    // Deliver only new pages
    if (allPages.length > seenCount) {
      const newPages = allPages.slice(seenCount)
      await onBatch(newPages)
      seenCount = allPages.length
    }

    if (currentStatus.status === "completed") {
      return
    }

    if (currentStatus.status === "failed") {
      throw new Error("Firecrawl crawl job failed")
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}
