// FORK: Stretch — git push/pull auth via HTTPS token or SSH key.
// Credentials are stored in $XDG_CONFIG/opencode/git-credentials.json (0o600).
// HTTPS: uses http.extraheader Authorization Basic (same as GitHub Actions).
// SSH: writes a temp key file and sets GIT_SSH_COMMAND.

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Global } from "@/global"

const CREDS_FILE = path.join(Global.Path.config, "git-credentials.json")
const CREDS_MODE = 0o600

export type GitAuthType = "none" | "https-token" | "ssh-key"

export type GitCredentials =
  | { type: "none" }
  | { type: "https-token"; token: string; username?: string }
  | { type: "ssh-key"; privateKey: string; passphrase?: string }

export async function readCredentials(): Promise<GitCredentials> {
  try {
    const raw = await fs.readFile(CREDS_FILE, "utf8")
    const parsed = JSON.parse(raw) as GitCredentials
    if (!parsed.type) return { type: "none" }
    return parsed
  } catch {
    return { type: "none" }
  }
}

export async function writeCredentials(creds: GitCredentials): Promise<void> {
  const json = JSON.stringify(creds, null, 2)
  // Write atomically with restricted permissions.
  const tmp = `${CREDS_FILE}.tmp`
  await fs.writeFile(tmp, json, { mode: CREDS_MODE, encoding: "utf8" })
  await fs.rename(tmp, CREDS_FILE)
}

// Returns env vars to inject into a git process for auth.
// Caller is responsible for cleaning up `tempKeyPath` if provided — it is a
// private temp DIRECTORY containing the key; remove it recursively.
export async function buildAuthEnv(
  creds: GitCredentials,
): Promise<{ env: Record<string, string>; tempKeyPath?: string }> {
  if (creds.type === "none") return { env: {} }

  if (creds.type === "https-token") {
    const user = creds.username ?? "x"
    const b64 = Buffer.from(`${user}:${creds.token}`).toString("base64")
    // Disable system credential helpers, then inject our header.
    // GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n (git ≥ 2.31).
    return {
      env: {
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "http.extraheader",
        GIT_CONFIG_VALUE_1: `Authorization: Basic ${b64}`,
      },
    }
  }

  // SSH_ASKPASS is not available cross-platform; passphrase-protected keys
  // are not yet supported — buildAuthEnv will throw so callers get a clear error.
  if (creds.passphrase) {
    throw new Error("SSH keys with a passphrase are not yet supported. Please use an unencrypted key or HTTPS token auth.")
  }

  // SSH key: write inside a fresh mkdtemp directory (0o700, random name) —
  // a fixed path like `oc-git-key-<pid>` is predictable and writeFile would
  // follow a pre-planted symlink in the world-writable tmpdir.
  const keyDir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-git-"))
  const keyPath = path.join(keyDir, "key")
  await fs.writeFile(keyPath, creds.privateKey, { mode: 0o600, encoding: "utf8" })

  // accept-new (TOFU) instead of disabling host-key checking outright:
  // first connection stores the host key, a changed key (MITM) still fails.
  const sshCmd = `ssh -i "${keyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes`

  return {
    env: { GIT_SSH_COMMAND: sshCmd },
    tempKeyPath: keyDir,
  }
}

// Masked view for API responses — never expose the raw token/key.
export function maskCredentials(creds: GitCredentials): object {
  if (creds.type === "none") return { type: "none" }
  if (creds.type === "https-token")
    return { type: "https-token", username: creds.username ?? "x", tokenSet: true }
  return { type: "ssh-key", keySet: true, hasPassphrase: Boolean(creds.passphrase) }
}
