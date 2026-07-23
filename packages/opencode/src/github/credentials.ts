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
import { resolveGitInvocation } from "../git/android-launcher"
import { readCredentials as readManualGitCredentials } from "../git/credentials"

const GITHUB_HOST = "github.com"
const URL_SCOPE = `http.https://${GITHUB_HOST}/.extraheader`

function getRemoteUrl(cwd: string, remote: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const invocation = resolveGitInvocation()
    execFile(invocation.bin, invocation.args(["remote", "get-url", remote]), {
      cwd,
      timeout: 5_000,
      env: { ...process.env, ...invocation.env },
    }, (error, stdout) => {
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

/** Mobile-only: writes the GitHub OAuth token into ~/.gitconfig (same
 *  github.com-scoped http.extraheader as buildGithubAuthEnv above) so the
 *  interactive terminal's raw `git push`/`pull`/`fetch`/`clone` — which
 *  never goes through Git.push()/pull() and its per-invocation
 *  getAuthEnv() — also authenticates automatically. Desktop already has
 *  working OS credential helpers and doesn't need this.
 *
 *  Trade-off (deliberate, confirmed with the user before implementing):
 *  unlike the per-invocation env-var injection used everywhere else, this
 *  token becomes readable by ANY process running in this shell — including
 *  agent-run bash commands — for as long as the server process lives. Call
 *  once at server boot (see cli/cmd/serve.ts); does not update live if the
 *  GitHub session changes while the server keeps running (same limitation
 *  as the rest of this app's boot-time shell config — restart to refresh).
 *
 *  No-op, never throws, on: desktop, no GitHub session connected, or a
 *  manual git credential already configured for any host (mirrors the
 *  precedence rule in git/index.ts::getAuthEnv — manual config always wins,
 *  so we don't silently override a token/key the user set up on purpose). */
export async function persistGithubGitConfigForTerminal(): Promise<void> {
  if (process.env.OPENCODE_CLIENT !== "mobile-embedded") return
  try {
    const manual = await readManualGitCredentials()
    if (manual.type !== "none") return

    const token = await GithubAuth.getAccessToken()
    if (!token) return

    const basic = Buffer.from(`x-access-token:${token}`).toString("base64")
    const invocation = resolveGitInvocation()
    await new Promise<void>((resolve) => {
      execFile(
        invocation.bin,
        invocation.args(["config", "--global", URL_SCOPE, `Authorization: Basic ${basic}`]),
        { timeout: 5_000, env: { ...process.env, ...invocation.env } },
        (error) => {
          if (error) console.error(`[github] persistGithubGitConfigForTerminal: ${error.message}`)
          resolve()
        },
      )
    })
  } catch (e) {
    console.error(`[github] persistGithubGitConfigForTerminal: ${e}`)
  }
}
