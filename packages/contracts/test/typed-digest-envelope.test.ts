/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * ADR-026 — typed DigestEnvelope per domain (parsing-boundary cross-domain guard).
 *
 * Plan V2.3.1 §64, §65, §195-197 (M1 gate) + ADR-001 (digest contract) +
 * ADR-026 (typed envelopes).
 *
 * M1-02 evidence §3.1 identified a cross-domain gap: the Zod schema
 * `DigestEnvelopeSchema` validates the *shape* of the envelope but not
 * the *domain* literal relative to a call site. The branded type
 * system (compile-time) and `asDomainDigest()` (runtime) close the
 * gap for typed call sites — but at the parsing boundary, before any
 * type narrowing happens, the schema accepted any of the 7 domain
 * literals.
 *
 * ADR-026 fixes that with 7 per-domain Zod refinements. This test
 * file pins the contract:
 *   - Each per-domain schema accepts a well-formed envelope with the
 *     matching domain literal.
 *   - Each per-domain schema rejects a well-formed envelope with a
 *     non-matching domain literal.
 *   - The existing `WorkflowVersion.versionDigest` and
 *     `ArtifactRef.contentDigest` fields now reject cross-domain
 *     inputs at the parsing boundary (the gap is closed).
 *   - The generic `DigestEnvelopeSchema` and the runtime
 *     `asDomainDigest()` escape hatch are unchanged (backward
 *     compatibility for trust-boundary loaders).
 *   - All 7 typed schemas are exported, distinct, and cover every
 *     member of the `DigestDomain` enum.
 *
 * Companion to the throwaway spike
 * `docs/automation-v2/spikes/adr-026-typed-digest-envelope.ts`.
 */
import { describe, expect, test } from "bun:test"
import {
  DigestEnvelopeSchema,
  DigestDomainSchema,
  WorkflowVersionDigestSchema,
  ApprovalEffectDigestSchema,
  PolicyDigestSchema,
  ConnectorManifestDigestSchema,
  McpSchemaDigestSchema,
  DeploymentDigestSchema,
  ArtifactBytesDigestSchema,
  asDomainDigest,
  type DigestDomain,
} from "../src/digest.ts"
import { WorkflowVersionSchema } from "../src/workflow-ir.ts"
import { ArtifactRefSchema, ArtifactRecordSchema } from "../src/artifact-record.ts"

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

/** All seven domain literals, in the same order as `DigestDomainSchema.options`. */
const ALL_DOMAINS: DigestDomain[] = DigestDomainSchema.options

/**
 * Map each domain literal to its per-domain schema. Used to assert
 * "all 7 typed schemas exist and are distinct" in one test.
 */
const TYPED_SCHEMAS = {
  "workflow-version": WorkflowVersionDigestSchema,
  "approval-effect": ApprovalEffectDigestSchema,
  "policy": PolicyDigestSchema,
  "connector-manifest": ConnectorManifestDigestSchema,
  "mcp-schema": McpSchemaDigestSchema,
  "deployment": DeploymentDigestSchema,
  "artifact-bytes": ArtifactBytesDigestSchema,
} as const satisfies Record<DigestDomain, unknown>

/**
 * Build a syntactically-valid `DigestEnvelope` for a given domain.
 * The 64-char `value` is all zeros — the test does not need a real
 * SHA-256, only a well-formed envelope shape.
 */
function envelopeFor(domain: DigestDomain): ReturnType<typeof DigestEnvelopeSchema.parse> {
  return DigestEnvelopeSchema.parse({
    version: 1,
    domain,
    canonicalizationAlgorithm: "JCS-v1",
    hashAlgorithm: "SHA-256",
    value: "0".repeat(64),
  })
}

/** Minimal valid `WorkflowDefinition` so Zod can traverse the recursion. */
const validWorkflowDefinition = {
  definitionId: "d1",
  ownershipScope: { organizationId: "o1", workspaceId: "w1" },
  displayName: "Test WF",
  nodes: [] as const,
  edges: [] as const,
  concurrency: { kind: "none" as const },
  defaultFailurePolicy: { kind: "propagate" as const },
  defaultTimeoutMs: 30_000,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
} as const

// -----------------------------------------------------------------------
// (a) Per-domain schema accepts matching domain literal
// -----------------------------------------------------------------------

