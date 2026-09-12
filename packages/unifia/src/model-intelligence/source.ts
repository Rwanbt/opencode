/**
 * Source interface et registre de connecteurs.
 *
 * Chaque source représente une origine de données externe
 * (models.dev, OpenRouter, HuggingFace, pricing pages, etc.).
 * Les sources sont versionnées et traçables via provenance.
 */

import { createHash } from "node:crypto"
import type { Source } from "./schema"

export interface FetchOptions {
  timeoutMs?: number
  userAgent?: string
  signal?: AbortSignal
}

export interface ParseOptions {
  parserVersion: string
  sourceVersion: string
  rawHash: string
}

export interface ParsedSource {
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
}

export interface SourceConnector {
  readonly id: string
  readonly type: "catalog" | "pricing" | "benchmarks" | "metadata"
  fetch(fetchOpts?: FetchOptions): Promise<string>
  parse(raw: string, opts: ParseOptions): ParsedSource
  readonly licenseCode: string | null
  readonly copyrightNotice: string | null
  readonly licenseFileURL: string | null
  readonly confidenceLevel: "official" | "community" | "unverified"
}

export class SourceRegistry {
  private connectors = new Map<string, SourceConnector>()

  register(connector: SourceConnector): void {
    this.connectors.set(connector.id, connector)
  }

  get(id: string): SourceConnector | undefined {
    return this.connectors.get(id)
  }

  list(): SourceConnector[] {
    return [...this.connectors.values()]
  }

  toSourceRecord(connector: SourceConnector): Source {
    return {
      id: connector.id,
      url: "",
      type: connector.type,
      licenseCode: connector.licenseCode,
      licenseFileURL: connector.licenseFileURL,
      copyrightNotice: connector.copyrightNotice,
      parserVersion: "0.1.0",
      confidenceLevel: connector.confidenceLevel,
      rollbackPolicy: "fallback_to_cache",
      policyDocRef: null,
      deprecated: false,
      deprecationReason: null,
    }
  }
}

export const DEFAULT_FETCH_OPTIONS: Required<FetchOptions> = {
  timeoutMs: 10_000,
  userAgent: "opencode-model-intelligence/1.0",
  signal: undefined as unknown as AbortSignal,
}

export function canonicalParseOptions(
  _sourceID: string,
  parserVersion: string,
  rawContent: string,
): ParseOptions {
  return {
    parserVersion,
    sourceVersion: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    rawHash: hashContent(rawContent),
  }
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}