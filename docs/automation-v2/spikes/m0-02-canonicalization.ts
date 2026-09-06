/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0-02 throwaway canonicalization spike — Plan V2.3.1 §193 + ADR-001.
 *
 * Explicitly non-production. No stable persisted format. No public
 * compatibility promise. Discarded/migrated after ADR-001 is rendered.
 *
 * What this does: it loads the `canonicalize` package (npm) and
 * verifies that the JCS (RFC 8785) implementation produces stable,
 * deterministic, domain-separated digests for representative inputs.
 *
 * Why this is throwaway:
 * - It depends on a transient `bun add --no-save canonicalize` (not
 *   committed to package.json).
 * - The vectors are local, not part of an RFC 8785 conformance test
 *   suite.
 * - After ADR-001, the production canonicalization code lives in
 *   `@unifia/digest-runtime/` (PROPOSED) with proper types and
 *   end-to-end tests.
 */

import { createHash } from "node:crypto"
import canonicalize from "canonicalize"

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function jcsSha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex")
}

type Verdict = "PASS" | "FAIL"

const results: { name: string; verdict: Verdict; evidence: string }[] = []

function record(name: string, verdict: Verdict, evidence: string): void {
  results.push({ name, verdict, evidence })
  console.log(`[${verdict.padEnd(4)}] ${name} — ${evidence}`)
}

// -----------------------------------------------------------------------
// Test vectors
// -----------------------------------------------------------------------

