import { normalizeCredentialNamespace } from "@/lib/credential-url"
import { validateRunUrl } from "@/lib/run-url"

const RUN_URL_PATTERN = /https?:\/\/\S+/i

export function prepareCreateRunPayload(data: {
  prompt: string
  credentialNamespace?: string | null
  browserProvider?: "local_chrome" | "steel" | null
}) {
  const prompt = data.prompt.trim()
  const matchedUrl = prompt.match(RUN_URL_PATTERN)?.[0] ?? ""
  const url = validateRunUrl(matchedUrl)

  if (!url) {
    throw new Error("Enter a full URL starting with http:// or https://.")
  }

  const instructions = prompt
    .replace(matchedUrl, " ")
    .replace(/\s+/g, " ")
    .trim()

  const credentialNamespace = data.credentialNamespace
    ? normalizeCredentialNamespace(data.credentialNamespace)
    : ""
  const browserProvider =
    data.browserProvider === "local_chrome" ? ("local_chrome" as const) : ("steel" as const)

  return {
    url,
    mode: instructions ? ("task" as const) : ("explore" as const),
    browserProvider,
    credentialNamespace: credentialNamespace || undefined,
    instructions: instructions || undefined,
  }
}
