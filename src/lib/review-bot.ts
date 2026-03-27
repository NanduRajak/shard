import { createServerFn } from "@tanstack/react-start"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

type RepoSelection = {
  defaultBranch: string
  fullName: string
  installationId: number
  isPrivate: boolean
  name: string
  owner: string
}

function parseRepoFullName(fullName: string) {
  const [owner, name] = fullName.split("/")

  if (!owner || !name) {
    throw new Error("Select a valid GitHub repository.")
  }

  return { name, owner }
}

export const getReviewBotState = createServerFn({ method: "GET" }).handler(
  async () => {
    const [
      { createConvexServerClient },
      { getCookie },
      {
        decryptReviewBotSecret,
      },
      {
        getGitHubConfigState,
        getCommitHeadline,
        listInstalledRepositories,
      },
      { REVIEW_BOT_SESSION_COOKIE },
    ] = await Promise.all([
      import("~/server/convex"),
      import("@tanstack/react-start/server"),
      import("~/server/review-bot-crypto"),
      import("~/server/github"),
      import("~/server/review-bot-session"),
    ])

    const sessionToken = getCookie(REVIEW_BOT_SESSION_COOKIE)
    const config = getGitHubConfigState()

    if (!sessionToken) {
      return {
        accessibleRepositories: [],
        config,
        connection: null,
        repositoryLoadError: null,
        trackedPullRequests: [],
        trackedRepos: [],
      }
    }

    const convex = createConvexServerClient()
    const connection = await convex.query(api.reviewBot.getConnectionBySessionToken, {
      sessionToken,
    })

    if (!connection) {
      return {
        accessibleRepositories: [],
        config,
        connection: null,
        repositoryLoadError: null,
        trackedPullRequests: [],
        trackedRepos: [],
      }
    }

    const snapshot = await convex.query(api.reviewBot.getReviewBotSnapshot, {
      connectionId: connection._id,
    })
    let accessibleRepositories: Array<RepoSelection> = []
    let trackedPullRequests: Array<any> = snapshot?.trackedPullRequests ?? []
    let repositoryLoadError: string | null = null

    if (config.isReady) {
      try {
        accessibleRepositories = await listInstalledRepositories(
          decryptReviewBotSecret(connection.encryptedAccessToken)
        )

        const trackedReposById = new Map(
          (snapshot?.trackedRepos ?? []).map((trackedRepo) => [trackedRepo._id, trackedRepo])
        )

        trackedPullRequests = await Promise.all(
          trackedPullRequests.map(async (trackedPullRequest) => {
            const trackedRepo = trackedReposById.get(trackedPullRequest.trackedRepoId)

            if (!trackedRepo) {
              return trackedPullRequest
            }

            try {
              const latestCommitMessage = await getCommitHeadline({
                installationId: trackedRepo.installationId,
                owner: trackedRepo.owner,
                ref: trackedPullRequest.headSha,
                repo: trackedRepo.name,
              })

              return {
                ...trackedPullRequest,
                latestCommitMessage,
              }
            } catch {
              return trackedPullRequest
            }
          })
        )
      } catch (error) {
        repositoryLoadError =
          error instanceof Error
            ? error.message
            : "GitHub repositories could not be loaded."
      }
    }

    return {
      accessibleRepositories,
      config,
      connection: snapshot?.connection ?? null,
      repositoryLoadError,
      trackedPullRequests,
      trackedRepos: snapshot?.trackedRepos ?? [],
    }
  }
)

export const getRepositoryPullRequests = createServerFn({ method: "GET" })
  .inputValidator((data: { fullName: string; installationId: number }) => data)
  .handler(async ({ data }) => {
    const [{ listOpenPullRequests }, { getCookie }, { REVIEW_BOT_SESSION_COOKIE }] =
      await Promise.all([
        import("~/server/github"),
        import("@tanstack/react-start/server"),
        import("~/server/review-bot-session"),
      ])

    const sessionToken = getCookie(REVIEW_BOT_SESSION_COOKIE)

    if (!sessionToken) {
      throw new Error("Connect GitHub before loading pull requests.")
    }

    const { owner, name } = parseRepoFullName(data.fullName)

    return await listOpenPullRequests({
      installationId: data.installationId,
      owner,
      repo: name,
    })
  })

export const trackRepository = createServerFn({ method: "POST" })
  .inputValidator((data: RepoSelection) => data)
  .handler(async ({ data }) => {
    const [
      { createConvexServerClient },
      { getCookie },
      { REVIEW_BOT_SESSION_COOKIE },
    ] = await Promise.all([
      import("~/server/convex"),
      import("@tanstack/react-start/server"),
      import("~/server/review-bot-session"),
    ])

    const sessionToken = getCookie(REVIEW_BOT_SESSION_COOKIE)

    if (!sessionToken) {
      throw new Error("Connect GitHub before tracking repositories.")
    }

    const convex = createConvexServerClient()
    const connection = await convex.query(api.reviewBot.getConnectionBySessionToken, {
      sessionToken,
    })

    if (!connection) {
      throw new Error("Your GitHub connection could not be found. Connect again.")
    }

    return await convex.mutation(api.reviewBot.upsertTrackedRepo, {
      connectionId: connection._id,
      defaultBranch: data.defaultBranch,
      fullName: data.fullName,
      installationId: data.installationId,
      isPrivate: data.isPrivate,
      name: data.name,
      owner: data.owner,
    })
  })

