// FORK: Bridges the GitHub OAuth session into git push/pull/fetch — ONLY
// when the user hasn't configured a manual git credential (git/credentials.ts
// — HTTPS token / SSH key, any host). This is the fallback path, checked
// after the manual one in git/index.ts::getAuthEnv.
//
// Host allowlist is load-bearing: the injected header must never leak to a
// remote that isn't github.com. `http.<url-prefix>.extraheader` is git's own
// URL-scoped config mechanism — safer than the unscoped `http.extraheader`
// used by the manual-token path (acceptable there because the user explicitly
// configured that token for arbitrary hosts they intend to use it with).
import { execFile } from "node:child_process"
import * as GithubAuth from "./auth"

const GITHUB_HOST = "github.com"
const URL_SCOPE = `http.https://${GITHUB_HOST}/.extraheader`

function getRemoteUrl(cwd: string, remote: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["remote", "get-url", remote], { cwd, timeout: 5_000 }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim())
    })
  })
}

function isGithubHttpsUrl(remoteUrl: string): boolean {
  // Covers both `https://github.com/owner/repo.git` and (less common but
  // valid) `https://user@github.com/owner/repo.git`.
  try {
    const url = new URL(remoteUrl)
    return url.protocol === "https:" && url.hostname.toLowerCase() === GITHUB_HOST
  } catch {
    return false
  }
}

/** Returns env vars to inject for this one git invocation, or `{}` when the
 *  remote isn't github.com or no GitHub session is connected. Never throws —
 *  callers fall back to no auth on any error, same contract as
 *  git/credentials.ts::buildAuthEnv. */
export async function buildGithubAuthEnv(cwd: string, remote: string): Promise<{ env: Record<string, string> }> {
  try {
    const remoteUrl = await getRemoteUrl(cwd, remote)
    if (!remoteUrl || !isGithubHttpsUrl(remoteUrl)) return { env: {} }

    const token = await GithubAuth.getAccessToken()
    if (!token) return { env: {} }

    const basic = Buffer.from(`x-access-token:${token}`).toString("base64")
    return {
      env: {
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: URL_SCOPE,
        GIT_CONFIG_VALUE_1: `Authorization: Basic ${basic}`,
      },
    }
  } catch {
    return { env: {} }
  }
}
