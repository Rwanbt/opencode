/**
 * sync.ts — TEAM-C07: transactional sync engine (staging + validation +
 * atomic commit + rollback).
 *
 * ---------------------------------------------------------------------
 * Why this file exists instead of fixing Registry.sync()
 * ---------------------------------------------------------------------
 * `registry.ts` is FROZEN for this card (never modified, import type-only
 * if at all). Its `sync()` method (registry.ts:158-206) is a known-
 * incomplete stub: hardcoded to ModelsDevConnector only, its `SyncOptions`
 * (force/staging/validate) is accepted but ignored, and it writes directly
 * via `manager.set(registry)` with no real staging area — `manager` is a
 * private closure variable inside `makeLiveRegistryLayer`, unreachable from
 * outside registry.ts.
 *
 * This module does NOT attempt to patch that stub in place (impossible
 * without editing the frozen file). Instead it is a self-contained,
 * INJECTABLE sync engine: given a `StorageBackend` and a list of sources,
 * it performs real staging (fetch+parse+validate every source fully
 * in-memory before touching storage), real transactional commit (storage
 * is written exactly once, only after every source validated), and real
 * rollback (any failure before that single write leaves the storage
 * backend provably unchanged).
 *
 * Precedent: this is the same dependency-injection resolution used by
 * TEAM-B03's `multi-model/cost-catalog.ts` to consume the C01 registry's
 * shape without importing model-intelligence/ directly — reviewed and
 * praised as "load-bearing, not decorative" rather than a workaround. Here
 * the DI axis is inverted (this module DOES import model-intelligence/
 * infra, since it lives inside model-intelligence/ and the manifest
 * explicitly allows read-only imports of storage.ts/ingestion.ts/
 * connectors/**), but the shape of the resolution is identical: accept
 * collaborators as constructor parameters instead of reaching for a
 * hardcoded singleton, so the engine can be pointed at any StorageBackend
 * and any combination of connectors.
 *
 * ---------------------------------------------------------------------
 * Why this is NOT a second registry
 * ---------------------------------------------------------------------
 * `SyncEngine` persists nothing that model-intelligence/schema.ts doesn't
 * already define: the committed value is always a `Registry` produced by
 * `buildRegistry()` (ingestion.ts, frozen) from `ingest()` output
 * (ingestion.ts, frozen), and it is validated by the exact same
 * `Registry.parse()` / `Model.safeParse()` / `Provider.safeParse()` /
 * `Alias.safeParse()` calls the real registry uses — none of that
 * validation logic is reimplemented here. The engine constructs its own
 * `StorageBackend` instance (as instructed — this is NOT the live
 * singleton's private `manager`, which is unreachable) because there is no
 * production wiring yet connecting a sync engine to the live
 * `LiveRegistryLayer`'s storage: wiring this engine to that singleton is
 * out of scope for this card and is documented below as a followup,
 * exactly like B03 documented CostCatalog's production wiring gap as
 * FU-1/FU-2 rather than reaching into frozen code to invent one.
 *
 * Future integration path (FU-1): a bootstrap/integration card could
 * construct a `SyncEngine` pointed at the SAME `StorageBackend` instance
 * passed into `makeLiveRegistryLayer(storage)` (see registry.ts:76,231-232
 * — `defaultStorage` is already exported and public), and call
 * `engine.sync()` on a schedule. Because `StorageManager` re-reads its
 * backend via `manager.init()` per-instance rather than watching it, the
 * live `RegistryInterface` would need either (a) to re-run `init()` after
 * an external sync, or (b) a small refresh hook added to registry.ts in a
 * FUTURE card (not this one — registry.ts stays frozen here). Documenting
 * this rather than attempting it keeps the "zero second registry" doctrine
 * intact: this card ships the transactional engine, not a live rewiring.
 *
 * Known limitation inherited from frozen `ingest()` (FU-2): `ingest()`
 * (ingestion.ts:91-106) hardcodes the emitted `Source` record's
 * license/copyright/licenseFileURL fields to models.dev's values
 * regardless of which source produced the data. Since `ingest()` cannot be
 * modified here, `mergeIngestResults()` below corrects those three fields
 * per source using the adapter's own already-validated license metadata
 * (`SyncSource.licenseCode/copyrightNotice/licenseFileURL`) — this is
 * enrichment of data already in hand, not a reimplementation of `ingest()`
 * parsing/validation logic.
 *
 * ---------------------------------------------------------------------
 * Staging / validation / commit / rollback design
 * ---------------------------------------------------------------------
 * 1. STAGING — every configured source's `fetchAndParse()` is invoked and
 *    the raw result is run through `ingest()`. Nothing in this phase reads
 *    or writes `this.storage` except the one read of the PREVIOUS snapshot
 *    at the very start (needed for diffing / no-op detection — the
 *    snapshot itself is never mutated).
 * 2. MERGE + BUILD — all staged sources are merged into one candidate
 *    `IngestResult` (last-source-wins per (providerID, modelID) — see
 *    `mergeIngestResults`), then `buildRegistry()` turns it into a
 *    candidate `Registry`, which throws (ZodError) on ANY schema
 *    violation. Still nothing touches storage.
 * 3. VALIDATE — an additional referential-integrity pass
 *    (`assertReferentialIntegrity`) rejects the candidate WHOLESALE if any
 *    model/alias references a providerID that doesn't exist in the merged
 *    provider set. This is the "a partial or inconsistent source must be
 *    rejected wholesale" guarantee: a bad source can corrupt the candidate
 *    in-memory object, but it can never reach storage, because every check
 *    in this phase runs strictly before the one commit call in step 5.
 * 4. STAGING-ONLY short-circuit — `opts.staging: true` returns after step
 *    3 without ever calling `storage.save()`, for dry-run/preview use.
 * 5. COMMIT — `this.storage.save(candidate)` is called EXACTLY ONCE, and
 *    it is the only line in this file that mutates the target storage
 *    backend. Deliberately bypasses `StorageManager.set()`
 *    (storage.ts:75-78), which does `this.registry = registry` BEFORE
 *    awaiting `backend.save(registry)` — if `save()` throws, that manager
 *    instance's in-memory cache would already point at the unpersisted
 *    candidate while the backend itself still holds the old data. Calling
 *    the raw `StorageBackend.save()` here avoids ever creating that
 *    inconsistent window; the engine keeps no such dual-state cache of its
 *    own.
 * 6. ROLLBACK — the `faultInjector` hook is invoked at four fixed
 *    checkpoints ("after-staging", "after-validation", "before-commit",
 *    "after-commit"). Tests inject a throwing hook to simulate a crash at
 *    each checkpoint and assert `storage.load()` still returns the
 *    pre-sync snapshot for every checkpoint at or before "before-commit" —
 *    this is real proof (see sync.test.ts), not an untested claim, because
 *    the assertion reads the raw backend, not any engine-side cache.
 *
 * ---------------------------------------------------------------------
 * Scope (TEAM-C07 manifest)
 * ---------------------------------------------------------------------
 * Allowed to create: sync.ts, test/model-intelligence/sync.test.ts.
 * Imports read-only from: storage.ts, ingestion.ts, schema.ts, source.ts,
 * events.ts, errors.ts, connectors/** (modelsdev.ts, registry.ts, types.ts,
 * http-connector.ts, snapshot-manager.ts). Never imports multi-model/** or
 * team/**. Never modifies registry.ts.
 */

