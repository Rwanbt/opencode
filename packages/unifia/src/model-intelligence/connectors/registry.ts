/**
 * ConnectorRegistry + FakeConnector (TEAM-C02).
 *
 * Ce module IMPLÉMENTE le contrat défini dans ./types.ts :
 *   - Allowlist de connecteurs autorisés (mécanisme de sécurité
 *     contre l'enregistrement de connecteurs arbitraires).
 *   - Cache des derniers résultats valides, avec invalidation explicite
 *     (par id) ou automatique (sur changement de version).
 *   - Restauration du dernier snapshot valide si un connecteur échoue
 *     (degraded mode), avec émission d'un ConnectorError typé pour
 *     signaler la dégradation (jamais silencieuse).
 *   - Vérification systématique de la provenance avant de servir un
 *     résultat (fail-closed).
 *   - FakeConnector déterministe, offline, pour les tests unitaires et
 *     d'intégration. Aucune dépendance réseau non contrôlée.
 *
 * Doctrine respectée :
 *   - Pas de second registry : ce module ne stocke AUCUNE liste de
 *     modèles. Il NE PRODUIT QUE des résultats normalisés, qui seront
 *     éventuellement ingérés par le registry C01 (via ingest() +
 *     buildRegistry()) si le consommateur le décide.
 *   - A06 Décision 4 + D-035 : zéro liste de modèles statique ici.
 *   - A05 audit F-A05-1..6 : chaque résultat porte licenseCode,
 *     copyrightNotice, licenseFileURL.
 *   - F-B01-001 (Wave followup) : ce module est explicitement la couche
 *     où la consommation C01 démarre réellement (cf. fonction
 *     `toC01ParsedSource` qui adapte un DiscoverResult vers le format
 *     ParsedSource ingérable par ingest()).
 *
 * Allowed par TEAM-C02 scope manifest :
 *   - création : packages/unifia/src/model-intelligence/connectors/registry.ts
 */

import {
  type Connector,
  type ConnectorError,
  type ConnectorFetchOptions,
  type DiscoverResult,
  type PricingResult,
  type CapabilitiesResult,
  type StatusResult,
  type ProvenanceMeta,
  ConnectorOperationError,
  DEFAULT_CONNECTOR_FETCH_OPTIONS,
  MAX_RETRIES_CAP,
  assertCompatibleParserVersion,
  assertValidProvenance,
  normalizeConnectorFetchOptions,
} from "./types"
import { hashContent } from "../source"
import { isoUtcNow } from "../schema"

// =====================================================================
// 1. Allowlist — sécurité d'enregistrement
// =====================================================================

/**
 * Allowlist de connecteurs autorisés.
 *
 * Deux modes :
 *   - `BUILTIN` : ids de confiance (ex. `fake` pour les tests, ids
 *     officiels ajoutés après audit).
 *   - `TEST_PREFIX` : préfixe réservé aux connecteurs de tests
 *     dynamiques (ex. `test:foo`, `test:bar`). Toute chaîne
 *     commençant par ce préfixe est acceptée en mode test uniquement.
 *
 * L'enregistrement d'un connector hors allowlist lève
 * ConnectorOperationError(kind="unauthorized").
 */
const BUILTIN_ALLOWLIST: ReadonlySet<string> = new Set(["fake"])
const TEST_PREFIX = "test:"

export function isAllowedConnectorID(id: string, allowTestPrefix: boolean = false): boolean {
  if (BUILTIN_ALLOWLIST.has(id)) return true
  if (allowTestPrefix && id.startsWith(TEST_PREFIX)) return true
  return false
}

// =====================================================================
// 2. Cache des derniers résultats valides (par opération)
// =====================================================================

type OpKind = "discover" | "pricing" | "capabilities" | "status"

interface CacheEntry<T> {
  value: T
  fetchedAtUTC: string
  sourceVersion: string
  rawHash: string
}

interface CacheBag {
  discover?: CacheEntry<DiscoverResult>
  pricing?: CacheEntry<PricingResult>
  capabilities?: CacheEntry<CapabilitiesResult>
  status?: CacheEntry<StatusResult>
}

class ResultCache {
  private readonly map = new Map<string, CacheBag>()

  has(connectorID: string): boolean {
    return this.map.has(connectorID)
  }

  getBag(connectorID: string): CacheBag | undefined {
    return this.map.get(connectorID)
  }

