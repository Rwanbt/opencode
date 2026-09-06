/* SPDX-License-Identifier: MIT */

/**
 * Headless bootstrap: turns WorkbenchServer from a library into a process.
 *
 * WHY this file exists: until now nothing constructed a WorkbenchServer outside
 * its own test. Every route proof was an in-memory `server.fetch(new Request())`
 * with no socket, no listener and no lifecycle, so "serveur headless" — a
 * Phase 5 exit criterion and a Gate A condition — was unproven.
 *
 * It is deliberately NOT re-exported from ./index.ts: bootstrap imports
 * WorkbenchServer from there, and re-exporting would close a module cycle.
 * Consumers import "@unifia/workbench-server/bootstrap".
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { ArtifactStore } from "@unifia/artifact-runtime"
import { ApprovalBroker, AuditRuntimeDouble, FakeRuntimeAdapter, OpenCodeRuntimeAdapter, P3_CAPABILITIES, verifyAuditChain, type AuditChainVerification, type AuditContext, type AuditEvent, type McpUiControlBroker, type OpenCodeRuntimeBackend, type P3Capability, type PersistedAuditRow, type RuntimeAdapter, type RuntimeDecision } from "@unifia/contracts"
import type { DesignSkillManifest } from "@unifia/skill-hub"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { FixedWindowRateLimiter, HmacTokenAuthenticator, ScopedTokenIssuer } from "./auth.js"
import { ApprovalCapabilityGate, WorkbenchServer, type WorkbenchGithubSurface } from "./index.js"
import { PresentLinkSigner } from "./present-link.js"

export type WorkbenchRuntimeKind = "fake" | "opencode"

export type WorkbenchConfig = {
  signingKey: string
  issuer: string
  audience: string
  host: string
  port: number
  runtime: WorkbenchRuntimeKind
  auditLogPath: string
  rateBudget: number
  rateWindowMs: number
  /** Capabilities that bypass the approval broker. Empty means approve everything. */
  allowlistedCapabilities: ReadonlySet<P3Capability>
  /**
   * Where the artifact lineage is stored (the store appends `.unifia/artifacts`).
   * Same reasoning as auditLogPath: a sidecar inherits the launcher's cwd, which
   * on a Windows shortcut is C:\WINDOWS\system32 and is not writable.
   */
  artifactRoot: string
  /** Lifetime of a Phase 9.4 share link. Short by design — a present link expires rather than being revoked. */
  presentLinkTtlMs: number
}

export type WorkbenchHandle = {
  readonly url: string
  readonly port: number
  readonly instanceId: string
  stop(): Promise<void>
}

/** Minimum entropy for the signing key, matching HmacTokenAuthenticator. */
const MIN_SIGNING_KEY_BYTES = 32
const DEFAULT_PORT = 7444
const DEFAULT_RATE_BUDGET = 240
const DEFAULT_RATE_WINDOW_MS = 60_000
/** Ten minutes: long enough to paste a link into a chat, short enough that a leaked one stops working. */
const DEFAULT_PRESENT_LINK_TTL_MS = 10 * 60_000

/**
 * Durable audit sink.
 *
 * Appends synchronously: an audit record must reach disk before the decision it
 * describes is returned to the caller. An asynchronous append would let a crash
 * drop the record for an action that already happened.
 */
export class FileAuditSink {
  readonly #chain = new AuditRuntimeDouble()
  readonly #logPath: string

  constructor(logPath: string) {
    this.#logPath = logPath
    try {
      mkdirSync(path.dirname(logPath), { recursive: true })
    } catch (cause) {
      // The sink still refuses to exist without a writable destination — an
      // audit trail nobody can write is worse than a refusal. But the raw
      // errno is unreadable to whoever launched the process: it names neither
      // the directory nor the knob that fixes it. Embedders that must not die
      // on this are expected to catch, as the sidecar's control plane does.
      throw new Error(
        `audit log directory is not writable: ${path.dirname(logPath)} — set UNIFIA_WORKBENCH_AUDIT_LOG to a writable path`,
        { cause },
      )
    }
  }

  record(context: AuditContext, decision: RuntimeDecision): unknown {
    const entry = this.#chain.record(context, decision) as Record<string, unknown>
    // WHY we re-serialise the full event (not just actor/capability/decision):
    // the on-disk row must carry every attribution field so a downstream
    // reader can reconstruct the chain without joining the live process.
    appendFileSync(this.#logPath, `${JSON.stringify(entry)}\n`, "utf8")
    return entry
  }

  events(): readonly unknown[] {
    return this.#chain.events()
  }

  page(afterSequence = 0, limit = 50): { events: readonly AuditEvent[]; nextCursor: number | null } {
    return this.#chain.page(afterSequence, limit)
  }

