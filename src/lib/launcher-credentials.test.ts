import { describe, expect, it } from "vitest"
import {
  getCredentialSiteOrigin,
  getMatchingCredentialsForSiteUrl,
  getPreferredCredentialId,
  type LauncherCredential,
} from "./launcher-credentials"

const credentials: LauncherCredential[] = [
  {
    _id: "cred_default",
    isDefault: true,
    login: "qa-default@example.com",
    origin: "https://app.example.com",
    website: "https://app.example.com/login",
  },
  {
    _id: "cred_alt",
    isDefault: false,
    login: "qa-alt@example.com",
    origin: "https://app.example.com",
    website: "https://app.example.com/login",
  },
]

describe("launcher credential helpers", () => {
  it("extracts a site origin from a valid URL", () => {
    expect(getCredentialSiteOrigin("https://app.example.com/settings")).toBe(
      "https://app.example.com",
    )
  })

  it("returns no site origin for invalid URLs", () => {
    expect(getCredentialSiteOrigin("app.example.com")).toBeNull()
  })

  it("finds matching credentials for a site url", () => {
    expect(
      getMatchingCredentialsForSiteUrl(credentials, "https://app.example.com/account"),
    ).toHaveLength(2)
  })

  it("returns no matching credentials for a different origin", () => {
    expect(
      getMatchingCredentialsForSiteUrl(credentials, "https://admin.example.com"),
    ).toEqual([])
  })

  it("prefers the default credential when multiple credentials match", () => {
    expect(getPreferredCredentialId(credentials)).toBe("cred_default")
  })
})
