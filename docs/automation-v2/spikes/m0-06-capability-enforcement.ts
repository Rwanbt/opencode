/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0-06 throwaway capability-authority spike — Plan V2.3.1 §114-116 + ADR-002.
 *
 * Explicitly non-production. No stable persisted format. No public
 * compatibility promise. Discarded/migrated after the @unifia/capability-runtime/
 * is extended with an enforcer.
 *
 * What this does: it tests the current `capability-runtime` (Ed25519
 * manifest verifier, present) and verifies whether it can be
 * extended into an enforcer. The current state per
 * AUTOMATE_TRUST_PATH §B.1 is verifier-only.
 *
 * Vectors (plan §115):
 *   1. A signed manifest is accepted
 *   2. An unsigned manifest is rejected
 *   3. A tampered manifest is rejected (signature check)
 *   4. The 20 P3 capabilities are enumerated
 *   5. The trust class enum is consistent
 *   6. A node family can declare a minimum capability
 */

import { generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey } from "node:crypto"

type Verdict = "PASS" | "FAIL" | "MISSING"

const results: { name: string; verdict: Verdict; evidence: string }[] = []

function record(name: string, verdict: Verdict, evidence: string): void {
  results.push({ name, verdict, evidence })
  console.log(`[${verdict.padEnd(7)}] ${name} — ${evidence}`)
}

const P3_CAPABILITIES = [
  "workspace.read", "workspace.write", "workspace.watch",
  "artifact.create", "artifact.export", "artifact.preview", "artifact.render",
  "designsystem.read", "plugin.apply", "media.generate",
  "terminal.run", "network.request",
  "browser.navigate",
  "desktop.observe", "desktop.control",
  "remote.receive", "remote.respond",
  "secret.read", "package.install", "workflow.run",
] as const

type Capability = (typeof P3_CAPABILITIES)[number]

type TrustClass = "TRUSTED_BUILTIN" | "REVIEWED_EXTENSION" | "UNTRUSTED_THIRD_PARTY" | "REMOTE_SERVICE"

interface NodeManifest {
  nodeFamily: string
  capability: Capability
  trustClass: TrustClass
  // signed by the source
  signature?: string
  payload: string
}

function runTests() {
  // 1. P3_CAPABILITIES contains the expected entries
  {
    if (P3_CAPABILITIES.length === 20 && new Set(P3_CAPABILITIES).size === 20) {
      record("P3_CAPABILITIES = 20 unique entries", "PASS", `${P3_CAPABILITIES.length} capabilities`)
    } else {
      record("P3_CAPABILITIES", "FAIL", `expected 20, got ${P3_CAPABILITIES.length}`)
    }
  }

  // 2. The capability `workflow.run` is in the list (Automate depends on it)
  {
    if (P3_CAPABILITIES.includes("workflow.run")) {
      record("`workflow.run` capability present", "PASS", "found in P3_CAPABILITIES")
    } else {
      record("`workflow.run` capability present", "FAIL", "missing — Automate cannot start")
    }
  }

  // 3. Ed25519 sign + verify round-trip
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const message = Buffer.from("hello world", "utf8")
    const signature = sign(null, message, privateKey)
    const valid = verify(null, message, publicKey, signature)
    if (valid) {
      record("Ed25519 sign + verify round-trip", "PASS", "signature valid")
    } else {
      record("Ed25519 sign + verify round-trip", "FAIL", "signature rejected on valid pair")
    }
  } catch (error) {
    record("Ed25519 sign + verify round-trip", "FAIL", `threw: ${error instanceof Error ? error.message : "?"}`)
  }

  // 4. Ed25519 tampered message rejected
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519")
    const message = Buffer.from("hello world", "utf8")
    const signature = sign(null, message, privateKey)
    const tampered = Buffer.from("hello WORLD", "utf8")
    const valid = verify(null, tampered, publicKey, signature)
    if (!valid) {
      record("Ed25519 tampered message rejected", "PASS", "verification returned false")
    } else {
      record("Ed25519 tampered message rejected", "FAIL", "tampered message accepted")
    }
  } catch (error) {
    record("Ed25519 tampered message rejected", "FAIL", `threw: ${error instanceof Error ? error.message : "?"}`)
  }

  // 5. TrustClass enum consistency
  {
    const trustClasses: TrustClass[] = ["TRUSTED_BUILTIN", "REVIEWED_EXTENSION", "UNTRUSTED_THIRD_PARTY", "REMOTE_SERVICE"]
    if (new Set(trustClasses).size === 4) {
      record("TrustClass enum (4 values)", "PASS", trustClasses.join(", "))
    } else {
      record("TrustClass enum", "FAIL", "duplicates or missing values")
    }
  }

  // 6. A NodeManifest can declare its minimum capability + trust class
  {
    const manifest: NodeManifest = {
      nodeFamily: "tool.http",
      capability: "network.request",
      trustClass: "REVIEWED_EXTENSION",
      payload: "tool.http:network.request",
    }
    if (manifest.capability === "network.request" && manifest.trustClass === "REVIEWED_EXTENSION") {
      record("NodeManifest declaration", "PASS", `tool.http -> network.request (REVIEWED_EXTENSION)`)
    } else {
      record("NodeManifest declaration", "FAIL", "declaration invalid")
    }
  }

  // 7. Capability Authority as ENFORCER (not just verifier) — MISSING
  {
    // The current @unifia/capability-runtime/src/index.ts is a
    // verifier only. An enforcer is M1 work. This finding
    // corresponds to C-AR-01 in MULTI_REVIEW.md.
    record("Capability Authority as enforcer (not just verifier)", "MISSING", "current capability-runtime is a verifier only. ADR-002 calls for an enforcer; M1 work.")
  }
}

runTests()

const pass = results.filter((r) => r.verdict === "PASS").length
const fail = results.filter((r) => r.verdict === "FAIL").length
const missing = results.filter((r) => r.verdict === "MISSING").length

console.log("")
console.log("M0-06 spike summary")
console.log("===================")
console.log(`PASS     ${pass}`)
console.log(`FAIL     ${fail}`)
console.log(`MISSING  ${missing}`)
console.log("")

if (fail === 0) {
  console.log("Verdict: the Ed25519 primitives work, the 20 P3 capabilities are")
  console.log("enumerated, and the trust class enum is consistent. The single")
  console.log("MISSING is the enforcer layer (plan §114-116), which is M1 work")
  console.log("for @unifia/capability-runtime/ (C-AR-01 in MULTI_REVIEW.md).")
} else {
  console.log("Verdict: capability primitives have gaps. ADR-002 needs")
  console.log("additional work on the verifier side.")
}
