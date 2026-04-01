import {
  IconCheck,
  IconLoader3,
  IconX,
  IconHourglassEmpty,
} from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"

type CrawlJob = {
  status: "pending" | "crawling" | "completed" | "failed"
  totalPages?: number
  crawledPages?: number
}

export function CrawlStatusBadge({
  crawlJob,
}: {
  crawlJob: CrawlJob | null | undefined
}) {
  if (!crawlJob) return null

  if (crawlJob.status === "pending") {
    return (
      <Badge
        className="items-center gap-1 bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none text-xs"
        variant="secondary"
      >
        <IconHourglassEmpty className="size-3.5" />
        Crawl queued
      </Badge>
    )
  }

  if (crawlJob.status === "crawling") {
    return (
      <Badge
        className="items-center gap-1 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none text-xs"
        variant="secondary"
      >
        <IconLoader3 className="size-3.5 animate-spin" />
        Crawling{crawlJob.crawledPages != null && crawlJob.totalPages != null
          ? ` ${crawlJob.crawledPages}/${crawlJob.totalPages}`
          : "..."}
      </Badge>
    )
  }

  if (crawlJob.status === "completed") {
    return (
      <Badge
        className="items-center gap-1 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none text-xs"
        variant="secondary"
      >
        <IconCheck className="size-3.5" stroke={2.5} />
        Crawled {crawlJob.totalPages ?? 0} pages
      </Badge>
    )
  }

  return (
    <Badge
      variant="destructive"
      className="items-center gap-1 bg-red-500/15 text-red-500 hover:bg-red-500/25 border-0 rounded-lg py-1 px-2.5 shadow-none text-xs"
    >
      <IconX className="size-3.5" stroke={2.5} />
      Crawl failed
    </Badge>
  )
}