import type { StorageBackend } from "./storage"
import { ingest, buildRegistry, type IngestResult } from "./ingestion"
import type { Registry, Model, Provider, Alias, Source, ProvenanceRecord, HealthSnapshot } from "./schema"
import { isoUtcNow } from "./schema"
import { type SourceConnector, type ParsedSource, canonicalParseOptions } from "./source"
import type { Connector, ConnectorFetchOptions } from "./connectors/types"
import { toC01ParsedSource } from "./connectors/registry"
import { defaultBus, type EventBus } from "./events"
import { SourceFetchError, SourceParseError, SourceValidationError } from "./errors"

// =====================================================================
// 1. SyncSource — uniform adapter over C01/C02/C03 connector shapes
// =====================================================================

/**
 * Parser version stamped on sources adapted through this engine. Distinct
 * from any individual connector's own `parserVersion` (which is preserved
 * inside the `ParsedSource.metadata` each adapter produces) — this
 * constant only feeds `canonicalParseOptions()` for the C01-shaped
 * `SourceConnector` adapter path, matching how `registry.ts:171` calls it.
 */
export const SYNC_ENGINE_PARSER_VERSION = "1.0.0"

/**
 * A source the engine can stage. Deliberately narrow: `fetchAndParse()` is
 * the only operation the engine needs, so any of C01's `SourceConnector`,
 * C02's `Connector`, or C03's `HttpConnector` (which also implements
 * `Connector`) can be adapted into this shape without the engine knowing
 * which concrete transport produced the data.
 */
export interface SyncSource {
  readonly id: string
  readonly licenseCode: string | null
  readonly copyrightNotice: string | null
  readonly licenseFileURL: string | null
  readonly confidenceLevel: "official" | "community" | "unverified"
  fetchAndParse(): Promise<ParsedSource>
}

/**
 * Adapts a C01 `SourceConnector` (e.g. `ModelsDevConnector`) into a
 * `SyncSource`. Mirrors registry.ts:170-172's own fetch→parse sequence
 * exactly, so behavior for the models.dev path is unchanged.
 */