describe("Typed DigestEnvelope schemas — accept the matching domain literal", () => {
  test("(a) WorkflowVersionDigestSchema accepts a workflow-version envelope", () => {
    const env = envelopeFor("workflow-version")
    const parsed = WorkflowVersionDigestSchema.parse(env)
    expect(parsed.domain).toBe("workflow-version")
  })

  test("(c) ArtifactBytesDigestSchema accepts an artifact-bytes envelope", () => {
    const env = envelopeFor("artifact-bytes")
    const parsed = ArtifactBytesDigestSchema.parse(env)
    expect(parsed.domain).toBe("artifact-bytes")
  })

  test("(i) all 7 typed schemas accept their own domain literal", () => {
    for (const d of ALL_DOMAINS) {
      const env = envelopeFor(d)
      const schema = TYPED_SCHEMAS[d]
      expect(() => schema.parse(env)).not.toThrow()
    }
  })
})

// -----------------------------------------------------------------------
// (b) Per-domain schema rejects non-matching domain literal
// -----------------------------------------------------------------------

describe("Typed DigestEnvelope schemas — reject non-matching domain literal (cross-domain guard)", () => {
  test("(b) WorkflowVersionDigestSchema rejects a policy envelope", () => {
    const env = envelopeFor("policy")
    expect(() => WorkflowVersionDigestSchema.parse(env)).toThrow(/workflow-version/)
  })

  test("(d) ArtifactBytesDigestSchema rejects a workflow-version envelope", () => {
    const env = envelopeFor("workflow-version")
    expect(() => ArtifactBytesDigestSchema.parse(env)).toThrow(/artifact-bytes/)
  })

  test("all 7 typed schemas reject the 6 non-matching domain literals", () => {
    for (const targetDomain of ALL_DOMAINS) {
      const targetSchema = TYPED_SCHEMAS[targetDomain]
      for (const otherDomain of ALL_DOMAINS) {
        if (otherDomain === targetDomain) continue
        const env = envelopeFor(otherDomain)
        // The refine message embeds the expected domain literal; we
        // assert the throw happens (the exact text is the helper's
        // contract, not part of the API surface).
        expect(() => targetSchema.parse(env)).toThrow()
      }
    }
  })
})

// -----------------------------------------------------------------------
// (e, f) Parsing boundary enforces the domain on the actual call sites
// -----------------------------------------------------------------------

