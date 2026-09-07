/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * PostM3-R2 — Enterprise (EN-01..03) (Plan V2.3.1 §226, ADR-018).
 *
 * Locked invariants (regression net, 12 tests):
 *   EN-01 SSO (3):
 *     (1) SsoConfigSchema — parses a minimal valid config.
 *     (2) SsoConfigSchema — accepts all 6 documented providers.
 *     (3) SsoConfigSchema — rejects a non-URL metadataUrl.
 *
 *   EN-02 Audit log (5):
 *     (4) AuditEntrySchema — parses all 7 fields.
 *     (5) AuditEntrySchema — accepts the 3 documented outcomes.
 *     (6) AuditLogSchema — parses with default retentionDays.
 *     (7) AuditLogSchema — rejects retentionDays > AUDIT_MAX_RETENTION_DAYS.
 *     (8) AuditLogSchema — empty config defaults retention to 365.
 *
 *   EN-03 Compliance (4):
 *     (9) ComplianceConfigSchema — parses with at least one framework.
 *     (10) ComplianceConfigSchema — rejects an empty frameworks list.
 *     (11) ComplianceControlSchema — `enforced` defaults to false.
 *     (12) ComplianceConfigSchema — accepts all 5 documented frameworks.
 */
import { describe, expect, test } from "bun:test"
import {
  SsoConfigSchema,
  parseSsoConfig,
  AUDIT_MAX_RETENTION_DAYS,
  AuditEntrySchema,
  AuditLogSchema,
  COMPLIANCE_FRAMEWORKS,
  ComplianceControlSchema,
  ComplianceConfigSchema,
  parseComplianceConfig,
} from "../src/enterprise.ts"

// =========================================================================
// EN-01 — SSO
// =========================================================================

describe("EN-01 SSO — config", () => {
  test("(1) SsoConfigSchema_ParsesValid", () => {
    const parsed = parseSsoConfig({
      provider: "okta",
      metadataUrl: "https://idp.example.com/saml/metadata",
      tenantId: "acme",
    })
    expect(parsed.provider).toBe("okta")
    expect(parsed.metadataUrl).toBe(
      "https://idp.example.com/saml/metadata",
    )
    expect(parsed.tenantId).toBe("acme")
    expect(parsed.claimMappings).toEqual({})
  })

  test("(2) SsoConfigSchema_AcceptsAllProviders — 6 documented providers", () => {
    const providers = [
      "okta",
      "azure-ad",
      "google-workspace",
      "onelogin",
      "ping-identity",
      "custom",
    ] as const
    for (const provider of providers) {
      const parsed = SsoConfigSchema.parse({
        provider,
        metadataUrl: "https://idp.example.com/saml/metadata",
        tenantId: "t-1",
      })
      expect(parsed.provider).toBe(provider)
    }
  })

  test("(3) SsoConfigSchema_RejectsBadMetadataUrl — non-URL", () => {
    expect(() =>
      SsoConfigSchema.parse({
        provider: "okta",
        metadataUrl: "not-a-url",
        tenantId: "t-1",
      }),
    ).toThrow()
  })
})

// =========================================================================
// EN-02 — Audit log
// =========================================================================

describe("EN-02 Audit log — entry", () => {
  test("(4) AuditEntrySchema_ParsesValid — all 7 fields", () => {
    const parsed = AuditEntrySchema.parse({
      entryId: "e-1",
      timestamp: 1_700_000_000_000,
      actor: "user-1",
      action: "workflow.start",
      resource: "wf-1",
      outcome: "success",
      details: { runId: "run-1" },
    })
    expect(parsed.entryId).toBe("e-1")
    expect(parsed.timestamp).toBe(1_700_000_000_000)
    expect(parsed.outcome).toBe("success")
    expect(parsed.details).toEqual({ runId: "run-1" })
  })

  test("(5) AuditEntrySchema_AcceptsAllOutcomes — success / failure / denied", () => {
    for (const outcome of ["success", "failure", "denied"] as const) {
      const parsed = AuditEntrySchema.parse({
        entryId: "e-x",
        timestamp: 0,
        actor: "u",
        action: "a",
        resource: "r",
        outcome,
      })
      expect(parsed.outcome).toBe(outcome)
    }
  })
})

describe("EN-02 Audit log — retention", () => {
  test("(6) AuditLogSchema_ParsesValid — entries + retentionDays", () => {
    const parsed = AuditLogSchema.parse({
      entries: [
        {
          entryId: "e-1",
          timestamp: 0,
          actor: "u",
          action: "a",
          resource: "r",
          outcome: "success",
        },
      ],
      retentionDays: 90,
    })
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.retentionDays).toBe(90)
  })

  test("(7) AuditLogSchema_RejectsTooLongRetention — > AUDIT_MAX_RETENTION_DAYS", () => {
    expect(() =>
      AuditLogSchema.parse({
        entries: [],
        retentionDays: AUDIT_MAX_RETENTION_DAYS + 1,
      }),
    ).toThrow()
  })

  test("(8) AuditLogSchema_DefaultsRetentionTo365 — empty config", () => {
    const parsed = AuditLogSchema.parse({ entries: [] })
    expect(parsed.retentionDays).toBe(365)
  })
})

// =========================================================================
// EN-03 — Compliance
// =========================================================================

describe("EN-03 Compliance — frameworks + controls", () => {
  test("(9) ComplianceConfigSchema_ParsesValid — frameworks + controls", () => {
    const parsed = parseComplianceConfig({
      frameworks: ["soc2"],
      controls: [
        {
          controlId: "CC1.1",
          framework: "soc2",
          description: "Code of conduct",
          enforced: true,
        },
      ],
    })
    expect(parsed.frameworks).toEqual(["soc2"])
    expect(parsed.controls).toHaveLength(1)
    expect(parsed.controls[0]?.enforced).toBe(true)
  })

  test("(10) ComplianceConfigSchema_RejectsEmptyFrameworks", () => {
    expect(() =>
      ComplianceConfigSchema.parse({ frameworks: [], controls: [] }),
    ).toThrow()
  })

  test("(11) ComplianceControlSchema_DefaultsEnforcedFalse — aspirational by default", () => {
    const parsed = ComplianceControlSchema.parse({
      controlId: "CC1.2",
      framework: "soc2",
      description: "Background checks",
    })
    expect(parsed.enforced).toBe(false)
  })

  test("(12) ComplianceConfigSchema_AcceptsAll5Frameworks", () => {
    expect(COMPLIANCE_FRAMEWORKS).toHaveLength(5)
    for (const framework of COMPLIANCE_FRAMEWORKS) {
      const parsed = ComplianceConfigSchema.parse({
        frameworks: [framework],
        controls: [],
      })
      expect(parsed.frameworks).toEqual([framework])
    }
  })
})
