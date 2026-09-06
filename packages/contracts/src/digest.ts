/* SPDX-License-Identifier: MIT */
import { z } from "zod"

export const DigestDomainSchema = z.enum([
  "workflow-version",
  "approval-effect",
  "policy",
  "connector-manifest",
  "mcp-schema",
  "deployment",
  "artifact-bytes",
])
export type DigestDomain = z.infer<typeof DigestDomainSchema>

export const CanonicalizationAlgorithmSchema = z.enum(["JCS-v1"])
export type CanonicalizationAlgorithm = z.infer<typeof CanonicalizationAlgorithmSchema>

export const HashAlgorithmSchema = z.enum(["SHA-256"])
export type HashAlgorithm = z.infer<typeof HashAlgorithmSchema>

export const DigestEnvelopeSchema = z.object({
  version: z.literal(1),
  domain: DigestDomainSchema,
  canonicalizationAlgorithm: CanonicalizationAlgorithmSchema,
  hashAlgorithm: HashAlgorithmSchema,
  value: z.string(),
})
export type DigestEnvelope = z.infer<typeof DigestEnvelopeSchema>

declare const digestBrand: unique symbol
type DigestForDomain<D extends DigestDomain> = DigestEnvelope & {
  readonly [digestBrand]: D
}

export type WorkflowVersionDigest = DigestForDomain<"workflow-version">
export type ApprovalEffectDigest = DigestForDomain<"approval-effect">
export type PolicyDigest = DigestForDomain<"policy">
export type ConnectorManifestDigest = DigestForDomain<"connector-manifest">
export type McpSchemaDigest = DigestForDomain<"mcp-schema">
export type DeploymentDigest = DigestForDomain<"deployment">
export type ArtifactBytesDigest = DigestForDomain<"artifact-bytes">

function domainSchemaFor<D extends DigestDomain>(domain: D) {
  return DigestEnvelopeSchema.refine(
    (envelope): envelope is DigestForDomain<D> => envelope.domain === domain,
    { message: `expected domain "${domain}"` },
  )
}

export const WorkflowVersionDigestSchema = domainSchemaFor("workflow-version")
export const ApprovalEffectDigestSchema = domainSchemaFor("approval-effect")
export const PolicyDigestSchema = domainSchemaFor("policy")
export const ConnectorManifestDigestSchema = domainSchemaFor("connector-manifest")
export const McpSchemaDigestSchema = domainSchemaFor("mcp-schema")
export const DeploymentDigestSchema = domainSchemaFor("deployment")
export const ArtifactBytesDigestSchema = domainSchemaFor("artifact-bytes")

export function asDomainDigest<D extends DigestDomain>(
  envelope: DigestEnvelope,
  expected: D,
): DigestForDomain<D> {
  if (envelope.domain !== expected) {
    throw new Error(`DigestEnvelope domain mismatch: expected ${expected}, got ${envelope.domain}`)
  }
  return envelope as DigestForDomain<D>
}