export function adaptSourceConnector(
  connector: SourceConnector,
  parserVersion: string = SYNC_ENGINE_PARSER_VERSION,
): SyncSource {
  return {
    id: connector.id,
    licenseCode: connector.licenseCode,
    copyrightNotice: connector.copyrightNotice,
    licenseFileURL: connector.licenseFileURL,
    confidenceLevel: connector.confidenceLevel,
    async fetchAndParse(): Promise<ParsedSource> {
      const raw = await connector.fetch()
      const opts = canonicalParseOptions(connector.id, parserVersion, raw)
      return connector.parse(raw, opts)
    },
  }
}

/**
 * Adapts a C02/C03 `Connector` (generic catalog connector, HTTP connector
 * with snapshot fallback, `FakeConnector`, ...) into a `SyncSource` via
 * `discover()` + `toC01ParsedSource()` (connectors/registry.ts, the
 * documented C02→C01 bridge — reused here, not reimplemented).
 */
export function adaptGenericConnector(connector: Connector, fetchOpts?: ConnectorFetchOptions): SyncSource {
  return {
    id: connector.id,
    licenseCode: connector.licenseCode,
    copyrightNotice: connector.copyrightNotice,
    licenseFileURL: connector.licenseFileURL,
    confidenceLevel: connector.confidenceLevel,
    async fetchAndParse(): Promise<ParsedSource> {
      const result = await connector.discover(fetchOpts)
      return toC01ParsedSource(result)
    },
  }
}

// =====================================================================
// 2. Options / results
// =====================================================================

export interface SyncEngineOptions {
  /**
   * When a source fails to fetch/parse: without `force`, the ENTIRE sync
   * aborts immediately (storage untouched). With `force`, the failed
   * source is skipped and staging continues with the remaining sources
   * (as long as at least one source succeeds). Default false.
   */
  force?: boolean
  /**
   * When true, runs staging + merge + build + validation but never calls
   * `storage.save()` — a dry-run / preview mode. Default false.
   */
  staging?: boolean
  /**
   * Schema-level validation (`ingest()`'s Zod safeParse + `buildRegistry`'s
   * `Registry.parse`) can NEVER be disabled — that would violate the
   * CRITICAL-risk "no partial commit" guarantee this card exists to
   * provide. This flag only toggles the EXTRA referential-integrity pass
   * (`assertReferentialIntegrity`) layered on top. Default true.
   */
  validate?: boolean
}

export type SyncPhase = "after-staging" | "after-validation" | "before-commit" | "after-commit"

/**
 * Test-only fault-injection hook. Production callers never need to pass
 * one (defaults to a no-op). Throwing from this hook at any phase up to
 * and including "before-commit" is how sync.test.ts proves the storage
 * backend is left untouched by a mid-sync crash.
 */
export type FaultInjector = (phase: SyncPhase) => void | Promise<void>

export interface SyncSourceOutcome {
  sourceID: string
  status: "ok" | "failed"
  providersCount: number
  modelsCount: number
  aliasesCount: number
  skippedCount: number
  durationMs: number
  errorMessage: string | null
}

export interface SyncDiff {
  modelsAdded: Array<{ providerID: string; modelID: string }>
  modelsRemoved: Array<{ providerID: string; modelID: string }>
  modelsChanged: Array<{ providerID: string; modelID: string }>
  modelsNewlyDeprecated: Array<{ providerID: string; modelID: string }>
  providersAdded: string[]
  providersRemoved: string[]
  providersChanged: string[]
  aliasesAdded: string[]
  aliasesRemoved: string[]
  aliasesChanged: string[]
  /**
   * Source ids whose record is new or differs in ANY non-volatile field
   * (not just `licenseCode`) from the previous sync — see
   * `SOURCE_VOLATILE_FIELDS`. This is the field `isDiffEmpty()` checks for
   * no-op detection; `licenseChanges` below stays narrowly scoped to
   * `licenseCode` because that's the only pair of fields the existing
   * `source.license.changed` event (events.ts) can carry.
   */
  sourcesChanged: string[]
  licenseChanges: Array<{ sourceID: string; oldLicense: string | null; newLicense: string | null }>
}

