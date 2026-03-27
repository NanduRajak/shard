import { App, Octokit } from "octokit"
import { serverEnv } from "~/server-env"

export type GitHubConfigState = {
  isReady: boolean
  missing: Array<string>
}

export type GitHubAccessibleRepository = {
  defaultBranch: string
  fullName: string
  installationId: number
  isPrivate: boolean
  name: string
  owner: string
}

export type GitHubPullRequestOption = {
  authorLogin: string | null
  baseBranch: string
  baseSha: string
  headBranch: string
  headSha: string
  number: number
  state: "closed" | "open"
  title: string
  updatedAt: string
  url: string
}

export type GitHubIssueComment = {
  id: number
}

export type GitHubPullRequestReview = {
  id: number
}

export type GitHubPullRequestFile = {
  additions: number
  blobUrl: string
  changes: number
  contentsUrl: string
  deletions: number
  filename: string
  patch?: string
  previousFilename?: string
  rawUrl: string
  sha: string
  status:
    | "added"
    | "changed"
    | "copied"
    | "modified"
    | "removed"
    | "renamed"
    | "unchanged"
}

export async function getCommitHeadline(input: {
  installationId: number
  owner: string
  ref: string
  repo: string
}) {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const { data } = await octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", {
    owner: input.owner,
    ref: input.ref,
    repo: input.repo,
  })

  return data.commit.message.split("\n")[0]?.trim() ?? data.sha
}

type GitHubPullRequestDetails = {
  authorLogin: string | null
  baseBranch: string
  baseSha: string
  body: string | null
  headBranch: string
  headSha: string
  isDraft: boolean
  number: number
  state: "closed" | "open"
  title: string
  url: string
}

export type GitHubCommitComparison = {
  files: Array<GitHubPullRequestFile>
  totalCommits: number
}

function requireEnvValue(
  value: string | undefined,
  name: string,
  purpose: string
) {
  if (!value) {
    throw new Error(`${name} is required to ${purpose}.`)
  }

  return value
}

export function getGitHubConfigState(): GitHubConfigState {
  const requiredValues = {
    APP_BASE_URL: serverEnv.APP_BASE_URL,
    GITHUB_APP_ID: serverEnv.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: serverEnv.GITHUB_APP_PRIVATE_KEY,
    GITHUB_APP_SLUG: serverEnv.GITHUB_APP_SLUG,
    GITHUB_OAUTH_CLIENT_ID: serverEnv.GITHUB_OAUTH_CLIENT_ID,
    GITHUB_OAUTH_CLIENT_SECRET: serverEnv.GITHUB_OAUTH_CLIENT_SECRET,
    GITHUB_WEBHOOK_SECRET: serverEnv.GITHUB_WEBHOOK_SECRET,
    REVIEW_BOT_SECRET: serverEnv.REVIEW_BOT_SECRET,
  }

  const missing = Object.entries(requiredValues)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  return {
    isReady: missing.length === 0,
    missing,
  }
}

function getGitHubApp() {
  return new App({
    appId: requireEnvValue(
      serverEnv.GITHUB_APP_ID,
      "GITHUB_APP_ID",
      "authenticate the GitHub App"
    ),
    privateKey: requireEnvValue(
      serverEnv.GITHUB_APP_PRIVATE_KEY,
      "GITHUB_APP_PRIVATE_KEY",
      "authenticate the GitHub App"
    ).replace(/\\n/g, "\n"),
    webhooks: {
      secret: requireEnvValue(
        serverEnv.GITHUB_WEBHOOK_SECRET,
        "GITHUB_WEBHOOK_SECRET",
        "verify GitHub webhooks"
      ),
    },
  })
}

function getUserOctokit(accessToken: string) {
  return new Octokit({ auth: accessToken })
}

export function getGitHubOAuthRedirectUrl() {
  return new URL(
    "/api/github/callback",
    requireEnvValue(serverEnv.APP_BASE_URL, "APP_BASE_URL", "build GitHub callback URLs")
  ).toString()
}

export function getGitHubInstallRedirectUrl() {
  return new URL(
    "/api/github/install/callback",
    requireEnvValue(serverEnv.APP_BASE_URL, "APP_BASE_URL", "build GitHub install callback URLs")
  ).toString()
}

