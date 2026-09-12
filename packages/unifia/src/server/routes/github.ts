// FORK: GitHub account connection routes — OAuth Device Flow + capability
// diagnostics. See src/github/{auth,client,credentials,diagnostics}.ts.
//
// The raw access token NEVER leaves this process: every response here is
// built from GithubIdentity/GithubCapabilities/GitRuntimeReport, none of
// which carry the token field of GithubSession.
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import * as GithubAuth from "../../github/auth"
import * as GithubClient from "../../github/client"
import * as GithubDiagnostics from "../../github/diagnostics"
import type { GitRuntimeReport, GithubCapabilities } from "../../github/schema"
import { withTimeout } from "../../util/timeout"
import { Log } from "../../util/log"

const log = Log.create({ service: "github-routes" })

const IdentitySchema = z
  .object({
    login: z.string(),
    name: z.string().optional(),
    avatarUrl: z.string().optional(),
    profileUrl: z.string(),
  })
  .meta({ ref: "GithubIdentity" })

const DeviceAuthorizationSchema = z
  .object({
    userCode: z.string(),
    verificationUri: z.string(),
    verificationUriComplete: z.string().optional(),
    expiresInSeconds: z.number(),
    intervalSeconds: z.number(),
  })
  .meta({ ref: "GithubDeviceAuthorization" })

const PollResultSchema = z
  .object({
    status: z.enum(["pending", "slow_down", "expired", "denied", "no_pending_flow", "success", "error"]),
    nextIntervalSeconds: z.number().optional(),
    identity: IdentitySchema.optional(),
    message: z.string().optional(),
  })
  .meta({ ref: "GithubPollResult" })

const StatusSchema = z
  .object({
    connected: z.boolean(),
    configured: z.boolean(),
    identity: IdentitySchema.optional(),
  })
  .meta({ ref: "GithubStatus" })

const CapabilitiesSchema = z
  .object({
    apiReachable: z.boolean(),
    authenticated: z.boolean(),
    privateRepositoryAccess: z.union([z.boolean(), z.literal("unknown")]),
    gitHttpsAvailable: z.boolean(),
    gitHttpsAuthenticated: z.boolean(),
    gitSshAvailable: z.union([z.boolean(), z.literal("unsupported")]),
    lastCheckedAt: z.number(),
  })
  .meta({ ref: "GithubCapabilities" })

const GitRuntimeReportSchema = z
  .object({
    gitAvailable: z.boolean(),
    gitVersion: z.string().optional(),
    execPath: z.string().optional(),
    httpsHelperFound: z.boolean(),
    httpsHelperPath: z.string().optional(),
    httpsHelperExecutable: z.boolean(),
    httpsProbeSucceeded: z.boolean(),
    sshAvailable: z.boolean(),
    platform: z.string(),
    architecture: z.string(),
    failure: z
      .object({
        stage: z.string(),
        code: z.number().optional(),
        signal: z.string().optional(),
        category: z.string(),
        safeMessage: z.string(),
      })
      .optional(),
  })
  .meta({ ref: "GitRuntimeReport" })

const START_TIMEOUT = 15_000
const POLL_TIMEOUT = 15_000
const TEST_TIMEOUT = 20_000
const DIAG_TIMEOUT = 20_000

