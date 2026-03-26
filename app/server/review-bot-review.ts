import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import type { GitHubPullRequestFile } from "~/server/github"
import { getInstallationAccessToken } from "~/server/github"
import { serverEnv } from "~/server-env"

export type ReviewCheckerName = "lint" | "semgrep" | "tests" | "typecheck"
export type ReviewCheckerStatus =
  | "failed"
  | "passed"
  | "queued"
  | "running"
  | "skipped"
export type ReviewFindingCategory =
  | "Maintainability"
  | "Performance smell"
  | "Security"
  | "Test hygiene"

export type ReviewFindingInput = {
  category?: ReviewFindingCategory
  checker?: string
  confidence: number
  description: string
  filePath?: string
  line?: number
  severity: "critical" | "high" | "low" | "medium"
  source: "browser" | "hygiene" | "perf" | "test"
  suggestedFix?: string
  title: string
}

export type ReviewCheckerResult = {
  category?: ReviewFindingCategory
  checker: ReviewCheckerName
  details?: string
  findings: Array<ReviewFindingInput>
  status: ReviewCheckerStatus
}

export type ReviewFileSummary = {
  path: string
  summary: string
}

export type ReviewNearbyCode = {
  excerpt: string
  filePath: string
  lineEnd: number
  lineStart: number
}

type CapturedFile = {
  content: string
  file: GitHubPullRequestFile
}

type CommandResult = {
  combinedOutput: string
  exitCode: number
  stderr: string
  stdout: string
}

type RepositoryRuntime = {
  packageManager: "npm" | "pnpm" | "yarn"
  packageScripts: Record<string, string>
  repoDir: string
}

export function createQueuedCheckerResults() {
  return [
    { checker: "semgrep", status: "queued" },
    { checker: "lint", status: "queued" },
    { checker: "typecheck", status: "queued" },
    { checker: "tests", status: "queued" },
  ] as const satisfies Array<{
    checker: ReviewCheckerName
    status: ReviewCheckerStatus
  }>
}

