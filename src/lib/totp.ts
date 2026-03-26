import { createHmac } from "node:crypto"

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

function decodeBase32(value: string) {
  const normalized = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "")
  let bits = ""

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character)

    if (index === -1) {
      throw new Error("TOTP secret must be valid base32.")
    }

    bits += index.toString(2).padStart(5, "0")
  }

  const bytes: number[] = []

  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2))
  }

  return Buffer.from(bytes)
}

export function generateTotpCode(secret: string, timestamp = Date.now()) {
  const key = decodeBase32(secret)
  const counter = Math.floor(timestamp / 30_000)
  const buffer = Buffer.alloc(8)

  buffer.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac("sha1", key).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binaryCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)

  return (binaryCode % 1_000_000).toString().padStart(6, "0")
}
