/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * ArtifactRecord — V2.3.1 contract for ADR-005 + plan §67-71.
 *
 * Distinct from `artifact.ts` (P2-C200 ArtifactPort) which models
 * the legacy artifact abstraction. This file models the new
 * record-shaped contract: ArtifactRef (handle, non-authoritative) +
 * ArtifactRecord (store-authoritative metadata) + taints +
 * classification + protection envelope.
 *
 * Plan §71 invariant: the caller cannot fix classification, taint,
 * ownership, or environment. These come from the store / policy /
 * taint authority. The ArtifactWriteRequest schema below omits them
 * on purpose.
 */

import { z } from "zod"
import { OwnershipScopeSchema, DeploymentScopeSchema } from "./scope.js"
import { ArtifactBytesDigestSchema } from "./digest.js"
import { AtRestProtectionEnvelopeSchema } from "./protection.js"

// -------- Ref (non-authoritative handle) --------

export const ArtifactRefSchema = z.object({
  artifactId: z.string(),
  // ADR-026: `contentDigest` is typed by domain. A Zod parse of an
  // `ArtifactRef` rejects any envelope whose `domain` literal is not
  // `"artifact-bytes"`. The store computes the digest with the
  // digest-runtime and brands it via `asDomainDigest(envelope,
  // "artifact-bytes")` (artifact-store/src/index.ts:403), so the
  // ref's domain and the value's domain agree by construction.
  contentDigest: ArtifactBytesDigestSchema,
})
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>

// -------- Taint + classification (plan §121-122) --------

export const TaintSchema = z.enum([
  "untrusted_external",
  "secret",
  "auth_session",
  "PII",
  "financial",
  "source_code",
  "internal",
  "confidential",
  "restricted",
])
export type Taint = z.infer<typeof TaintSchema>

export const ClassificationSchema = z.enum([
  "public",
  "internal",
  "confidential",
  "restricted",
])
export type Classification = z.infer<typeof ClassificationSchema>

// -------- Origin + retention (plan §68) --------

export const ArtifactOriginSchema = z.object({
  kind: z.enum(["workflow", "user", "connector", "mcp"]),
  ref: z.string(),
})
export type ArtifactOrigin = z.infer<typeof ArtifactOriginSchema>

export const RetentionPolicySchema = z.object({
  ttlSeconds: z.number().int().nonnegative(),
  coldAfterSeconds: z.number().int().nonnegative().optional(),
  purgeAfterSeconds: z.number().int().nonnegative().optional(),
})
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>

// -------- Store-authoritative record (plan §68) --------

export const ArtifactRecordSchema = z.object({
  artifactId: z.string(),
  ownershipScope: OwnershipScopeSchema,
  deploymentScope: DeploymentScopeSchema.optional(),
  // ADR-026: store-authoritative `contentDigest` is typed by domain.
  // The store produces it via `asDomainDigest(envelope, "artifact-bytes")`,
  // so the parsing boundary now enforces the same invariant at parse
  // time that the brand system enforced at the type level.
  contentDigest: ArtifactBytesDigestSchema,
  mediaType: z.string(),
  size: z.number().int().nonnegative(),
  storageClass: z.enum(["hot", "cold", "encrypted", "redacted"]),
  taints: z.array(TaintSchema).readonly(),
  classification: ClassificationSchema,
  origin: ArtifactOriginSchema,
  retentionPolicy: RetentionPolicySchema,
  protectionEnvelope: AtRestProtectionEnvelopeSchema.optional(),
  createdAt: z.number().int(),
})
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>

// -------- Caller-side write request (plan §71) --------
// NO classification, taint, ownership, environment — store decides.

export const ArtifactWriteRequestSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  mediaType: z.string(),
  origin: ArtifactOriginSchema,
  ownershipScope: OwnershipScopeSchema,
  deploymentScope: DeploymentScopeSchema.optional(),
  retentionPolicy: RetentionPolicySchema.optional(),
})
export type ArtifactWriteRequest = z.infer<typeof ArtifactWriteRequestSchema>

// -------- LARGE PAYLOAD RULE (plan §70) --------

export const ARTIFACT_INLINE_THRESHOLD_BYTES = 64 * 1024 // 64 KiB
