import { createHmac, randomBytes } from "crypto"
import type { Context, Next } from "hono"
import { HTTPException } from "hono/http-exception"
import { User, type UserID, type UserRole } from "../user"
import { Config } from "../config/config"
import { Log } from "../util/log"

const log = Log.create({ service: "auth-jwt" })

export namespace JwtAuth {
  // Lazy secret initialization
  let _secret: string | undefined

  function getSecret(): string {
    if (_secret) return _secret
    try {
      // Kick off async config load for next call
      Config.get().then((cfg) => { _secret = cfg?.experimental?.collaborative?.jwt_secret }).catch(() => {})
    } catch {}
    if (!_secret) {
      // Auto-generate a secret for this server instance
      _secret = randomBytes(32).toString("hex")
      log.info("auto-generated JWT secret (not persisted)")
    }
    return _secret
  }

  export interface TokenPayload {
    sub: string // UserID
    username: string
    role: UserRole
    iat: number
    exp: number
  }

  const ACCESS_TOKEN_TTL = 15 * 60 * 1000 // 15 minutes

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

  function verify(token: string, secret: string): TokenPayload | null {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const [header, body, signature] = parts
    const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")
    if (signature !== expected) return null

    try {
      const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload
      if (payload.exp && payload.exp < Date.now()) return null
      return payload
    } catch {
      return null
    }
  }

  export function issue(user: User.Info): { accessToken: string; refreshToken: string } {
    const now = Date.now()
    const payload: TokenPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
    }
    const accessToken = sign(payload, getSecret())
    const refreshToken = User.Token.create(user.id as UserID)
    return { accessToken, refreshToken }
  }

  export function refresh(refreshToken: string): { accessToken: string; refreshToken: string } | null {
    const userId = User.Token.verify(refreshToken)
    if (!userId) return null

    // Revoke old refresh token (rotation)
    User.Token.revoke(refreshToken)

    const user = User.get(userId)
    if (!user) return null

    return issue(user)
  }

  export function verifyAccessToken(token: string): TokenPayload | null {
    return verify(token, getSecret())
  }

  /**
   * Hono middleware that supports both JWT Bearer and Basic Auth.
   * When collaborative mode is disabled, falls back to basic auth only.
   * Sets `c.set("user", ...)` when JWT auth succeeds.
   */
  export function middleware() {
    return async (c: Context, next: Next) => {
      // Allow CORS preflight
      if (c.req.method === "OPTIONS") return next()

      // WebSocket connections from browsers cannot send custom HTTP headers.
      // Fall back to ?authorization= query parameter for WS upgrade requests.
      const authHeader = c.req.header("Authorization") || c.req.query("authorization")

      // Try JWT Bearer token first
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7)
        const payload = verifyAccessToken(token)
        if (payload) {
          c.set("user", {
            id: payload.sub,
            username: payload.username,
            role: payload.role,
          })
          return next()
        }
        // Invalid JWT — don't fall through, reject
        throw new HTTPException(401, { message: "Invalid or expired token" })
      }

      // Fall back to Basic Auth (backward compatibility)
      if (authHeader?.startsWith("Basic ")) {
        const { Flag } = await import("../flag/flag")
        const password = Flag.OPENCODE_SERVER_PASSWORD
        if (!password) return next() // No password configured — allow
        const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"

        const decoded = Buffer.from(authHeader.slice(6), "base64").toString()
        const [user, pass] = decoded.split(":")
        if (user === username && pass === password) {
          c.set("user", {
            id: "basic-auth",
            username: user,
            role: "admin" as UserRole,
          })
          return next()
        }
        throw new HTTPException(401, { message: "Invalid credentials" })
      }

      // No auth header — check if auth is required
      const { Flag } = await import("../flag/flag")
      const password = Flag.OPENCODE_SERVER_PASSWORD
      if (!password) {
        // Check collaborative config
        let requireAuth = false
        try {
          const cfg = await Config.get()
          requireAuth = cfg?.experimental?.collaborative?.require_auth ?? false
        } catch {}
        if (!requireAuth) return next()
      }

      throw new HTTPException(401, { message: "Authentication required" })
    }
  }
}
