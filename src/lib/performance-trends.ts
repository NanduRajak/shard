type AuditScores = {
  accessibilityScore: number
  bestPracticesScore: number
  pageUrl: string
  performanceScore: number
  seoScore: number
}

type TrendMetric = {
  current: number | null
  delta: number | null
  previous: number | null
}

export type AuditTrend = {
  accessibility: TrendMetric
  bestPractices: TrendMetric
  performance: TrendMetric
  seo: TrendMetric
}

export function buildAuditTrend({
  currentAudits,
  previousAudits,
  runUrl,
}: {
  currentAudits: AuditScores[]
  previousAudits: AuditScores[]
  runUrl: string
}): AuditTrend {
  const current = selectReferenceAudit(currentAudits, runUrl)
  const previous = selectReferenceAudit(previousAudits, runUrl)

  return {
    performance: createMetric(current?.performanceScore ?? null, previous?.performanceScore ?? null),
    accessibility: createMetric(
      current?.accessibilityScore ?? null,
      previous?.accessibilityScore ?? null,
    ),
    bestPractices: createMetric(
      current?.bestPracticesScore ?? null,
      previous?.bestPracticesScore ?? null,
    ),
    seo: createMetric(current?.seoScore ?? null, previous?.seoScore ?? null),
  }
}

function selectReferenceAudit(audits: AuditScores[], runUrl: string) {
  if (audits.length === 0) {
    return null
  }

  const startPageAudit = audits.find((audit) => audit.pageUrl === runUrl)

  if (startPageAudit) {
    return startPageAudit
  }

  return {
    pageUrl: runUrl,
    performanceScore: roundScore(average(audits.map((audit) => audit.performanceScore))),
    accessibilityScore: roundScore(average(audits.map((audit) => audit.accessibilityScore))),
    bestPracticesScore: roundScore(average(audits.map((audit) => audit.bestPracticesScore))),
    seoScore: roundScore(average(audits.map((audit) => audit.seoScore))),
  }
}

function createMetric(current: number | null, previous: number | null): TrendMetric {
  if (current === null) {
    return { current: null, previous, delta: null }
  }

  if (previous === null) {
    return { current: roundScore(current), previous: null, delta: null }
  }

  return {
    current: roundScore(current),
    previous: roundScore(previous),
    delta: Math.round((current - previous) * 100),
  }
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function roundScore(value: number) {
  return Math.round(value * 10000) / 10000
}
