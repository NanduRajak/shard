import { normalizeCredentialWebsite } from "@/lib/credential-url"

export const LAST_SELECTED_CREDENTIAL_KEY = "last-selected-credential-id"
export const NO_CREDENTIAL_SELECTED = "__none__"

export type LauncherCredential = {
  _id: string
  isDefault: boolean
  login: string
  origin: string
  website: string
}

export function getCredentialSiteOrigin(siteUrl: string) {
  return normalizeCredentialWebsite(siteUrl)?.origin ?? null
}

export function getMatchingCredentialsForSiteUrl(
  credentials: LauncherCredential[],
  siteUrl: string,
) {
  const siteOrigin = getCredentialSiteOrigin(siteUrl)

  if (!siteOrigin) {
    return []
  }

  return credentials.filter((credential) => credential.origin === siteOrigin)
}

export function getPreferredCredentialId(credentials: LauncherCredential[]) {
  const preferredCredential =
    credentials.find((credential) => credential.isDefault) ?? credentials[0] ?? null

  return preferredCredential?._id ?? null
}