function runTests() {
  // 1. Determinism: same input → same digest.
  const v1a = { id: "wf-1", version: 1, steps: [{ id: "a", capability: "workspace.read" }] }
  const v1b = { id: "wf-1", version: 1, steps: [{ id: "a", capability: "workspace.read" }] }
  const d1a = jcsSha256(v1a)
  const d1b = jcsSha256(v1b)
  if (d1a === d1b) {
    record("determinism", "PASS", `same input -> same SHA-256 (${d1a.slice(0, 16)}...)`)
  } else {
    record("determinism", "FAIL", `differ: ${d1a} vs ${d1b}`)
  }

  // 2. Key order: two structurally-equal objects with different key
  // order produce the same digest.
  const v2a = { z: 1, a: 2, m: 3 }
  const v2b = { a: 2, m: 3, z: 1 }
  const d2a = jcsSha256(v2a)
  const d2b = jcsSha256(v2b)
  if (d2a === d2b) {
    record("key order invariance", "PASS", `JCS sorts keys lexicographically`)
  } else {
    record("key order invariance", "FAIL", `differ: ${d2a} vs ${d2b}`)
  }

  // 3. Nested key order: same at depth.
  const v3a = { outer: { z: 1, a: 2 } }
  const v3b = { outer: { a: 2, z: 1 } }
  const d3a = jcsSha256(v3a)
  const d3b = jcsSha256(v3b)
  if (d3a === d3b) {
    record("nested key order invariance", "PASS", `recursive sort works`)
  } else {
    record("nested key order invariance", "FAIL", `differ: ${d3a} vs ${d3b}`)
  }

  // 4. Numeric precision: 1.0 and 1 should serialize differently
  // (RFC 8785 §3.2.2.3).
  const v4a = { x: 1 }
  const v4b = { x: 1.0 }
  const c4a = canonicalize(v4a) as string
  const c4b = canonicalize(v4b) as string
  if (c4a === '{"x":1}' && c4b === '{"x":1.0}') {
    record("numeric precision (RFC 8785 §3.2.2.3)", "PASS", `1 -> "1", 1.0 -> "1.0"`)
  } else {
    record("numeric precision (RFC 8785 §3.2.2.3)", "FAIL", `got ${c4a} and ${c4b}`)
  }

  // 5. Unicode: é in a key.
  const v5 = { "café": 1 }
  const c5 = canonicalize(v5) as string
  // JCS uses UTF-8 by default. The é is 0xC3 0xA9 in UTF-8.
  if (c5.includes("café")) {
    record("unicode preservation", "PASS", `output: ${c5}`)
  } else {
    record("unicode preservation", "FAIL", `output: ${c5}`)
  }

  // 6. Array order: array element order is preserved (JCS does NOT
  // sort arrays).
  const v6a = { a: [1, 2, 3] }
  const v6b = { a: [3, 2, 1] }
  const d6a = jcsSha256(v6a)
  const d6b = jcsSha256(v6b)
  if (d6a !== d6b) {
    record("array order preserved (JCS does not sort arrays)", "PASS", `differ: ${d6a.slice(0, 16)}... vs ${d6b.slice(0, 16)}...`)
  } else {
    record("array order preserved (JCS does not sort arrays)", "FAIL", "arrays are equal when they should differ")
  }

  // 7. Domain separation: same payload with different "domain" prefix
  // produces different digests.
  // We simulate the DigestEnvelope by including the domain in the
  // canonicalized object.
  const payload = { id: "wf-1", version: 1 }
  const workflowVersionDigest = jcsSha256({ domain: "workflow-version", payload })
  const approvalEffectDigest = jcsSha256({ domain: "approval-effect", payload })
  if (workflowVersionDigest !== approvalEffectDigest) {
    record("domain separation", "PASS", `workflow-version != approval-effect (${workflowVersionDigest.slice(0, 16)}... vs ${approvalEffectDigest.slice(0, 16)}...)`)
  } else {
    record("domain separation", "FAIL", "domains collide!")
  }

  // 8. Stability of the canonical form: same input produces the same
  // string (not just the same hash).
  const v8a = { x: 1, y: 2 }
  const v8b = { y: 2, x: 1 }
  const c8a = canonicalize(v8a) as string
  const c8b = canonicalize(v8b) as string
  if (c8a === c8b) {
    record("canonical form stability (same string, not just same hash)", "PASS", `output: ${c8a}`)
  } else {
    record("canonical form stability", "FAIL", `differ: ${c8a} vs ${c8b}`)
  }

  // 9. Algorithm migration: same input, different domain prefix
  // ("JCS-v1" vs "JCS-v2") produces different digests.
  // This proves we can upgrade the algorithm without colliding with
  // the old digests.
  const v9 = { id: "wf-1" }
  const jcsV1 = jcsSha256({ algorithm: "JCS-v1", payload: v9 })
  const jcsV2 = jcsSha256({ algorithm: "JCS-v2", payload: v9 })
  if (jcsV1 !== jcsV2) {
    record("algorithm migration (JCS-v1 vs JCS-v2)", "PASS", `v1 != v2 (${jcsV1.slice(0, 16)}... vs ${jcsV2.slice(0, 16)}...)`)
  } else {
    record("algorithm migration (JCS-v1 vs JCS-v2)", "FAIL", "versions collide")
  }
}

// -----------------------------------------------------------------------
// Final verdict
// -----------------------------------------------------------------------

runTests()

const pass = results.filter((r) => r.verdict === "PASS").length
const fail = results.filter((r) => r.verdict === "FAIL").length

console.log("")
console.log("M0-02 spike summary")
console.log("===================")
console.log(`PASS  ${pass}`)
console.log(`FAIL  ${fail}`)
console.log("")

if (fail === 0) {
  console.log("Verdict: the `canonicalize` package (npm) implements JCS")
  console.log("(RFC 8785) correctly for all 9 vectors. ADR-001 (canonicalization)")
  console.log("is feasible with this library as the production dependency.")
  console.log("")
  console.log("Next step: render ADR-001 with `canonicalize` + SHA-256 +")
  console.log("the 7-domain separation (workflow-version, approval-effect, policy,")
  console.log("connector-manifest, mcp-schema, deployment, artifact-bytes).")
} else {
  console.log("Verdict: the canonicalize package does NOT pass all vectors.")
  console.log("ADR-001 needs a different library or a hand-rolled implementation.")
}
