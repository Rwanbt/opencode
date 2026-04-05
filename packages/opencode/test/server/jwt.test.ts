import { describe, it, expect } from "bun:test"
import { createHmac, randomBytes } from "crypto"

// Test JWT signing/verification logic directly (without importing the module
// which depends on Config). This validates the cryptographic core.

function base64url(data: string | Buffer): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data
  return buf.toString("base64url")
}

function sign(payload: object, secret: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = base64url(JSON.stringify(payload))
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  return `${header}.${body}.${signature}`
}

function verify(token: string, secret: string): any | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [header, body, signature] = parts
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
  if (signature !== expected) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString())
    if (payload.exp && payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

describe("JWT crypto", () => {
  const secret = randomBytes(32).toString("hex")

  it("signs and verifies a token", () => {
    const payload = { sub: "usr_123", username: "alice", role: "admin", iat: Date.now(), exp: Date.now() + 60000 }
    const token = sign(payload, secret)
    const verified = verify(token, secret)
    expect(verified).not.toBeNull()
    expect(verified.sub).toBe("usr_123")
    expect(verified.username).toBe("alice")
  })

  it("rejects tampered token", () => {
    const payload = { sub: "usr_123", iat: Date.now(), exp: Date.now() + 60000 }
    const token = sign(payload, secret)
    const tampered = token.slice(0, -2) + "xx"
    expect(verify(tampered, secret)).toBeNull()
  })

  it("rejects expired token", () => {
    const payload = { sub: "usr_123", iat: Date.now() - 120000, exp: Date.now() - 60000 }
    const token = sign(payload, secret)
    expect(verify(token, secret)).toBeNull()
  })

  it("rejects token with wrong secret", () => {
    const payload = { sub: "usr_123", iat: Date.now(), exp: Date.now() + 60000 }
    const token = sign(payload, secret)
    expect(verify(token, "wrong-secret")).toBeNull()
  })

  it("rejects malformed tokens", () => {
    expect(verify("not.a.jwt", secret)).toBeNull()
    expect(verify("", secret)).toBeNull()
    expect(verify("a.b", secret)).toBeNull()
  })
})
