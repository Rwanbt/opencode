/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Enterprise contracts (Plan V2.3.1 §226, ADR-018).
 *
 * SSO, audit log, compliance — the three pillars of an enterprise
 * deployment. The contracts here are the *shape*; the runtime
 * integration with providers (Okta, Azure AD, etc.) is in the
 * worktree's enterprise package (out of scope for contracts).
 *
 * EN-01 — SSO config (provider + IdP metadata + claim mapping).
 * EN-02 — Audit log (entry shape + retention policy).
 * EN-03 — Compliance config (frameworks + control catalogue).
 */
import { z } from "zod"

/* ------------------------------------------------------------------ */
/* EN-01 — SSO                                                        */
/* ------------------------------------------------------------------ */

/**
 * Maximum length of an IdP metadata URL. SAML metadata documents
 * are typically < 100 KB, but we cap the *URL* (not the document)
 * to keep a hostile config from being injected.
 */
export const SSO_METADATA_URL_MAX_CHARS = 2048

export const SsoProviderSchema = z.enum([
  "okta",
  "azure-ad",
  "google-workspace",
  "onelogin",
  "ping-identity",
  "custom",
])
export type SsoProvider = z.infer<typeof SsoProviderSchema>

export const SsoConfigSchema = z.object({
  provider: SsoProviderSchema,
  /** URL to the IdP metadata document (SAML or OIDC). */
  metadataUrl: z.string().url().max(SSO_METADATA_URL_MAX_CHARS),
  /** Tenant / domain identifier. */
  tenantId: z.string().min(1).max(256),
  /** Optional claim mappings (SAML attribute -> Unifia claim). */
  claimMappings: z
    .record(z.string().min(1).max(64), z.string().min(1).max(64))
    .readonly()
    .default({}),
})
export type SsoConfig = z.infer<typeof SsoConfigSchema>

export function parseSsoConfig(input: unknown): SsoConfig {
  return SsoConfigSchema.parse(input)
}

/* ------------------------------------------------------------------ */
/* EN-02 — Audit log                                                  */
/* ------------------------------------------------------------------ */

/**
 * Maximum audit retention. 10 years covers the longest realistic
 * compliance window (SOX, HIPAA, some financial regulators); any
 * value larger than that almost certainly indicates a config bug.
 */
export const AUDIT_MAX_RETENTION_DAYS = 365 * 10

export const AuditEntrySchema = z.object({
  entryId: z.string().min(1).max(128),
  /** Unix epoch milliseconds. */
  timestamp: z.number().int().nonnegative(),
  actor: z.string().min(1).max(256),
  action: z.string().min(1).max(128),
  resource: z.string().min(1).max(512),
  outcome: z.enum(["success", "failure", "denied"]),
  /** Free-form details (key/value, no schema enforced). */
  details: z.record(z.string(), z.unknown()).readonly().default({}),
})
export type AuditEntry = z.infer<typeof AuditEntrySchema>

export const AuditLogSchema = z.object({
  entries: z.array(AuditEntrySchema).readonly().default([]),
  /** Retention policy in days. Default 365 (1 year). */
  retentionDays: z
    .number()
    .int()
    .positive()
    .max(AUDIT_MAX_RETENTION_DAYS)
    .default(365),
})
export type AuditLog = z.infer<typeof AuditLogSchema>

/* ------------------------------------------------------------------ */
/* EN-03 — Compliance                                                 */
/* ------------------------------------------------------------------ */

export const COMPLIANCE_FRAMEWORKS = [
  "soc2",
  "hipaa",
  "gdpr",
  "iso27001",
  "pci-dss",
] as const

export const ComplianceControlSchema = z.object({
  controlId: z.string().min(1).max(64),
  framework: z.enum(COMPLIANCE_FRAMEWORKS),
  description: z.string().min(1).max(1024),
  /** Whether the control is currently enforced (true) or aspirational (false). */
  enforced: z.boolean().default(false),
})
export type ComplianceControl = z.infer<typeof ComplianceControlSchema>

export const ComplianceConfigSchema = z.object({
  /**
   * Frameworks the deployment targets. Must be at least one —
   * "compliant with nothing" is not a deployment posture.
   */
  frameworks: z.array(z.enum(COMPLIANCE_FRAMEWORKS)).min(1).readonly(),
  controls: z.array(ComplianceControlSchema).readonly().default([]),
})
export type ComplianceConfig = z.infer<typeof ComplianceConfigSchema>

export function parseComplianceConfig(input: unknown): ComplianceConfig {
  return ComplianceConfigSchema.parse(input)
}