export const trackPullRequest = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      installationId: number
      prNumber: number
      repo: RepoSelection
    }) => data
  )
  .handler(async ({ data }) => {
    const [
      { createConvexServerClient },
      { getCookie },
      { REVIEW_BOT_SESSION_COOKIE },
      { getPullRequestDetails },
      { enqueueTrackedPullRequestReview },
    ] = await Promise.all([
      import("~/server/convex"),
      import("@tanstack/react-start/server"),
      import("~/server/review-bot-session"),
      import("~/server/github"),
      import("~/server/review-bot-service"),
    ])

    const sessionToken = getCookie(REVIEW_BOT_SESSION_COOKIE)

    if (!sessionToken) {
      throw new Error("Connect GitHub before tracking pull requests.")
    }

    const convex = createConvexServerClient()
    const connection = await convex.query(api.reviewBot.getConnectionBySessionToken, {
      sessionToken,
    })

    if (!connection) {
      throw new Error("Your GitHub connection could not be found. Connect again.")
    }

    const trackedRepoId = await convex.mutation(api.reviewBot.upsertTrackedRepo, {
      connectionId: connection._id,
      defaultBranch: data.repo.defaultBranch,
      fullName: data.repo.fullName,
      installationId: data.repo.installationId,
      isPrivate: data.repo.isPrivate,
      name: data.repo.name,
      owner: data.repo.owner,
    })
    const pullRequest = await getPullRequestDetails({
      installationId: data.installationId,
      owner: data.repo.owner,
      pullNumber: data.prNumber,
      repo: data.repo.name,
    })
    const trackedPullRequestId = await convex.mutation(
      api.reviewBot.upsertTrackedPullRequest,
      {
        authorLogin: pullRequest.authorLogin,
        baseBranch: pullRequest.baseBranch,
        baseSha: pullRequest.baseSha,
        headBranch: pullRequest.headBranch,
        headSha: pullRequest.headSha,
        prNumber: pullRequest.number,
        repoFullName: data.repo.fullName,
        state: pullRequest.state,
        title: pullRequest.title,
        trackedRepoId,
        url: pullRequest.url,
      }
    )

    const reviewId = await enqueueTrackedPullRequestReview(trackedPullRequestId, {
      isManualTrigger: true,
      requestedReviewMode: "full",
    })

    return {
      reviewId,
      trackedPullRequestId,
    }
  })

export const rerunTrackedPullRequestReview = createServerFn({ method: "POST" })
  .inputValidator((data: { trackedPullRequestId: string }) => data)
  .handler(async ({ data }) => {
    const [{ enqueueTrackedPullRequestReview }] = await Promise.all([
      import("~/server/review-bot-service"),
    ])

    return await enqueueTrackedPullRequestReview(
      data.trackedPullRequestId as Id<"trackedPullRequests">,
      {
        isManualTrigger: true,
        requestedReviewMode: "full",
      }
    )
  })

export const getTrackedPullRequestDetail = createServerFn({ method: "GET" })
  .inputValidator((data: { trackedPullRequestId: string }) => data)
  .handler(async ({ data }) => {
    const [{ createConvexServerClient }] = await Promise.all([
      import("~/server/convex"),
    ])

    const convex = createConvexServerClient()

    return await convex.query(api.reviewBot.getTrackedPullRequestDetail, {
      trackedPullRequestId: data.trackedPullRequestId as Id<"trackedPullRequests">,
    })
  })

export const disconnectGitHub = createServerFn({ method: "POST" }).handler(
  async () => {
    const [
      { deleteCookie, getCookie, getRequestUrl },
      { createConvexServerClient },
      { REVIEW_BOT_OAUTH_STATE_COOKIE, REVIEW_BOT_SESSION_COOKIE, getReviewBotCookieOptions },
    ] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("~/server/convex"),
      import("~/server/review-bot-session"),
    ])

    const sessionToken = getCookie(REVIEW_BOT_SESSION_COOKIE)
    const requestUrl = getRequestUrl()

    if (sessionToken) {
      const convex = createConvexServerClient()

      await convex.mutation(api.reviewBot.removeConnectionBySessionToken, {
        sessionToken,
      })
    }

    deleteCookie(
      REVIEW_BOT_SESSION_COOKIE,
      getReviewBotCookieOptions(requestUrl)
    )
    deleteCookie(
      REVIEW_BOT_OAUTH_STATE_COOKIE,
      getReviewBotCookieOptions(requestUrl)
    )

    return { ok: true }
  }
)
