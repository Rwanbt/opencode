// FORK: Minimal typed GitHub API client — Device Flow exchange + identity.
// No dependency on the `gh` CLI (may not be installed, and isn't available
// at all in the Android on-device rootfs). Plain `fetch`, not Effect — this
// is a small, isolated surface, consistent with git/credentials.ts.
import { redact } from "@/security/dlp"
import type { GithubIdentity } from "./schema"

/** Public OAuth App client_id — safe to embed (Device Flow has no client
 *  secret). Overridable so other forks/builds can point at their own app. */
export const CLIENT_ID = process.env.OPENCODE_GITHUB_CLIENT_ID ?? "Ov23liuaygpsQUnmi2hu"

/** `repo` covers private repos + collaborator repos for both API and git
 *  HTTPS push/pull — the minimal single scope that satisfies the mission's
 *  "access private + collaborator repos" requirement without over-asking. */
const SCOPE = "repo"

const USER_AGENT = "OpenCode-Fork-GithubAuth"
const REQUEST_TIMEOUT_MS = 15_000

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "GithubApiError"
  }
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS)
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: timeoutSignal() })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    // Never let a raw error surface a token — none should be in `init` here
    // (device-code endpoints are unauthenticated), but redact defensively.
    throw new GithubApiError(redact(message).text)
  }
}

export interface RawDeviceAuthorization {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
}

export async function requestDeviceCode(): Promise<RawDeviceAuthorization> {
  const res = await safeFetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPE }),
  })
  if (!res.ok) throw new GithubApiError(`device code request failed: ${res.status}`, res.status)
  return (await res.json()) as RawDeviceAuthorization
}

export type RawDeviceTokenResult =
  | { access_token: string; token_type: string; scope: string; refresh_token?: string; expires_in?: number }
  | { error: "authorization_pending" | "slow_down" | "expired_token" | "access_denied" | string; error_description?: string }

export async function pollDeviceToken(deviceCode: string): Promise<RawDeviceTokenResult> {
  const res = await safeFetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  })
  if (!res.ok) throw new GithubApiError(`device token poll failed: ${res.status}`, res.status)
  return (await res.json()) as RawDeviceTokenResult
}

export interface IdentityResult {
  identity: GithubIdentity
  scopes: string[]
}

/** GET /user — also reveals granted scopes via the `X-OAuth-Scopes` header,
 *  which is how we derive `privateRepositoryAccess` without probing a real
 *  repo (mission explicitly forbids inferring write access from visibility
 *  alone; scopes are the authoritative signal for classic OAuth Apps). */
export async function fetchIdentity(accessToken: string): Promise<IdentityResult> {
  const res = await safeFetch("https://api.github.com/user", {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
  if (res.status === 401) throw new GithubApiError("GitHub token rejected (revoked or expired)", 401)
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new GithubApiError("GitHub API rate limit exceeded", 403)
  }
  if (!res.ok) throw new GithubApiError(`GET /user failed: ${res.status}`, res.status)
  const body = (await res.json()) as { login: string; name?: string; avatar_url?: string; html_url: string }
  const scopesHeader = res.headers.get("x-oauth-scopes") ?? ""
  const scopes = scopesHeader
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    identity: {
      login: body.login,
      name: body.name,
      avatarUrl: body.avatar_url,
      profileUrl: body.html_url,
    },
    scopes,
  }
}
