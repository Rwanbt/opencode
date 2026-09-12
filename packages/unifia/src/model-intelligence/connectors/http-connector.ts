/**
 * HttpConnector (TEAM-C03) — implémentation HTTP du contrat Connector (C02).
 *
 * Ce module IMPLÉMENTE l'interface `Connector` de C02 `types.ts` avec un
 * vrai transport HTTP, en respectant strictement :
 *
 *   - sourceURL constant pinné (jamais calculé runtime — protection SSRF)
 *   - Timeout par tentative borné (1-30s, default 10s)
 *   - Retry cap strict (default 3, max 5, F2-G02 durci)
 *   - Validation Zod du ProvenanceMeta AVANT tout retour (fail-closed)
 *   - AbortSignal supporté (cancellation native)
 *   - Pas de secret dans les logs (cause: string bornée, pas de payload brut)
 *   - Response size limit (10 MB) — détection streaming, abort avant OOM
 *   - Offline mode : si pas de réseau mais snapshot valide disponible
 *     dans SnapshotManager, restoration transparente (degraded mode
 *     EXPLICITE — l'opération retourne un résultat snapshoté)
 *
 * Doctrine :
 *   - C01 reste l'autorité unique du registry : HttpConnector DÉCOUVRE et
 *     NORMALISE, il n'ingère jamais dans le registry C01 directement.
 *   - C02 reste le contrat abstrait : HttpConnector est une implémentation,
 *     pas une réécriture.
 *   - Pas de second schéma, catalogue ou snapshot canonique concurrent.
 *   - Pas d'URL configurable runtime (anti-SSRF) : sourceURL injecté au
 *     build via constructeur, validé contre une whitelist optionnelle.
 *
 * Allowed par TEAM-C03 scope manifest :
 *   - création : packages/unifia/src/model-intelligence/connectors/http-connector.ts
 */

import { createHash } from "node:crypto"
import {
  type Connector,
  type ConnectorError,
  type ConnectorFetchOptions,
  type DiscoverResult,
  type PricingResult,
  type CapabilitiesResult,
  type StatusResult,
  type ProvenanceMeta,
  ProvenanceMetaSchema,
  ConnectorOperationError,
  normalizeConnectorFetchOptions,
} from "./types"
import { isoUtcNow } from "../schema"
import { SnapshotManager, type SnapshotOpKind, type SnapshotRecord } from "./snapshot-manager"

// =====================================================================
// 1. Constantes & types publics
// =====================================================================

export const HTTP_CONNECTOR_MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10 MB
export const HTTP_CONNECTOR_DEFAULT_TIMEOUT_MS = 10_000
export const HTTP_CONNECTOR_MIN_TIMEOUT_MS = 1_000
export const HTTP_CONNECTOR_MAX_TIMEOUT_MS = 30_000
export const HTTP_CONNECTOR_DEFAULT_MAX_RETRIES = 3
const BACKOFF_BASE_MS = 200
const BACKOFF_JITTER_MS = 100

/**
 * Type d'une fonction `fetch` injectable (pour tests). Sous-ensemble de
 * l'API Web standard suffisante pour ce connecteur (Bun, Deno, Node 18+,
 * browsers, mocks). Le `preconnect` n'est pas utilisé et donc non requis.
 */
export type FetchFn = (
  input: string | URL | Request,
  init?: {
    method?: string
    headers?: Record<string, string> | Headers
    body?: BodyInit | null
    signal?: AbortSignal | null
    redirect?: RequestRedirect
    [key: string]: unknown
  },
) => Promise<Response>

/**
 * Options du constructeur HttpConnector.
 *
 * IMPORTANT : `sourceURL` est const-y au sens du runtime — il DOIT être
 * connu statiquement par l'appelant. Aucun helper ne construit l'URL à
 * partir d'une entrée utilisateur non filtrée.
 */
