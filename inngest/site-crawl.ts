import type { Id } from "../convex/_generated/dataModel"
import { api } from "../convex/_generated/api"
import { createConvexServerClient } from "~/server/convex"
import { inngest } from "./core"
import { startCrawl, pollCrawlUntilDone } from "@/lib/firecrawl-client"
import { classifyPageType, extractForms } from "@/lib/crawl-processing"
import {
  computeFindingScore,
  impactWeightForSource,
} from "@/lib/scoring"
import type { FindingSeverity } from "@/lib/scoring"

export type CrawlRequestedEvent = {
  data: {
    orchestratorId?: string
    runId?: string
    url: string
    origin: string
    limit?: number
  }
}

export async function runSiteCrawlWorkflow(eventData: CrawlRequestedEvent["data"]) {
  const convex = createConvexServerClient()
  let crawlJobId: Id<"crawlJobs"> | undefined

  try {
    const { id: firecrawlJobId } = await startCrawl({
      url: eventData.url,
      limit: eventData.limit ?? 200,
      scrapeOptions: { formats: ["markdown", "html"] },
    })

    crawlJobId = await convex.mutation(api.crawl.createCrawlJob, {
      orchestratorId: eventData.orchestratorId
        ? (eventData.orchestratorId as Id<"backgroundOrchestrators">)
        : undefined,
      runId: eventData.runId
        ? (eventData.runId as Id<"runs">)
        : undefined,
      url: eventData.url,
      origin: eventData.origin,
      firecrawlJobId,
    })

    await convex.mutation(api.crawl.updateCrawlJob, {
      crawlJobId,
      status: "crawling",
    })

    let processedCount = 0
    const originHostname = new URL(eventData.url).hostname

    await pollCrawlUntilDone(firecrawlJobId, async (pages) => {
      for (const page of pages) {
        const pageType = classifyPageType(page)
        const forms = extractForms(page)
        const statusCode = page.metadata?.statusCode ?? 200
        const internalLinks = (page.metadata?.links ?? []).filter((link) => {
          try {
            return new URL(link).hostname === originHostname
          } catch {
            return false
          }
        })

        await convex.mutation(api.crawl.upsertCrawledPage, {
          crawlJobId: crawlJobId!,
          url: page.url,
          title: page.metadata?.title,
          description: page.metadata?.description,
          markdownContent: page.markdown,
          statusCode,
          isDeadLink: statusCode >= 400,
          internalLinks,
          pageType,
          forms: forms.length > 0 ? forms : undefined,
          wordCount: page.markdown
            ? page.markdown.split(/\s+/).filter(Boolean).length
            : undefined,
          crawledAt: Date.now(),
        })

        processedCount++
      }

      await convex.mutation(api.crawl.updateCrawlJob, {
        crawlJobId: crawlJobId!,
        crawledPages: processedCount,
      })
    })

    await convex.mutation(api.crawl.updateCrawlJob, {
      crawlJobId,
      status: "completed",
      crawledPages: processedCount,
      totalPages: processedCount,
      finishedAt: Date.now(),
    })

    await createDeadLinkFindings(convex, crawlJobId!)
  } catch (error) {
    if (crawlJobId) {
      await convex
        .mutation(api.crawl.updateCrawlJob, {
          crawlJobId,
          status: "failed",
          errorMessage:
            error instanceof Error ? error.message : "Unknown crawl error",
          finishedAt: Date.now(),
        })
        .catch(() => undefined)
    }

    throw error
  }
}

export const siteCrawl = inngest.createFunction(
  {
    id: "site-crawl",
    retries: 1,
    concurrency: { limit: 2 },
    triggers: [{ event: "app/crawl.requested" }],
  },
  async ({ event }: { event: CrawlRequestedEvent }) => {
    return await runSiteCrawlWorkflow(event.data)
  },
)

async function createDeadLinkFindings(
  convex: ReturnType<typeof createConvexServerClient>,
  crawlJobId: Id<"crawlJobs">,
) {
  const crawlJob = await convex.query(api.crawl.getCrawlJob, { crawlJobId })
  if (!crawlJob) return

  // Determine runId for findings
  let runId: Id<"runs"> | undefined = crawlJob.runId ?? undefined

  if (!runId && crawlJob.orchestratorId) {
    const firstRun = await convex.query(api.crawl.getFirstRunForOrchestrator, {
      orchestratorId: crawlJob.orchestratorId,
    })
    runId = firstRun?._id
  }

  const deadLinks = await convex.query(api.crawl.listDeadLinks, { crawlJobId })

  for (const deadLink of deadLinks) {
    const severity: FindingSeverity = deadLink.statusCode >= 500 ? "high" : "medium"
    const score = computeFindingScore({
      confidence: 0.95,
      severity,
      source: "browser",
    })
    const impact = impactWeightForSource("browser")

    await convex.mutation(api.runtime.createFinding, {
      runId,
      source: "browser",
      browserSignal: "network",
      title: `Dead link: ${deadLink.statusCode} at ${deadLink.url}`,
      description: `Crawl discovered a ${deadLink.statusCode} response at ${deadLink.url}. This link may be broken or the page may have been removed.`,
      severity,
      confidence: 0.95,
      impact,
      score,
      pageOrFlow: deadLink.url,
    })
  }
}