/**
 * True iff `diff` represents zero meaningful content change, AS MEASURED BY
 * `computeDiff()`'s field-by-field comparison below. Deliberately NOT based
 * on `Registry.registryID` — `buildRegistry()` (ingestion.ts, frozen)
 * computes `registryID` as `hashContent(JSON.stringify({ p:
 * providers.length, m: models.length }))` (ingestion.ts:156), i.e. a hash
 * of two COUNTS, not of actual content. Two registries with the same
 * provider/model counts but different pricing, capabilities, or status
 * would collide on that hash — using it for no-op detection would risk
 * silently skipping a real change.
 *
 * The comparison itself (`modelContentEqual` / `providerContentEqual` /
 * the `sourcesChanged` computation below) is a DENYLIST over each schema:
 * every field is compared UNLESS it is on an explicit, justified
 * volatile-field list (see `MODEL_VOLATILE_FIELDS` /
 * `PROVIDER_VOLATILE_FIELDS` / `SOURCE_VOLATILE_FIELDS`). This is the
 * corrected design after an independent E2 review (finding B-1) found an
 * earlier field-ALLOWLIST version of this comparison silently discarded 17
 * classes of real upstream change (e.g. `lifecycleStage` transitioning to
 * `quarantined`, `regionPolicy.dataResidencyRequired`, `Source.
 * confidenceLevel` downgrades) because those fields simply weren't in the
 * hand-picked list of compared fields — an allowlist fails OPEN on schema
 * growth (every new field is silently excluded until someone remembers to
 * add it). A denylist fails CLOSED: any field not proven to be pure
 * fetch/observation bookkeeping participates in the comparison by default,
 * including fields added to the schema after this code was written.
 */
function isDiffEmpty(diff: SyncDiff): boolean {
  return (
    diff.modelsAdded.length === 0 &&
    diff.modelsRemoved.length === 0 &&
    diff.modelsChanged.length === 0 &&
    diff.providersAdded.length === 0 &&
    diff.providersRemoved.length === 0 &&
    diff.providersChanged.length === 0 &&
    diff.aliasesAdded.length === 0 &&
    diff.aliasesRemoved.length === 0 &&
    diff.aliasesChanged.length === 0 &&
    diff.sourcesChanged.length === 0
  )
}

export interface SyncEngineResult {
  /** True only if `storage.save()` was actually called and succeeded. */
  committed: boolean
  totalDurationMs: number
  sources: SyncSourceOutcome[]
  merged: {
    providersCount: number
    modelsCount: number
    aliasesCount: number
    skippedCount: number
  }
  /** Hash of the committed registry, or null if nothing was committed. */
  registryID: string | null
  previousRegistryID: string | null
  diff: SyncDiff
}

// =====================================================================
// 3. Merge — combine N staged IngestResults into one candidate
// =====================================================================

interface StagedEntry {
  sourceID: string
  ingested: IngestResult
  adapter: SyncSource
}

/**
 * Last-source-wins merge, keyed by `id` for providers/aliases and
 * `${providerID}/${id}` for models. Source order == precedence order (the
 * order sources were passed to the `SyncEngine` constructor): a later
 * source's entry for the same key overrides an earlier one. This mirrors
 * ordinary config-layering semantics and is documented explicitly because
 * it is a real design decision, not an accident of `Map` insertion order.
 */
function mergeIngestResults(staged: StagedEntry[]): IngestResult {
  const providerMap = new Map<string, Provider>()
  const modelMap = new Map<string, Model>()
  const aliasMap = new Map<string, Alias>()
  const sources: Source[] = []
  const provenances: ProvenanceRecord[] = []
  const skipped: IngestResult["skipped"] = []

  for (const { adapter, ingested } of staged) {
    for (const p of ingested.providers) providerMap.set(p.id, p)
    for (const m of ingested.models) modelMap.set(`${m.providerID}/${m.id}`, m)
    for (const a of ingested.aliases) aliasMap.set(a.alias, a)
    for (const s of ingested.sources) {
      // See "Known limitation inherited from frozen ingest()" in the file
      // header: ingest() hardcodes license metadata to models.dev's
      // values. Correct it here using the adapter's own validated
      // metadata rather than trusting ingest()'s hardcoded fields.
      sources.push({
        ...s,
        licenseCode: adapter.licenseCode,
        copyrightNotice: adapter.copyrightNotice,
        licenseFileURL: adapter.licenseFileURL,
        confidenceLevel: adapter.confidenceLevel,
      })
    }
    provenances.push(...ingested.provenances)
    for (const sk of ingested.skipped) {
      skipped.push({ kind: sk.kind, id: sk.id, reason: `[${adapter.id}] ${sk.reason}` })
    }
  }

  const providers = [...providerMap.values()]
  const models = [...modelMap.values()]
  const aliases = [...aliasMap.values()]

  return {
    providers,
    models,
    aliases,
    sources,
    provenances,
    health: computeMergedHealth(providers, models, aliases),
    skipped,
  }
}

/**
 * Recomputes the health snapshot over the MERGED result. `ingest()`
 * computes health per-source (ingestion.ts:127-135), which no longer
 * applies once N sources are combined into one candidate — this recreates
 * the exact same trivial derived-count formula (not a reimplementation of
 * any validation or business rule) because merging necessarily changes the
 * counts it aggregates.
 */
