import { createHmac } from "node:crypto"

export function hmacSha256(secret: Uint8Array, value: string) {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex")
}
