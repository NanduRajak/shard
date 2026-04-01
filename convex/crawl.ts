import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const createCrawlJob = mutation({
  args: {
    orchestratorId: v.optional(v.id("backgroundOrchestrators")),
    runId: v.optional(v.id("runs")),
    url: v.string(),
    origin: v.string(),
    firecrawlJobId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    return await ctx.db.insert("crawlJobs", {
      ...args,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const updateCrawlJob = mutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("crawling"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
    totalPages: v.optional(v.number()),
    crawledPages: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { crawlJobId, ...fields } = args
    const patch: Record<string, unknown> = { updatedAt: Date.now() }

    if (fields.status !== undefined) patch.status = fields.status
    if (fields.totalPages !== undefined) patch.totalPages = fields.totalPages
    if (fields.crawledPages !== undefined) patch.crawledPages = fields.crawledPages
    if (fields.errorMessage !== undefined) patch.errorMessage = fields.errorMessage
    if (fields.finishedAt !== undefined) patch.finishedAt = fields.finishedAt

    await ctx.db.patch(crawlJobId, patch)
  },
})

export const upsertCrawledPage = mutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
    url: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    markdownContent: v.optional(v.string()),
    statusCode: v.number(),
    isDeadLink: v.boolean(),
    internalLinks: v.array(v.string()),
    pageType: v.optional(v.string()),
    forms: v.optional(
      v.array(
        v.object({
          action: v.optional(v.string()),
          method: v.optional(v.string()),
          fields: v.array(
            v.object({
              name: v.string(),
              type: v.string(),
              label: v.optional(v.string()),
              required: v.boolean(),
              placeholder: v.optional(v.string()),
              options: v.optional(v.array(v.string())),
            }),
          ),
        }),
      ),
    ),
    wordCount: v.optional(v.number()),
    crawledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("crawledPages")
      .withIndex("by_crawl_job_and_url", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("url", args.url),
      )
      .first()

    if (existing) {
      const { crawlJobId: _cj, url: _u, ...updateFields } = args
      await ctx.db.patch(existing._id, updateFields)
      return existing._id
    }

    return await ctx.db.insert("crawledPages", args)
  },
})

export const deleteCrawlJob = mutation({
  args: {
    crawlJobId: v.id("crawlJobs"),
  },
  handler: async (ctx, args) => {
    const pages = await ctx.db
      .query("crawledPages")
      .withIndex("by_crawl_job", (q) => q.eq("crawlJobId", args.crawlJobId))
      .collect()

    await Promise.all(pages.map((page) => ctx.db.delete(page._id)))
    await ctx.db.delete(args.crawlJobId)
  },
})

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getCrawlJob = query({
  args: {
    crawlJobId: v.id("crawlJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.crawlJobId)
  },
})

export const getCrawlJobByOrchestrator = query({
  args: {
    orchestratorId: v.id("backgroundOrchestrators"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crawlJobs")
      .withIndex("by_orchestrator", (q) => q.eq("orchestratorId", args.orchestratorId))
      .first()
  },
})

export const getCrawlJobByRun = query({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crawlJobs")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .first()
  },
})

export const listCrawledPages = query({
  args: {
    crawlJobId: v.id("crawlJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crawledPages")
      .withIndex("by_crawl_job", (q) => q.eq("crawlJobId", args.crawlJobId))
      .collect()
  },
})

export const listDeadLinks = query({
  args: {
    crawlJobId: v.id("crawlJobs"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crawledPages")
      .withIndex("by_crawl_job_and_is_dead_link", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("isDeadLink", true),
      )
      .collect()
  },
})

export const listPagesByType = query({
  args: {
    crawlJobId: v.id("crawlJobs"),
    pageType: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("crawledPages")
      .withIndex("by_crawl_job_and_page_type", (q) =>
        q.eq("crawlJobId", args.crawlJobId).eq("pageType", args.pageType),
      )
      .collect()
  },
})

export const listFormsFromCrawl = query({
  args: {
    crawlJobId: v.id("crawlJobs"),
  },
  handler: async (ctx, args) => {
    const pages = await ctx.db
      .query("crawledPages")
      .withIndex("by_crawl_job", (q) => q.eq("crawlJobId", args.crawlJobId))
      .collect()

    return pages.filter((page) => page.forms && page.forms.length > 0)
  },
})

export const getCrawlCoverage = query({
  args: {
    crawlJobId: v.id("crawlJobs"),
  },
  handler: async (ctx, args) => {
    const pages = await ctx.db
      .query("crawledPages")
      .withIndex("by_crawl_job", (q) => q.eq("crawlJobId", args.crawlJobId))
      .collect()

    const byPageType: Record<string, number> = {}
    let deadLinks = 0

    for (const page of pages) {
      const pt = page.pageType ?? "other"
      byPageType[pt] = (byPageType[pt] ?? 0) + 1
      if (page.isDeadLink) deadLinks++
    }

    return { total: pages.length, byPageType, deadLinks }
  },
})

export const getUnvisitedPages = query({
  args: {
    crawlJobId: v.id("crawlJobs"),
    visitedUrls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const pages = await ctx.db
      .query("crawledPages")
      .withIndex("by_crawl_job", (q) => q.eq("crawlJobId", args.crawlJobId))
      .collect()

    const visited = new Set(args.visitedUrls)
    return pages.filter((page) => !visited.has(page.url))
  },
})

export const getFirstRunForOrchestrator = query({
  args: {
    orchestratorId: v.id("backgroundOrchestrators"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_background_orchestrator", (q) =>
        q.eq("backgroundOrchestratorId", args.orchestratorId),
      )
      .first()
  },
})

export const getDashboardCrawlStats = query({
  args: {},
  handler: async (ctx) => {
    const recentJobs = await ctx.db
      .query("crawlJobs")
      .order("desc")
      .take(20)

    let totalPagesCrawled = 0
    let totalDeadLinks = 0
    let totalFormsFound = 0
    let completedCrawls = 0
    let coverageSum = 0

    for (const job of recentJobs) {
      if (job.status !== "completed") continue
      completedCrawls++

      const pages = await ctx.db
        .query("crawledPages")
        .withIndex("by_crawl_job", (q) => q.eq("crawlJobId", job._id))
        .collect()

      totalPagesCrawled += pages.length

      for (const page of pages) {
        if (page.isDeadLink) totalDeadLinks++
        if (page.forms && page.forms.length > 0) totalFormsFound += page.forms.length
      }

      if (job.orchestratorId) {
        const runs = await ctx.db
          .query("runs")
          .withIndex("by_background_orchestrator", (q) =>
            q.eq("backgroundOrchestratorId", job.orchestratorId!),
          )
          .collect()

        const visitedUrls = new Set<string>()
        for (const run of runs) {
          const events = await ctx.db
            .query("runEvents")
            .withIndex("by_run", (q) => q.eq("runId", run._id))
            .collect()
          for (const event of events) {
            if (event.pageUrl) visitedUrls.add(event.pageUrl)
          }
        }

        if (pages.length > 0) {
          coverageSum += (visitedUrls.size / pages.length) * 100
        }
      }
    }

    const avgCoverage = completedCrawls > 0 ? Math.round(coverageSum / completedCrawls) : 0

    return {
      totalPagesCrawled,
      totalDeadLinks,
      totalFormsFound,
      completedCrawls,
      avgCoverage,
    }
  },
})