function computeMergedHealth(providers: Provider[], models: Model[], aliases: Alias[]): HealthSnapshot {
  const activeModels = models.filter((m) => m.status === "active").length
  const deprecatedModels = models.filter((m) => m.status === "deprecated").length
  const missingPricingModels = models.filter((m) => m.pricing.input === 0 && m.pricing.output === 0).length
  return {
    snapshotAtUTC: isoUtcNow(),
    totalProviders: providers.length,
    totalModels: models.length,
    activeModels,
    deprecatedModels,
    missingPricingModels,
    aliasesResolved: aliases.filter((a) => !a.deprecated).length,
  }
}

/**
 * Fail-closed referential integrity: every model must reference a
 * providerID present in the merged provider set, and every alias must
 * resolve to a (providerID, modelID) pair present in the merged model
 * set. A single dangling reference rejects the WHOLE candidate — this is
 * the "inconsistent source rejected wholesale" guarantee at the
 * cross-source level (schema-level per-item validation already happened
 * inside `ingest()`; this catches inconsistency that only appears once
 * providers/models from potentially DIFFERENT sources are combined).
 */
function assertReferentialIntegrity(providers: Provider[], models: Model[], aliases: Alias[]): void {
  const providerIDs = new Set(providers.map((p) => p.id))
  for (const m of models) {
    if (!providerIDs.has(m.providerID)) {
      throw new SourceValidationError({
        sourceID: "sync-engine:merged",
        path: `models[${m.providerID}/${m.id}].providerID`,
        expectedType: "providerID present in merged provider set",
        actualValue: m.providerID,
        message: `model "${m.providerID}/${m.id}" references unknown provider "${m.providerID}" — rejecting sync wholesale, storage left untouched`,
      })
    }
  }
  const modelKeys = new Set(models.map((m) => `${m.providerID}/${m.id}`))
  for (const a of aliases) {
    const ref = `${a.canonicalRef.providerID}/${a.canonicalRef.modelID}`
    if (!modelKeys.has(ref)) {
      throw new SourceValidationError({
        sourceID: "sync-engine:merged",
        path: `aliases[${a.alias}].canonicalRef`,
        expectedType: "canonicalRef resolving to a merged model",
        actualValue: ref,
        message: `alias "${a.alias}" references unknown model "${ref}" — rejecting sync wholesale, storage left untouched`,
      })
    }
  }
}

// =====================================================================
// 4. Diff — previous Registry (or null) vs candidate Registry
// =====================================================================

// ---------------------------------------------------------------------
// Content equality — DENYLIST over each schema, not an allowlist.
//
// Post-review fix (E2 finding B-1): an earlier version of this file
// compared a hand-picked subset of fields per type (an allowlist). That
// silently discarded every real content change landing in an uncompared
// field — 17 confirmed cases, including a model transitioning to
// `lifecycleStage: "quarantined"`, a provider's
// `regionPolicy.dataResidencyRequired`, and a source's `confidenceLevel`
// downgrading from `official` to `unverified` — and, worse, it FAILS OPEN
// on schema growth: any field added to Model/Provider/Source in the
// future would be silently excluded from change detection until someone
// remembered to add it to the allowlist.
//
// The fix inverts this: compare a canonical (JSON.stringify) serialization
// of the WHOLE object, after stripping only fields explicitly proven to be
// pure fetch/observation bookkeeping that legitimately changes on every
// sync run regardless of real content (a denylist). Any field not on one
// of the lists below — including one added to the schema after this code
// was written — participates in the comparison by default, so the failure
// mode is now "compare a harmless bookkeeping field and over-trigger a
// commit" (safe: costs one extra write) rather than "silently drop a real
// change" (unsafe: the defect this fix exists to close).
// ---------------------------------------------------------------------

/**
 * Model fields that legitimately change on every sync regardless of
 * whether the model's actual catalog content changed: `sourceRefs` and
 * `provenance` carry per-fetch hashes/timestamps, `health` is live-probe
 * telemetry (owned by C06, unrelated to catalog content), and
 * `lastSeenAtUTC` is a bookkeeping stamp. These are the ONLY four fields
 * excluded — every other Model field (including `family`, `aliases`,
 * `modalities`, `reasoning`, `toolUse`, `temperature`, `lifecycleStage`,
 * `releaseDateUTC`, `retirementDateUTC` — the fields the allowlist version
 * missed) is compared.
 */
const MODEL_VOLATILE_FIELDS = ["sourceRefs", "health", "provenance", "lastSeenAtUTC"] as const