export function GithubRoutes() {
  return new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get GitHub connection status",
        description:
          "Returns whether a GitHub session is connected (from stored state, no network call) and whether the OAuth app is configured for this build.",
        operationId: "github.status",
        responses: {
          200: { description: "Connection status", content: { "application/json": { schema: resolver(StatusSchema) } } },
        },
      }),
      async (c) => {
        const configured = GithubAuth.isConfigured()
        const identity = await GithubAuth.getIdentity().catch(() => undefined)
        return c.json({ connected: !!identity, configured, identity })
      },
    )
    .post(
      "/device/start",
      describeRoute({
        summary: "Start GitHub Device Flow",
        description: "Requests a device/user code pair from GitHub. Call /device/poll on the returned interval.",
        operationId: "github.deviceStart",
        responses: {
          200: {
            description: "Device authorization",
            content: { "application/json": { schema: resolver(DeviceAuthorizationSchema) } },
          },
          503: { description: "GitHub OAuth app not configured for this build" },
        },
      }),
      async (c) => {
        if (!GithubAuth.isConfigured()) return c.json({ error: "github_not_configured" }, 503)
        try {
          const auth = await withTimeout(GithubAuth.startDeviceFlow(), START_TIMEOUT)
          return c.json(auth)
        } catch (err) {
          log.warn("github.deviceStart failed", { error: err instanceof Error ? err.message : String(err) })
          return c.json({ error: "device_start_failed" }, 502)
        }
      },
    )
    .post(
      "/device/poll",
      describeRoute({
        summary: "Poll the pending Device Flow",
        description: "Call on the interval returned by /device/start (increase it on slow_down). No request body.",
        operationId: "github.devicePoll",
        responses: {
          200: { description: "Poll result", content: { "application/json": { schema: resolver(PollResultSchema) } } },
        },
      }),
      async (c) => {
        const result = await withTimeout(GithubAuth.pollDeviceFlow(), POLL_TIMEOUT).catch((err) => {
          log.warn("github.devicePoll failed", { error: err instanceof Error ? err.message : String(err) })
          return { status: "error" as const, message: "poll request failed" }
        })
        return c.json(result)
      },
    )
    .post(
      "/device/cancel",
      describeRoute({
        summary: "Cancel the pending Device Flow",
        operationId: "github.deviceCancel",
        responses: { 200: { description: "Cancelled" } },
      }),
      async (c) => {
        GithubAuth.cancelDeviceFlow()
        return c.json({ ok: true })
      },
    )
    .post(
      "/disconnect",
      describeRoute({
        summary: "Disconnect the GitHub account",
        description: "Deletes the stored session from whichever backend holds it (keychain / encrypted file / plain file).",
        operationId: "github.disconnect",
        responses: { 200: { description: "Disconnected" } },
      }),
      async (c) => {
        await GithubAuth.disconnect()
        return c.json({ ok: true })
      },
    )
    .post(
      "/test-connection",
      describeRoute({
        summary: "Live capability check",
        description:
          "Re-validates the GitHub session against the live API and probes git HTTPS with the session's credentials. Distinguishes API reachability from git transport health — never reports 'operational' from the API check alone.",
        operationId: "github.testConnection",
        responses: {
          200: { description: "Capabilities", content: { "application/json": { schema: resolver(CapabilitiesSchema) } } },
          409: { description: "No GitHub session connected" },
        },
      }),
      async (c) => {
        const token = await GithubAuth.getAccessToken()
        if (!token) return c.json({ error: "not_connected" }, 409)

        const capabilities: GithubCapabilities = {
          apiReachable: false,
          authenticated: false,
          privateRepositoryAccess: "unknown",
          gitHttpsAvailable: false,
          gitHttpsAuthenticated: false,
          gitSshAvailable: "unsupported",
          lastCheckedAt: Date.now(),
        }

        try {
          const { scopes } = await withTimeout(GithubClient.fetchIdentity(token), TEST_TIMEOUT)
          capabilities.apiReachable = true
          capabilities.authenticated = true
          capabilities.privateRepositoryAccess = scopes.includes("repo")
            ? true
            : scopes.includes("public_repo")
              ? false
              : "unknown"
        } catch (err) {
          capabilities.apiReachable = err instanceof Error && !err.message.includes("rejected")
          log.warn("github.testConnection identity check failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        }

        try {
          // Probes a fixed public github.com URL (not the project's own
          // remote, which may not even be hosted on GitHub) — this checks
          // "does git HTTPS work with this session", a property of the
          // session, not of the current project.
          const env = await githubOnlyEnv(token)
          const probe = await withTimeout(GithubDiagnostics.probeAuthenticated(env), TEST_TIMEOUT)
          // API reachability is independent from the local Git HTTPS transport.
          capabilities.gitHttpsAvailable = probe.ok
          capabilities.gitHttpsAuthenticated = probe.ok
        } catch (err) {
          log.warn("github.testConnection git probe failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        }

        return c.json(capabilities)
      },
    )
    .get(
      "/diagnostics",
      describeRoute({
        summary: "Git runtime diagnostics",
        description:
          "Unauthenticated probe of the local git installation and HTTPS transport (git --version, exec-path, git-remote-https presence, a read-only ls-remote against a public repo). Safe to run without a GitHub session.",
        operationId: "github.diagnostics",
        responses: {
          200: { description: "Diagnostics report", content: { "application/json": { schema: resolver(GitRuntimeReportSchema) } } },
        },
      }),
      async (c) => {
        const report: GitRuntimeReport = await withTimeout(GithubDiagnostics.diagnose(), DIAG_TIMEOUT).catch(
          (err) => ({
            gitAvailable: false,
            httpsHelperFound: false,
            httpsHelperExecutable: false,
            httpsProbeSucceeded: false,
            sshAvailable: false,
            platform: process.platform,
            architecture: process.arch,
            failure: {
              stage: "diagnose",
              category: "unknown" as const,
              safeMessage: err instanceof Error ? err.message : "diagnostics timed out",
            },
          }),
        )
        return c.json(report)
      },
    )
}

// Builds the github.com-scoped extraheader env directly from a known-good
// token when buildGithubAuthEnv's own remote-detection has nothing to key
// off (test-connection probes a fixed public URL, not the project's own
// remote, which may not even be hosted on GitHub).
async function githubOnlyEnv(token: string): Promise<Record<string, string>> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64")
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_1: `Authorization: Basic ${basic}`,
  }
}
