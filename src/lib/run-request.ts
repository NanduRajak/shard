import { normalizeCredentialNamespace } from "@/lib/credential-url"
import { validateRunUrl } from "@/lib/run-url"

export function prepareCreateRunPayload(data: {
  url: string
  credentialNamespace?: string | null
}) {
  const url = validateRunUrl(data.url)

  if (!url) {
    throw new Error("Enter a full URL starting with http:// or https://.")
  }

  const credentialNamespace = data.credentialNamespace
    ? normalizeCredentialNamespace(data.credentialNamespace)
    : ""

  return {
    url,
    credentialNamespace: credentialNamespace || undefined,
  }
}