  setDiscover(connectorID: string, entry: CacheEntry<DiscoverResult>): void {
    let bag = this.map.get(connectorID)
    if (!bag) {
      bag = {}
      this.map.set(connectorID, bag)
    }
    bag.discover = entry
  }

  setPricing(connectorID: string, entry: CacheEntry<PricingResult>): void {
    let bag = this.map.get(connectorID)
    if (!bag) {
      bag = {}
      this.map.set(connectorID, bag)
    }
    bag.pricing = entry
  }

  setCapabilities(connectorID: string, entry: CacheEntry<CapabilitiesResult>): void {
    let bag = this.map.get(connectorID)
    if (!bag) {
      bag = {}
      this.map.set(connectorID, bag)
    }
    bag.capabilities = entry
  }

  setStatus(connectorID: string, entry: CacheEntry<StatusResult>): void {
    let bag = this.map.get(connectorID)
    if (!bag) {
      bag = {}
      this.map.set(connectorID, bag)
    }
    bag.status = entry
  }

  invalidate(connectorID: string, op?: OpKind): void {
    if (!op) {
      this.map.delete(connectorID)
      return
    }
    const bag = this.map.get(connectorID)
    if (!bag) return
    delete bag[op]
    if (Object.keys(bag).length === 0) this.map.delete(connectorID)
  }

  clear(): void {
    this.map.clear()
  }

  size(): number {
    return this.map.size
  }
}

// =====================================================================
// 3. Snapshot de fallback (last-valid)
// =====================================================================

interface LastValidSnapshot {
  discover?: DiscoverResult
  pricing?: PricingResult
  capabilities?: CapabilitiesResult
  status?: StatusResult
  recordedAtUTC: string
  sourceVersion: string
}

class LastValidStore {
  private readonly map = new Map<string, LastValidSnapshot>()

  record(connectorID: string, op: OpKind, value: unknown, sourceVersion: string): void {
    let snap = this.map.get(connectorID)
    if (!snap) {
      snap = { recordedAtUTC: isoUtcNow(), sourceVersion }
      this.map.set(connectorID, snap)
    }
    if (op === "discover") snap.discover = value as DiscoverResult
    else if (op === "pricing") snap.pricing = value as PricingResult
    else if (op === "capabilities") snap.capabilities = value as CapabilitiesResult
    else if (op === "status") snap.status = value as StatusResult
    snap.recordedAtUTC = isoUtcNow()
    snap.sourceVersion = sourceVersion
  }

  get(connectorID: string): LastValidSnapshot | undefined {
    return this.map.get(connectorID)
  }

  clear(connectorID?: string): void {
    if (!connectorID) {
      this.map.clear()
      return
    }
    this.map.delete(connectorID)
  }
}

// =====================================================================
// 4. ConnectorRegistry — façade publique
// =====================================================================

export interface ConnectorRegistryOptions {
  /**
   * Si true, accepte les connecteurs dont l'id commence par `test:`.
   * Default false. À activer UNIQUEMENT dans des contextes de tests
   * (et jamais dans une build de production).
   */
  allowTestPrefix?: boolean
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>()
  private readonly cache = new ResultCache()
  private readonly lastValid = new LastValidStore()
  private readonly options: Required<ConnectorRegistryOptions>

  constructor(options: ConnectorRegistryOptions = {}) {
    this.options = {
      allowTestPrefix: options.allowTestPrefix ?? false,
    }
  }

  /**
   * Enregistre un connecteur. Vérifie l'allowlist.
   * Idempotent : ré-enregistrer le même id écrase le précédent (les
   * caches associés sont invalidés).
   */
  register(connector: Connector): void {
    if (!isAllowedConnectorID(connector.id, this.options.allowTestPrefix)) {
      throw new ConnectorOperationError({
        kind: "unauthorized",
        sourceID: connector.id,
        reason: `connector id "${connector.id}" not in allowlist (built-in: ${[...BUILTIN_ALLOWLIST].join(", ") || "(empty)"}; test prefix: ${this.options.allowTestPrefix ? TEST_PREFIX + "*" : "disabled"})`,
      })
    }
    if (this.connectors.has(connector.id)) {
      this.cache.invalidate(connector.id)
      this.lastValid.clear(connector.id)
    }
    this.connectors.set(connector.id, connector)
  }

  /** Désenregistre un connecteur et purge ses caches. */
  unregister(connectorID: string): boolean {
    const had = this.connectors.delete(connectorID)
    this.cache.invalidate(connectorID)
    this.lastValid.clear(connectorID)
    return had
  }

