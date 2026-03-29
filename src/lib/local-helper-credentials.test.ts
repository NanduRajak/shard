import { beforeEach, describe, expect, it, vi } from "vitest"
import { getLocalHelperStoredCredential } from "./local-helper-credentials"

const { getDecryptedCredentialByIdMock } = vi.hoisted(() => ({
  getDecryptedCredentialByIdMock: vi.fn(),
}))

vi.mock("./credentials-server", () => ({
  getDecryptedCredentialById: getDecryptedCredentialByIdMock,
}))

describe("getLocalHelperStoredCredential", () => {
  beforeEach(() => {
    getDecryptedCredentialByIdMock.mockReset()
  })

  it("rejects helpers that do not own the run claim", async () => {
    const convex = {
      query: vi.fn().mockResolvedValue({
        authorized: false,
      }),
    }

    await expect(
      getLocalHelperStoredCredential({
        convex,
        helperId: "helper_1",
        runId: "run_1" as never,
      }),
    ).rejects.toThrowError("Unauthorized local helper credential request.")
  })

  it("returns null when the run has no stored credential", async () => {
    const convex = {
      query: vi.fn().mockResolvedValue({
        authorized: true,
        credentialId: undefined,
        runOrigin: "https://app.example.com",
      }),
    }

    await expect(
      getLocalHelperStoredCredential({
        convex,
        helperId: "helper_1",
        runId: "run_1" as never,
      }),
    ).resolves.toBeNull()
    expect(getDecryptedCredentialByIdMock).not.toHaveBeenCalled()
  })

  it("returns the decrypted credential when the claimed run and origin match", async () => {
    const convex = {
      query: vi.fn().mockResolvedValue({
        authorized: true,
        credentialId: "cred_1",
        runOrigin: "https://app.example.com",
      }),
    }

    getDecryptedCredentialByIdMock.mockResolvedValue({
      login: "qa@example.com",
      origin: "https://app.example.com",
      password: "secret",
    })

    await expect(
      getLocalHelperStoredCredential({
        convex,
        helperId: "helper_1",
        runId: "run_1" as never,
      }),
    ).resolves.toEqual({
      login: "qa@example.com",
      origin: "https://app.example.com",
      password: "secret",
    })
  })

  it("fails closed when the saved credential origin no longer matches the run", async () => {
    const convex = {
      query: vi.fn().mockResolvedValue({
        authorized: true,
        credentialId: "cred_1",
        runOrigin: "https://app.example.com",
      }),
    }

    getDecryptedCredentialByIdMock.mockResolvedValue({
      login: "qa@example.com",
      origin: "https://admin.example.com",
      password: "secret",
    })

    await expect(
      getLocalHelperStoredCredential({
        convex,
        helperId: "helper_1",
        runId: "run_1" as never,
      }),
    ).resolves.toBeNull()
  })
})
