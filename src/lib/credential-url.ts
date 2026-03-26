export function normalizeCredentialNamespace(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

export function normalizeCredentialWebsite(value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  try {
    const parsedUrl = new URL(trimmedValue)

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null
    }

    return {
      website: parsedUrl.toString(),
      origin: parsedUrl.origin,
    }
  } catch {
    return null
  }
}
