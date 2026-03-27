import { z } from "zod"
import { getRepositoryFileContent, type GitHubPullRequestFile } from "~/server/github"

const reviewBotConfigSchema = z.object({
  reviews: z
    .object({
      auto_review: z
        .object({
          auto_incremental_review: z.boolean().optional(),
          auto_pause_after_reviewed_commits: z.number().int().min(0).optional(),
          base_branches: z.array(z.string()).optional(),
          drafts: z.boolean().optional(),
          enabled: z.boolean().optional(),
          ignore_title_keywords: z.array(z.string()).optional(),
          ignore_usernames: z.array(z.string()).optional(),
        })
        .optional(),
      path_filters: z.array(z.string()).optional(),
      path_instructions: z
        .array(
          z.object({
            instructions: z.string(),
            path: z.string(),
          })
        )
        .optional(),
      summary: z
        .object({
          in_pr_body: z.boolean().optional(),
        })
        .optional(),
      walkthrough: z
        .object({
          enabled: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
})

export type ReviewBotConfig = {
  reviews: {
    autoReview: {
      autoIncrementalReview: boolean
      autoPauseAfterReviewedCommits: number
      baseBranches: Array<string>
      drafts: boolean
      enabled: boolean
      ignoreTitleKeywords: Array<string>
      ignoreUsernames: Array<string>
    }
    pathFilters: Array<string>
    pathInstructions: Array<{
      instructions: string
      path: string
    }>
    summary: {
      inPrBody: boolean
    }
    walkthrough: {
      enabled: boolean
    }
  }
}

export type ReviewConfigLoadResult = {
  config: ReviewBotConfig
  error: string | null
  source: "default" | "invalid" | "repository"
}

export const DEFAULT_REVIEW_PATH_FILTERS = [
  "!**/dist/**",
  "!**/node_modules/**",
  "!**/.next/**",
  "!**/.nuxt/**",
  "!**/.cache/**",
  "!**/generated/**",
  "!**/@generated/**",
  "!**/__generated__/**",
  "!**/__generated/**",
  "!**/_generated/**",
  "!**/gen/**",
  "!**/@gen/**",
  "!**/__gen__/**",
  "!**/__gen/**",
  "!**/_gen/**",
  "!**/package-lock.json",
  "!**/yarn.lock",
  "!**/pnpm-lock.yaml",
  "!**/bun.lockb",
  "!**/*.lock",
  "!**/*.svg",
  "!**/*.png",
  "!**/*.jpg",
  "!**/*.jpeg",
  "!**/*.gif",
  "!**/*.ico",
  "!**/*.webp",
  "!**/*.mp4",
  "!**/*.mp3",
  "!**/*.pdf",
  "!**/*.zip",
  "!**/*.map",
] as const

export const defaultReviewBotConfig: ReviewBotConfig = {
  reviews: {
    autoReview: {
      autoIncrementalReview: true,
      autoPauseAfterReviewedCommits: 5,
      baseBranches: [],
      drafts: false,
      enabled: true,
      ignoreTitleKeywords: [],
      ignoreUsernames: ["dependabot[bot]", "renovate[bot]", "github-actions[bot]"],
    },
    pathFilters: [],
    pathInstructions: [],
    summary: {
      inPrBody: true,
    },
    walkthrough: {
      enabled: true,
    },
  },
}

type ParsedLine = {
  content: string
  indent: number
  raw: string
}

function normalizeLine(line: string) {
  return line.replace(/\t/g, "  ")
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim()

  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null") return null
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim()

    if (!inner) {
      return []
    }

    return inner
      .split(",")
      .map((part) => parseScalar(part))
      .filter((part) => part !== undefined)
  }

  return trimmed
}

function preprocessYaml(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw) => normalizeLine(raw))
    .map((raw) => ({
      content: raw.trimEnd(),
      indent: raw.match(/^ */)?.[0].length ?? 0,
      raw,
    }))
    .filter((line) => {
      const trimmed = line.content.trim()
      return trimmed.length > 0 && !trimmed.startsWith("#")
    })
}

function parseBlockScalar(
  lines: Array<ParsedLine>,
  startIndex: number,
  parentIndent: number
) {
  const blockLines: Array<string> = []
  let index = startIndex
  let minIndent: number | null = null

  while (index < lines.length) {
    const line = lines[index]

    if (line.indent <= parentIndent) {
      break
    }

    minIndent = minIndent === null ? line.indent : Math.min(minIndent, line.indent)
    blockLines.push(line.raw)
    index += 1
  }

  const normalizedIndent = minIndent ?? parentIndent + 2
  const value = blockLines
    .map((line) => line.slice(normalizedIndent))
    .join("\n")
    .replace(/\n+$/, "")

  return {
    nextIndex: index,
    value,
  }
}

function parseNode(
  lines: Array<ParsedLine>,
  startIndex: number,
  indent: number
): { nextIndex: number; value: unknown } {
  const current = lines[startIndex]

  if (!current) {
    return {
      nextIndex: startIndex,
      value: {},
    }
  }

  if (current.indent < indent) {
    return {
      nextIndex: startIndex,
      value: {},
    }
  }

  if (current.content.trimStart().startsWith("- ")) {
    return parseSequence(lines, startIndex, indent)
  }

  return parseMapping(lines, startIndex, indent)
}

function parseSequence(
  lines: Array<ParsedLine>,
  startIndex: number,
  indent: number
): { nextIndex: number; value: Array<unknown> } {
  const items: Array<unknown> = []
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index]

    if (line.indent !== indent || !line.content.trimStart().startsWith("- ")) {
      break
    }

    const afterDash = line.content.trimStart().slice(2).trim()

    if (!afterDash) {
      const nextLine = lines[index + 1]

      if (!nextLine || nextLine.indent <= indent) {
        items.push(null)
        index += 1
        continue
      }

      const child = parseNode(lines, index + 1, nextLine.indent)
      items.push(child.value)
      index = child.nextIndex
      continue
    }

    const inlinePair = afterDash.match(/^([^:]+):(.*)$/)

    if (inlinePair) {
      const item: Record<string, unknown> = {}
      const key = inlinePair[1]!.trim()
      const rawValue = inlinePair[2]!.trim()

      if (rawValue === "|") {
        const block = parseBlockScalar(lines, index + 1, indent)
        item[key] = block.value
        index = block.nextIndex
      } else if (rawValue.length > 0) {
        item[key] = parseScalar(rawValue)
        index += 1
      } else {
        const nextLine = lines[index + 1]

        if (nextLine && nextLine.indent > indent) {
          const child = parseNode(lines, index + 1, nextLine.indent)
          item[key] = child.value
          index = child.nextIndex
        } else {
          item[key] = {}
          index += 1
        }
      }

      while (index < lines.length) {
        const nextLine = lines[index]

        if (nextLine.indent <= indent) {
          break
        }

        const child = parseMapping(lines, index, indent + 2, item)
        index = child.nextIndex
      }

      items.push(item)
      continue
    }

    items.push(parseScalar(afterDash))
    index += 1
  }

  return {
    nextIndex: index,
    value: items,
  }
}