export interface HttpConnectorOptions {
  id: string
  sourceURL: string
  parserVersion: string
  licenseCode: string | null
  copyrightNotice: string | null
  licenseFileURL: string | null
  confidenceLevel: "official" | "community" | "unverified"
  sourceVersion?: string
  kind?: "catalog" | "pricing" | "benchmarks" | "metadata"
  fetchImpl?: FetchFn
  snapshotManager?: SnapshotManager
  allowedURLs?: string[]
  userAgent?: string
  deterministic?: boolean
}

export interface HttpRequestLogEntry {
  connectorID: string
  op: SnapshotOpKind
  url: string
  attempts: number
  outcome:
    | "ok"
    | "fetch_failed"
    | "size_limit"
    | "aborted"
    | "parse_failed"
    | "validation_failed"
    | "license_mismatch"
    | "offline_restored"
    | "offline_no_cache"
  durationMs: number
  bytesRead: number | null
  hash: string | null
}

// =====================================================================
// 2. HttpConnector — implémentation concrète
// =====================================================================

export class HttpConnector implements Connector {
  readonly id: string
  readonly kind: "catalog" | "pricing" | "benchmarks" | "metadata"
  readonly version: string
  readonly sourceURL: string
  readonly parserVersion: string
  readonly licenseCode: string | null
  readonly copyrightNotice: string | null
  readonly licenseFileURL: string | null
  readonly confidenceLevel: "official" | "community" | "unverified"

  private readonly fetchImpl: FetchFn
  private readonly snapshotManager: SnapshotManager
  private readonly allowedURLs: ReadonlySet<string>
  private readonly userAgent: string
  private readonly requestLog: HttpRequestLogEntry[] = []

  constructor(options: HttpConnectorOptions) {
    if (!options.id || options.id.length === 0) {
      throw new Error("HttpConnector: id is required and must be non-empty")
    }
    if (!options.sourceURL) {
      throw new Error("HttpConnector: sourceURL is required")
    }
    if (!isValidSemver(options.parserVersion)) {
      throw new Error(`HttpConnector: parserVersion must be semver, got "${options.parserVersion}"`)
    }
    validateSourceURL(options.sourceURL)

    const allowed = new Set<string>([options.sourceURL])
    // Les URLs dérivées (sourceURL + /discover, /pricing, etc.) doivent
    // toujours être autorisées (sinon le check anti-SSRF interne bloquerait).
    const appendPathLocal = (base: string, seg: string): string =>
      base.endsWith("/") ? base + seg : base + "/" + seg
    for (const op of ["discover", "pricing", "capabilities", "status"] as const) {
      allowed.add(appendPathLocal(options.sourceURL, op))
    }
    if (options.allowedURLs) {
      for (const u of options.allowedURLs) {
        if (u !== options.sourceURL) validateSourceURL(u)
        allowed.add(u)
      }
    }

    this.id = options.id
    this.kind = options.kind ?? "catalog"
    this.version = options.sourceVersion ?? options.parserVersion
    this.sourceURL = options.sourceURL
    this.parserVersion = options.parserVersion
    this.licenseCode = options.licenseCode ?? null
    this.copyrightNotice = options.copyrightNotice ?? null
    this.licenseFileURL = options.licenseFileURL ?? null
    this.confidenceLevel = options.confidenceLevel
    // Bound for the same reason as WorkbenchClient's transport: kept as an
    // instance field, `this.fetchImpl(...)` would call the global fetch with
    // this connector as receiver, which a browser-grade fetch rejects outright.
    // Every test here injects `fetchImpl`, so this fallback is untested by
    // construction — it must not be the one that carries a latent defect.
    const globalFetch = globalThis.fetch as FetchFn | undefined
    const fetchFn = options.fetchImpl ?? (globalFetch ? (globalFetch.bind(globalThis) as FetchFn) : undefined)
    if (!fetchFn) {
      throw new Error(
        "HttpConnector: no fetch implementation found. Pass options.fetchImpl (or set globalThis.fetch).",
      )
    }
    this.fetchImpl = fetchFn
    this.snapshotManager =
      options.snapshotManager ?? new SnapshotManager({ rootDir: defaultTempRootDir() })
    this.allowedURLs = allowed
    this.userAgent = options.userAgent ?? `opencode-model-intelligence/${options.parserVersion}`
  }