  /** Récupère un connecteur par id. */
  get(connectorID: string): Connector | undefined {
    return this.connectors.get(connectorID)
  }

  /** Liste tous les connecteurs enregistrés. */
  list(): Connector[] {
    return [...this.connectors.values()]
  }

  /** IDs enregistrés. */
  ids(): string[] {
    return [...this.connectors.keys()]
  }

  /**
   * Invalide le cache pour un connecteur (ou tous).
   * `op` : opération spécifique à invalider, ou undefined pour tout.
   */
  invalidate(connectorID?: string, op?: OpKind): void {
    if (!connectorID) {
      this.cache.clear()
      this.lastValid.clear()
      return
    }
    this.cache.invalidate(connectorID, op)
  }

  /** Indique si un cache existe pour ce connecteur. */
  hasCachedResult(connectorID: string): boolean {
    return this.cache.has(connectorID)
  }

  /** Indique si on a au moins un snapshot valide pour ce connecteur. */
  hasLastValid(connectorID: string): boolean {
    return this.lastValid.get(connectorID) !== undefined
  }

  /**
   * discover() — délègue au connecteur, valide la provenance, met en
   * cache le résultat si valide, et le snapshot de fallback.
   */
  async discover(connectorID: string, opts?: ConnectorFetchOptions): Promise<DiscoverResult> {
    const conn = this.getConnectorOrThrow(connectorID)
    normalizeConnectorFetchOptions(opts)
    const result = await conn.discover(opts)
    assertValidProvenance(result.provenance)
    assertCompatibleParserVersion(connectorID, result.provenance.parserVersion, conn.parserVersion)
    this.cache.setDiscover(connectorID, {
      value: result,
      fetchedAtUTC: result.provenance.fetchedAtUTC,
      sourceVersion: result.provenance.sourceVersion,
      rawHash: result.provenance.rawHash,
    })
    this.lastValid.record(connectorID, "discover", result, result.provenance.sourceVersion)
    return result
  }

  async pricing(connectorID: string, opts?: ConnectorFetchOptions): Promise<PricingResult> {
    const conn = this.getConnectorOrThrow(connectorID)
    normalizeConnectorFetchOptions(opts)
    const result = await conn.pricing(opts)
    assertValidProvenance(result.provenance)
    assertCompatibleParserVersion(connectorID, result.provenance.parserVersion, conn.parserVersion)
    this.cache.setPricing(connectorID, {
      value: result,
      fetchedAtUTC: result.provenance.fetchedAtUTC,
      sourceVersion: result.provenance.sourceVersion,
      rawHash: result.provenance.rawHash,
    })
    this.lastValid.record(connectorID, "pricing", result, result.provenance.sourceVersion)
    return result
  }

  async capabilities(connectorID: string, opts?: ConnectorFetchOptions): Promise<CapabilitiesResult> {
    const conn = this.getConnectorOrThrow(connectorID)
    normalizeConnectorFetchOptions(opts)
    const result = await conn.capabilities(opts)
    assertValidProvenance(result.provenance)
    assertCompatibleParserVersion(connectorID, result.provenance.parserVersion, conn.parserVersion)
    this.cache.setCapabilities(connectorID, {
      value: result,
      fetchedAtUTC: result.provenance.fetchedAtUTC,
      sourceVersion: result.provenance.sourceVersion,
      rawHash: result.provenance.rawHash,
    })
    this.lastValid.record(connectorID, "capabilities", result, result.provenance.sourceVersion)
    return result
  }

  async status(connectorID: string, opts?: ConnectorFetchOptions): Promise<StatusResult> {
    const conn = this.getConnectorOrThrow(connectorID)
    normalizeConnectorFetchOptions(opts)
    const result = await conn.status(opts)
    assertValidProvenance(result.provenance)
    assertCompatibleParserVersion(connectorID, result.provenance.parserVersion, conn.parserVersion)
    this.cache.setStatus(connectorID, {
      value: result,
      fetchedAtUTC: result.provenance.fetchedAtUTC,
      sourceVersion: result.provenance.sourceVersion,
      rawHash: result.provenance.rawHash,
    })
    this.lastValid.record(connectorID, "status", result, result.provenance.sourceVersion)
    return result
  }

  /**
   * Restaure le dernier snapshot valide pour un connecteur, ou
   * undefined si aucun snapshot n'a été enregistré.
   *
   * Utilisation typique : quand un connecteur échoue (timeout, parse
   * error), le consommateur peut appeler cette méthode pour obtenir
   * le dernier résultat sain, plutôt que d'échouer brutalement.
   * C'est une dégradation explicite, pas un fallback silencieux : le
   * caller décide et peut comparer la version/staleness.
   */
  restoreLastValid(connectorID: string): LastValidSnapshot | undefined {
    return this.lastValid.get(connectorID)
  }