function parseMapping(
  lines: Array<ParsedLine>,
  startIndex: number,
  indent: number,
  seed: Record<string, unknown> = {}
): { nextIndex: number; value: Record<string, unknown> } {
  const value = seed
  let index = startIndex

  while (index < lines.length) {
    const line = lines[index]

    if (line.indent < indent) {
      break
    }

    if (line.indent > indent) {
      break
    }

    if (line.content.trimStart().startsWith("- ")) {
      break
    }

    const pair = line.content.trim().match(/^([^:]+):(.*)$/)

    if (!pair) {
      throw new Error(`Invalid YAML line: ${line.content.trim()}`)
    }

    const key = pair[1]!.trim()
    const rawValue = pair[2]!.trim()

    if (rawValue === "|") {
      const block = parseBlockScalar(lines, index + 1, indent)
      value[key] = block.value
      index = block.nextIndex
      continue
    }

    if (rawValue.length > 0) {
      value[key] = parseScalar(rawValue)
      index += 1
      continue
    }

    const nextLine = lines[index + 1]

    if (nextLine && nextLine.indent > indent) {
      const child = parseNode(lines, index + 1, nextLine.indent)
      value[key] = child.value
      index = child.nextIndex
      continue
    }

    value[key] = {}
    index += 1
  }

  return {
    nextIndex: index,
    value,
  }
}

