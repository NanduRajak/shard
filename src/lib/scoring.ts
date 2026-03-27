export const severityWeights = {
  low: 15,
  medium: 35,
  high: 65,
  critical: 90,
} as const

export const sourceImpactWeights = {
  browser: 1.1,
  perf: 1,
  hygiene: 0.9,
  test: 0.8,
} as const

export type FindingSeverity = keyof typeof severityWeights
export type FindingSource = keyof typeof sourceImpactWeights

export type ScoredFinding = {
  score: number
  source: FindingSource
}

type ScoreSummary = {
  overall: number
  bySource: Partial<Record<FindingSource, number>>
  counts: {
    findings: number
    performanceAudits: number
    screenshots: number
  }
}

export function impactWeightForSource(source: FindingSource) {
  return sourceImpactWeights[source]
}

export function clampConfidence(confidence: number) {
  return Math.min(1, Math.max(0, confidence))
}

export function computeFindingScore({
  confidence,
  severity,
  source,
}: {
  confidence: number
  severity: FindingSeverity
  source: FindingSource
}) {
  return Math.round(
    severityWeights[severity] *
      clampConfidence(confidence) *
      impactWeightForSource(source) *
      100,
  ) / 100
}

export function computeQualityScore(penalty: number) {
  return Math.max(0, Math.min(100, Math.round((100 - penalty) * 100) / 100))
}

export function buildScoreSummary({
  findings,
  performanceAudits,
  screenshots,
}: {
  findings: ScoredFinding[]
  performanceAudits: number
  screenshots: number
}): ScoreSummary {
  const penaltyBySource = findings.reduce<Partial<Record<FindingSource, number>>>(
    (accumulator, finding) => {
      accumulator[finding.source] = (accumulator[finding.source] ?? 0) + finding.score
      return accumulator
    },
    {},
  )

  const bySource = Object.fromEntries(
    Object.entries(penaltyBySource).map(([source, penalty]) => [
      source,
      computeQualityScore(Math.min(penalty, 100)),
    ]),
  ) as Partial<Record<FindingSource, number>>

  const totalPenalty = findings.reduce((sum, finding) => sum + finding.score, 0)

  return {
    overall: computeQualityScore(Math.min(totalPenalty, 100)),
    bySource,
    counts: {
      findings: findings.length,
      performanceAudits,
      screenshots,
    },
  }
}