  /** Diagnostic : nombre de connecteurs enregistrés. */
  size(): number {
    return this.connectors.size
  }

  private getConnectorOrThrow(connectorID: string): Connector {
    const conn = this.connectors.get(connectorID)
    if (!conn) {
      throw new ConnectorOperationError({
        kind: "unauthorized",
        sourceID: connectorID,
        reason: `connector "${connectorID}" not registered`,
      })
    }
    return conn
  }
}

// =====================================================================
// 5. FakeConnector — déterministe, offline, pour tests
// =====================================================================

/**
 * Connecteur factice pour les tests. Aucune dépendance réseau, données
 * générées en mémoire à partir d'un seed.
 *
 * Comportement :
 *   - discover() : 1 provider + 1 model + 1 alias.
 *   - pricing() : 1 entrée pricing.
 *   - capabilities() : 1 entrée capabilities.
 *   - status() : 1 entrée status (active par défaut).
 *
 * Configuration via constructeur :
 *   - `mode` : "ok" (succès normal), "fail-fetch" (lève fetch),
 *              "fail-parse" (lève parse), "fail-validation" (provenance
 *              malformée), "fail-version" (parserVersion incompatible).
 *   - `deterministic` : si true, fetchedAtUTC est figé (utile pour
 *                       les tests d'égalité structurelle).
 *
 * Mode offline : ce connecteur n'effectue AUCUNE requête réseau. Il
 * est utilisable en mode `offline: true` sans contrainte.
 */
export type FakeConnectorMode = "ok" | "fail-fetch" | "fail-parse" | "fail-validation" | "fail-version"

export interface FakeConnectorOptions {
  mode?: FakeConnectorMode
  deterministic?: boolean
  fetchedAtUTC?: string
}

const FAKE_PROVIDER_ID = "fake-provider"
const FAKE_MODEL_ID = "fake-model"
const FAKE_LICENSE = "MIT"
const FAKE_COPYRIGHT = "Copyright (c) 2025 FakeConnector (test fixture)"
const FAKE_LICENSE_URL = "https://example.test/LICENSE"
const FAKE_SOURCE_URL = "https://example.test/api.json"
const FAKE_SOURCE_VERSION = "1.0.0"
const FAKE_PARSER_VERSION = "1.0.0"
const FAKE_SOURCE_ID = "fake:test:fixture"
const FAKE_RAW = JSON.stringify({ fixture: "fake", providers: [FAKE_PROVIDER_ID], models: [FAKE_MODEL_ID] })
const FAKE_RAW_HASH = hashContent(FAKE_RAW)

function makeProvenance(fetchedAtUTC: string): ProvenanceMeta {
  return {
    sourceID: FAKE_SOURCE_ID,
    sourceVersion: FAKE_SOURCE_VERSION,
    sourceURL: FAKE_SOURCE_URL,
    parserVersion: FAKE_PARSER_VERSION,
    rawHash: FAKE_RAW_HASH,
    fetchedAtUTC,
    licenseCode: FAKE_LICENSE,
    copyrightNotice: FAKE_COPYRIGHT,
    licenseFileURL: FAKE_LICENSE_URL,
    confidenceLevel: "official",
  }
}

function makeProvider() {
  return {
    id: FAKE_PROVIDER_ID,
    name: "Fake Provider",
    sdk: "@fake/sdk",
    api: { baseURL: "https://api.fake.example.com" },
    envVars: ["FAKE_API_KEY"],
    capabilities: {
      tools: true,
      structuredOutput: true,
      streaming: true,
      visionInput: false,
      audioIO: false,
      videoIO: false,
      pdfInput: false,
      functionCallingStrict: false,
      systemPrompts: true,
    },
    modalitiesSupported: { input: ["text"] as Array<"text" | "audio" | "image" | "video" | "pdf">, output: ["text"] as Array<"text" | "audio" | "image" | "video" | "pdf"> },
    status: "active" as const,
    deprecationReason: null,
    addedAtUTC: "2025-01-01T00:00:00Z",
    removedAtUTC: null,
    docsURL: null,
    privacyPolicyRef: null,
    regionPolicy: { allowedRegions: [], dataResidencyRequired: false },
    aliases: [],
  }
}