describe("Parsing boundary on the call sites — the cross-domain gap is closed", () => {
  test("(e) WorkflowVersion.versionDigest rejects a policy envelope at parse time", () => {
    const policyEnv = envelopeFor("policy")
    const result = WorkflowVersionSchema.safeParse({
      versionId: "v1",
      definitionId: "d1",
      versionNumber: 1,
      definition: validWorkflowDefinition,
      versionDigest: policyEnv,
      createdAt: 1_700_000_000,
      createdBy: "erwan",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      // The error path is `versionDigest` (Zod path on the nested refine).
      const paths = result.error.issues.map((i) => i.path.join("."))
      expect(paths.some((p) => p.startsWith("versionDigest"))).toBe(true)
    }
  })

  test("(e+) WorkflowVersion.versionDigest accepts a workflow-version envelope", () => {
    const wfEnv = envelopeFor("workflow-version")
    const result = WorkflowVersionSchema.safeParse({
      versionId: "v1",
      definitionId: "d1",
      versionNumber: 1,
      definition: validWorkflowDefinition,
      versionDigest: wfEnv,
      createdAt: 1_700_000_000,
      createdBy: "erwan",
    })
    expect(result.success).toBe(true)
  })

  test("(f) ArtifactRef.contentDigest rejects a workflow-version envelope at parse time", () => {
    const wfEnv = envelopeFor("workflow-version")
    const result = ArtifactRefSchema.safeParse({
      artifactId: "a-1",
      contentDigest: wfEnv,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."))
      expect(paths.some((p) => p.startsWith("contentDigest"))).toBe(true)
    }
  })

  test("(f+) ArtifactRef.contentDigest accepts an artifact-bytes envelope", () => {
    const abEnv = envelopeFor("artifact-bytes")
    const result = ArtifactRefSchema.safeParse({
      artifactId: "a-1",
      contentDigest: abEnv,
    })
    expect(result.success).toBe(true)
  })

  test("ArtifactRecord.contentDigest rejects a workflow-version envelope (store-authoritative path)", () => {
    const wfEnv = envelopeFor("workflow-version")
    const result = ArtifactRecordSchema.safeParse({
      artifactId: "a-2",
      ownershipScope: { organizationId: "o1", workspaceId: "w1" },
      contentDigest: wfEnv,
      mediaType: "text/html",
      size: 14,
      storageClass: "hot",
      taints: [],
      classification: "internal",
      origin: { kind: "workflow", ref: "wf-1" },
      retentionPolicy: { ttlSeconds: 86_400 },
      createdAt: 1_700_000_000,
    })
    expect(result.success).toBe(false)
  })

  test("ArtifactRecord.contentDigest accepts an artifact-bytes envelope (store-authoritative path)", () => {
    const abEnv = envelopeFor("artifact-bytes")
    const result = ArtifactRecordSchema.safeParse({
      artifactId: "a-2",
      ownershipScope: { organizationId: "o1", workspaceId: "w1" },
      contentDigest: abEnv,
      mediaType: "text/html",
      size: 14,
      storageClass: "hot",
      taints: [],
      classification: "internal",
      origin: { kind: "workflow", ref: "wf-1" },
      retentionPolicy: { ttlSeconds: 86_400 },
      createdAt: 1_700_000_000,
    })
    expect(result.success).toBe(true)
  })
})

// -----------------------------------------------------------------------
// (g, h) Backward compatibility — generic envelope + escape hatch
// -----------------------------------------------------------------------

describe("Backward compatibility — generic schema + runtime escape hatch", () => {
  test("(g) asDomainDigest still works (the existing API is not broken)", () => {
    const env = envelopeFor("workflow-version")
    const typed = asDomainDigest(env, "workflow-version")
    expect(typed.domain).toBe("workflow-version")
  })

  test("(g+) asDomainDigest still throws on cross-domain input (runtime guard)", () => {
    const env = envelopeFor("policy")
    expect(() => asDomainDigest(env, "workflow-version")).toThrow(/domain mismatch/)
  })

  test("(h) DigestEnvelopeSchema (the generic one) accepts all 7 domains", () => {
    for (const d of ALL_DOMAINS) {
      const env = envelopeFor(d)
      expect(() => DigestEnvelopeSchema.parse(env)).not.toThrow()
    }
  })

  test("(h+) DigestEnvelopeSchema still rejects a malformed envelope (shape check)", () => {
    expect(() =>
      DigestEnvelopeSchema.parse({
        version: 2, // not the literal 1
        domain: "policy",
        canonicalizationAlgorithm: "JCS-v1",
        hashAlgorithm: "SHA-256",
        value: "0".repeat(64),
      }),
    ).toThrow()
  })
})

// -----------------------------------------------------------------------
// (i) All 7 typed schemas exist and are distinct
// -----------------------------------------------------------------------

describe("Inventory — all 7 typed schemas are exported and distinct", () => {
  test("(i) each domain has its own typed schema, and they are not the same object", () => {
    const seen = new Set<unknown>()
    for (const d of ALL_DOMAINS) {
      const schema = TYPED_SCHEMAS[d]
      expect(schema).toBeDefined()
      expect(seen.has(schema)).toBe(false)
      seen.add(schema)
    }
    expect(seen.size).toBe(7)
  })
})

// -----------------------------------------------------------------------
// (j) The migration is backward-compatible with the existing 108 tests
// -----------------------------------------------------------------------

describe("Migration is backward-compatible (regression net for the 108 baseline tests)", () => {
  test("(j) a well-formed artifact-bytes envelope produced by digest-runtime is accepted by ArtifactRef", () => {
    // Smoke: simulate the artifact-store path (digest + asDomainDigest
    // + parse). The envelope's domain is "artifact-bytes" by
    // construction, so the per-domain refine passes.
    const env = envelopeFor("artifact-bytes")
    const ref = ArtifactRefSchema.parse({ artifactId: "a-1", contentDigest: env })
    expect(ref.contentDigest.domain).toBe("artifact-bytes")
    expect(ref.contentDigest.value).toBe("0".repeat(64))
  })

  test("(j+) a well-formed workflow-version envelope is accepted by WorkflowVersion", () => {
    const env = envelopeFor("workflow-version")
    const parsed = WorkflowVersionSchema.parse({
      versionId: "v1",
      definitionId: "d1",
      versionNumber: 1,
      definition: validWorkflowDefinition,
      versionDigest: env,
      createdAt: 1_700_000_000,
      createdBy: "erwan",
    })
    expect(parsed.versionDigest.domain).toBe("workflow-version")
  })
})
