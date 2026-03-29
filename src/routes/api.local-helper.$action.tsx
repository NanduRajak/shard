import { createFileRoute } from "@tanstack/react-router"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import {
  appendFindingRequestSchema,
  appendRunEventRequestSchema,
  claimLocalRunRequestSchema,
  createPerformanceAuditRequestSchema,
  finalizeLocalRunRequestSchema,
  getLocalRunCredentialRequestSchema,
  getLocalRunStateRequestSchema,
  registerLocalHelperRequestSchema,
  updateLocalRunRequestSchema,
  uploadArtifactRequestSchema,
  upsertLocalSessionRequestSchema,
} from "@/lib/local-helper-protocol"

export const Route = createFileRoute("/api/local-helper/$action")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const [{ createConvexServerClient }, { serverEnv }] = await Promise.all([
          import("~/server/convex"),
          import("~/server-env"),
        ])

        if (!serverEnv.LOCAL_HELPER_SECRET) {
          return json(
            { error: "LOCAL_HELPER_SECRET is not configured on the app server." },
            { status: 503 },
          )
        }

        if (
          request.headers.get("x-local-helper-secret") !== serverEnv.LOCAL_HELPER_SECRET
        ) {
          return json({ error: "Unauthorized local helper request." }, { status: 401 })
        }

        const body = (await request.json().catch(() => null)) as unknown
        const convex = createConvexServerClient()

        switch (params.action) {
          case "register": {
            const payload = registerLocalHelperRequestSchema.parse(body)
            const helperDocId = await convex.mutation(api.runtime.upsertLocalHelperHeartbeat, {
              ...payload,
              currentClaimedRunId: payload.currentClaimedRunId as Id<"runs"> | undefined,
            })

            return json({ helperDocId, ok: true })
          }

          case "claim": {
            const payload = claimLocalRunRequestSchema.parse(body)
            const result = await convex.mutation(api.runtime.claimNextLocalRun, payload)

            return json(result)
          }

          case "state": {
            const payload = getLocalRunStateRequestSchema.parse(body)
            const state = await convex.query(api.runtime.getRunExecutionState, {
              runId: payload.runId as Id<"runs">,
            })

            return json({ ok: true, state })
          }

          case "credential": {
            const payload = getLocalRunCredentialRequestSchema.parse(body)
            const { getLocalHelperStoredCredential } = await import(
              "@/lib/local-helper-credentials"
            )

            try {
              const credential = await getLocalHelperStoredCredential({
                convex,
                helperId: payload.helperId,
                runId: payload.runId as Id<"runs">,
              })

              return json({ credential, ok: true })
            } catch (error) {
              if (
                error instanceof Error &&
                error.message === "Unauthorized local helper credential request."
              ) {
                return json({ error: error.message }, { status: 403 })
              }

              throw error
            }
          }

          case "progress": {
            const payload = updateLocalRunRequestSchema.parse(body)
            await convex.mutation(api.runtime.updateRun, {
              ...payload,
              runId: payload.runId as Id<"runs">,
            })

            return json({ ok: true })
          }

          case "session": {
            const payload = upsertLocalSessionRequestSchema.parse(body)
            const sessionId = payload.sessionId
              ? ((payload.sessionId as Id<"sessions">))
              : await convex.mutation(api.runtime.createSession, {
                  runId: payload.runId as Id<"runs">,
                  provider: payload.provider,
                  externalSessionId: payload.externalSessionId,
                  status: payload.status,
                  debugUrl: payload.debugUrl,
                  replayUrl: payload.replayUrl,
                })

            if (payload.sessionId) {
              await convex.mutation(api.runtime.updateSession, {
                sessionId,
                status: payload.status,
                debugUrl: payload.debugUrl,
                replayUrl: payload.replayUrl,
                finishedAt: payload.finishedAt ?? undefined,
              })
            }

            return json({ ok: true, sessionId })
          }

          case "event": {
            const payload = appendRunEventRequestSchema.parse(body)
            const eventId = await convex.mutation(api.runtime.createRunEvent, {
              ...payload,
              runId: payload.runId as Id<"runs">,
              sessionId: payload.sessionId as Id<"sessions"> | undefined,
              artifactId: payload.artifactId as Id<"artifacts"> | undefined,
            })

            return json({ eventId, ok: true })
          }

          case "finding": {
            const payload = appendFindingRequestSchema.parse(body)
            const findingId = await convex.mutation(api.runtime.createFinding, {
              ...payload,
              runId: payload.runId as Id<"runs">,
              artifactId: payload.artifactId as Id<"artifacts"> | undefined,
            })

            return json({ findingId, ok: true })
          }

          case "artifact": {
            const payload = uploadArtifactRequestSchema.parse(body)
            const uploadUrl = await convex.mutation(api.runtime.generateArtifactUploadUrl, {})
            const uploadResponse = await fetch(uploadUrl, {
              method: "POST",
              headers: {
                "Content-Type": payload.contentType,
              },
              body: Buffer.from(payload.base64, "base64"),
            })

            if (!uploadResponse.ok) {
              return json(
                { error: `Convex upload failed with status ${uploadResponse.status}` },
                { status: 502 },
              )
            }

            const { storageId } = (await uploadResponse.json()) as {
              storageId: Id<"_storage">
            }

            const artifactId = await convex.mutation(api.runtime.createArtifact, {
              runId: payload.runId as Id<"runs">,
              type: payload.type,
              fileLocation: `convex-storage:${storageId}`,
              storageId,
              title: payload.title,
              pageUrl: payload.pageUrl,
            })

            return json({ artifactId, ok: true })
          }

          case "performance-audit": {
            const payload = createPerformanceAuditRequestSchema.parse(body)
            const performanceAuditId = await convex.mutation(
              api.runtime.createPerformanceAudit,
              {
                ...payload,
                runId: payload.runId as Id<"runs">,
                reportArtifactId: payload.reportArtifactId as Id<"artifacts"> | undefined,
              },
            )

            return json({ ok: true, performanceAuditId })
          }

          case "finalize": {
            const payload = finalizeLocalRunRequestSchema.parse(body)

            await convex.mutation(api.runtime.updateRun, {
              runId: payload.runId as Id<"runs">,
              status: payload.status,
              currentStep: payload.currentStep,
              currentUrl: payload.currentUrl,
              errorMessage: payload.errorMessage,
              goalStatus: payload.goalStatus,
              goalSummary: payload.goalSummary,
              finalScore: payload.finalScore,
              finishedAt: payload.finishedAt ?? Date.now(),
            })

            if (payload.sessionId && payload.sessionStatus) {
              await convex.mutation(api.runtime.updateSession, {
                sessionId: payload.sessionId as Id<"sessions">,
                status: payload.sessionStatus,
                debugUrl: payload.debugUrl,
                replayUrl: payload.replayUrl,
                finishedAt: payload.finishedAt ?? Date.now(),
              })
            }

            await convex.mutation(api.runtime.releaseLocalHelperClaim, {
              helperId: payload.helperId,
              status: payload.status === "failed" ? "error" : "idle",
              currentClaimedRunId: null,
            })

            return json({ ok: true })
          }

          default:
            return json({ error: "Unknown local helper action." }, { status: 404 })
        }
      },
    },
  },
})

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
}
