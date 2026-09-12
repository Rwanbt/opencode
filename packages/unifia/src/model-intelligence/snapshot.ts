/**
 * Snapshot serialization/désérialisation pour le registry.
 *
 * Round-trip byte-stable :
 *   - clés JSON triées (canonical JSON)
 *   - indentation 2 espaces fixe
 *   - floats sérialisés via toFixed ou stringifiée
 *   - timestamps au format ISO 8601 UTC sans millisecondes
 *
 * SHA-256 calculable et déterministe pour un même input.
 */

import { createHash } from "node:crypto"
import { Registry, type Registry as RegistryType } from "./schema"
import {
  SnapshotCorruptedError,
  SnapshotHashMismatchError,
  UnsupportedSchemaVersionError,
} from "./errors"
import { SCHEMA_VERSION } from "./schema-version"
import { hashContent } from "./source"

export interface RegistrySnapshot {
  schemaVersion: string
  generatedAtUTC: string
  generatorVersion: string
  registryID: string
  snapshot: RegistryType
}

export function serialize(registry: RegistryType, generatorVersion: string): RegistrySnapshot {
  return {
    schemaVersion: registry.schemaVersion,
    generatedAtUTC: registry.generatedAtUTC,
    generatorVersion,
    registryID: registry.registryID,
    snapshot: registry,
  }
}

export function toCanonicalJSON(snapshot: RegistrySnapshot): string {
  return JSON.stringify(snapshot, canonicalReplacer, 2)
}

export function hashSnapshot(snapshot: RegistrySnapshot): string {
  return createHash("sha256").update(toCanonicalJSON(snapshot)).digest("hex")
}

export function verifyHash(content: string, expectedHash: string): void {
  const actual = hashContent(content)
  if (actual !== expectedHash) {
    throw new SnapshotHashMismatchError({
      expectedHash,
      actualHash: actual,
      path: content.slice(0, 80),
    })
  }
}

export function loadSnapshot(content: string): RegistrySnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    throw new SnapshotCorruptedError({
      expectedHash: "unknown",
      actualHash: "unknown",
      path: content.slice(0, 80),
      message: `JSON parse error: ${(e as Error).message}`,
    })
  }

  const snapshot = parsed as RegistrySnapshot
  if (!snapshot || typeof snapshot.schemaVersion !== "string") {
    throw new SnapshotCorruptedError({
      expectedHash: "unknown",
      actualHash: "unknown",
      path: content.slice(0, 80),
      message: "missing schemaVersion",
    })
  }

  const versionDiff = compareVersions(snapshot.schemaVersion, SCHEMA_VERSION)
  if (versionDiff === "older-major") {
    throw new UnsupportedSchemaVersionError({
      found: snapshot.schemaVersion,
      currentVersion: SCHEMA_VERSION,
      message: `Snapshot schemaVersion ${snapshot.schemaVersion} is N-2 or older (current ${SCHEMA_VERSION}); migration not supported.`,
    })
  }

  const validated = Registry.parse(snapshot.snapshot)
  return { ...snapshot, snapshot: validated }
}

export function loadSnapshotWithHash(content: string, expectedHash: string): RegistrySnapshot {
  verifyHash(content, expectedHash)
  return loadSnapshot(content)
}

function canonicalReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = (value as Record<string, unknown>)[k]
  }
  return sorted
}

function compareVersions(a: string, b: string): "equal" | "newer-major" | "older-major" {
  const aMatch = /^(\d+)\.(\d+)\.(\d+)/.exec(a)
  const bMatch = /^(\d+)\.(\d+)\.(\d+)/.exec(b)
  if (!aMatch || !bMatch) return "older-major"
  const aMajor = Number(aMatch[1])
  const bMajor = Number(bMatch[1])
  if (aMajor === bMajor) return "equal"
  return aMajor > bMajor ? "newer-major" : "older-major"
}