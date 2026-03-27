import { createServerFn } from "@tanstack/react-start"
import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import {
  normalizeCredentialNamespace,
  normalizeCredentialWebsite,
} from "@/lib/credential-url"

export type CredentialFormInput = {
  isDefault: boolean
  namespace: string
  password: string
  profileLabel: string
  totpSecret?: string
  username: string
  website: string
}

async function validateCredentialInput(data: CredentialFormInput) {
  const { encryptCredentialValue } = await import("@/lib/credential-crypto")
  const profileLabel = data.profileLabel.trim()
  const namespace = normalizeCredentialNamespace(data.namespace)
  const username = data.username.trim()
  const normalizedWebsite = normalizeCredentialWebsite(data.website)
  const password = data.password.trim()
  const totpSecret = data.totpSecret?.trim()

  if (!namespace) {
    throw new Error("Namespace is required.")
  }

  if (!normalizedWebsite) {
    throw new Error("Website must be a full http:// or https:// URL.")
  }

  if (!profileLabel) {
    throw new Error("Profile name is required.")
  }

  if (!username) {
    throw new Error("Username is required.")
  }

  if (!password) {
    throw new Error("Password is required.")
  }

  return {
    isDefault: data.isDefault,
    namespace,
    origin: normalizedWebsite.origin,
    passwordEncrypted: await encryptCredentialValue(password),
    profileLabel,
    totpSecretEncrypted: totpSecret
      ? await encryptCredentialValue(totpSecret)
      : undefined,
    username,
    website: normalizedWebsite.website,
  }
}

export async function getDecryptedCredentialForOrigin({
  convex,
  namespace,
  pageUrl,
}: {
  convex: {
    query: (...args: any[]) => Promise<any>
  }
  namespace: string
  pageUrl: string
}) {
  const normalizedNamespace = normalizeCredentialNamespace(namespace)

  if (!normalizedNamespace) {
    return null
  }

  const normalizedWebsite = normalizeCredentialWebsite(pageUrl)

  if (!normalizedWebsite) {
    return null
  }

  const credential = await convex.query(api.credentials.getCredentialForRuntime, {
    namespace: normalizedNamespace,
    origin: normalizedWebsite.origin,
  })

  if (!credential) {
    return null
  }

  const { decryptCredentialValue } = await import("@/lib/credential-crypto")

  return {
    isDefault: credential.isDefault ?? false,
    namespace: credential.namespace,
    origin: credential.origin,
    password: await decryptCredentialValue(credential.passwordEncrypted),
    profileLabel: credential.profileLabel ?? credential.username,
    totpSecret: credential.totpSecretEncrypted
      ? await decryptCredentialValue(credential.totpSecretEncrypted)
      : undefined,
    username: credential.username,
    website: credential.website,
  }
}

export async function getDecryptedCredentialProfileById({
  convex,
  credentialId,
}: {
  convex: {
    query: (...args: any[]) => Promise<any>
  }
  credentialId: Id<"credentials">
}) {
  const credential = await convex.query(api.credentials.getCredentialProfileForRuntime, {
    credentialId,
  })

  if (!credential) {
    return null
  }

  const { decryptCredentialValue } = await import("@/lib/credential-crypto")

  return {
    _id: credential._id,
    isDefault: credential.isDefault ?? false,
    namespace: credential.namespace,
    origin: credential.origin,
    password: await decryptCredentialValue(credential.passwordEncrypted),
    profileLabel: credential.profileLabel ?? credential.username,
    totpSecret: credential.totpSecretEncrypted
      ? await decryptCredentialValue(credential.totpSecretEncrypted)
      : undefined,
    username: credential.username,
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

export const listCredentialNamespaces = createServerFn({ method: "GET" })
  .inputValidator((data: Record<string, never>) => data)
  .handler(async () => {
    const { createConvexServerClient } = await import("~/server/convex")
    const convex = createConvexServerClient()

    return await convex.query(api.credentials.listNamespaces, {})
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
      namespace: credential.namespace,
      password: await decryptCredentialValue(credential.passwordEncrypted),
      profileLabel: credential.profileLabel ?? credential.username,
      totpSecret: credential.totpSecretEncrypted
        ? await decryptCredentialValue(credential.totpSecretEncrypted)
        : "",
      username: credential.username,
      website: credential.website,
    }
  })
