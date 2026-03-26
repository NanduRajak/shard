const CREDENTIAL_CIPHER = "aes-256-gcm"

function resolveEncryptionKey(rawKey: string) {
  const trimmedKey = rawKey.trim()

  if (/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
    return Buffer.from(trimmedKey, "hex")
  }

  const base64Key = Buffer.from(trimmedKey, "base64")

  if (base64Key.length === 32 && base64Key.toString("base64") === trimmedKey) {
    return base64Key
  }

  const utf8Key = Buffer.from(trimmedKey, "utf8")

  if (utf8Key.length === 32) {
    return utf8Key
  }

  throw new Error(
    "CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes via hex, base64, or raw text.",
  )
}

async function getEncryptionKey(overrideKey?: string) {
  if (overrideKey) {
    return resolveEncryptionKey(overrideKey)
  }

  const { serverEnv } = await import("~/server-env")

  return resolveEncryptionKey(serverEnv.CREDENTIAL_ENCRYPTION_KEY)
}

export async function encryptCredentialValue(value: string, overrideKey?: string) {
  const { createCipheriv, randomBytes } = await import("node:crypto")
  const iv = randomBytes(12)
  const key = await getEncryptionKey(overrideKey)
  const cipher = createCipheriv(CREDENTIAL_CIPHER, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [iv, authTag, encrypted].map((part) => part.toString("base64")).join(".")
}

export async function decryptCredentialValue(value: string, overrideKey?: string) {
  const [ivPart, authTagPart, encryptedPart] = value.split(".")

  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new Error("Credential ciphertext is malformed.")
  }

  const { createDecipheriv } = await import("node:crypto")
  const decipher = createDecipheriv(
    CREDENTIAL_CIPHER,
    await getEncryptionKey(overrideKey),
    Buffer.from(ivPart, "base64"),
  )

  decipher.setAuthTag(Buffer.from(authTagPart, "base64"))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64")),
    decipher.final(),
  ]).toString("utf8")
}
