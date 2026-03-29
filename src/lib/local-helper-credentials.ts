import type { Id } from "../../convex/_generated/dataModel"
import { api } from "../../convex/_generated/api"
import { getDecryptedCredentialById } from "./credentials-server"

export type LocalHelperStoredCredential = {
  login: string
  origin: string
  password: string
}

type LocalHelperCredentialQueryClient = {
  query: (...args: any[]) => Promise<any>
}

export async function getLocalHelperStoredCredential({
  convex,
  helperId,
  runId,
}: {
  convex: LocalHelperCredentialQueryClient
  helperId: string
  runId: Id<"runs">
}) {
  const access = await convex.query(api.runtime.getClaimedLocalRunCredentialAccess, {
    helperId,
    runId,
  })

  if (!access?.authorized) {
    throw new Error("Unauthorized local helper credential request.")
  }

  if (!access.credentialId || !access.runOrigin) {
    return null
  }

  const credential = await getDecryptedCredentialById({
    convex,
    credentialId: access.credentialId,
  })

  if (!credential || credential.origin !== access.runOrigin) {
    return null
  }

  return {
    login: credential.login,
    origin: credential.origin,
    password: credential.password,
  } satisfies LocalHelperStoredCredential
}