function limitText(text: string, maxLength = 2000) {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}\n...truncated`
}

function isTextCodeFile(path: string) {
  return /\.(cjs|css|cts|html|js|json|jsx|mjs|mts|md|scss|ts|tsx|txt|vue|ya?ml)$/i.test(
    path
  )
}

function detectFileKind(path: string) {
  if (path.includes("/routes/")) return "route module"
  if (path.includes("/components/")) return "UI component"
  if (path.includes("/hooks/")) return "hook"
  if (path.startsWith("convex/")) return "Convex backend module"
  if (path.startsWith("server/") || path.startsWith("app/server/")) {
    return "server module"
  }
  if (path.startsWith("src/lib/")) return "shared library module"
  if (path.endsWith(".css") || path.endsWith(".scss")) return "style sheet"
  if (path.endsWith(".json")) return "configuration file"

  return "source file"
}

function extractTopLevelSymbols(content: string) {
  const matches = [
    ...content.matchAll(
      /export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g
    ),
  ]

  return [...new Set(matches.map((match) => match[1]))].slice(0, 3)
}

function buildFileSummaryFromContent(path: string, content: string) {
  const fileKind = detectFileKind(path)
  const symbols = extractTopLevelSymbols(content)

  if (content.includes("createFileRoute(")) {
    return `${basename(path)} is a route module that renders part of the app UI.`
  }

  if (symbols.length > 0) {
    return `${basename(path)} is a ${fileKind} centered on ${symbols.join(", ")}.`
  }

  return `${basename(path)} is a ${fileKind} used in the ${path}.`
}

function parseChangedLineRanges(patch: string) {
  const ranges: Array<{ end: number; start: number }> = []
  const hunkPattern = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g

  for (const match of patch.matchAll(hunkPattern)) {
    const start = Number(match[1])
    const length = Number(match[2] ?? "1")

    ranges.push({
      end: start + Math.max(length - 1, 0),
      start,
    })
  }

  return ranges
}

function buildNearbyCodeFromFile(filePath: string, content: string, patch?: string) {
  if (!patch || !content.trim()) {
    return []
  }

  const lines = content.split("\n")
  const snippets = parseChangedLineRanges(patch).slice(0, 3)

  return snippets.map((snippet) => {
    const start = Math.max(snippet.start - 6, 1)
    const end = Math.min(snippet.end + 6, lines.length)
    const excerpt = lines
      .slice(start - 1, end)
      .map((line, index) => `${start + index}: ${line}`)
      .join("\n")

    return {
      excerpt,
      filePath,
      lineEnd: end,
      lineStart: start,
    }
  })
}

function buildCommandOutputExcerpt(output: string) {
  return limitText(output.trim() || "Command produced no output.", 1600)
}

function parseTypeScriptFindings(output: string) {
  const findings: Array<ReviewFindingInput> = []
  const pattern = /^(.+?)\((\d+),(\d+)\): error TS\d+: (.+)$/gm

  for (const match of output.matchAll(pattern)) {
    findings.push({
      category: "Maintainability",
      checker: "typecheck",
      confidence: 0.93,
      description: match[4],
      filePath: match[1],
      line: Number(match[2]),
      severity: "medium",
      source: "hygiene",
      title: "TypeScript error",
    })
  }

  return findings.slice(0, 25)
}

function parseEslintLikeFindings(output: string) {
  const findings: Array<ReviewFindingInput> = []
  const pattern = /^(.+?):(\d+):(\d+):\s(.+)$/gm

  for (const match of output.matchAll(pattern)) {
    findings.push({
      category: "Maintainability",
      checker: "lint",
      confidence: 0.8,
      description: match[4],
      filePath: match[1],
      line: Number(match[2]),
      severity: "medium",
      source: "hygiene",
      title: "Lint issue",
    })
  }

  return findings.slice(0, 25)
}

function buildFallbackFinding(input: {
  category: ReviewFindingCategory
  checker: ReviewCheckerName
  output: string
  severity: "critical" | "high" | "low" | "medium"
  source: "hygiene" | "test"
  title: string
}) {
  return {
    category: input.category,
    checker: input.checker,
    confidence: 0.72,
    description: buildCommandOutputExcerpt(input.output),
    severity: input.severity,
    source: input.source,
    title: input.title,
  } satisfies ReviewFindingInput
}

async function runCommand(
  command: string,
  args: Array<string>,
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
  } = {}
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
    }, options.timeoutMs ?? 180_000)

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timeout)
      resolve({
        combinedOutput: `${stdout}\n${stderr}`.trim(),
        exitCode: code ?? 1,
        stderr,
        stdout,
      })
    })
  })
}

async function commandExists(command: string) {
  const result = await runCommand("sh", ["-lc", `command -v ${command}`], {
    timeoutMs: 10_000,
  })

  return result.exitCode === 0
}

async function prepareRepositoryRuntime(repoDir: string): Promise<RepositoryRuntime | null> {
  const packageJsonPath = join(repoDir, "package.json")

  if (!existsSync(packageJsonPath)) {
    return null
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>
  }

  const packageManager = existsSync(join(repoDir, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(repoDir, "yarn.lock"))
      ? "yarn"
      : "npm"

  return {
    packageManager,
    packageScripts: packageJson.scripts ?? {},
    repoDir,
  }
}

async function installDependencies(runtime: RepositoryRuntime) {
  const installArgs =
    runtime.packageManager === "pnpm"
      ? ["install", "--frozen-lockfile"]
      : runtime.packageManager === "yarn"
        ? ["install", "--immutable"]
        : ["ci"]

  return await runCommand(runtime.packageManager, installArgs, {
    cwd: runtime.repoDir,
    env: {
      CI: "1",
    },
    timeoutMs: 300_000,
  })
}

async function clonePullRequestHead(input: {
  fullName: string
  headSha: string
  installationId: number
}) {
  const tempRoot = await mkdtemp(join(tmpdir(), "shard-review-bot-"))
  const repoDir = join(tempRoot, "repo")
  const auth = await getInstallationAccessToken(input.installationId)
  const authHeader = `AUTHORIZATION: basic ${Buffer.from(
    `x-access-token:${auth.token}`
  ).toString("base64")}`
  const repoUrl = `https://github.com/${input.fullName}.git`

  await runCommand(
    "git",
    ["-c", `http.extraheader=${authHeader}`, "clone", "--no-checkout", repoUrl, repoDir],
    {
      env: {
        GIT_TERMINAL_PROMPT: "0",
      },
      timeoutMs: 180_000,
    }
  )
  await runCommand(
    "git",
    [
      "-C",
      repoDir,
      "-c",
      `http.extraheader=${authHeader}`,
      "fetch",
      "--depth",
      "1",
      "origin",
      input.headSha,
    ],
    {
      env: {
        GIT_TERMINAL_PROMPT: "0",
      },
      timeoutMs: 180_000,
    }
  )
  await runCommand("git", ["-C", repoDir, "checkout", "--force", input.headSha], {
    timeoutMs: 60_000,
  })

  return {
    cleanup: async () => {
      await rm(tempRoot, { force: true, recursive: true })
    },
    repoDir,
  }
}