  // ------------------------------------------------------------------
  // Implémentation Connector (C02)
  // ------------------------------------------------------------------

  async discover(opts?: ConnectorFetchOptions): Promise<DiscoverResult> {
    return this.executeJsonOp<DiscoverResult>("discover", this.discoverURL(), opts, parseDiscoverJson)
  }

  async pricing(opts?: ConnectorFetchOptions): Promise<PricingResult> {
    return this.executeJsonOp<PricingResult>("pricing", this.pricingURL(), opts, parsePricingJson)
  }

  async capabilities(opts?: ConnectorFetchOptions): Promise<CapabilitiesResult> {
    return this.executeJsonOp<CapabilitiesResult>("capabilities", this.capabilitiesURL(), opts, parseCapabilitiesJson)
  }

  async status(opts?: ConnectorFetchOptions): Promise<StatusResult> {
    return this.executeJsonOp<StatusResult>("status", this.statusURL(), opts, parseStatusJson)
  }

  // ------------------------------------------------------------------
  // API étendue (utilisée par tests + SnapshotManager)
  // ------------------------------------------------------------------

  async getSnapshot(op: SnapshotOpKind): Promise<SnapshotRecord | null> {
    return this.snapshotManager.restore(this.id, op)
  }

  getRequestLog(): readonly HttpRequestLogEntry[] {
    return [...this.requestLog]
  }

  clearRequestLog(): void {
    this.requestLog.length = 0
  }

  getSnapshotManager(): SnapshotManager {
    return this.snapshotManager
  }

  // ------------------------------------------------------------------
  // URLs dérivées
  // ------------------------------------------------------------------

  private discoverURL(): string {
    return this.appendPath(this.sourceURL, "discover")
  }
  private pricingURL(): string {
    return this.appendPath(this.sourceURL, "pricing")
  }
  private capabilitiesURL(): string {
    return this.appendPath(this.sourceURL, "capabilities")
  }
  private statusURL(): string {
    return this.appendPath(this.sourceURL, "status")
  }

  private appendPath(base: string, seg: string): string {
    if (base.endsWith("/")) return base + seg
    return base + "/" + seg
  }

  // ------------------------------------------------------------------
  // Cœur : exécution d'une opération fetch + validation + persistance
  // ------------------------------------------------------------------

  private async executeJsonOp<T>(
    op: SnapshotOpKind,
    url: string,
    opts: ConnectorFetchOptions | undefined,
    parser: (raw: string, prov: ProvenanceMeta) => T,
  ): Promise<T> {
    if (!this.allowedURLs.has(url)) {
      throw new ConnectorOperationError({
        kind: "validation",
        sourceID: this.id,
        path: "url",
        expectedType: "URL inside allowlist",
        actualValueShape: url,
        cause: `URL "${url}" is not in the connector's allowlist (SSRF guard)`,
      })
    }
    const norm = normalizeConnectorFetchOptions(opts)
    const start = Date.now()
    const logBase: Omit<HttpRequestLogEntry, "outcome" | "durationMs" | "bytesRead" | "hash"> = {
      connectorID: this.id,
      op,
      url,
      attempts: 0,
    }

    // ---------- Mode offline strict ----------
    if (norm.offline) {
      const snap = await this.snapshotManager.restore(this.id, op)
      if (!snap) {
        this.requestLog.push({
          ...logBase,
          attempts: 0,
          outcome: "offline_no_cache",
          durationMs: Date.now() - start,
          bytesRead: null,
          hash: null,
        })
        throw new ConnectorOperationError({
          kind: "offline_no_cache",
          sourceID: this.id,
        })
      }
      const prov = this.parseAndValidateProvenance(snap.raw, op)
      const result = parser(snap.raw, prov)
      this.requestLog.push({
        ...logBase,
        attempts: 0,
        outcome: "offline_restored",
        durationMs: Date.now() - start,
        bytesRead: snap.raw.length,
        hash: snap.hash,
      })
      return result
    }

    // ---------- Mode online : retry borné ----------
    let lastError: ConnectorError | null = null
    for (let attempt = 1; attempt <= norm.maxRetries; attempt++) {
      const requestLogBase: Omit<HttpRequestLogEntry, "outcome" | "durationMs" | "bytesRead" | "hash"> = {
        ...logBase,
        attempts: attempt,
      }
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), norm.timeoutMs)
        const externalSignal = norm.signal
        if (externalSignal) {
          if (externalSignal.aborted) controller.abort()
          else externalSignal.addEventListener("abort", () => controller.abort(), { once: true })
        }
        let response: Response
        try {
          response = await this.fetchImpl(url, {
            method: "GET",
            headers: { "User-Agent": this.userAgent, Accept: "application/json" },
            signal: controller.signal,
            redirect: "manual",
          })
        } finally {
          clearTimeout(timer)
        }