function makeModel() {
  return {
    id: FAKE_MODEL_ID,
    providerID: FAKE_PROVIDER_ID,
    canonicalName: "Fake Model",
    family: null,
    aliases: [],
    capabilities: {
      structuredOutput: true,
      toolCalls: true,
      parallelToolCalls: false,
      visionInput: false,
      audioInput: false,
      videoInput: false,
      pdfInput: false,
      reasoning: false,
      caching: false,
      promptCaching: false,
      systemMessages: true,
    },
    modalities: { input: ["text"] as Array<"text" | "audio" | "image" | "video" | "pdf">, output: ["text"] as Array<"text" | "audio" | "image" | "video" | "pdf"> },
    contextWindow: { totalTokens: 8000, inputTokens: null, outputTokens: 4000 },
    reasoning: { supports: false, interleavedField: null },
    toolUse: { supports: true, parallelCalls: false },
    temperature: { supports: true, range: null },
    status: "active" as const,
    deprecationReason: null,
    lifecycleStage: "metadata_validated" as const,
    releaseDateUTC: null,
    retirementDateUTC: null,
    pricing: {
      currency: "USD",
      unit: "per_1m_tokens" as const,
      input: 1,
      output: 2,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
      tiers: null,
    },
    sourceRefs: [
      {
        sourceID: FAKE_SOURCE_ID,
        observedAtUTC: "2025-01-01T00:00:00Z",
        sourceVersion: FAKE_SOURCE_VERSION,
        fieldHashes: { id: FAKE_RAW_HASH },
      },
    ],
    health: {
      lastHealthCheckUTC: "2025-01-01T00:00:00Z",
      availabilityScore: 1,
      latencyP50Ms: null,
      latencyP95Ms: null,
      errorRate1h: 0,
      rateLimit: null,
      notes: null,
    },
    provenance: {
      sourceID: FAKE_SOURCE_ID,
      sourceVersion: FAKE_SOURCE_VERSION,
      sourceURL: FAKE_SOURCE_URL,
      fetchedAtUTC: "2025-01-01T00:00:00Z",
      rawHash: FAKE_RAW_HASH,
      parserVersion: FAKE_PARSER_VERSION,
      transformHash: FAKE_RAW_HASH,
      signatureRef: null,
    },
    lastSeenAtUTC: "2025-01-01T00:00:00Z",
  }
}

export class FakeConnector implements Connector {
  readonly id: string = "fake"
  readonly kind: "catalog" | "pricing" | "benchmarks" | "metadata" = "catalog"
  readonly version: string = FAKE_SOURCE_VERSION
  readonly sourceURL: string = FAKE_SOURCE_URL
  readonly parserVersion: string = FAKE_PARSER_VERSION
  readonly licenseCode: string | null = FAKE_LICENSE
  readonly copyrightNotice: string | null = FAKE_COPYRIGHT
  readonly licenseFileURL: string | null = FAKE_LICENSE_URL
  readonly confidenceLevel: "official" | "community" | "unverified" = "official"

  readonly mode: FakeConnectorMode
  readonly deterministic: boolean
  readonly fixedFetchedAtUTC: string | undefined

  constructor(options: FakeConnectorOptions = {}) {
    this.mode = options.mode ?? "ok"
    this.deterministic = options.deterministic ?? false
    this.fixedFetchedAtUTC = options.fetchedAtUTC
  }

  private nowOrFixed(): string {
    if (this.fixedFetchedAtUTC) return this.fixedFetchedAtUTC
    if (this.deterministic) return "2025-01-01T00:00:00Z"
    return isoUtcNow()
  }

  private gateOrThrow(op: string): void {
    if (this.mode === "ok") return
    const sourceID = this.id
    if (this.mode === "fail-fetch") {
      throw new ConnectorOperationError({
        kind: "fetch",
        sourceID,
        url: this.sourceURL,
        attempts: 1,
        cause: `FakeConnector simulated fetch failure (${op})`,
      })
    }
    if (this.mode === "fail-parse") {
      throw new ConnectorOperationError({
        kind: "parse",
        sourceID,
        line: 1,
        column: 1,
        snippet: "{",
        cause: `FakeConnector simulated parse failure (${op})`,
      })
    }
    if (this.mode === "fail-validation") {
      throw new ConnectorOperationError({
        kind: "validation",
        sourceID,
        path: "provenance.rawHash",
        expectedType: "SHA-256 hex (64 chars)",
        actualValueShape: "string",
        cause: `FakeConnector simulated validation failure (${op})`,
      })
    }
    if (this.mode === "fail-version") {
      throw new ConnectorOperationError({
        kind: "unsupported_version",
        sourceID,
        parserVersion: "99.0.0",
        currentParserVersion: this.parserVersion,
      })
    }
  }

