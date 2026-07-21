// FORK: GitHub account connection — storage + Device Flow orchestration.
//
// Storage namespace: deliberately its OWN keychain service ("github") / own
// encrypted file / own plaintext file — never the same namespace as provider
// credentials (../auth/index.ts). Reusing that namespace was considered and
// rejected: Auth.all() is consumed by provider-listing code (provider
// discovery, `opencode auth list`, GDPR export) that treats every entry as an
// LLM provider — a "github" entry there would silently corrupt those lists.
// Instead this module reuses the underlying secure-storage *mechanisms*
// (KeychainStorage with a distinct `service`, the same AES-256-GCM
// encrypted-file scheme) which is exactly what the mission spec allows
// ("réutiliser une infrastructure générique de stockage sécurisé").
import path from "node:path"
import { Global } from "@/global"
import { KeychainStorage } from "@/auth"
import { redact } from "@/security/dlp"
import * as GithubClient from "./client"
import type { DeviceAuthorization, GithubIdentity, GithubSession, GithubStatus, PollResult } from "./schema"

const SERVICE = "github"
const SESSION_KEY = "session"
const file = path.join(Global.Path.data, "github-auth.json")
const encryptedFile = path.join(Global.Path.data, "github-auth.enc.json")

type Backend = "file" | "keychain" | "encrypted-file"

function backend(): Backend {
  const override = process.env.OPENCODE_AUTH_STORAGE?.toLowerCase()
  if (override === "file" || override === "keychain" || override === "encrypted-file") return override
  return process.env.OPENCODE_CLIENT === "mobile-embedded" ? "encrypted-file" : "file"
}

function keychain(): KeychainStorage | undefined {
  const kc = new KeychainStorage(SERVICE)
  return kc.available() ? kc : undefined
}

async function readEncrypted(): Promise<GithubSession | undefined> {
  const fs = await import("node:fs/promises")
  const crypto = await import("node:crypto")
  try {
    const envelope = JSON.parse(await fs.readFile(encryptedFile, "utf8")) as {
      v: number
      iv: string
      tag: string
      ciphertext: string
    }
    const key = Buffer.from(process.env.OPENCODE_AUTH_ENCRYPTION_KEY ?? "", "base64")
    if (key.length !== 32) return undefined
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"))
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
    const json = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")
    return JSON.parse(json) as GithubSession
  } catch {
    return undefined
  }
}

async function writeEncrypted(session: GithubSession | undefined): Promise<void> {
  const fs = await import("node:fs/promises")
  if (!session) {
    await fs.rm(encryptedFile, { force: true })
    return
  }
  const crypto = await import("node:crypto")
  const key = Buffer.from(process.env.OPENCODE_AUTH_ENCRYPTION_KEY ?? "", "base64")
  if (key.length !== 32) throw new Error("OPENCODE_AUTH_ENCRYPTION_KEY must be a 32-byte base64 key")
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()])
  await fs.mkdir(path.dirname(encryptedFile), { recursive: true })
  await fs.writeFile(
    encryptedFile,
    JSON.stringify({
      v: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    }),
    { mode: 0o600 },
  )
}

async function readPlain(): Promise<GithubSession | undefined> {
  const fs = await import("node:fs/promises")
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as GithubSession
  } catch {
    return undefined
  }
}

async function writePlain(session: GithubSession | undefined): Promise<void> {
  const fs = await import("node:fs/promises")
  if (!session) {
    await fs.rm(file, { force: true })
    return
  }
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(session, null, 2), { mode: 0o600 })
  await fs.rename(tmp, file)
}

async function readSession(): Promise<GithubSession | undefined> {
  const b = backend()
  if (b === "keychain") {
    const kc = keychain()
    if (kc) return (await kc.get(SESSION_KEY)) as GithubSession | undefined
    // Endpoint not reachable yet (sidecar started before the Tauri host) —
    // fall through to file so a fresh connect isn't silently lost.
  }
  if (b === "encrypted-file") return readEncrypted()
  return readPlain()
}

async function writeSession(session: GithubSession | undefined): Promise<void> {
  const b = backend()
  if (b === "keychain") {
    const kc = keychain()
    if (kc) {
      if (session) await kc.set(SESSION_KEY, session)
      else await kc.delete(SESSION_KEY)
      return
    }
  }
  if (b === "encrypted-file") return writeEncrypted(session)
  return writePlain(session)
}

// ─── Device Flow — server-held pending state ────────────────────────────────
// The device_code never needs to reach the frontend: it only calls /start
// (gets back userCode/verificationUri to display) and /poll (no body) on an
// interval it manages itself, honoring slow_down. One pending flow at a time
// — starting a new one replaces any previous one (matches a single Settings
// panel; no concurrent connect attempts from one instance).
let pending: { deviceCode: string; intervalMs: number; expiresAt: number } | undefined

export async function startDeviceFlow(): Promise<DeviceAuthorization> {
  const raw = await GithubClient.requestDeviceCode()
  pending = {
    deviceCode: raw.device_code,
    intervalMs: raw.interval * 1000,
    expiresAt: Date.now() + raw.expires_in * 1000,
  }
  return {
    userCode: raw.user_code,
    verificationUri: raw.verification_uri,
    verificationUriComplete: raw.verification_uri_complete,
    expiresInSeconds: raw.expires_in,
    intervalSeconds: raw.interval,
  }
}

export function cancelDeviceFlow(): void {
  pending = undefined
}

export async function pollDeviceFlow(): Promise<PollResult> {
  if (!pending) return { status: "no_pending_flow" }
  if (Date.now() > pending.expiresAt) {
    pending = undefined
    return { status: "expired" }
  }
  try {
    const raw = await GithubClient.pollDeviceToken(pending.deviceCode)
    if ("error" in raw) {
      if (raw.error === "authorization_pending") return { status: "pending" }
      if (raw.error === "slow_down") {
        pending.intervalMs += 5000
        return { status: "slow_down", nextIntervalSeconds: Math.ceil(pending.intervalMs / 1000) }
      }
      if (raw.error === "expired_token") {
        pending = undefined
        return { status: "expired" }
      }
      if (raw.error === "access_denied") {
        pending = undefined
        return { status: "denied" }
      }
      pending = undefined
      return { status: "error", message: redact(raw.error_description ?? raw.error).text }
    }

    const { identity, scopes } = await GithubClient.fetchIdentity(raw.access_token)
    const session: GithubSession = {
      login: identity.login,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      profileUrl: identity.profileUrl,
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      expiresAt: raw.expires_in ? Date.now() + raw.expires_in * 1000 : undefined,
      scopes,
      connectedAt: Date.now(),
    }
    await writeSession(session)
    pending = undefined
    return { status: "success", identity }
  } catch (cause) {
    pending = undefined
    const message = cause instanceof Error ? cause.message : String(cause)
    return { status: "error", message: redact(message).text }
  }
}

export async function getIdentity(): Promise<GithubIdentity | undefined> {
  const session = await readSession()
  if (!session) return undefined
  return {
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    profileUrl: session.profileUrl,
  }
}

/** Internal use only (git credential bridge, capability checks) — never
 *  return this value from an HTTP route or log it verbatim. */
export async function getAccessToken(): Promise<string | undefined> {
  const session = await readSession()
  return session?.accessToken
}

export async function getScopes(): Promise<string[]> {
  const session = await readSession()
  return session?.scopes ?? []
}

export async function disconnect(): Promise<void> {
  pending = undefined
  await writeSession(undefined)
}

export function isConfigured(): boolean {
  return GithubClient.CLIENT_ID.length > 0
}

export type { GithubStatus }
