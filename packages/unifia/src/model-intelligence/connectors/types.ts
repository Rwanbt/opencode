/**
 * Connecteur de catalogue provider — contrat générique (TEAM-C02).
 *
 * Ce module DÉCOUVRE et NORMALISE des données externes de catalogues
 * providers. Il ne remplace PAS le registry C01 — C01 reste l'autorité
 * unique pour ce qui est effectivement enregistré (doctrine A06 Décision 4
 * + D-035 « zéro second registry »).
 *
 * Architecture en deux couches :
 *
 *   Layer C02 (ce fichier) : contrat abstrait Connector avec 4 opérations
 *     disjointes (discover, pricing, capabilities, status). Chaque retour
 *     porte un ProvenanceMeta obligatoire et un parserVersion explicite.
 *     Permet à des sources hétérogènes (pricing, status pages, catalog)
 *     d'être composées sans dupliquer un registre.
 *
 *   Layer C01 (figé, source.ts / connectors/modelsdev.ts) : SourceConnector
 *     à fetch+parse unique qui produit un ParsedSource ingérable par
 *     ingest(). Registry reste l'autorité.
 *
 * Le présent contrat complète C01 sans le réécrire. Aucune fonction
 * `registerModel()` / `addProvider()` exposée ici — la décision
 * d'ingestion vers le registry reste externalisée.
 *
 * Invariants (doctrine A06 Décision 4 + A05 audit F-A05-1..6 + C01 retry
 * verdict §3) :
 *   - Chaque retour porte un ProvenanceMeta complet (fail-closed si champ
 *     manquant — JAMAIS de provenance par défaut silencieuse).
 *   - rawHash = SHA-256 hex 64 chars lowercase.
 *   - licenseCode SPDX-like ou null (jamais une chaîne libre non déclarée).
 *   - sourceURL pinnée au build time — aucune URL construite à l'exécution
 *     à partir d'une entrée utilisateur non validée.
 *   - Champs inconnus NE SONT PAS perdus : ils sont remontés en
 *     ConnectorWarning structuré (jamais d'exécution implicite, jamais
 *     d'ignore silencieux).
 *   - Données invalides rejetées fail-closed : SourceValidationError typé.
 *   - Pas de second registry : aucune liste de modèles statique ici.
 *   - Pas de secret dans les logs : les messages d'erreur portent le code
 *     (kind) + identifiants non-sensibles, jamais les valeurs brutes.
 *
 * Allowed par TEAM-C02 scope manifest :
 *   - création : packages/unifia/src/model-intelligence/connectors/types.ts
 *   - (registry.ts créé séparément, voir ./registry.ts)
 */

import { z } from "zod"
import { Model, Provider, Alias } from "../schema"

// =====================================================================
// 1. Schémas Zod — guards runtime pour fail-closed
// =====================================================================

/** SHA-256 hexadécimal 64 chars lowercase. */
const SHA_256_HEX = /^[a-f0-9]{64}$/
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.]+)?$/
/** ISO 8601 UTC SANS millisecondes (cohérent avec isoUtcNow()). */
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
/** SPDX-like : lettres, chiffres, tirets, points, plus. Insensible à la casse. */
const SPDX_LIKE = /^[A-Za-z0-9.+-]+$/

/** Code licence SPDX-like ou null. Pas de chaîne libre. */
const LicenseCodeSchema = z
  .string()
  .nullable()
  .refine((v) => v === null || SPDX_LIKE.test(v), "licenseCode must be SPDX-like or null")

export const ProvenanceMetaSchema = z.object({
  sourceID: z.string().min(1),
  sourceVersion: z.string().min(1),
  sourceURL: z.string().url(),
  parserVersion: z.string().regex(SEMVER, "parserVersion must be semver"),
  rawHash: z.string().regex(SHA_256_HEX, "rawHash must be SHA-256 hex (64 chars lowercase)"),
  fetchedAtUTC: z.string().regex(ISO_8601_UTC, "fetchedAtUTC must be ISO 8601 UTC"),
  licenseCode: LicenseCodeSchema,
  copyrightNotice: z.string().nullable(),
  licenseFileURL: z.string().url().nullable(),
  confidenceLevel: z.enum(["official", "community", "unverified"]),
})