  async discover(_opts?: ConnectorFetchOptions): Promise<DiscoverResult> {
    this.gateOrThrow("discover")
    return {
      providers: [makeProvider()],
      models: [makeModel()],
      aliases: [
        {
          alias: "fake",
          canonicalRef: { providerID: FAKE_PROVIDER_ID, modelID: FAKE_MODEL_ID },
          deprecated: false,
          replacedBy: null,
        },
      ],
      warnings: [],
      provenance: makeProvenance(this.nowOrFixed()),
    }
  }

  async pricing(_opts?: ConnectorFetchOptions): Promise<PricingResult> {
    this.gateOrThrow("pricing")
    return {
      pricing: [
        {
          providerID: FAKE_PROVIDER_ID,
          modelID: FAKE_MODEL_ID,
          currency: "USD",
          unit: "per_1m_tokens",
          input: 1,
          output: 2,
          cacheRead: null,
          cacheWrite: null,
          reasoning: null,
          tiers: null,
        },
      ],
      warnings: [],
      provenance: makeProvenance(this.nowOrFixed()),
    }
  }

  async capabilities(_opts?: ConnectorFetchOptions): Promise<CapabilitiesResult> {
    this.gateOrThrow("capabilities")
    return {
      capabilities: [
        {
          providerID: FAKE_PROVIDER_ID,
          modelID: FAKE_MODEL_ID,
          capabilities: {
            structuredOutput: true,
            toolCalls: true,
            parallelToolCalls: false,
            visionInput: false,
            audioInput: false,
            videoInput: false,
            pdfInput: false,
            reasoning: false,
            caching: false,
            promptCaching: false,
            systemMessages: true,
          },
          modalities: { input: ["text"], output: ["text"] },
        },
      ],
      warnings: [],
      provenance: makeProvenance(this.nowOrFixed()),
    }
  }

  async status(_opts?: ConnectorFetchOptions): Promise<StatusResult> {
    this.gateOrThrow("status")
    return {
      status: [
        {
          providerID: FAKE_PROVIDER_ID,
          modelID: FAKE_MODEL_ID,
          status: "active",
          deprecated: false,
          deprecationReason: null,
          renamedTo: null,
          removed: false,
        },
      ],
      warnings: [],
      provenance: makeProvenance(this.nowOrFixed()),
    }
  }
}

// =====================================================================
// 6. Helper d'adaptation DiscoverResult → ParsedSource C01
// =====================================================================

/**
 * Adapte un DiscoverResult (C02) en ParsedSource (C01), pour
 * permettre à un consommateur d'ingérer via le pipeline C01 existant
 * (ingest() + buildRegistry()) SANS DUPLIQUER le registre.
 *
 * Conformité F-B01-001 (Wave followup) : la consommation C01 démarre
 * ici — c'est le seul point d'entrée qui fait le pont entre les deux
 * couches.
 *
 * Le consumer garde la pleine responsabilité d'appeler ingest() +
 * buildRegistry() ; cette fonction ne fait QUE la traduction de
 * forme, sans aucune validation (déjà faite en amont par C02).
 */
export function toC01ParsedSource(result: DiscoverResult): {
  providers: unknown[]
  models: unknown[]
  aliases: unknown[]
  metadata: {
    sourceID: string
    sourceVersion: string
    fetchedAtUTC: string
    rawHash: string
    parserVersion: string
  }
} {
  return {
    providers: result.providers as unknown[],
    models: result.models as unknown[],
    aliases: result.aliases as unknown[],
    metadata: {
      sourceID: result.provenance.sourceID,
      sourceVersion: result.provenance.sourceVersion,
      fetchedAtUTC: result.provenance.fetchedAtUTC,
      rawHash: result.provenance.rawHash,
      parserVersion: result.provenance.parserVersion,
    },
  }
}

// =====================================================================
// 7. Re-exports (unités partagées)
// =====================================================================

export { hashContent }
export { isoUtcNow }
export {
  DEFAULT_CONNECTOR_FETCH_OPTIONS,
  MAX_RETRIES_CAP,
  normalizeConnectorFetchOptions,
  assertValidProvenance,
  assertCompatibleParserVersion,
  ConnectorOperationError,
}
export type { ConnectorError, ConnectorFetchOptions }