/**
 * Provider has no `health`/`provenance`/`sourceRefs` (those are
 * Model-only). The one genuinely volatile field is `addedAtUTC`: despite
 * its name suggesting an immutable "first observed" stamp,
 * `ModelsDevConnector` (connectors/modelsdev.ts, frozen, read-only import)
 * populates it with `opts.sourceVersion` — the CURRENT fetch's
 * timestamp — on every single parse call, not a value fixed at first
 * discovery. It therefore changes on every real sync run regardless of
 * whether the provider's actual content changed, exactly like Model's
 * `lastSeenAtUTC`. Every other Provider field (`sdk`, `envVars`,
 * `deprecationReason`, `removedAtUTC`, `docsURL`, `privacyPolicyRef`,
 * `regionPolicy`, `aliases` — the fields the allowlist version missed) is
 * compared.
 */
const PROVIDER_VOLATILE_FIELDS = ["addedAtUTC"] as const

/**
 * `Source` (unlike Model/Provider) has no field that auto-updates on every
 * fetch: `ingest()` (ingestion.ts, frozen) hardcodes `url`/`type`/
 * `policyDocRef` to fixed constants and copies `parserVersion` from the
 * source's own declared metadata, not a live timestamp. Every field —
 * including `confidenceLevel`, `copyrightNotice`, `licenseFileURL`,
 * `deprecated`, `rollbackPolicy` (the fields the allowlist version
 * missed) — is genuine content, so the denylist is intentionally empty.
 */
const SOURCE_VOLATILE_FIELDS: readonly string[] = []

function stripVolatileFields<T extends Record<string, unknown>>(obj: T, volatile: readonly string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj }
  for (const field of volatile) delete copy[field]
  return copy
}

function canonicalContentEqual<T extends Record<string, unknown>>(a: T, b: T, volatile: readonly string[]): boolean {
  return JSON.stringify(stripVolatileFields(a, volatile)) === JSON.stringify(stripVolatileFields(b, volatile))
}

function modelContentEqual(a: Model, b: Model): boolean {
  return canonicalContentEqual(a, b, MODEL_VOLATILE_FIELDS)
}

function providerContentEqual(a: Provider, b: Provider): boolean {
  return canonicalContentEqual(a, b, PROVIDER_VOLATILE_FIELDS)
}

function sourceContentEqual(a: Source, b: Source): boolean {
  return canonicalContentEqual(a, b, SOURCE_VOLATILE_FIELDS)
}

function aliasContentEqual(a: Alias, b: Alias): boolean {
  // Already exhaustive over Alias's non-key fields (canonicalRef,
  // deprecated, replacedBy — Alias has no volatile bookkeeping field) —
  // independently re-verified during the B-1 review and left unchanged.
  return (
    a.canonicalRef.providerID === b.canonicalRef.providerID &&
    a.canonicalRef.modelID === b.canonicalRef.modelID &&
    a.deprecated === b.deprecated &&
    JSON.stringify(a.replacedBy) === JSON.stringify(b.replacedBy)
  )
}