export type ProvenanceMeta = z.infer<typeof ProvenanceMetaSchema>

// =====================================================================
// 2. Warning structuré pour champs inconnus (jamais silencieux)
// =====================================================================

/**
 * Les champs inconnus NE SONT PAS exécutés implicitement ni perdus :
 * ils sont remontés au consommateur via ConnectorWarning structuré.
 * Permet à un consommateur d'auditer ce qui a été ignoré sans avoir à
 * modifier le contrat.
 */
export type ConnectorWarning =
  | { code: "unknown_field"; path: string; valueShape: string; message: string }
  | { code: "unknown_provider"; sourceID: string; providerID: string; message: string }
  | { code: "unknown_model"; sourceID: string; providerID: string; modelID: string; message: string }
  | { code: "deprecated_field"; path: string; replacement: string | null; message: string }
  | { code: "schema_drift"; sourceID: string; addedPaths: string[]; removedPaths: string[]; message: string }

// =====================================================================
// 3. Résultats typés des 4 opérations du contrat
// =====================================================================

/**
 * discover() — énumère providers + models + aliases découverts.
 * Les items sont déjà validés contre le schéma C01 (Model.safeParse,
 * Provider.safeParse, Alias.safeParse). Toute entrée qui échoue la
 * validation est signalée en warning `unknown_*` et exclue du résultat,
 * jamais insérée partiellement.
 */
export interface DiscoverResult {
  providers: Provider[]
  models: Model[]
  aliases: Alias[]
  warnings: ConnectorWarning[]
  provenance: ProvenanceMeta
}

/**
 * pricing() — données de tarification par (providerID, modelID).
 * Forme minimale normalisée : pas de structure propriétaire, pas de
 * champs libres non déclarés ici.
 */
export interface PricingEntry {
  providerID: string
  modelID: string
  currency: string
  unit: "per_1m_tokens" | "per_1k_tokens" | "per_request"
  input: number
  output: number
  cacheRead: number | null
  cacheWrite: number | null
  reasoning: number | null
  tiers: Array<{
    thresholdTokens: number
    input: number
    output: number
  }> | null
}

export interface PricingResult {
  pricing: PricingEntry[]
  warnings: ConnectorWarning[]
  provenance: ProvenanceMeta
}

/**
 * capabilities() — capacités par (providerID, modelID).
 * Les capacités sont normalisées au ModelCapabilities C01 (sous-ensemble
 * strict). Toute capacité non mappable est reportée en warning.
 */
export interface CapabilitiesEntry {
  providerID: string
  modelID: string
  capabilities: {
    structuredOutput: boolean
    toolCalls: boolean
    parallelToolCalls: boolean
    visionInput: boolean
    audioInput: boolean
    videoInput: boolean
    pdfInput: boolean
    reasoning: boolean
    caching: boolean
    promptCaching: boolean
    systemMessages: boolean
  }
  modalities: {
    input: Array<"text" | "audio" | "image" | "video" | "pdf">
    output: Array<"text" | "audio" | "image" | "video" | "pdf">
  }
}

export interface CapabilitiesResult {
  capabilities: CapabilitiesEntry[]
  warnings: ConnectorWarning[]
  provenance: ProvenanceMeta
}

/**
 * status() — état de cycle de vie par (providerID, modelID).
 * Le statut suit strictement l'enum Model.status C01.
 */
export type ModelStatus = "alpha" | "beta" | "active" | "deprecated" | "quarantined"

export interface StatusEntry {
  providerID: string
  modelID: string
  status: ModelStatus
  deprecated: boolean
  deprecationReason: string | null
  renamedTo: { providerID: string; modelID: string } | null
  removed: boolean
}

export interface StatusResult {
  status: StatusEntry[]
  warnings: ConnectorWarning[]
  provenance: ProvenanceMeta
}

