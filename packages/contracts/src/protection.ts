/* SPDX-License-Identifier: MIT */
import { z } from "zod"

export const EncryptionAlgorithmSchema = z.enum(["AES-256-GCM"])
export type EncryptionAlgorithm = z.infer<typeof EncryptionAlgorithmSchema>

export const ProtectionSchemeSchema = z.enum(["envelope", "DEK-wrapped", "OS-keyring"])
export type ProtectionScheme = z.infer<typeof ProtectionSchemeSchema>

export const AadDomainSchema = z.enum([
  "artifact-content",
  "credential-material",
  "audit-row",
  "oauth-token",
  "browser-auth-profile",
  "sensitive-runtime-state",
])
export type AadDomain = z.infer<typeof AadDomainSchema>

export const AtRestProtectionEnvelopeSchema = z.object({
  version: z.literal(1),
  protectionScheme: ProtectionSchemeSchema,
  encryptionAlgorithm: EncryptionAlgorithmSchema,
  keyRef: z.string(),
  keyVersion: z.string().optional(),
  wrappedDataKey: z.string().optional(),
  nonceOrIV: z.string(),
  aadDomain: AadDomainSchema,
})
export type AtRestProtectionEnvelope = z.infer<typeof AtRestProtectionEnvelopeSchema>