async function runSemgrep(repoDir: string): Promise<ReviewCheckerResult> {
  const hasSemgrep = await commandExists("semgrep")
  const configCandidates = [
    ".semgrep.yml",
    ".semgrep.yaml",
    "semgrep.yml",
    "semgrep.yaml",
  ]
  const configPath = configCandidates.find((path) => existsSync(join(repoDir, path)))

  if (!hasSemgrep) {
    return {
      checker: "semgrep",
      details: "Semgrep is not installed in this environment.",
      findings: [],
      status: "skipped",
    }
  }

  if (!configPath) {
    return {
      checker: "semgrep",
      details: "No local Semgrep config file was found in the repository.",
      findings: [],
      status: "skipped",
    }
  }

  const result = await runCommand(
    "semgrep",
    ["--config", configPath, "--json", "--quiet", "."],
    {
      cwd: repoDir,
      timeoutMs: 180_000,
    }
  )

  if (result.exitCode === 0) {
    const payload = JSON.parse(result.stdout || "{}") as {
      results?: Array<{
        check_id?: string
        extra?: {
          message?: string
          metadata?: {
            category?: string
            cwe?: unknown
            severity?: string
          }
        }
        path?: string
        start?: {
          line?: number
        }
      }>
    }

    return {
      category: "Security",
      checker: "semgrep",
      findings:
        payload.results?.slice(0, 50).map((entry) => ({
          category: "Security",
          checker: "semgrep",
          confidence: 0.94,
          description: entry.extra?.message ?? "Semgrep flagged this code path.",
          filePath: entry.path,
          line: entry.start?.line,
          severity:
            entry.extra?.metadata?.severity === "ERROR"
              ? "high"
              : entry.extra?.metadata?.severity === "WARNING"
                ? "medium"
                : "low",
          source: "hygiene",
          title: entry.check_id ?? "Semgrep finding",
        })) ?? [],
      status: "passed",
    }
  }

  return {
    category: "Security",
    checker: "semgrep",
    details: buildCommandOutputExcerpt(result.combinedOutput),
    findings: [
      buildFallbackFinding({
        category: "Security",
        checker: "semgrep",
        output: result.combinedOutput,
        severity: "medium",
        source: "hygiene",
        title: "Semgrep failed to complete cleanly",
      }),
    ],
    status: "failed",
  }
}

async function runLint(runtime: RepositoryRuntime | null): Promise<ReviewCheckerResult> {
  if (!runtime) {
    return {
      checker: "lint",
      details: "No package.json was found, so lint scripts cannot be resolved.",
      findings: [],
      status: "skipped",
    }
  }

  const script =
    runtime.packageScripts["lint:ci"] !== undefined ? "lint:ci" : runtime.packageScripts.lint ? "lint" : null

  if (!script) {
    return {
      checker: "lint",
      details: "No lint or lint:ci script was found in package.json.",
      findings: [],
      status: "skipped",
    }
  }

  const result = await runCommand(runtime.packageManager, ["run", script], {
    cwd: runtime.repoDir,
    env: {
      CI: "1",
    },
    timeoutMs: 180_000,
  })

  if (result.exitCode === 0) {
    return {
      category: "Maintainability",
      checker: "lint",
      findings: [],
      status: "passed",
    }
  }

  const parsedFindings = parseEslintLikeFindings(result.combinedOutput)

  return {
    category: "Maintainability",
    checker: "lint",
    details: buildCommandOutputExcerpt(result.combinedOutput),
    findings:
      parsedFindings.length > 0
        ? parsedFindings
        : [
            buildFallbackFinding({
              category: "Maintainability",
              checker: "lint",
              output: result.combinedOutput,
              severity: "medium",
              source: "hygiene",
              title: "Lint script failed",
            }),
          ],
    status: "failed",
  }
}