// =====================================================================
// 4. Erreurs typées — discriminated union (fail-closed)
// =====================================================================

/**
 * Toute défaillance d'un connecteur remonte un ConnectorError typé.
 * On évite les exceptions non-typées : le consommateur peut discriminer
 * via `kind` pour décider d'une stratégie (retry, fallback snapshot, etc.).
 *
 * Garanties :
 *   - Pas de valeur brute (jamais un message de payload réseau dans
 *     `cause` qui contiendrait un secret) — on stocke un extrait borné.
 *   - Pas de stack trace ici (volumineux, peut contenir des secrets).
 */
export type ConnectorError =
  | {
      kind: "fetch"
      sourceID: string
      url: string
      attempts: number
      cause: string
    }
  | {
      kind: "parse"
      sourceID: string
      line: number | null
      column: number | null
      snippet: string
      cause: string
    }
  | {
      kind: "validation"
      sourceID: string
      path: string
      expectedType: string
      actualValueShape: string
      cause: string
    }
  | {
      kind: "license_mismatch"
      sourceID: string
      expectedLicense: string | null
      actualLicense: string | null
    }
  | {
      kind: "unsupported_version"
      sourceID: string
      parserVersion: string
      currentParserVersion: string
    }
  | {
      kind: "unknown_provider"
      sourceID: string
      providerID: string
    }
  | {
      kind: "unknown_model"
      sourceID: string
      providerID: string
      modelID: string
    }
  | {
      kind: "unauthorized"
      sourceID: string
      reason: string
    }
  | {
      kind: "timeout"
      sourceID: string
      url: string
      timeoutMs: number
      attempts: number
    }
  | {
      kind: "cache_corrupted"
      sourceID: string
      path: string
      cause: string
    }
  | {
      kind: "offline_no_cache"
      sourceID: string
    }

export class ConnectorOperationError extends Error {
  readonly detail: ConnectorError
  constructor(detail: ConnectorError) {
    super(`ConnectorError[${detail.kind}] sourceID=${detail.sourceID}`)
    this.name = "ConnectorOperationError"
    this.detail = detail
  }
}

// =====================================================================
// 5. Options de fetch (timeout borné, retry borné, offline)
// =====================================================================

/**
 * Options de fetch pour les 4 opérations du contrat.
 * Tous les délais/retries sont BORNÉS — pas de boucle infinie, pas de
 * timeout implicite dépendant du runtime.
 */
export interface ConnectorFetchOptions {
  /** Timeout par tentative (ms). Default 10_000. */
  timeoutMs?: number
  /** Nombre max de tentatives. Default 3. BORNÉ (max 5). */
  maxRetries?: number
  /** Signal d'annulation externe (AbortSignal). */
  signal?: AbortSignal
  /** Mode offline strict : aucune requête réseau, échec fail-closed si cache absent. */
  offline?: boolean
  /** Hash attendu (vérification d'intégrité en mode offline). */
  expectedHash?: string
}

export const DEFAULT_CONNECTOR_FETCH_OPTIONS = {
  timeoutMs: 10_000,
  maxRetries: 3,
  offline: false,
} as const satisfies Required<Omit<ConnectorFetchOptions, "signal" | "expectedHash">>

export const MAX_RETRIES_CAP = 5

/**
 * Normalise les options fetch avec bornes dures. Toute valeur
 * dépassant MAX_RETRIES_CAP est plafonnée (anti-abus).
 */
export function normalizeConnectorFetchOptions(
  opts?: ConnectorFetchOptions,
): Required<Omit<ConnectorFetchOptions, "signal" | "expectedHash">> & {
  signal: AbortSignal | null
  expectedHash: string | null
} {
  const o = opts ?? {}
  const maxRetries = Math.min(Math.max(1, o.maxRetries ?? DEFAULT_CONNECTOR_FETCH_OPTIONS.maxRetries), MAX_RETRIES_CAP)
  const timeoutMs = Math.max(100, o.timeoutMs ?? DEFAULT_CONNECTOR_FETCH_OPTIONS.timeoutMs)
  return {
    timeoutMs,
    maxRetries,
    offline: o.offline ?? DEFAULT_CONNECTOR_FETCH_OPTIONS.offline,
    signal: o.signal ?? null,
    expectedHash: o.expectedHash ?? null,
  }
}

