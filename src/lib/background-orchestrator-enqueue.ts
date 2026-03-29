type BackgroundOrchestratorQueueAssignment<TCredentialId extends string = string> = {
  credentialId?: TCredentialId
  instructions: string
  url: string
}

type BackgroundOrchestratorQueueRun<
  TRunId extends string = string,
  TCredentialId extends string = string,
> = {
  assignment: BackgroundOrchestratorQueueAssignment<TCredentialId>
  runId: TRunId
}

type QueueDispatchPayload<TRunId extends string = string, TCredentialId extends string = string> = {
  browserProvider: "playwright"
  credentialId?: TCredentialId
  instructions: string
  mode: "task"
  runId: TRunId
  url: string
}

type QueueDispatchEvent<TRunId extends string = string, TCredentialId extends string = string> = {
  data: QueueDispatchPayload<TRunId, TCredentialId>
  name: "app/background-run.requested"
}

type EnqueueBackgroundOrchestratorRunsOptions<
  TRunId extends string = string,
  TCredentialId extends string = string,
> = {
  markQueuedForWorker: (runId: TRunId) => Promise<void>
  markQueueDispatchFailed: (runId: TRunId, errorMessage: string) => Promise<void>
  markQueueDispatchUnconfirmed: (runId: TRunId, errorMessage: string) => Promise<void>
  runs: BackgroundOrchestratorQueueRun<TRunId, TCredentialId>[]
  sendEvent: (event: QueueDispatchEvent<TRunId, TCredentialId>) => Promise<unknown>
}

const UNKNOWN_QUEUE_ERROR = "Unknown background queue error"

function getQueueErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : UNKNOWN_QUEUE_ERROR
}

export async function enqueueBackgroundOrchestratorRuns<
  TRunId extends string = string,
  TCredentialId extends string = string,
>({
  markQueuedForWorker,
  markQueueDispatchFailed,
  markQueueDispatchUnconfirmed,
  runs,
  sendEvent,
}: EnqueueBackgroundOrchestratorRunsOptions<TRunId, TCredentialId>) {
  for (const [index, run] of runs.entries()) {
    try {
      await sendEvent({
        name: "app/background-run.requested",
        data: {
          browserProvider: "playwright",
          credentialId: run.assignment.credentialId,
          instructions: run.assignment.instructions,
          mode: "task",
          runId: run.runId,
          url: run.assignment.url,
        },
      })
    } catch (error) {
      const errorMessage = getQueueErrorMessage(error)

      await Promise.allSettled([
        markQueueDispatchUnconfirmed(run.runId, errorMessage),
        ...runs
          .slice(index + 1)
          .map((pendingRun) => markQueueDispatchFailed(pendingRun.runId, errorMessage)),
      ])

      throw error
    }

    await markQueuedForWorker(run.runId).catch(() => undefined)
  }
}
