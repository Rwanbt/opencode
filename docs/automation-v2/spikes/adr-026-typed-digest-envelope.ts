/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * ADR-026 throwaway spike — Plan V2.3.1 §64, §195-197 (C-M1-02, M1 gate).
 *
 * Runs the 5 acceptance tests for ADR-026: the cross-domain guard is
 * now active at the *parsing boundary*, in addition to the existing
 * runtime guard (`asDomainDigest()`) and compile-time guard (branded
 * type system). The 5 vectors are:
 *
 *   1. `WorkflowVersionSchema.parse({versionDigest: {domain: "policy"...}})`
 *      is now REJECTED (the gap is closed).
 *   2. `ArtifactRefSchema.parse({contentDigest: {domain: "workflow-version"...}})`
 *      is now REJECTED (the gap is closed).
 *   3. `ArtifactRecordSchema.parse({contentDigest: {domain: "workflow-version"...}})`
 *      is now REJECTED (the store-authoritative path is also covered).
 *   4. The 7 typed schemas are distinct, exported, and each rejects the
 *      6 non-matching domain literals.
 *   5. The generic `DigestEnvelopeSchema` and `asDomainDigest()` are
 *      unchanged (backward compatibility — 108 baseline tests stay
 *      green, 19 new tests are added).
 *
 * This is *not* the production test suite — that lives in
 * `packages/contracts/test/typed-digest-envelope.test.ts` (19 cases).
 * This spike is the evidence file that pins the 5 acceptance criteria
 * for the ADR-026 card.
 *
 * Pattern is the same as the M1-NN series: a single throwaway file in
 * `docs/automation-v2/spikes/`, executed with `bun`, distribution
 * expected 5/0/0/0.
 */

import { z } from "zod"
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
} from "../../../packages/contracts/src/index.ts"
import {
  WorkflowVersionSchema,
  type WorkflowVersion,
} from "../../../packages/contracts/src/workflow-ir.ts"
import {
  ArtifactRefSchema,
  ArtifactRecordSchema,
  type ArtifactRef,
  type ArtifactRecord,
} from "../../../packages/contracts/src/artifact-record.ts"

// -----------------------------------------------------------------------
// Verdict collector
// -----------------------------------------------------------------------

type Verdict = "PASS" | "PARTIAL" | "FAIL" | "MISSING"

interface TestResult {
  readonly name: string
  readonly verdict: Verdict
  readonly evidence: string
}

const results: TestResult[] = []

