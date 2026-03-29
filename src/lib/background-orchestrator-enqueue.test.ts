import { describe, expect, it, vi } from "vitest"
import { enqueueBackgroundOrchestratorRuns } from "./background-orchestrator-enqueue"

describe("enqueueBackgroundOrchestratorRuns", () => {
  it("queues runs in order and marks them waiting for a worker", async () => {
    const sendEvent = vi.fn(async () => undefined)
    const markQueuedForWorker = vi.fn(async () => undefined)
    const markQueueDispatchFailed = vi.fn(async () => undefined)
    const markQueueDispatchUnconfirmed = vi.fn(async () => undefined)

    await enqueueBackgroundOrchestratorRuns({
      markQueuedForWorker,
      markQueueDispatchFailed,
      markQueueDispatchUnconfirmed,
      runs: [
        {
          assignment: {
            instructions: "Lane 1",
            url: "https://app.example.com",
          },
          runId: "run_1",
        },
        {
          assignment: {
            instructions: "Lane 2",
            url: "https://app.example.com",
          },
          runId: "run_2",
        },
      ],
      sendEvent,
    })

    expect(sendEvent).toHaveBeenCalledTimes(2)
    expect(markQueuedForWorker).toHaveBeenNthCalledWith(1, "run_1")
    expect(markQueuedForWorker).toHaveBeenNthCalledWith(2, "run_2")
    expect(markQueueDispatchFailed).not.toHaveBeenCalled()
    expect(markQueueDispatchUnconfirmed).not.toHaveBeenCalled()
  })

  it("marks only the ambiguous handoff and never-attempted runs on queue failure", async () => {
    const sendEvent = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Queue unavailable"))
    const markQueuedForWorker = vi.fn(async () => undefined)
    const markQueueDispatchFailed = vi.fn(async () => undefined)
    const markQueueDispatchUnconfirmed = vi.fn(async () => undefined)

    await expect(
      enqueueBackgroundOrchestratorRuns({
        markQueuedForWorker,
        markQueueDispatchFailed,
        markQueueDispatchUnconfirmed,
        runs: [
          {
            assignment: {
              instructions: "Lane 1",
              url: "https://app.example.com",
            },
            runId: "run_1",
          },
          {
            assignment: {
              instructions: "Lane 2",
              url: "https://app.example.com",
            },
            runId: "run_2",
          },
          {
            assignment: {
              instructions: "Lane 3",
              url: "https://app.example.com",
            },
            runId: "run_3",
          },
        ],
        sendEvent,
      }),
    ).rejects.toThrowError("Queue unavailable")

    expect(markQueuedForWorker).toHaveBeenCalledTimes(1)
    expect(markQueuedForWorker).toHaveBeenCalledWith("run_1")
    expect(markQueueDispatchUnconfirmed).toHaveBeenCalledTimes(1)
    expect(markQueueDispatchUnconfirmed).toHaveBeenCalledWith("run_2", "Queue unavailable")
    expect(markQueueDispatchFailed).toHaveBeenCalledTimes(1)
    expect(markQueueDispatchFailed).toHaveBeenCalledWith("run_3", "Queue unavailable")
  })
})
