/**
 * NamedError typés pour le model-intelligence registry.
 * Conformité A02-V2 §3.1 + ADR-SECRET-DELEGATION-V2 (pas de fuite de secrets).
 */

import { NamedError } from "@unifia/util/error"
import z from "zod"

export const SourceFetchError = NamedError.create(
  "SourceFetchError",
  z.object({
    sourceID: z.string(),
    url: z.string(),
    httpStatus: z.number().int().nullable(),
    attempts: z.number().int().positive(),
    message: z.string(),
  }),
)

export const SourceParseError = NamedError.create(
  "SourceParseError",
  z.object({
    sourceID: z.string(),
    line: z.number().int().nullable(),
    column: z.number().int().nullable(),
    snippet: z.string(),
    message: z.string(),
  }),
)

export const SourceValidationError = NamedError.create(
  "SourceValidationError",
  z.object({
    sourceID: z.string(),
    path: z.string(),
    expectedType: z.string(),
    actualValue: z.string(),
    message: z.string(),
  }),
)

export const SourceLicenseMismatch = NamedError.create(
  "SourceLicenseMismatch",
  z.object({
    sourceID: z.string(),
    expectedLicense: z.string().nullable(),
    actualLicense: z.string().nullable(),
    url: z.string(),
    message: z.string(),
  }),
)

export const SnapshotCorruptedError = NamedError.create(
  "SnapshotCorruptedError",
  z.object({
    expectedHash: z.string(),
    actualHash: z.string(),
    path: z.string(),
    message: z.string(),
  }),
)

export const SnapshotHashMismatchError = NamedError.create(
  "SnapshotHashMismatchError",
  z.object({
    expectedHash: z.string(),
    actualHash: z.string(),
    path: z.string(),
  }),
)

export const UnsupportedSchemaVersionError = NamedError.create(
  "UnsupportedSchemaVersionError",
  z.object({
    found: z.string(),
    currentVersion: z.string(),
    message: z.string(),
  }),
)

export const DuplicateAliasError = NamedError.create(
  "DuplicateAliasError",
  z.object({
    alias: z.string(),
    occurrences: z.number().int().positive(),
  }),
)

export const CyclicAliasError = NamedError.create(
  "CyclicAliasError",
  z.object({
    cycle: z.array(z.string()),
  }),
)

export const RegistryNotInitializedError = NamedError.create(
  "RegistryNotInitializedError",
  z.object({
    dbPath: z.string(),
    message: z.string(),
  }),
)

export const OfflineFallbackError = NamedError.create(
  "OfflineFallbackError",
  z.object({
    source: z.string(),
    cacheStatus: z.enum(["empty", "stale", "absent"]),
    bundledSnapshotStatus: z.enum(["present", "absent"]),
    message: z.string(),
  }),
)

export const InvalidPricingError = NamedError.create(
  "InvalidPricingError",
  z.object({
    modelID: z.string(),
    field: z.enum(["currency", "unit", "input", "output", "cacheRead", "cacheWrite", "reasoning"]),
    message: z.string(),
  }),
)

export const InvalidCurrencyError = NamedError.create(
  "InvalidCurrencyError",
  z.object({
    currency: z.string(),
    expected: z.string(),
  }),
)