function computeDiff(previous: Registry | null, candidate: Registry): SyncDiff {
  const prevModels = new Map(previous?.models.map((m) => [`${m.providerID}/${m.id}`, m]) ?? [])
  const candModels = new Map(candidate.models.map((m) => [`${m.providerID}/${m.id}`, m]))

  const modelsAdded: SyncDiff["modelsAdded"] = []
  const modelsChanged: SyncDiff["modelsChanged"] = []
  const modelsNewlyDeprecated: SyncDiff["modelsNewlyDeprecated"] = []

  for (const [key, m] of candModels) {
    const prev = prevModels.get(key)
    if (!prev) {
      modelsAdded.push({ providerID: m.providerID, modelID: m.id })
      continue
    }
    if (!modelContentEqual(prev, m)) {
      modelsChanged.push({ providerID: m.providerID, modelID: m.id })
    }
    if (prev.status !== "deprecated" && m.status === "deprecated") {
      modelsNewlyDeprecated.push({ providerID: m.providerID, modelID: m.id })
    }
  }

  const modelsRemoved: SyncDiff["modelsRemoved"] = []
  for (const [key, m] of prevModels) {
    if (!candModels.has(key)) modelsRemoved.push({ providerID: m.providerID, modelID: m.id })
  }

  const prevProviders = new Map(previous?.providers.map((p) => [p.id, p]) ?? [])
  const candProviders = new Map(candidate.providers.map((p) => [p.id, p]))
  const providersAdded: string[] = []
  const providersChanged: string[] = []
  for (const [id, p] of candProviders) {
    const prev = prevProviders.get(id)
    if (!prev) {
      providersAdded.push(id)
    } else if (!providerContentEqual(prev, p)) {
      providersChanged.push(id)
    }
  }
  const providersRemoved = [...prevProviders.keys()].filter((id) => !candProviders.has(id))

  const prevAliases = new Map(previous?.aliases.map((a) => [a.alias, a]) ?? [])
  const candAliases = new Map(candidate.aliases.map((a) => [a.alias, a]))
  const aliasesAdded: string[] = []
  const aliasesChanged: string[] = []
  for (const [alias, a] of candAliases) {
    const prev = prevAliases.get(alias)
    if (!prev) {
      aliasesAdded.push(alias)
    } else if (!aliasContentEqual(prev, a)) {
      aliasesChanged.push(alias)
    }
  }
  const aliasesRemoved = [...prevAliases.keys()].filter((alias) => !candAliases.has(alias))

  const licenseChanges: SyncDiff["licenseChanges"] = []
  if (previous) {
    const prevLicenses = new Map(previous.sources.map((s) => [s.id, s.licenseCode]))
    for (const s of candidate.sources) {
      const old = prevLicenses.get(s.id)
      if (old !== undefined && old !== s.licenseCode) {
        licenseChanges.push({ sourceID: s.id, oldLicense: old, newLicense: s.licenseCode })
      }
    }
  }

  // Full Source content diff (superset of licenseChanges above — see
  // SOURCE_VOLATILE_FIELDS' doc comment: every Source field is content).
  // This is what isDiffEmpty() actually gates on.
  const prevSources = new Map(previous?.sources.map((s) => [s.id, s]) ?? [])
  const sourcesChanged: string[] = []
  for (const s of candidate.sources) {
    const prev = prevSources.get(s.id)
    if (!prev || !sourceContentEqual(prev, s)) {
      sourcesChanged.push(s.id)
    }
  }

  return {
    modelsAdded,
    modelsRemoved,
    modelsChanged,
    modelsNewlyDeprecated,
    providersAdded,
    providersRemoved,
    providersChanged,
    aliasesAdded,
    aliasesRemoved,
    aliasesChanged,
    sourcesChanged,
    licenseChanges,
  }
}

// =====================================================================
// 5. SyncEngine
// =====================================================================

export interface SyncEngineConfig {
  /**
   * The storage backend this engine reads from and (on successful commit)
   * writes to. Caller-owned: this is explicitly NOT
   * `registry.ts`'s private `manager`/`defaultStorage` singleton unless
   * the caller deliberately passes `defaultStorage` in (see FU-1 in the
   * file header) — the engine has no implicit binding to the live
   * registry.
   */
  storage: StorageBackend
  /** At least one source is required. Order = merge precedence (last wins). */
  sources: SyncSource[]
  /** Defaults to `defaultBus` (events.ts). Inject an isolated `EventBus` in tests to avoid cross-test listener leakage. */
  bus?: EventBus
  /** Test-only. Defaults to a no-op. */
  faultInjector?: FaultInjector
}

export class SyncEngine {
  private readonly storage: StorageBackend
  private readonly sources: SyncSource[]
  private readonly bus: EventBus
  private readonly faultInjector: FaultInjector

  constructor(config: SyncEngineConfig) {
    if (config.sources.length === 0) {
      throw new Error("SyncEngine: at least one source is required")
    }
    this.storage = config.storage
    this.sources = config.sources
    this.bus = config.bus ?? defaultBus
    this.faultInjector = config.faultInjector ?? (() => {})
  }