// =====================================================================
// 6. Le contrat Connector
// =====================================================================

/**
 * Connecteur abstrait — implémentation libre (HTTP, fichier, mémoire).
 *
 * Conformité obligatoire :
 *   - `id` unique, allowlisté au niveau du ConnectorRegistry.
 *   - `sourceURL` pinné (constante de classe, jamais calculée runtime).
 *   - Chaque méthode retourne un *Result avec ProvenanceMeta complet.
 *   - Aucune méthode ne mute un état partagé hors du contrôle du
 *     caller (immutable inputs, pure functions de transformation).
 *   - Aucune méthode ne log de secret.
 *
 * Le Connector N'INGÈRE PAS dans le registry C01 : il DÉCOUVRE et
 * NORMALISE, point. Le registry C01 (avec son ingestion+validation
 * typée) reste seul juge de ce qui est persisté.
 */
export interface Connector {
  readonly id: string
  readonly kind: "catalog" | "pricing" | "benchmarks" | "metadata"
  readonly version: string
  readonly sourceURL: string
  readonly parserVersion: string
  readonly licenseCode: string | null
  readonly copyrightNotice: string | null
  readonly licenseFileURL: string | null
  readonly confidenceLevel: "official" | "community" | "unverified"

  discover(opts?: ConnectorFetchOptions): Promise<DiscoverResult>
  pricing(opts?: ConnectorFetchOptions): Promise<PricingResult>
  capabilities(opts?: ConnectorFetchOptions): Promise<CapabilitiesResult>
  status(opts?: ConnectorFetchOptions): Promise<StatusResult>
}

// =====================================================================
// 7. Validateur central (fail-closed)
// =====================================================================

/**
 * Vérifie qu'un ProvenanceMeta est conforme. Utilisé par ConnectorRegistry
 * AVANT de retourner un résultat au consommateur : si la validation
 * échoue, on remonte un ConnectorError `validation` plutôt que de servir
 * une provenance dégradée.
 */
export function assertValidProvenance(p: unknown): ProvenanceMeta {
  const result = ProvenanceMetaSchema.safeParse(p)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new ConnectorOperationError({
      kind: "validation",
      sourceID: typeof (p as { sourceID?: unknown })?.sourceID === "string"
        ? (p as { sourceID: string }).sourceID
        : "unknown",
      path: issue.path.join("."),
      expectedType: "ProvenanceMeta",
      actualValueShape: typeof p,
      cause: issue.message,
    })
  }
  return result.data
}

/**
 * Vérifie que la version d'un parser est compatible avec la version
 * courante déclarée par le registry. Toute incompatibilité majeure
 * (X+1 ou X-1) lève un ConnectorError `unsupported_version`.
 */
export function assertCompatibleParserVersion(
  sourceID: string,
  parserVersion: string,
  currentParserVersion: string,
): void {
  const extractMajor = (v: string): number => {
    const m = /^(\d+)\./.exec(v)
    return m ? Number(m[1]) : -1
  }
  const cMaj = extractMajor(currentParserVersion)
  const pMaj = extractMajor(parserVersion)
  if (cMaj < 0 || pMaj < 0) {
    throw new ConnectorOperationError({
      kind: "unsupported_version",
      sourceID,
      parserVersion,
      currentParserVersion,
    })
  }
  if (Math.abs(cMaj - pMaj) > 0) {
    throw new ConnectorOperationError({
      kind: "unsupported_version",
      sourceID,
      parserVersion,
      currentParserVersion,
    })
  }
}

// =====================================================================
// 8. Re-exports minimaux (unités partagées)
// =====================================================================

export { Model, Provider, Alias }