        if (!response.ok) {
          // 4xx (autre que 429) → terminal : on remonte en `validation`
          // avec cause explicite. 5xx (et 429) → retry transient via `fetch`.
          const isClientError = response.status >= 400 && response.status < 500 && response.status !== 429
          if (isClientError) {
            this.requestLog.push({
              ...requestLogBase,
              outcome: "fetch_failed",
              durationMs: Date.now() - start,
              bytesRead: null,
              hash: null,
            })
            throw new ConnectorOperationError({
              kind: "validation",
              sourceID: this.id,
              path: `http.${response.status}`,
              expectedType: "2xx successful response",
              actualValueShape: `HTTP ${response.status}`,
              cause: `upstream returned non-retryable status: HTTP ${response.status}`,
            })
          }
          if (response.status >= 500 && attempt < norm.maxRetries) {
            await sleep(backoffMs(attempt))
            continue
          }
          this.requestLog.push({
            ...requestLogBase,
            outcome: "fetch_failed",
            durationMs: Date.now() - start,
            bytesRead: null,
            hash: null,
          })
          throw new ConnectorOperationError({
            kind: "fetch",
            sourceID: this.id,
            url,
            attempts: attempt,
            cause: `HTTP ${response.status}`,
          })
        }

        const reader = response.body?.getReader()
        if (!reader) {
          this.requestLog.push({
            ...requestLogBase,
            outcome: "fetch_failed",
            durationMs: Date.now() - start,
            bytesRead: null,
            hash: null,
          })
          throw new ConnectorOperationError({
            kind: "fetch",
            sourceID: this.id,
            url,
            attempts: attempt,
            cause: "no response body",
          })
        }
        const chunks: Uint8Array[] = []
        let total = 0
        let truncated = false
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value) continue
          total += value.byteLength
          if (total > HTTP_CONNECTOR_MAX_RESPONSE_BYTES) {
            truncated = true
            try { await reader.cancel() } catch { /* noop */ }
            break
          }
          chunks.push(value)
        }
        if (truncated) {
          this.requestLog.push({
            ...requestLogBase,
            outcome: "size_limit",
            durationMs: Date.now() - start,
            bytesRead: total,
            hash: null,
          })
          if (attempt < norm.maxRetries) {
            await sleep(backoffMs(attempt))
            continue
          }
          throw new ConnectorOperationError({
            kind: "fetch",
            sourceID: this.id,
            url,
            attempts: attempt,
            cause: `response exceeded ${HTTP_CONNECTOR_MAX_RESPONSE_BYTES} bytes`,
          })
        }
        const bodyBytes = concatUint8(chunks)
        const raw = new TextDecoder("utf-8").decode(bodyBytes)

        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch (e) {
          this.requestLog.push({
            ...requestLogBase,
            outcome: "parse_failed",
            durationMs: Date.now() - start,
            bytesRead: total,
            hash: null,
          })
          if (attempt < norm.maxRetries) {
            await sleep(backoffMs(attempt))
            continue
          }
          throw new ConnectorOperationError({
            kind: "parse",
            sourceID: this.id,
            line: 1,
            column: 1,
            snippet: raw.slice(0, 80),
            cause: (e as Error).message,
          })
        }

        const envelope = parsed as { provenance?: unknown; payload?: unknown }
        if (!envelope || typeof envelope !== "object" || envelope.provenance === undefined) {
          this.requestLog.push({
            ...requestLogBase,
            outcome: "validation_failed",
            durationMs: Date.now() - start,
            bytesRead: total,
            hash: null,
          })
          throw new ConnectorOperationError({
            kind: "validation",
            sourceID: this.id,
            path: "response.provenance",
            expectedType: "ProvenanceMeta",
            actualValueShape: typeof parsed,
            cause: "response missing provenance field",
          })
        }
        const provParse = ProvenanceMetaSchema.safeParse(envelope.provenance)
        if (!provParse.success) {
          const issue = provParse.error.issues[0]
          this.requestLog.push({
            ...requestLogBase,
            outcome: "validation_failed",
            durationMs: Date.now() - start,
            bytesRead: total,
            hash: null,
          })
          throw new ConnectorOperationError({
            kind: "validation",
            sourceID: this.id,
            path: issue?.path.join(".") ?? "provenance",
            expectedType: "ProvenanceMeta",
            actualValueShape: typeof envelope.provenance,
            cause: issue?.message ?? "provenance invalid",
          })
        }
        const provenance = provParse.data
        if (
          this.licenseCode !== null &&
          provenance.licenseCode !== null &&
          this.licenseCode !== provenance.licenseCode
        ) {
          this.requestLog.push({
            ...requestLogBase,
            outcome: "license_mismatch",
            durationMs: Date.now() - start,
            bytesRead: total,
            hash: null,
          })
          throw new ConnectorOperationError({
            kind: "license_mismatch",
            sourceID: this.id,
            expectedLicense: this.licenseCode,
            actualLicense: provenance.licenseCode,
          })
        }

        await this.snapshotManager.record({
          connectorID: this.id,
          op,
          raw,
          fetchedAtUTC: provenance.fetchedAtUTC,
          sourceURL: url,
        })

        const result = parser(raw, provenance)
        this.requestLog.push({
          ...requestLogBase,
          outcome: "ok",
          durationMs: Date.now() - start,
          bytesRead: total,
          hash: hashOfRaw(raw),
        })
        return result
      } catch (err) {
        if (err instanceof ConnectorOperationError) {
          const detail = err.detail
          const terminal =
            detail.kind === "validation" ||
            detail.kind === "license_mismatch" ||
            detail.kind === "parse" ||
            detail.kind === "timeout" ||
            (detail.kind === "fetch" && attempt >= norm.maxRetries) ||
            detail.kind === "offline_no_cache" ||
            detail.kind === "unauthorized" ||
            detail.kind === "cache_corrupted" ||
            detail.kind === "unknown_provider" ||
            detail.kind === "unknown_model" ||
            detail.kind === "unsupported_version"
          if (terminal) throw err
          lastError = detail
          if (attempt < norm.maxRetries) await sleep(backoffMs(attempt))
          continue
        }
        const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))
        if (isAbort) {
          this.requestLog.push({
            ...logBase,
            attempts: attempt,
            outcome: "aborted",
            durationMs: Date.now() - start,
            bytesRead: null,
            hash: null,
          })
          if (attempt < norm.maxRetries) {
            await sleep(backoffMs(attempt))
            continue
          }
          throw new ConnectorOperationError({
            kind: "timeout",
            sourceID: this.id,
            url,
            attempts: attempt,
            timeoutMs: norm.timeoutMs,
          })
        }
        throw err
      }
    }
    if (lastError) throw new ConnectorOperationError(lastError)
    throw new ConnectorOperationError({
      kind: "fetch",
      sourceID: this.id,
      url,
      attempts: norm.maxRetries,
      cause: "retry exhausted without explicit error",
    })
  }

  private parseAndValidateProvenance(raw: string, op: SnapshotOpKind): ProvenanceMeta {
    try {
      const parsed = JSON.parse(raw) as { provenance?: unknown }
      const r = ProvenanceMetaSchema.safeParse(parsed.provenance)
      if (!r.success) {
        const issue = r.error.issues[0]
        throw new ConnectorOperationError({
          kind: "validation",
          sourceID: this.id,
          path: issue?.path.join(".") ?? `snapshot.${op}.provenance`,
          expectedType: "ProvenanceMeta",
          actualValueShape: typeof parsed.provenance,
          cause: issue?.message ?? "snapshot provenance invalid",
        })
      }
      return r.data
    } catch (e) {
      if (e instanceof ConnectorOperationError) throw e
      throw new ConnectorOperationError({
        kind: "validation",
        sourceID: this.id,
        path: `snapshot.${op}`,
        expectedType: "JSON with provenance",
        actualValueShape: typeof raw,
        cause: (e as Error).message,
      })
    }
  }
}

