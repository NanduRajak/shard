import { createHmac, timingSafeEqual } from "node:crypto"
import { createFileRoute } from "@tanstack/react-router"
import { serverEnv } from "../../../../app/server-env"
import { getGitHubConfigState } from "../../../../app/server/github"
import { handleTrackedPullRequestWebhook } from "../../../../app/server/review-bot-service"

function verifyWebhookSignature(payload: string, signature: string) {
  const secret = serverEnv.GITHUB_WEBHOOK_SECRET

  if (!secret) {
    return false
  }

  const digest = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`

  return timingSafeEqual(Buffer.from(signature), Buffer.from(digest))
}

export const Route = createFileRoute("/api/github/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const config = getGitHubConfigState()

        if (!config.isReady) {
          return new Response("GitHub webhook handling is not configured.", {
            status: 503,
          })
        }

        const payload = await request.text()
        const eventName = request.headers.get("x-github-event")
        const signature = request.headers.get("x-hub-signature-256")

        if (!payload || !eventName || !signature || !verifyWebhookSignature(payload, signature)) {
          return new Response("Invalid GitHub webhook signature.", {
            status: 401,
          })
        }

        if (eventName !== "pull_request") {
          return new Response("Ignored")
        }

        const parsed = JSON.parse(payload) as {
          action?: string
          pull_request?: {
            base: {
              ref: string
              sha: string
            }
            head: {
              ref: string
              sha: string
            }
            html_url: string
            number: number
            state: "closed" | "open"
            title: string
            user?: {
              login?: string
            }
          }
          repository?: {
            full_name: string
          }
        }

        if (
          !parsed.pull_request ||
          !parsed.repository?.full_name ||
          !parsed.action ||
          !["opened", "ready_for_review", "reopened", "synchronize"].includes(parsed.action)
        ) {
          return new Response("Ignored")
        }

        await handleTrackedPullRequestWebhook({
          action: parsed.action as "opened" | "ready_for_review" | "reopened" | "synchronize",
          authorLogin: parsed.pull_request.user?.login ?? null,
          baseBranch: parsed.pull_request.base.ref,
          baseSha: parsed.pull_request.base.sha,
          headBranch: parsed.pull_request.head.ref,
          headSha: parsed.pull_request.head.sha,
          prNumber: parsed.pull_request.number,
          repoFullName: parsed.repository.full_name,
          state: parsed.pull_request.state,
          title: parsed.pull_request.title,
          url: parsed.pull_request.html_url,
        })

        return new Response("OK")
      },
    },
  },
})
