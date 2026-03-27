import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { serverEnv } from "~/server-env"

const IV_LENGTH = 12

function getReviewBotKey() {
  if (!serverEnv.REVIEW_BOT_SECRET) {
    throw new Error("REVIEW_BOT_SECRET is required for the Review Bot connection flow.")
  }

  return createHash("sha256").update(serverEnv.REVIEW_BOT_SECRET).digest()
}

export function encryptReviewBotSecret(value: string) {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv("aes-256-gcm", getReviewBotKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return Buffer.concat([iv, authTag, encrypted]).toString("base64url")
}

export function decryptReviewBotSecret(value: string) {
  const raw = Buffer.from(value, "base64url")
  const iv = raw.subarray(0, IV_LENGTH)
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16)
  const encrypted = raw.subarray(IV_LENGTH + 16)
  const decipher = createDecipheriv("aes-256-gcm", getReviewBotKey(), iv)

  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  )
}
