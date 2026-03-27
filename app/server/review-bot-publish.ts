import type { ReviewAiSummary, ReviewInlineComment } from "~/server/review-bot-review"

function stripRawFormatting(text: string | null | undefined, maxLength = 220) {
  if (!text) {
    return null
  }

  const normalized = text
    .replace(/```(?:json)?/gi, " ")
    .replace(/[{}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!normalized) {
    return null
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength).trimEnd()}...`
}

function sanitizeBulletList(items: Array<string>, limit: number, maxLength = 180) {
  return items
    .map((item) => stripRawFormatting(item, maxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit)
}

function shortSha(sha: string) {
  return sha.slice(0, 10)
}

export function buildSummaryComment(input: {
  headSha: string
  summary: ReviewAiSummary
}) {
  const summaryParagraph =
    stripRawFormatting(input.summary.summaryParagraph, 420) ??
    "Shard reviewed this pull request and generated a concise summary."
  const summaryBullets = sanitizeBulletList(input.summary.summaryBullets, 5, 180)
  const confidenceScore = input.summary.confidenceScore ?? 3
  const confidenceSummary = sanitizeBulletList(input.summary.confidenceSummary, 3, 180)
  const attentionNotes = sanitizeBulletList(input.summary.attentionNotes, 3, 160)

  const lines = ["## Shard Summary", "", summaryParagraph]

  if (summaryBullets.length > 0) {
    lines.push("", ...summaryBullets.map((bullet) => `- ${bullet}`))
  }

  lines.push("", `## Confidence Score: ${confidenceScore}/5`, "")

  if (confidenceSummary.length > 0) {
    lines.push(...confidenceSummary.map((bullet) => `- ${bullet}`))
  } else {
    lines.push("- Shard found the reviewed changes understandable, but this score should still be validated against the full PR context.")
  }

  if (attentionNotes.length > 0) {
    lines.push("", "### Files needing attention", "", ...attentionNotes.map((note) => `- ${note}`))
  }

  lines.push("", `Last reviewed commit: \`${shortSha(input.headSha)}\``)

  return lines.join("\n")
}

export function buildWalkthroughComment(input: { headSha: string }) {
  return [
    "## 💡 Shard Review",
    "",
    "Here are some automated review suggestions for this pull request.",
    "",
    `Reviewed commit: \`${shortSha(input.headSha)}\``,
    "",
    "<details>",
    "<summary>ℹ️ About Shard in GitHub</summary>",
    "",
    "Shard can automatically review pull requests in this repository.",
    "",
    "Reviews are triggered when you:",
    "",
    "- Open a pull request for review",
    "- Mark a draft as ready",
    '- Comment `@shard review`',
    "",
    "If Shard has suggestions, it will comment inline on the relevant files.",
    "</details>",
  ].join("\n")
}

export function buildInlineReviewCommentBody(input: {
  comment: ReviewInlineComment
}) {
  const title = stripRawFormatting(input.comment.title, 120) ?? "Review suggestion"
  const body =
    stripRawFormatting(input.comment.body, 500) ??
    "This change likely needs follow-up before merge."
  const fixHint = stripRawFormatting(input.comment.fixHint, 180)

  const lines = [`${input.comment.priority} ${title}`, "", body]

  if (fixHint) {
    lines.push("", `Suggested fix: ${fixHint}`)
  }

  lines.push("", "Useful? React with 👍 / 👎.")

  return lines.join("\n")
}