  /**
   * Verify the whole persisted trail, including rows this process did not
   * write.
   *
   * The chain was written and never checked, which is why nobody noticed
   * that DA-AUD-01's extra attribution fields changed the hash preimage:
   * every row predating it stops matching the current rule. `verifyAuditChain`
   * checks each row against the version stamped on it, so an operator gets
   * "this trail is intact" rather than a tamper report for a schema change.
   */
  verifyPersistedChain(): AuditChainVerification {
    if (!existsSync(this.#logPath)) return { ok: true, rows: 0, versions: [] }
    const rows: PersistedAuditRow[] = []
    const text = readFileSync(this.#logPath, "utf8")
    for (const line of text.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        rows.push(JSON.parse(trimmed) as PersistedAuditRow)
      } catch {
        // A torn final append is the one line a crash can leave behind.
        // Report it as the failure it is rather than skipping it.
        return { ok: false, rows: rows.length + 1, failedAt: rows.length + 1, reason: "row is not valid JSON" }
      }
    }
    return verifyAuditChain(rows)
  }
}

/**
 * DA-CAP-02: parses UNIFIA_WORKBENCH_ALLOWLISTED_CAPABILITIES into a closed
 * set of P3 capability names.
 *
 * Fail-closed contract:
 * - An empty / unset env var yields an empty Set (the default).
 * - Whitespace around each entry is trimmed.
 * - Unknown names (anything not in P3_CAPABILITIES) are silently dropped,
 *   NOT raised as a hard error. The intent of the env var is policy input,
 *   not a strict register — a typo must not stop the server from starting,
 *   it just does not widen the allowlist.
 * - Names already in the union are deduplicated.
 *
 * Exported so the test suite can exercise the parser without going through
 * loadConfigFromEnv (which requires a signing key).
 */
export function parseAllowlistedCapabilities(value: string | undefined): ReadonlySet<P3Capability> {
  if (!value) return new Set()
  const known: ReadonlySet<string> = new Set(P3_CAPABILITIES)
  const result = new Set<P3Capability>()
  for (const entry of value.split(",")) {
    const trimmed = entry.trim()
    if (known.has(trimmed)) result.add(trimmed as P3Capability)
  }
  return result
}

/**
 * Reads configuration from the environment.
 *
 * @throws when the signing key is absent or too short. There is deliberately no
 * default key and no fallback to UnauthenticatedPrincipal: a misconfigured
 * server must refuse to start rather than start without authentication.
 */
export function loadConfigFromEnv(env: Record<string, string | undefined> = process.env): WorkbenchConfig {
  const signingKey = env.UNIFIA_WORKBENCH_SIGNING_KEY ?? ""
  if (Buffer.byteLength(signingKey, "utf8") < MIN_SIGNING_KEY_BYTES) {
    throw new Error(`UNIFIA_WORKBENCH_SIGNING_KEY must be set and at least ${MIN_SIGNING_KEY_BYTES} bytes`)
  }
  const runtime = env.UNIFIA_WORKBENCH_RUNTIME ?? "fake"
  if (runtime !== "fake" && runtime !== "opencode") throw new Error(`unsupported UNIFIA_WORKBENCH_RUNTIME: ${runtime}`)
  const host = env.UNIFIA_WORKBENCH_HOST ?? "127.0.0.1"
  // WHY loopback is enforced rather than defaulted: this server holds
  // filesystem capabilities. Binding it to a routable interface must be a
  // deliberate, separately reviewed decision, not an environment typo.
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") throw new Error(`UNIFIA_WORKBENCH_HOST must be a loopback address, got: ${host}`)
  return {
    signingKey,
    issuer: env.UNIFIA_WORKBENCH_ISSUER ?? "unifia-local",
    audience: env.UNIFIA_WORKBENCH_AUDIENCE ?? "workbench",
    host,
    port: Number(env.UNIFIA_WORKBENCH_PORT ?? DEFAULT_PORT),
    runtime,
    // Relative to cwd on purpose: a standalone Workbench server is launched
    // from the directory it serves. Anything spawned by another process (the
    // desktop sidecar) inherits an arbitrary cwd instead and must pass an
    // absolute path — see createWorkbenchBridge in packages/unifia.
    auditLogPath: env.UNIFIA_WORKBENCH_AUDIT_LOG ?? path.join(process.cwd(), ".unifia", "audit.jsonl"),
    rateBudget: Number(env.UNIFIA_WORKBENCH_RATE_BUDGET ?? DEFAULT_RATE_BUDGET),
    rateWindowMs: Number(env.UNIFIA_WORKBENCH_RATE_WINDOW_MS ?? DEFAULT_RATE_WINDOW_MS),
    allowlistedCapabilities: parseAllowlistedCapabilities(env.UNIFIA_WORKBENCH_ALLOWLISTED_CAPABILITIES),
    artifactRoot: env.UNIFIA_WORKBENCH_ARTIFACT_ROOT ?? process.cwd(),
    presentLinkTtlMs: Number(env.UNIFIA_WORKBENCH_PRESENT_LINK_TTL_MS ?? DEFAULT_PRESENT_LINK_TTL_MS),
  }
}

export type WorkbenchApp = {
  readonly server: WorkbenchServer
  readonly authenticator: HmacTokenAuthenticator
  readonly tokenIssuer: ScopedTokenIssuer
  readonly audit: FileAuditSink
  readonly workspace: WorkspaceRuntime
}

export type WorkbenchSurfaces = {
  backend?: OpenCodeRuntimeBackend
  /** UI control broker. Absent means /v1/ui/actions answers 503, not "allow". */
  ui?: McpUiControlBroker
  /** Actions a generated UI may reference. Absent means /v1/ui/render answers 503. */
  uiAllowedActions?: ReadonlySet<string>
  designSkills?: (workspaceId: string) => Promise<readonly DesignSkillManifest[]>
  github?: WorkbenchGithubSurface
}

/** One ArtifactStore per workspace, memoised so repeated calls reuse the instance. */
export function artifactStoreResolver(root: string): (workspaceId: string) => ArtifactStore {
  const stores = new Map<string, ArtifactStore>()
  return (workspaceId) => {
    const existing = stores.get(workspaceId)
    if (existing) return existing
    // The id is server-generated, but it lands in a filesystem path — refuse
    // anything that could climb out of the root rather than trusting the
    // generator to stay path-safe forever.
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(workspaceId) || workspaceId === "." || workspaceId === "..") {
      throw new Error(`workspace id is not usable as an artifact directory: ${workspaceId}`)
    }
    const created = new ArtifactStore(path.join(root, "workspaces", workspaceId))
    stores.set(workspaceId, created)
    return created
  }
}

/** Assembles the object graph. No I/O beyond opening the audit log. */
export function createWorkbenchApp(config: WorkbenchConfig, surfaces: WorkbenchSurfaces = {}): WorkbenchApp {
  const backend = surfaces.backend
  if (config.runtime === "opencode" && !backend) throw new Error("runtime=opencode requires an OpenCodeRuntimeBackend")
  const runtime: RuntimeAdapter = config.runtime === "opencode" ? new OpenCodeRuntimeAdapter(backend as OpenCodeRuntimeBackend) : new FakeRuntimeAdapter()
  const authenticator = new HmacTokenAuthenticator(config.signingKey, config.issuer, config.audience)
  const tokenIssuer = new ScopedTokenIssuer(config.signingKey, 5 * 60_000, 30_000)
  const instanceId = randomUUID()
  const audit = new FileAuditSink(config.auditLogPath)
  const workspace = new WorkspaceRuntime()
  const server = new WorkbenchServer({
    auth: authenticator,
    rateLimiter: new FixedWindowRateLimiter(config.rateBudget, config.rateWindowMs),
    workspace,
    runtime,
    audit,
    instanceId,
    tokenIssuer,
    capability: new ApprovalCapabilityGate(new ApprovalBroker(), config.allowlistedCapabilities),
    // WHY these two were absent: nothing constructed them, so every artifact
    // route answered 503 artifact.*.unavailable in the shipped app — no
    // persistence of streamed artifacts, no raw read, no history, no share
    // link — while server.test.ts injected its own and passed.
    //
    // One store PER WORKSPACE, not one shared: ArtifactStore.list() reads a
    // single directory and takes no workspace, so a shared root would let one
    // workspace list and read another's artifacts.
    artifacts: artifactStoreResolver(config.artifactRoot),
    presentLinks: new PresentLinkSigner(config.signingKey, config.presentLinkTtlMs),
    ui: surfaces.ui,
    uiAllowedActions: surfaces.uiAllowedActions,
    designSkills: surfaces.designSkills,
    github: surfaces.github,
  })
  return { server, authenticator, tokenIssuer, audit, workspace }
}

/** Starts the HTTP listener and returns a handle that shuts it down cleanly. */
export async function startWorkbench(config: WorkbenchConfig, surfaces: WorkbenchSurfaces = {}): Promise<WorkbenchHandle> {
  const app = createWorkbenchApp(config, surfaces)
  const listener = Bun.serve({
    hostname: config.host,
    port: config.port,
    // WHY idleTimeout is disabled: the default 10s closes any connection that
    // sends no bytes for that long, which kills every SSE subscription that is
    // simply waiting for its next event. Long-lived streams are the point of
    // this route.
    idleTimeout: 0,
    fetch: (request) => app.server.fetch(request),
  })
  // WHY it is checked and not coerced: Bun types the bound port as optional. If
  // the listener has no port the process is not actually serving, and reporting
  // a fabricated one would hide that.
  const boundPort = listener.port
  if (typeof boundPort !== "number") {
    await listener.stop(true)
    throw new Error("the listener did not report a bound port")
  }
  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    // WHY file sessions are closed before the socket: a revoked token must not
    // outlive the process that issued it, and close() releases the watchers the
    // runtime holds on the workspace root.
    await app.server.shutdown()
    await listener.stop(true)
  }
  return { url: `http://${config.host}:${boundPort}`, port: boundPort, instanceId: app.server.instanceId, stop }
}

/** Process entry point: starts from the environment and stops on a signal. */
export async function main(): Promise<WorkbenchHandle> {
  const handle = await startWorkbench(loadConfigFromEnv())
  const shutdown = () => { void handle.stop().then(() => process.exit(0)) }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
  process.stdout.write(`unifia workbench listening on ${handle.url}\n`)
  return handle
}

if (import.meta.main) await main()
