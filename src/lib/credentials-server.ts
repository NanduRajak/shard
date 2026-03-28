import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { normalizeCredentialWebsite } from "@/lib/credential-url"

export type CredentialFormInput = {
  isDefault: boolean
  login: string
  password: string
  website: string
}

async function validateCredentialInput(data: CredentialFormInput) {
  const { encryptCredentialValue } = await import("@/lib/credential-crypto")
  const login = data.login.trim()
  const normalizedWebsite = normalizeCredentialWebsite(data.website)
  const password = data.password.trim()

  if (!normalizedWebsite) {
    throw new Error("Website must be a full http:// or https:// URL.")
  }

  if (!login) {
    throw new Error("Email or username is required.")
  }

  if (!password) {
    throw new Error("Password is required.")
  }

  return {
    isDefault: data.isDefault,
    login,
    origin: normalizedWebsite.origin,
    passwordEncrypted: await encryptCredentialValue(password),
    website: normalizedWebsite.website,
  }
}

export async function getDecryptedCredentialById({
  convex,
  credentialId,
}: {
  convex: {
    query: (...args: any[]) => Promise<any>
  }
  credentialId: Id<"credentials">
}) {
  const credential = await convex.query(api.credentials.getCredentialForRuntime, {
    credentialId,
  })

  if (!credential) {
    return null
  }

  const { decryptCredentialValue } = await import("@/lib/credential-crypto")

  return {
    _id: credential._id,
    isDefault: credential.isDefault ?? false,
    login: credential.login,
    origin: credential.origin,
    password: await decryptCredentialValue(credential.passwordEncrypted),
    website: credential.website,
  }
}

export const listCredentials = createServerFn({ method: "GET" })
  .inputValidator((data: Record<string, never>) => data)
  .handler(async () => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()

    return await convex.query(api.credentials.listCredentials, {})
  })

export const getCredentialsRolloutStatus = createServerFn({ method: "GET" })
  .inputValidator((data: Record<string, never>) => data)
  .handler(async () => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()

    return await convex.query(api.credentials.getCredentialsRolloutStatus, {})
  })

export const createCredential = createServerFn({ method: "POST" })
  .inputValidator((data: CredentialFormInput) => data)
  .handler(async ({ data }) => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()

    return await convex.mutation(
      api.credentials.createCredential,
      await validateCredentialInput(data),
    )
  })

export const updateCredential = createServerFn({ method: "POST" })
  .inputValidator(
    (data: CredentialFormInput & { credentialId: Id<"credentials"> }) => data,
  )
  .handler(async ({ data }) => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()
    const payload = await validateCredentialInput(data)

    await convex.mutation(api.credentials.updateCredential, {
      credentialId: data.credentialId,
      ...payload,
    })
  })

export const deleteCredential = createServerFn({ method: "POST" })
  .inputValidator((data: { credentialId: Id<"credentials"> }) => data)
  .handler(async ({ data }) => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()

    await convex.mutation(api.credentials.deleteCredential, data)
  })

export const resetCredentials = createServerFn({ method: "POST" })
  .inputValidator((data: Record<string, never>) => data)
  .handler(async () => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()

    return await convex.mutation(api.credentials.resetCredentials, {})
  })

export const getCredentialForEdit = createServerFn({ method: "POST" })
  .inputValidator((data: { credentialId: Id<"credentials"> }) => data)
  .handler(async ({ data }) => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()
    const credential = await convex.query(api.credentials.getCredentialForServer, data)

    if (!credential) {
      throw new Error("Credential not found.")
    }

    const { decryptCredentialValue } = await import("@/lib/credential-crypto")

    return {
      credentialId: credential._id,
      isDefault: credential.isDefault ?? false,
      login: credential.login,
      password: await decryptCredentialValue(credential.passwordEncrypted),
      website: credential.website,
    }
  })