export function buildGitHubOAuthUrl(state: string) {
  const url = new URL("https://github.com/login/oauth/authorize")

  url.searchParams.set(
    "client_id",
    requireEnvValue(
      serverEnv.GITHUB_OAUTH_CLIENT_ID,
      "GITHUB_OAUTH_CLIENT_ID",
      "start GitHub OAuth"
    )
  )
  url.searchParams.set("redirect_uri", getGitHubOAuthRedirectUrl())
  url.searchParams.set("scope", "read:user repo read:org")
  url.searchParams.set("state", state)

  return url.toString()
}

export function buildGitHubInstallUrl(state: string) {
  const url = new URL(
    `https://github.com/apps/${requireEnvValue(
      serverEnv.GITHUB_APP_SLUG,
      "GITHUB_APP_SLUG",
      "start GitHub App installation"
    )}/installations/new`
  )

  url.searchParams.set("state", state)
  url.searchParams.set("redirect_url", getGitHubInstallRedirectUrl())

  return url.toString()
}

export async function exchangeGitHubOAuthCode(code: string) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: requireEnvValue(
        serverEnv.GITHUB_OAUTH_CLIENT_ID,
        "GITHUB_OAUTH_CLIENT_ID",
        "exchange the GitHub OAuth code"
      ),
      client_secret: requireEnvValue(
        serverEnv.GITHUB_OAUTH_CLIENT_SECRET,
        "GITHUB_OAUTH_CLIENT_SECRET",
        "exchange the GitHub OAuth code"
      ),
      code,
      redirect_uri: getGitHubOAuthRedirectUrl(),
    }),
  })

  const payload = (await response.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }

  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        "GitHub OAuth token exchange failed."
    )
  }

  return payload.access_token
}

export async function getGitHubViewer(accessToken: string) {
  const octokit = getUserOctokit(accessToken)
  const { data } = await octokit.request("GET /user")

  return {
    avatarUrl: data.avatar_url ?? null,
    id: data.id,
    login: data.login,
    name: data.name ?? null,
  }
}

export async function listInstalledRepositories(
  accessToken: string
): Promise<Array<GitHubAccessibleRepository>> {
  const octokit = getUserOctokit(accessToken)
  const { data } = await octokit.request("GET /user/installations", {
    per_page: 100,
  })

  const repositories = await Promise.all(
    data.installations.map(async (installation) => {
      const installationOctokit = await getGitHubApp().getInstallationOctokit(
        installation.id
      )
      const installationRepositories = await installationOctokit.paginate(
        "GET /installation/repositories",
        {
          per_page: 100,
        }
      )

      return installationRepositories.map((repository) => ({
        defaultBranch: repository.default_branch ?? "main",
        fullName: repository.full_name,
        installationId: installation.id,
        isPrivate: repository.private,
        name: repository.name,
        owner: repository.owner.login,
      }))
    })
  )

  return repositories
    .flat()
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
}

export async function listOpenPullRequests(input: {
  installationId: number
  owner: string
  repo: string
}): Promise<Array<GitHubPullRequestOption>> {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const pullRequests = await octokit.paginate("GET /repos/{owner}/{repo}/pulls", {
    owner: input.owner,
    per_page: 100,
    repo: input.repo,
    state: "open",
  })

  return pullRequests
    .map((pullRequest) => ({
      authorLogin: pullRequest.user?.login ?? null,
      baseBranch: pullRequest.base.ref,
      baseSha: pullRequest.base.sha,
      headBranch: pullRequest.head.ref,
      headSha: pullRequest.head.sha,
      number: pullRequest.number,
      state: pullRequest.state as "closed" | "open",
      title: pullRequest.title,
      updatedAt: pullRequest.updated_at,
      url: pullRequest.html_url,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function getPullRequestDetails(input: {
  installationId: number
  owner: string
  pullNumber: number
  repo: string
}): Promise<GitHubPullRequestDetails> {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner: input.owner,
    pull_number: input.pullNumber,
    repo: input.repo,
  })

  return {
    authorLogin: data.user?.login ?? null,
    baseBranch: data.base.ref,
    baseSha: data.base.sha,
    body: data.body ?? null,
    headBranch: data.head.ref,
    headSha: data.head.sha,
    isDraft: Boolean(data.draft),
    number: data.number,
    state: data.state as "closed" | "open",
    title: data.title,
    url: data.html_url,
  }
}

export async function listPullRequestFiles(input: {
  installationId: number
  owner: string
  pullNumber: number
  repo: string
}): Promise<Array<GitHubPullRequestFile>> {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const files = await octokit.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
    owner: input.owner,
    per_page: 100,
    pull_number: input.pullNumber,
    repo: input.repo,
  })

  return files.map((file) => ({
    additions: file.additions,
    blobUrl: file.blob_url,
    changes: file.changes,
    contentsUrl: file.contents_url,
    deletions: file.deletions,
    filename: file.filename,
    patch: file.patch ?? undefined,
    previousFilename: file.previous_filename ?? undefined,
    rawUrl: file.raw_url,
    sha: file.sha ?? "",
    status: file.status,
  }))
}