export function parseReviewBotConfigText(text: string): ReviewBotConfig {
  const lines = preprocessYaml(text)

  if (lines.length === 0) {
    return defaultReviewBotConfig
  }

  const parsed = parseNode(lines, 0, lines[0]!.indent).value
  const normalized = reviewBotConfigSchema.parse(parsed)

  return {
    reviews: {
      autoReview: {
        autoIncrementalReview:
          normalized.reviews?.auto_review?.auto_incremental_review ??
          defaultReviewBotConfig.reviews.autoReview.autoIncrementalReview,
        autoPauseAfterReviewedCommits:
          normalized.reviews?.auto_review?.auto_pause_after_reviewed_commits ??
          defaultReviewBotConfig.reviews.autoReview.autoPauseAfterReviewedCommits,
        baseBranches:
          normalized.reviews?.auto_review?.base_branches ??
          defaultReviewBotConfig.reviews.autoReview.baseBranches,
        drafts:
          normalized.reviews?.auto_review?.drafts ??
          defaultReviewBotConfig.reviews.autoReview.drafts,
        enabled:
          normalized.reviews?.auto_review?.enabled ??
          defaultReviewBotConfig.reviews.autoReview.enabled,
        ignoreTitleKeywords:
          normalized.reviews?.auto_review?.ignore_title_keywords ??
          defaultReviewBotConfig.reviews.autoReview.ignoreTitleKeywords,
        ignoreUsernames:
          normalized.reviews?.auto_review?.ignore_usernames ??
          defaultReviewBotConfig.reviews.autoReview.ignoreUsernames,
      },
      pathFilters:
        normalized.reviews?.path_filters ?? defaultReviewBotConfig.reviews.pathFilters,
      pathInstructions:
        normalized.reviews?.path_instructions ??
        defaultReviewBotConfig.reviews.pathInstructions,
      summary: {
        inPrBody:
          normalized.reviews?.summary?.in_pr_body ??
          defaultReviewBotConfig.reviews.summary.inPrBody,
      },
      walkthrough: {
        enabled:
          normalized.reviews?.walkthrough?.enabled ??
          defaultReviewBotConfig.reviews.walkthrough.enabled,
      },
    },
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function globToRegExp(pattern: string) {
  const segments = pattern.split("**")
  const escaped = segments.map((segment) => {
    return escapeRegExp(segment).replace(/\\\*/g, "[^/]*")
  })

  return new RegExp(`^${escaped.join(".*")}$`)
}

export function pathMatchesPattern(path: string, pattern: string) {
  const normalizedPath = path.replace(/\\/g, "/")
  const normalizedPattern = pattern.replace(/\\/g, "/")

  return globToRegExp(normalizedPattern).test(normalizedPath)
}

export function isReviewPathIncluded(path: string, customFilters: Array<string>) {
  let included = !DEFAULT_REVIEW_PATH_FILTERS.some((pattern) =>
    pathMatchesPattern(path, pattern.slice(1))
  )

  for (const pattern of customFilters) {
    const trimmedPattern = pattern.trim()

    if (!trimmedPattern) {
      continue
    }

    if (trimmedPattern.startsWith("!")) {
      if (pathMatchesPattern(path, trimmedPattern.slice(1))) {
        included = false
      }

      continue
    }

    if (pathMatchesPattern(path, trimmedPattern)) {
      included = true
    }
  }

  return included
}

export function applyReviewPathFilters(
  files: Array<GitHubPullRequestFile>,
  config: ReviewBotConfig
) {
  const includedFiles: Array<GitHubPullRequestFile> = []
  const skippedFiles: Array<GitHubPullRequestFile> = []

  for (const file of files) {
    if (isReviewPathIncluded(file.filename, config.reviews.pathFilters)) {
      includedFiles.push(file)
    } else {
      skippedFiles.push(file)
    }
  }

  return {
    includedFiles,
    skippedFiles,
  }
}

export function getMatchedPathInstructions(
  files: Array<GitHubPullRequestFile>,
  config: ReviewBotConfig
) {
  return config.reviews.pathInstructions
    .map((instruction) => ({
      instructions: instruction.instructions,
      matchedFiles: files
        .filter((file) => pathMatchesPattern(file.filename, instruction.path))
        .map((file) => file.filename),
      path: instruction.path,
    }))
    .filter((instruction) => instruction.matchedFiles.length > 0)
}

export function shouldAutoReviewPullRequest(input: {
  authorLogin: string | null
  baseBranch: string
  config: ReviewBotConfig
  defaultBranch: string
  isDraft: boolean
  title: string
}) {
  const { autoReview } = input.config.reviews

  if (!autoReview.enabled) {
    return {
      allowed: false,
      reason: "Automatic reviews are disabled by repo config.",
    } as const
  }

  if (
    !autoReview.drafts &&
    input.isDraft
  ) {
    return {
      allowed: false,
      reason: "Draft pull requests are skipped by repo config.",
    } as const
  }

  if (
    input.authorLogin &&
    autoReview.ignoreUsernames.includes(input.authorLogin)
  ) {
    return {
      allowed: false,
      reason: `Pull requests from ${input.authorLogin} are skipped by repo config.`,
    } as const
  }

  const ignoreKeyword = autoReview.ignoreTitleKeywords.find((keyword) =>
    keyword.trim().length > 0 &&
    input.title.toLowerCase().includes(keyword.toLowerCase())
  )

  if (ignoreKeyword) {
    return {
      allowed: false,
      reason: `PR title matched ignored keyword "${ignoreKeyword}".`,
    } as const
  }

  const branchPatterns =
    autoReview.baseBranches.length > 0
      ? autoReview.baseBranches
      : [input.defaultBranch]

  const matchesBaseBranch = branchPatterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(input.baseBranch)
    } catch {
      return pattern === input.baseBranch
    }
  })

  if (!matchesBaseBranch) {
    return {
      allowed: false,
      reason: `Base branch ${input.baseBranch} is outside configured review scope.`,
    } as const
  }

  return {
    allowed: true,
    reason: null,
  } as const
}

export async function loadReviewBotConfig(input: {
  installationId: number
  owner: string
  ref: string
  repo: string
}): Promise<ReviewConfigLoadResult> {
  try {
    const content = await getRepositoryFileContent({
      installationId: input.installationId,
      owner: input.owner,
      path: ".shard-review.yml",
      ref: input.ref,
      repo: input.repo,
    })

    if (!content.trim()) {
      return {
        config: defaultReviewBotConfig,
        error: null,
        source: "default",
      }
    }

    return {
      config: parseReviewBotConfigText(content),
      error: null,
      source: "repository",
    }
  } catch (error) {
    if (error instanceof Error && /404|Not Found/i.test(error.message)) {
      return {
        config: defaultReviewBotConfig,
        error: null,
        source: "default",
      }
    }

    return {
      config: defaultReviewBotConfig,
      error:
        error instanceof Error
          ? error.message
          : "Review config could not be loaded. Falling back to defaults.",
      source: "invalid",
    }
  }
}