  async sync(opts: SyncEngineOptions = {}): Promise<SyncEngineResult> {
    const start = Date.now()
    const force = opts.force ?? false
    const stagingOnly = opts.staging ?? false
    const validate = opts.validate ?? true

    // ---- 0. Read (never mutate) the previous snapshot, if any. ----
    const previous = await this.storage.load()

    // ---- 1. STAGING: fetch + parse + ingest every source. No write. ----
    const outcomes: SyncSourceOutcome[] = []
    const staged: StagedEntry[] = []
    for (const source of this.sources) {
      const sourceStart = Date.now()
      await this.bus.publish({ type: "model-intelligence.sync.started", sourceID: source.id, atUTC: isoUtcNow() })
      try {
        const parsed = await source.fetchAndParse()
        const ingested = ingest(parsed)
        staged.push({ sourceID: source.id, ingested, adapter: source })
        outcomes.push({
          sourceID: source.id,
          status: "ok",
          providersCount: ingested.providers.length,
          modelsCount: ingested.models.length,
          aliasesCount: ingested.aliases.length,
          skippedCount: ingested.skipped.length,
          durationMs: Date.now() - sourceStart,
          errorMessage: null,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        outcomes.push({
          sourceID: source.id,
          status: "failed",
          providersCount: 0,
          modelsCount: 0,
          aliasesCount: 0,
          skippedCount: 0,
          durationMs: Date.now() - sourceStart,
          errorMessage: message,
        })
        await this.bus.publish({ type: "model-intelligence.sync.failed", sourceID: source.id, error: message, atUTC: isoUtcNow() })
        if (!force) {
          throw wrapSourceFailure(source.id, e, message)
        }
        // force=true: this source is skipped; staging continues.
      }
    }

    if (staged.length === 0) {
      throw new SourceValidationError({
        sourceID: "sync-engine:merged",
        path: "sources",
        expectedType: "at least one successfully staged source",
        actualValue: "0",
        message: "every configured source failed — aborting sync, storage left untouched",
      })
    }

    await this.faultInjector("after-staging")

    // ---- 2. MERGE + BUILD (still entirely in-memory). ----
    const mergedIngest = mergeIngestResults(staged)
    const candidate = buildRegistry(mergedIngest)

    // ---- 3. Extra cross-source validation. ----
    if (validate) {
      assertReferentialIntegrity(candidate.providers, candidate.models, candidate.aliases)
    }

    await this.faultInjector("after-validation")

    const diff = computeDiff(previous, candidate)
    const mergedCounts = {
      providersCount: candidate.providers.length,
      modelsCount: candidate.models.length,
      aliasesCount: candidate.aliases.length,
      skippedCount: mergedIngest.skipped.length,
    }

    // ---- 4. staging-only short-circuit: never calls storage.save(). ----
    if (stagingOnly) {
      return {
        committed: false,
        totalDurationMs: Date.now() - start,
        sources: outcomes,
        merged: mergedCounts,
        registryID: null,
        previousRegistryID: previous?.registryID ?? null,
        diff,
      }
    }

    // ---- 4b. no-op short-circuit (unless force): identical content, skip write. ----
    // Uses `isDiffEmpty(diff)`, NOT `previous.registryID === candidate.registryID` —
    // see isDiffEmpty()'s doc comment for why registryID (a hash of counts,
    // not content) would be unsound here.
    if (!force && previous && isDiffEmpty(diff)) {
      return {
        committed: false,
        totalDurationMs: Date.now() - start,
        sources: outcomes,
        merged: mergedCounts,
        registryID: previous.registryID,
        previousRegistryID: previous.registryID,
        diff,
      }
    }

    await this.faultInjector("before-commit")

    // ---- 5. ATOMIC COMMIT — the ONLY line in this method that mutates `this.storage`. ----
    try {
      await this.storage.save(candidate)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await this.bus.publish({ type: "model-intelligence.sync.failed", sourceID: "sync-engine:commit", error: message, atUTC: isoUtcNow() })
      throw new SourceValidationError({
        sourceID: "sync-engine:commit",
        path: "storage.save",
        expectedType: "successful persist",
        actualValue: message,
        message: `commit failed: ${message} — no in-memory cache was advanced ahead of this call, so this engine holds no inconsistent state`,
      })
    }

    await this.faultInjector("after-commit")

    await this.publishDiffEvents(diff)
    for (const o of outcomes) {
      if (o.status === "ok") {
        await this.bus.publish({ type: "model-intelligence.sync.completed", sourceID: o.sourceID, durationMs: o.durationMs, atUTC: isoUtcNow() })
      }
    }

    return {
      committed: true,
      totalDurationMs: Date.now() - start,
      sources: outcomes,
      merged: mergedCounts,
      registryID: candidate.registryID,
      previousRegistryID: previous?.registryID ?? null,
      diff,
    }
  }

  private async publishDiffEvents(diff: SyncDiff): Promise<void> {
    for (const m of diff.modelsAdded) {
      await this.bus.publish({ type: "model-intelligence.model.added", providerID: m.providerID, modelID: m.modelID, atUTC: isoUtcNow() })
    }
    for (const m of diff.modelsNewlyDeprecated) {
      await this.bus.publish({
        type: "model-intelligence.model.deprecated",
        providerID: m.providerID,
        modelID: m.modelID,
        replacedBy: null,
        atUTC: isoUtcNow(),
      })
    }
    for (const lc of diff.licenseChanges) {
      await this.bus.publish({
        type: "model-intelligence.source.license.changed",
        sourceID: lc.sourceID,
        oldLicense: lc.oldLicense,
        newLicense: lc.newLicense,
        atUTC: isoUtcNow(),
      })
    }
  }
}

function wrapSourceFailure(sourceID: string, cause: unknown, message: string): Error {
  if (cause instanceof SourceParseError || cause instanceof SourceFetchError || cause instanceof SourceValidationError) {
    return cause
  }
  return new SourceFetchError({
    sourceID,
    url: "",
    httpStatus: null,
    attempts: 1,
    message: `sync aborted: source "${sourceID}" failed and force=false — storage left untouched (${message})`,
  })
}