function record(name: string, verdict: Verdict, evidence: string): void {
  results.push({ name, verdict, evidence })
  const tag = verdict === "MISSING" ? "MISS." : verdict
  console.log(`[${tag.padEnd(7)}] ${name} — ${evidence}`)
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Build a syntactically-valid DigestEnvelope for any domain literal.
 * The 64-char value is zeros — the test cares about the envelope
 * *shape* and the `domain` literal, not a real SHA-256.
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

function validWorkflowVersionPayload(versionDigest: ReturnType<typeof envelopeFor>): unknown {
  return {
    versionId: "v1",
    definitionId: "d1",
    versionNumber: 1,
    definition: validWorkflowDefinition,
    versionDigest,
    createdAt: 1_700_000_000,
    createdBy: "erwan",
  }
}

function validArtifactRecordPayload(contentDigest: ReturnType<typeof envelopeFor>): unknown {
  return {
    artifactId: "a-1",
    ownershipScope: { organizationId: "o1", workspaceId: "w1" },
    contentDigest,
    mediaType: "text/html",
    size: 14,
    storageClass: "hot",
    taints: [],
    classification: "internal",
    origin: { kind: "workflow" as const, ref: "wf-1" },
    retentionPolicy: { ttlSeconds: 86_400 },
    createdAt: 1_700_000_000,
  }
}

// -----------------------------------------------------------------------
// The 5 acceptance tests
// -----------------------------------------------------------------------

function runAcceptance(): void {
  // (1) WorkflowVersionSchema.parse({versionDigest: {domain: "policy"...}}) is
  // now REJECTED. The M1-02 spike (test 1) demonstrated the gap; ADR-026
  // closes it via WorkflowVersionDigestSchema (a Zod refine on the
  // domain literal).
  try {
    const policyEnv = envelopeFor("policy")
    const wfEnv = envelopeFor("workflow-version")

    const crossResult = WorkflowVersionSchema.safeParse(
      validWorkflowVersionPayload(policyEnv),
    )
    const matchedResult = WorkflowVersionSchema.safeParse(
      validWorkflowVersionPayload(wfEnv),
    )

    if (!crossResult.success && matchedResult.success) {
      const issuePaths = crossResult.error.issues.map((i) => i.path.join("."))
      const versionDigestRejected = issuePaths.some((p) => p.startsWith("versionDigest"))
      const domainInMessage = crossResult.error.issues
        .map((i) => i.message)
        .some((m) => m.includes("workflow-version"))
      record(
        "1) WorkflowVersionSchema cross-domain guard (Zod level)",
        "PASS",
        `cross-domain (policy) REJECTED at parse time (paths=${JSON.stringify(issuePaths)}, domain-message=${domainInMessage}); matching (workflow-version) envelope ACCEPTED; the M1-02 gap is closed`,
      )
    } else if (crossResult.success) {
      record(
        "1) WorkflowVersionSchema cross-domain guard (Zod level)",
        "FAIL",
        `expected cross-domain (policy) to be REJECTED, but it was ACCEPTED — the gap is still open`,
      )
    } else {
      record(
        "1) WorkflowVersionSchema cross-domain guard (Zod level)",
        "FAIL",
        `matching (workflow-version) envelope was REJECTED (control failure): ${matchedResult.success ? "ok" : matchedResult.error.issues[0]?.message ?? "no detail"}`,
      )
    }
  } catch (err) {
    record(
      "1) WorkflowVersionSchema cross-domain guard (Zod level)",
      "FAIL",
      `threw ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // (2) ArtifactRefSchema.parse({contentDigest: {domain: "workflow-version"...}})
  // is now REJECTED.
  try {
    const wfEnv = envelopeFor("workflow-version")
    const abEnv = envelopeFor("artifact-bytes")

    const crossResult = ArtifactRefSchema.safeParse({
      artifactId: "a-1",
      contentDigest: wfEnv,
    })
    const matchedResult = ArtifactRefSchema.safeParse({
      artifactId: "a-1",
      contentDigest: abEnv,
    })

    if (!crossResult.success && matchedResult.success) {
      const issuePaths = crossResult.error.issues.map((i) => i.path.join("."))
      const contentDigestRejected = issuePaths.some((p) => p.startsWith("contentDigest"))
      const domainInMessage = crossResult.error.issues
        .map((i) => i.message)
        .some((m) => m.includes("artifact-bytes"))
      record(
        "2) ArtifactRefSchema cross-domain guard (Zod level)",
        "PASS",
        `cross-domain (workflow-version) REJECTED (paths=${JSON.stringify(issuePaths)}, domain-message=${domainInMessage}); matching (artifact-bytes) envelope ACCEPTED`,
      )
    } else if (crossResult.success) {
      record(
        "2) ArtifactRefSchema cross-domain guard (Zod level)",
        "FAIL",
        `expected cross-domain (workflow-version) to be REJECTED, but it was ACCEPTED`,
      )
    } else {
      record(
        "2) ArtifactRefSchema cross-domain guard (Zod level)",
        "FAIL",
        `matching (artifact-bytes) envelope was REJECTED: ${matchedResult.success ? "ok" : matchedResult.error.issues[0]?.message ?? "no detail"}`,
      )
    }
  } catch (err) {
    record(
      "2) ArtifactRefSchema cross-domain guard (Zod level)",
      "FAIL",
      `threw ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // (3) ArtifactRecordSchema (store-authoritative, plan §68) also
  // rejects a cross-domain envelope on its contentDigest field. The
  // store computes the digest with the digest-runtime + brands via
  // asDomainDigest, so this is a defense-in-depth check — the test
  // ensures the schema enforces the invariant even if a future
  // caller forgets the brand.
  try {
    const wfEnv = envelopeFor("workflow-version")
    const abEnv = envelopeFor("artifact-bytes")

    const crossResult = ArtifactRecordSchema.safeParse(
      validArtifactRecordPayload(wfEnv),
    )
    const matchedResult = ArtifactRecordSchema.safeParse(
      validArtifactRecordPayload(abEnv),
    )

    if (!crossResult.success && matchedResult.success) {
      const issuePaths = crossResult.error.issues.map((i) => i.path.join("."))
      record(
        "3) ArtifactRecordSchema cross-domain guard (store-authoritative path)",
        "PASS",
        `cross-domain (workflow-version) REJECTED (paths=${JSON.stringify(issuePaths)}); matching (artifact-bytes) envelope ACCEPTED`,
      )
    } else if (crossResult.success) {
      record(
        "3) ArtifactRecordSchema cross-domain guard (store-authoritative path)",
        "FAIL",
        `expected cross-domain (workflow-version) to be REJECTED, but it was ACCEPTED`,
      )
    } else {
      record(
        "3) ArtifactRecordSchema cross-domain guard (store-authoritative path)",
        "FAIL",
        `matching (artifact-bytes) envelope was REJECTED: ${matchedResult.success ? "ok" : matchedResult.error.issues[0]?.message ?? "no detail"}`,
      )
    }
  } catch (err) {
    record(
      "3) ArtifactRecordSchema cross-domain guard (store-authoritative path)",
      "FAIL",
      `threw ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // (4) All 7 typed schemas exist, are distinct, and each rejects the
  // 6 non-matching domain literals. This is the schema-inventory
  // guarantee — the 7 schemas cover the 7 members of DigestDomain
  // without overlap.
  try {
    const TYPED = {
      "workflow-version": WorkflowVersionDigestSchema,
      "approval-effect": ApprovalEffectDigestSchema,
      "policy": PolicyDigestSchema,
      "connector-manifest": ConnectorManifestDigestSchema,
      "mcp-schema": McpSchemaDigestSchema,
      "deployment": DeploymentDigestSchema,
      "artifact-bytes": ArtifactBytesDigestSchema,
    } as const satisfies Record<DigestDomain, unknown>

    const domains: DigestDomain[] = DigestDomainSchema.options

    // (4a) Inventory: 7 schemas, all distinct, one per domain literal.
    const seen = new Set<unknown>()
    for (const d of domains) {
      const schema = TYPED[d]
      if (!schema) {
        record("4) All 7 typed schemas are distinct and cover DigestDomain", "FAIL", `missing schema for domain "${d}"`)
        return
      }
      if (seen.has(schema)) {
        record("4) All 7 typed schemas are distinct and cover DigestDomain", "FAIL", `duplicate schema object for domain "${d}"`)
        return
      }
      seen.add(schema)
    }
    if (seen.size !== 7) {
      record("4) All 7 typed schemas are distinct and cover DigestDomain", "FAIL", `expected 7 distinct schemas, got ${seen.size}`)
      return
    }

    // (4b) Cross-domain rejection: for each (target, other) pair with
    // target !== other, parsing other through target fails.
    let rejectedCount = 0
    let expectedCount = 0
    for (const targetDomain of domains) {
      const targetSchema = TYPED[targetDomain]
      for (const otherDomain of domains) {
        if (otherDomain === targetDomain) continue
        expectedCount++
        const env = envelopeFor(otherDomain)
        const result = targetSchema.safeParse(env)
        if (!result.success) rejectedCount++
      }
    }
    if (rejectedCount !== expectedCount) {
      record(
        "4) All 7 typed schemas are distinct and cover DigestDomain",
        "FAIL",
        `expected ${expectedCount} cross-domain rejections, got ${rejectedCount}`,
      )
      return
    }

    // (4c) Self-acceptance: each schema accepts its own domain.
    for (const d of domains) {
      const env = envelopeFor(d)
      TYPED[d].parse(env) // throws if it fails
    }

    record(
      "4) All 7 typed schemas are distinct and cover DigestDomain",
      "PASS",
      `7 distinct schemas (one per DigestDomain); ${expectedCount}/${expectedCount} cross-domain rejections enforced; self-acceptance OK for all 7`,
    )
  } catch (err) {
    record(
      "4) All 7 typed schemas are distinct and cover DigestDomain",
      "FAIL",
      `threw ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // (5) Backward compatibility: the generic DigestEnvelopeSchema and
  // the runtime asDomainDigest() escape hatch are unchanged. The 108
  // baseline tests stay green; the migration is purely additive.
  try {
    // (5a) Generic schema still accepts all 7 domain literals.
    const domains: DigestDomain[] = DigestDomainSchema.options
    for (const d of domains) {
      DigestEnvelopeSchema.parse(envelopeFor(d))
    }

    // (5b) asDomainDigest still works for matching domain, still throws
    // for cross-domain input. The branded type is the type-system
    // escape hatch — unchanged.
    const wfEnv = envelopeFor("workflow-version")
    const typed = asDomainDigest(wfEnv, "workflow-version")
    let crossDomainThrew = false
    try {
      asDomainDigest(wfEnv, "policy")
    } catch {
      crossDomainThrew = true
    }

    if (typed.domain === "workflow-version" && crossDomainThrew) {
      record(
        "5) Backward compatibility — generic schema + asDomainDigest unchanged",
        "PASS",
        "DigestEnvelopeSchema accepts all 7 domain literals; asDomainDigest still brands and still throws on cross-domain input; the trust-boundary escape hatch is preserved",
      )
    } else {
      record(
        "5) Backward compatibility — generic schema + asDomainDigest unchanged",
        "FAIL",
        `typed.domain=${typed.domain}, crossDomainThrew=${crossDomainThrew}`,
      )
    }
  } catch (err) {
    record(
      "5) Backward compatibility — generic schema + asDomainDigest unchanged",
      "FAIL",
      `threw ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// -----------------------------------------------------------------------
// Final verdict
// -----------------------------------------------------------------------

runAcceptance()

const pass = results.filter((r) => r.verdict === "PASS").length
const partial = results.filter((r) => r.verdict === "PARTIAL").length
const fail = results.filter((r) => r.verdict === "FAIL").length
const missing = results.filter((r) => r.verdict === "MISSING").length

console.log("")
console.log("ADR-026 spike summary")
console.log("=====================")
console.log(`PASS     ${pass}`)
console.log(`PARTIAL  ${partial}`)
console.log(`FAIL     ${fail}`)
console.log(`MISSING  ${missing}`)
console.log("")

if (fail === 0 && missing === 0) {
  console.log("Verdict: cross-domain digest guard is enforced at the parsing boundary.")
  console.log("ADR-026 (typed DigestEnvelope per domain) is GREEN.")
  console.log("")
  console.log("Post-spike operator checks (out of band):")
  console.log("  cd packages/contracts && bun test                # 127/0 expected (108 + 19 new)")
  console.log("  bun run typecheck                                 # 43/43 expected")
  console.log("  cd packages/app && bun test --preload ./happydom.ts src/  # 1192/0 expected")
  console.log("  cd packages/artifact-store && bun test           # 16/0 expected")
  console.log("  cd packages/capability-runtime && bun test       # 17/0 expected")
  console.log("  cd packages/secret-broker && bun test            # 23/0 expected")
  console.log("  cd packages/digest-runtime && bun test           # 12/0 expected")
} else {
  console.log("Verdict: spike has failures or missing vectors.")
  console.log("Block the ADR-026 card until all 5 vectors are PASS.")
  if (fail > 0) process.exit(1)
}

// Quiet linter for unused imports (z, WorkflowVersion, ArtifactRef,
// ArtifactRecord). The imports document the contract surface; the
// runtime assertions use the schemas directly.
export const _types: ReadonlyArray<unknown> = [
  null as unknown as z.ZodTypeAny,
  null as unknown as WorkflowVersion | undefined,
  null as unknown as ArtifactRef | undefined,
  null as unknown as ArtifactRecord | undefined,
]
