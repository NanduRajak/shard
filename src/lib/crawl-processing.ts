import { JSDOM } from "jsdom"
import type { FirecrawlPageResult } from "./firecrawl-client"

export type FormField = {
  name: string
  type: string
  label?: string
  required: boolean
  placeholder?: string
  options?: string[]
}

export type FormInventoryEntry = {
  action?: string
  method?: string
  fields: FormField[]
}

const PAGE_TYPE_RULES: Array<{ keywords: string[]; type: string }> = [
  { keywords: ["/login", "/signin", "/signup", "/register", "/auth"], type: "auth" },
  { keywords: ["/product", "/item", "/shop", "/store"], type: "product" },
  { keywords: ["/cart", "/checkout", "/basket"], type: "checkout" },
  { keywords: ["/blog", "/post", "/article", "/news"], type: "blog" },
  { keywords: ["/docs", "/documentation", "/help", "/faq", "/support"], type: "docs" },
  { keywords: ["/about", "/team", "/contact"], type: "about" },
  { keywords: ["/settings", "/preferences", "/account", "/profile", "/dashboard"], type: "settings" },
  { keywords: ["/pricing", "/plans"], type: "pricing" },
  { keywords: ["/search", "/browse", "/explore", "/category"], type: "discovery" },
]

export function classifyPageType(page: FirecrawlPageResult): string {
  try {
    const pathname = new URL(page.url).pathname.toLowerCase()

    for (const rule of PAGE_TYPE_RULES) {
      if (rule.keywords.some((kw) => pathname.includes(kw))) {
        return rule.type
      }
    }
  } catch {
    // Invalid URL — fall through
  }

  // Fallback: check for forms in HTML
  if (page.html && /<form[\s>]/i.test(page.html)) {
    return "form"
  }

  return "other"
}

export function extractForms(page: FirecrawlPageResult): FormInventoryEntry[] {
  if (!page.html) return []

  const dom = new JSDOM(page.html)
  const document = dom.window.document
  const formElements = document.querySelectorAll("form")
  const results: FormInventoryEntry[] = []

  for (const form of formElements) {
    const action = form.getAttribute("action") || undefined
    const method = form.getAttribute("method")?.toLowerCase() || undefined

    const fields: FormField[] = []
    const fieldElements = form.querySelectorAll("input, select, textarea")

    for (const el of fieldElements) {
      const name = el.getAttribute("name")
      if (!name) continue

      const tagName = el.tagName.toLowerCase()
      let type: string
      if (tagName === "select") {
        type = "select"
      } else if (tagName === "textarea") {
        type = "textarea"
      } else {
        type = el.getAttribute("type") || "text"
      }

      // Resolve label
      const id = el.getAttribute("id")
      let label: string | undefined
      if (id) {
        const labelEl = document.querySelector(`label[for="${id}"]`)
        if (labelEl?.textContent) {
          label = labelEl.textContent.trim()
        }
      }
      if (!label) {
        label = el.getAttribute("aria-label") || undefined
      }
      if (!label) {
        label = el.getAttribute("placeholder") || undefined
      }

      const required = el.hasAttribute("required")
      const placeholder = el.getAttribute("placeholder") || undefined

      let options: string[] | undefined
      if (tagName === "select") {
        const optionEls = el.querySelectorAll("option")
        const values = Array.from(optionEls)
          .map((opt) => opt.textContent?.trim() ?? "")
          .filter((v) => v.length > 0)
        if (values.length > 0) options = values
      }

      fields.push({ name, type, label, required, placeholder, options })
    }

    if (fields.length > 0) {
      results.push({ action, method, fields })
    }
  }

  return results
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "and", "but", "or", "nor", "not", "so", "yet",
  "both", "either", "neither", "each", "every", "all", "any", "few",
  "more", "most", "other", "some", "such", "no", "only", "own", "same",
  "than", "too", "very", "just", "because", "if", "when", "where",
  "how", "what", "which", "who", "whom", "this", "that", "these",
  "those", "i", "me", "my", "we", "our", "you", "your", "it", "its",
  "they", "them", "their", "test", "check", "verify", "ensure", "page",
])

type CrawledPageForSearch = {
  url: string
  title?: string
  description?: string
}

export function findBestStartUrl({
  crawledPages,
  taskInstructions,
}: {
  crawledPages: CrawledPageForSearch[]
  taskInstructions: string
}): string | null {
  const keywords = taskInstructions
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))

  if (keywords.length === 0 || crawledPages.length === 0) {
    return null
  }

  let bestUrl: string | null = null
  let bestScore = 0

  for (const page of crawledPages) {
    let score = 0
    const urlLower = page.url.toLowerCase()
    const titleLower = (page.title ?? "").toLowerCase()
    const descLower = (page.description ?? "").toLowerCase()

    for (const kw of keywords) {
      if (urlLower.includes(kw)) score += 10
      if (titleLower.includes(kw)) score += 5
      if (descLower.includes(kw)) score += 3
    }

    if (score > bestScore) {
      bestScore = score
      bestUrl = page.url
    }
  }

  return bestScore > 0 ? bestUrl : null
}