export async function compareCommitRange(input: {
  baseRef: string
  headRef: string
  installationId: number
  owner: string
  repo: string
}): Promise<GitHubCommitComparison> {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const { data } = await octokit.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
    basehead: `${input.baseRef}...${input.headRef}`,
    owner: input.owner,
    repo: input.repo,
  })

  return {
    files: (data.files ?? []).map((file) => ({
      additions: file.additions,
      blobUrl: file.blob_url,
      changes: file.changes,
      contentsUrl: file.contents_url,
      deletions: file.deletions,
      filename: file.filename,
      patch: file.patch ?? undefined,
      previousFilename: file.previous_filename ?? undefined,
      rawUrl: file.raw_url,
      sha: file.sha ?? "",
      status: file.status,
    })),
    totalCommits: data.total_commits ?? data.commits?.length ?? 0,
  }
}

export async function getRepositoryFileContent(input: {
  installationId: number
  owner: string
  path: string
  ref: string
  repo: string
}) {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const { data } = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
    owner: input.owner,
    path: input.path,
    ref: input.ref,
    repo: input.repo,
  })

  if (typeof data === "string") {
    return data
  }

  if (data && "content" in data && typeof data.content === "string") {
    return data.encoding === "base64"
      ? Buffer.from(data.content, "base64").toString("utf8")
      : data.content
  }

  return ""
}

export async function getInstallationAccessToken(installationId: number) {
  const installationOctokit = await getGitHubApp().getInstallationOctokit(installationId)

  return installationOctokit.auth({
    type: "installation",
  }) as Promise<{ token: string }>
}

export async function updatePullRequestBody(input: {
  body: string
  installationId: number
  owner: string
  pullNumber: number
  repo: string
}) {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)

  await octokit.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
    body: input.body,
    owner: input.owner,
    pull_number: input.pullNumber,
    repo: input.repo,
  })
}

export async function createIssueComment(input: {
  body: string
  installationId: number
  issueNumber: number
  owner: string
  repo: string
}): Promise<GitHubIssueComment> {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const { data } = await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    body: input.body,
    issue_number: input.issueNumber,
    owner: input.owner,
    repo: input.repo,
  })

  return {
    id: data.id,
  }
}

export async function updateIssueComment(input: {
  body: string
  commentId: number
  installationId: number
  owner: string
  repo: string
}): Promise<GitHubIssueComment> {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const { data } = await octokit.request("PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}", {
    body: input.body,
    comment_id: input.commentId,
    owner: input.owner,
    repo: input.repo,
  })

  return {
    id: data.id,
  }
}

export async function createPullRequestReviewComment(input: {
  body: string
  commitId: string
  installationId: number
  owner: string
  path: string
  position: number
  pullNumber: number
  repo: string
}) {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const { data } = await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/comments", {
    body: input.body,
    commit_id: input.commitId,
    owner: input.owner,
    path: input.path,
    position: input.position,
    pull_number: input.pullNumber,
    repo: input.repo,
  })

  return {
    id: data.id,
  }
}

export async function createPullRequestReview(input: {
  body: string
  comments?: Array<{
    body: string
    path: string
    position: number
  }>
  commitId: string
  event?: "APPROVE" | "COMMENT" | "REQUEST_CHANGES"
  installationId: number
  owner: string
  pullNumber: number
  repo: string
}): Promise<GitHubPullRequestReview> {
  const octokit = await getGitHubApp().getInstallationOctokit(input.installationId)
  const { data } = await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
    body: input.body,
    comments: input.comments?.length ? input.comments : undefined,
    commit_id: input.commitId,
    event: input.event ?? "COMMENT",
    owner: input.owner,
    pull_number: input.pullNumber,
    repo: input.repo,
  })

  return {
    id: data.id,
  }
}