// =====================================================================
// 3. Parsers typés (un par opération)
// =====================================================================

function parseDiscoverJson(raw: string, prov: ProvenanceMeta): DiscoverResult {
  const parsed = JSON.parse(raw) as { payload?: { providers?: unknown[]; models?: unknown[]; aliases?: unknown[] } }
  const payload = parsed.payload ?? { providers: [], models: [], aliases: [] }
  return {
    providers: (payload.providers ?? []) as DiscoverResult["providers"],
    models: (payload.models ?? []) as DiscoverResult["models"],
    aliases: (payload.aliases ?? []) as DiscoverResult["aliases"],
    warnings: [],
    provenance: prov,
  }
}

function parsePricingJson(raw: string, prov: ProvenanceMeta): PricingResult {
  const parsed = JSON.parse(raw) as { payload?: { pricing?: PricingResult["pricing"] } }
  return {
    pricing: parsed.payload?.pricing ?? [],
    warnings: [],
    provenance: prov,
  }
}

function parseCapabilitiesJson(raw: string, prov: ProvenanceMeta): CapabilitiesResult {
  const parsed = JSON.parse(raw) as { payload?: { capabilities?: CapabilitiesResult["capabilities"] } }
  return {
    capabilities: parsed.payload?.capabilities ?? [],
    warnings: [],
    provenance: prov,
  }
}

