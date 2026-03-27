import {
  computeFindingScore,
  impactWeightForSource,
  type FindingSeverity,
} from "./scoring.ts"

type LighthouseCategoryId =
  | "performance"
  | "accessibility"
  | "best-practices"
  | "seo"

type LighthouseFinding = {
  confidence: number
  description: string
  impact: number
  severity: FindingSeverity
  suggestedFix: string
  title: string
}

export function severityFromCategoryScore(score: number): FindingSeverity | null {
  if (score >= 0.9) {
    return null
  }

  if (score < 0.4) {
    return "critical"
  }

  if (score < 0.6) {
    return "high"
  }

  if (score < 0.75) {
    return "medium"
  }

  return "low"
}

export function buildLighthouseFinding({
  category,
  pageUrl,
  score,
  isStartPage: _isStartPage,
}: {
  category: LighthouseCategoryId
  isStartPage: boolean
  pageUrl: string
  score: number
}): LighthouseFinding | null {
  const severity = severityFromCategoryScore(score)

  if (!severity) {
    return null
  }

  const percentage = Math.round(score * 100)
  const titleCategory = category === "best-practices" ? "best practices" : category

  return {
    title: `${capitalize(titleCategory)} score is ${percentage}/100`,
    description: `${capitalize(titleCategory)} on ${pageUrl} is below the acceptable threshold.`,
    severity,
    confidence: 0.95,
    impact: impactWeightForSource("perf"),
    suggestedFix: `Review the Lighthouse ${titleCategory} report for ${pageUrl} and address the highest-impact audits first.`,
  }
}

export function scoreLighthouseFinding(input: {
  category: LighthouseCategoryId
  isStartPage: boolean
  pageUrl: string
  score: number
}) {
  const finding = buildLighthouseFinding(input)

  if (!finding) {
    return null
  }

  return {
    ...finding,
    score: computeFindingScore({
      severity: finding.severity,
      confidence: finding.confidence,
      source: "perf",
    }),
  }
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