async function runTypecheck(runtime: RepositoryRuntime | null): Promise<ReviewCheckerResult> {
  if (!runtime) {
    return {
      checker: "typecheck",
      details: "No package.json was found, so TypeScript checks cannot run.",
      findings: [],
      status: "skipped",
    }
  }

  const hasTypecheckScript = Boolean(runtime.packageScripts.typecheck)
  const hasTsconfig = existsSync(join(runtime.repoDir, "tsconfig.json"))

  if (!hasTypecheckScript && !hasTsconfig) {
    return {
      checker: "typecheck",
      details: "No typecheck script or tsconfig.json was found.",
      findings: [],
      status: "skipped",
    }
  }

  const args = hasTypecheckScript
    ? ["run", "typecheck"]
    : runtime.packageManager === "npm"
      ? ["exec", "tsc", "--", "--noEmit"]
      : ["exec", "tsc", "--noEmit"]

  const result = await runCommand(runtime.packageManager, args, {
    cwd: runtime.repoDir,
    env: {
      CI: "1",
    },
    timeoutMs: 180_000,
  })

  if (result.exitCode === 0) {
    return {
      category: "Maintainability",
      checker: "typecheck",
      findings: [],
      status: "passed",
    }
  }

  const parsedFindings = parseTypeScriptFindings(result.combinedOutput)

  return {
    category: "Maintainability",
    checker: "typecheck",
    details: buildCommandOutputExcerpt(result.combinedOutput),
    findings:
      parsedFindings.length > 0
        ? parsedFindings
        : [
            buildFallbackFinding({
              category: "Maintainability",
              checker: "typecheck",
              output: result.combinedOutput,
              severity: "high",
              source: "hygiene",
              title: "Typecheck failed",
            }),
          ],
    status: "failed",
  }
}

async function runTests(runtime: RepositoryRuntime | null): Promise<ReviewCheckerResult> {
  if (!runtime) {
    return {
      checker: "tests",
      details: "No package.json was found, so project tests cannot run.",
      findings: [],
      status: "skipped",
    }
  }

  if (!runtime.packageScripts.test) {
    return {
      checker: "tests",
      details: "No test script was found in package.json.",
      findings: [],
      status: "skipped",
    }
  }

  const result = await runCommand(runtime.packageManager, ["run", "test"], {
    cwd: runtime.repoDir,
    env: {
      CI: "1",
    },
    timeoutMs: 240_000,
  })

  if (result.exitCode === 0) {
    return {
      category: "Test hygiene",
      checker: "tests",
      findings: [],
      status: "passed",
    }
  }

  return {
    category: "Test hygiene",
    checker: "tests",
    details: buildCommandOutputExcerpt(result.combinedOutput),
    findings: [
      buildFallbackFinding({
        category: "Test hygiene",
        checker: "tests",
        output: result.combinedOutput,
        severity: "medium",
        source: "test",
        title: "Project tests failed",
      }),
    ],
    status: "failed",
  }
}

function buildReviewPrompt(input: {
  changedFiles: Array<string>
  diffSummary: string
  fileSummaries: Array<ReviewFileSummary>
  findings: Array<ReviewFindingInput>
  nearbyCode: Array<ReviewNearbyCode>
  repo: string
  title: string
}) {
  return [
    "You are reviewing a GitHub pull request for an internal Review Bot UI.",
    "Return strict JSON with this shape:",
    '{"summary":"string","riskSummary":"string","testSuggestions":"string","inlineComments":[{"filePath":"string","line":1,"body":"string"}]}',
    `Repository: ${input.repo}`,
    `PR title: ${input.title}`,
    `Changed files: ${input.changedFiles.join(", ")}`,
    `Diff summary: ${input.diffSummary}`,
    `File summaries: ${JSON.stringify(input.fileSummaries.slice(0, 12))}`,
    `Deterministic findings: ${JSON.stringify(input.findings.slice(0, 20))}`,
    `Nearby code: ${JSON.stringify(input.nearbyCode.slice(0, 12))}`,
    "Only emit inline comments when the concern is high-confidence and specific.",
  ].join("\n")
}

