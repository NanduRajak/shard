import { useState } from "react"
import {
  IconAlertTriangle,
  IconArticle,
  IconBook,
  IconChevronDown,
  IconCreditCard,
  IconForms,
  IconGlobe,
  IconInfoCircle,
  IconLock,
  IconSearch,
  IconSettings,
  IconShoppingCart,
  IconTag,
  IconWorldWww,
} from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

type CrawledPage = {
  url: string
  title?: string
  pageType?: string
  statusCode: number
  isDeadLink: boolean
  forms?: { fields: unknown[] }[]
}

type SiteMapViewProps = {
  crawledPages: CrawledPage[]
  visitedUrls?: Set<string>
  coverage?: { total: number; byPageType: Record<string, number>; deadLinks: number }
}

const PAGE_TYPE_META: Record<string, { label: string; icon: typeof IconGlobe; className: string }> = {
  auth: { label: "Auth", icon: IconLock, className: "text-violet-400" },
  product: { label: "Product", icon: IconShoppingCart, className: "text-blue-400" },
  checkout: { label: "Checkout", icon: IconCreditCard, className: "text-emerald-400" },
  blog: { label: "Blog", icon: IconArticle, className: "text-amber-400" },
  docs: { label: "Docs", icon: IconBook, className: "text-sky-400" },
  about: { label: "About", icon: IconInfoCircle, className: "text-teal-400" },
  settings: { label: "Settings", icon: IconSettings, className: "text-slate-400" },
  pricing: { label: "Pricing", icon: IconTag, className: "text-pink-400" },
  discovery: { label: "Discovery", icon: IconSearch, className: "text-indigo-400" },
  form: { label: "Form", icon: IconForms, className: "text-orange-400" },
  other: { label: "Other", icon: IconGlobe, className: "text-muted-foreground" },
}

function getPageTypeMeta(pageType: string) {
  return PAGE_TYPE_META[pageType] ?? PAGE_TYPE_META.other!
}

function getUrlPath(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search
  } catch {
    return url
  }
}

export function SiteMapView({ crawledPages, visitedUrls, coverage }: SiteMapViewProps) {
  const deadLinks = crawledPages.filter((p) => p.isDeadLink)
  const grouped = new Map<string, CrawledPage[]>()

  for (const page of crawledPages) {
    const type = page.pageType ?? "other"
    const existing = grouped.get(type)
    if (existing) {
      existing.push(page)
    } else {
      grouped.set(type, [page])
    }
  }

  const sortedGroups = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)
  const coveragePercent = visitedUrls && crawledPages.length > 0
    ? Math.round((visitedUrls.size / crawledPages.length) * 100)
    : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <IconWorldWww className="size-4 text-cyan-400" />
            Site Map
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            {crawledPages.length} pages discovered{coverage?.deadLinks ? `, ${coverage.deadLinks} dead links` : ""}
          </p>
        </div>
      </div>

      {coveragePercent !== null && (
        <Progress value={coveragePercent}>
          <ProgressLabel className="text-xs text-muted-foreground">Coverage</ProgressLabel>
          <ProgressValue className="text-xs" />
        </Progress>
      )}

      {deadLinks.length > 0 && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-4">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wider text-red-400 uppercase">
            <IconAlertTriangle className="size-3.5" />
            Dead Links ({deadLinks.length})
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {deadLinks.slice(0, 12).map((page) => (
              <Badge
                key={page.url}
                variant="outline"
                className="max-w-full truncate border-red-500/30 text-red-300 text-xs"
              >
                {page.statusCode} {getUrlPath(page.url)}
              </Badge>
            ))}
            {deadLinks.length > 12 && (
              <Badge variant="outline" className="border-red-500/30 text-red-300 text-xs">
                +{deadLinks.length - 12} more
              </Badge>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {sortedGroups.map(([pageType, pages]) => (
          <PageTypeGroup
            key={pageType}
            pageType={pageType}
            pages={pages}
            visitedUrls={visitedUrls}
          />
        ))}
      </div>
    </div>
  )
}

function PageTypeGroup({
  pageType,
  pages,
  visitedUrls,
}: {
  pageType: string
  pages: CrawledPage[]
  visitedUrls?: Set<string>
}) {
  const [open, setOpen] = useState(false)
  const meta = getPageTypeMeta(pageType)
  const Icon = meta.icon

  return (
    <div className="rounded-xl border border-border/70 bg-background/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Icon className={cn("size-4", meta.className)} />
          {meta.label}
          <span className="text-xs text-muted-foreground">({pages.length})</span>
        </span>
        <IconChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border/70 px-4 py-2 space-y-1">
          {pages.slice(0, 20).map((page) => {
            const visited = visitedUrls?.has(page.url)
            const hasForms = page.forms && page.forms.length > 0
            return (
              <div key={page.url} className="flex items-center gap-2 py-1.5 text-xs">
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    page.isDeadLink
                      ? "bg-red-500"
                      : visited
                        ? "bg-emerald-500"
                        : "bg-muted-foreground/40",
                  )}
                />
                <span className="min-w-0 truncate text-foreground/90" title={page.url}>
                  {getUrlPath(page.url)}
                </span>
                {page.title && (
                  <span className="hidden sm:inline truncate text-muted-foreground ml-1" title={page.title}>
                    — {page.title}
                  </span>
                )}
                {hasForms && (
                  <IconForms className="size-3 shrink-0 text-orange-400 ml-auto" title="Has forms" />
                )}
              </div>
            )
          })}
          {pages.length > 20 && (
            <p className="text-xs text-muted-foreground py-1">
              +{pages.length - 20} more pages
            </p>
          )}
        </div>
      )}
    </div>
  )
}
