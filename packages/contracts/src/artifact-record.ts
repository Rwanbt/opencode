/* SPDX-License-Identifier: MIT */
import { z } from "zod"
import { OwnershipScopeSchema, DeploymentScopeSchema } from "./scope.js"
import { ArtifactBytesDigestSchema } from "./digest.js"
import { AtRestProtectionEnvelopeSchema } from "./protection.js"

export const ArtifactRefSchema = z.object({
  artifactId: z.string(),
  contentDigest: ArtifactBytesDigestSchema,
})
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>

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

export const ClassificationSchema = z.enum(["public", "internal", "confidential", "restricted"])
export type Classification = z.infer<typeof ClassificationSchema>

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

export const ArtifactRecordSchema = z.object({
  artifactId: z.string(),
  ownershipScope: OwnershipScopeSchema,
  deploymentScope: DeploymentScopeSchema.optional(),
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

export const ArtifactWriteRequestSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  mediaType: z.string(),
  origin: ArtifactOriginSchema,
  ownershipScope: OwnershipScopeSchema,
  deploymentScope: DeploymentScopeSchema.optional(),
  retentionPolicy: RetentionPolicySchema.optional(),
})
export type ArtifactWriteRequest = z.infer<typeof ArtifactWriteRequestSchema>

export const ARTIFACT_INLINE_THRESHOLD_BYTES = 64 * 1024