function extractJsonObject(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]+?)```/)
  if (fencedMatch) {
    return fencedMatch[1]
  }

  const objectStart = text.indexOf("{")
  const objectEnd = text.lastIndexOf("}")

  if (objectStart >= 0 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1)
  }

  return text
}

export async function summarizeReviewWithAI(input: {
  changedFiles: Array<string>
  diffSummary: string
  fileSummaries: Array<ReviewFileSummary>
  findings: Array<ReviewFindingInput>
  nearbyCode: Array<ReviewNearbyCode>
  repo: string
  title: string
}) {
  if (!serverEnv.OPENAI_API_KEY) {
    return {
      inlineComments: [],
      riskSummary: null,
      status: "skipped" as const,
      summary: null,
      testSuggestions: null,
    }
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serverEnv.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          content:
            "You write concise, accurate pull request summaries. Respond with strict JSON only.",
          role: "system",
        },
        {
          content: buildReviewPrompt(input),
          role: "user",
        },
      ],
      model: serverEnv.OPENAI_MODEL ?? "gpt-4.1-mini",
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI summary request failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }
  const content = payload.choices?.[0]?.message?.content

  if (!content) {
    throw new Error("OpenAI returned an empty completion.")
  }

  const parsed = JSON.parse(extractJsonObject(content)) as {
    inlineComments?: Array<{
      body?: string
      filePath?: string
      line?: number
    }>
    riskSummary?: string
    summary?: string
    testSuggestions?: string
  }

  return {
    inlineComments: (parsed.inlineComments ?? [])
      .filter((comment) => comment.body && comment.filePath)
      .slice(0, 5)
      .map((comment) => ({
        body: comment.body!.trim(),
        filePath: comment.filePath!.trim(),
        line: comment.line,
      })),
    riskSummary: parsed.riskSummary?.trim() ?? null,
    status: "completed" as const,
    summary: parsed.summary?.trim() ?? null,
    testSuggestions: parsed.testSuggestions?.trim() ?? null,
  }
}

export function buildDiffSummary(files: Array<GitHubPullRequestFile>) {
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0)
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0)
  const topFiles = files
    .slice()
    .sort((left, right) => right.changes - left.changes)
    .slice(0, 5)
    .map((file) => `${file.filename} (${file.changes} changed lines)`)

  return `Touches ${files.length} file(s) with ${totalAdditions} additions and ${totalDeletions} deletions. Most changed: ${topFiles.join(", ") || "n/a"}.`
}

export function buildFileSummaries(files: Array<CapturedFile>) {
  return files.slice(0, 20).map((file) => ({
    path: file.file.filename,
    summary: buildFileSummaryFromContent(file.file.filename, file.content),
  }))
}

export function buildNearbyCode(files: Array<CapturedFile>) {
  return files
    .filter((file) => file.file.patch)
    .flatMap((file) =>
      buildNearbyCodeFromFile(file.file.filename, file.content, file.file.patch)
    )
    .slice(0, 20)
}

export async function captureReviewFiles(input: {
  files: Array<GitHubPullRequestFile>
  getFileContent: (path: string) => Promise<string>
}) {
  const capturedFiles = await Promise.all(
    input.files
      .filter((file) => isTextCodeFile(file.filename) && file.status !== "removed")
      .slice(0, 20)
      .map(async (file) => {
        try {
          return {
            content: await input.getFileContent(file.filename),
            file,
          }
        } catch {
          return {
            content: "",
            file,
          }
        }
      })
  )

  return capturedFiles
}

export async function runReviewCheckers(input: {
  fullName: string
  headSha: string
  installationId: number
}) {
  const checkout = await clonePullRequestHead(input)

  try {
    const semgrepResult = await runSemgrep(checkout.repoDir)
    const runtime = await prepareRepositoryRuntime(checkout.repoDir)
    let installError: string | null = null

    if (runtime) {
      const installResult = await installDependencies(runtime)
      if (installResult.exitCode !== 0) {
        installError = buildCommandOutputExcerpt(installResult.combinedOutput)
      }
    }

    if (installError) {
      const skippedResults: Array<ReviewCheckerResult> = [
        semgrepResult,
        {
          checker: "lint",
          details: `Dependency install failed:\n${installError}`,
          findings: [],
          status: "skipped",
        },
        {
          checker: "typecheck",
          details: `Dependency install failed:\n${installError}`,
          findings: [],
          status: "skipped",
        },
        {
          checker: "tests",
          details: `Dependency install failed:\n${installError}`,
          findings: [],
          status: "skipped",
        },
      ]

      return {
        checkerResults: skippedResults,
        findings: semgrepResult.findings,
      }
    }

    const lintResult = await runLint(runtime)
    const typecheckResult = await runTypecheck(runtime)
    const testResult = await runTests(runtime)
    const checkerResults = [semgrepResult, lintResult, typecheckResult, testResult]

    return {
      checkerResults,
      findings: checkerResults.flatMap((result) => result.findings),
    }
  } finally {
    await checkout.cleanup()
  }
}