function parseStatusJson(raw: string, prov: ProvenanceMeta): StatusResult {
  const parsed = JSON.parse(raw) as { payload?: { status?: StatusResult["status"] } }
  return {
    status: parsed.payload?.status ?? [],
    warnings: [],
    provenance: prov,
  }
}

// =====================================================================
// 4. Helpers publics
// =====================================================================

export function isValidSemver(v: string): boolean {
  // Accepte le format semver strict : 1.2.3, 1.2.3-pre, 1.2.3-pre.1+build,
  // 1.2.3-pre+build.meta.1 (les `-` et `+` peuvent apparaître une fois chacun)
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v)
}

/**
 * Valide une sourceURL contre les vecteurs SSRF connus.
 */
export function validateSourceURL(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error(`HttpConnector: sourceURL is not a valid URL: "${url}"`)
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`HttpConnector: sourceURL must use http or https (got "${u.protocol}")`)
  }
  const host = u.hostname.toLowerCase()
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1" ||
    host === "169.254.169.254" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(host)
  ) {
    throw new Error(`HttpConnector: sourceURL points to a loopback/link-local address (SSRF guard) — got "${host}"`)
  }
}

export function backoffMs(attempt: number): number {
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), 5_000)
  return exp + Math.floor(Math.random() * BACKOFF_JITTER_MS)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function concatUint8(arr: Uint8Array[]): Uint8Array {
  let total = 0
  for (const a of arr) total += a.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arr) {
    out.set(a, offset)
    offset += a.byteLength
  }
  return out
}

export function hashOfRaw(raw: string): string {
  return createHash("sha256").update(raw, "utf-8").digest("hex")
}

function defaultTempRootDir(): string {
  const tmp = process.env["TMPDIR"] ?? process.env["TEMP"] ?? "/tmp"
  return `${tmp}/opencode-c03-snapshots-${process.pid}`
}

// =====================================================================
// 5. Re-exports
// =====================================================================

export { isoUtcNow, SnapshotManager }
export type { SnapshotOpKind, SnapshotRecord }