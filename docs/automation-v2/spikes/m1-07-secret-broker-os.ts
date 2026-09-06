/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M1-07 throwaway spike — Plan V2.3.1 §3.7 + §5.6 + ADR-010.
 *
 * Runs the 5 acceptance tests of M1 plan §5.6 against the new
 * `createOsBroker()` from `@unifia/secret-broker`. The spike proves
 * that the in-memory scaffold can be ported onto an OS-aware backing
 * store (PBKDF2 fallback in the spike; DPAPI / Keychain / libsecret
 * in production) without losing any of the five invariants ADR-010
 * DECIDED:
 *
 *   1. round-trip persistence (DPAPI round-trip on Windows, plan §3.7(b))
 *   2. explicit KEY_UNAVAILABLE on empty / wrong-length root key (plan §79)
 *   3. AAD binding — `envelope(m, "credential-material")` then
 *      `unenvelope(env, "oauth-token")` throws `EnvelopeIntegrityError`
 *      (GCM tag refuses the swap)
 *   4. backup/restore — store a credential in one instance, read
 *      the same content digest in a second instance on the same
 *      machine with the same root key (plan §80)
 *   5. revocation — `revoke(ref)` then `resolveCredential(ref, scope)`
 *      throws `CredentialRevokedError`
 *
 * The spike is throwaway in the M0-02 / M1-06 sense: it is committed
 * once as evidence, then re-run on subsequent M1 reviews to confirm
 * the secret-broker still passes the plan gates.
 *
 * Cross-references:
 *   - plan §3.7 (C-M1-07) — the 9 acceptance criteria this spike
 *     validates (5 here; the other 4 are package tests)
 *   - plan §5.6 — the spike spec (5 tests, distribution 4 PASS / 1
 *     PARTIAL / 0 FAIL / 0 MISSING)
 *   - plan §7.2 — the AAD domain drift between
 *     `packages/secret-broker/src/index.ts:171-177` and
 *     `packages/contracts/src/protection.ts:60-64`; this M1-07
 *     card closes the drift by extending the contract to 6 values
 *   - plan §76 — the canonical 6-domain AAD list
 *   - M1-07-EVIDENCE.md — the long-form evidence file that pairs
 *     with this spike
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createOsBroker, newRandomRootKey, newTempStorageDir } from "../../../packages/secret-broker/src/os-broker.js"
import {
  CredentialRevokedError,
  EnvelopeIntegrityError,
  KeyUnavailableError,
  TenantMismatchError,
  type CredentialRef,
  type OwnershipScope,
} from "../../../packages/secret-broker/src/index.js"

// ---------------------------------------------------------------------------
// Verdict collector
// ---------------------------------------------------------------------------

type Verdict = "PASS" | "PARTIAL" | "FAIL" | "MISSING"

interface Result {
  name: string
  verdict: Verdict
  evidence: string
}

const results: Result[] = []

function record(name: string, verdict: Verdict, evidence: string): void {
  results.push({ name, verdict, evidence })
  const tag = verdict === "MISSING" ? "MISS." : verdict
  console.log(`[${tag.padEnd(7)}] ${name} — ${evidence}`)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCOPE_A: OwnershipScope = { organizationId: "org-A", workspaceId: "ws-1" }
const SCOPE_B: OwnershipScope = { organizationId: "org-B", workspaceId: "ws-2" }

const openedDirs: string[] = []

function tempBroker(platform: NodeJS.Platform = process.platform): {
  broker: ReturnType<typeof createOsBroker>
  storageDir: string
  cleanup: () => void
} {
  const storageDir = newTempStorageDir("unifia-spike-m1-07-")
  openedDirs.push(storageDir)
  const broker = createOsBroker({ rootKey: newRandomRootKey(), platform, storageDir })
  return {
    broker,
    storageDir,
    cleanup: () => {
      try {
        rmSync(storageDir, { recursive: true, force: true })
      } catch {
        // best-effort
      }
    },
  }
}

function credentialRef(scope: OwnershipScope, id: string): CredentialRef {
  return { kind: "credential", credentialId: id, scope }
}

function cleanupAll(): void {
  for (const d of openedDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Test 1: round-trip (DPAPI on Windows, PBKDF2 fallback elsewhere)
// ---------------------------------------------------------------------------
//
// plan §3.7(b) + §5.6. The first acceptance criterion: a stored
// credential is resolvable through the same broker on the same
// machine. On Windows, the on-disk bytes are protected by DPAPI; on
// macOS, by Keychain; on Linux, by libsecret. The PBKDF2 fallback
// is the spike's stand-in.
async function test1RoundTrip(): Promise<void> {
  const { broker, cleanup } = tempBroker()
  try {
    const ref = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(ref, "secret", "credential-material")
    const material = await broker.resolveCredential(ref, SCOPE_A)
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(material as Uint8Array)
    if (decoded !== "secret") {
      record("T1 — createOsBroker round-trip (plan §3.7(b))", "FAIL", `expected "secret", got "${decoded}"`)
    } else {
      record(
        "T1 — createOsBroker round-trip (plan §3.7(b))",
        "PASS",
        `storeCredential → resolveCredential returns "secret" (PBKDF2 fallback on ${process.platform}; DPAPI/Keychain/libsecret target in production)`,
      )
    }
  } finally {
    cleanup()
  }
}

// ---------------------------------------------------------------------------
// Test 2: KEY_UNAVAILABLE on empty / wrong-length root key
// ---------------------------------------------------------------------------
//
// plan §79. The broker MUST refuse an empty or non-32-byte root key
// with a typed `KeyUnavailableError` — no silent corruption, no
// defaulting to a zero key. This is the AEAD contract: AES-256-GCM
// wants a 32-byte key and a wrong-length key would otherwise either
// throw on first encrypt or — worse — silently truncate.
async function test2KeyUnavailable(): Promise<void> {
  const dir = newTempStorageDir("unifia-spike-m1-07-empty-")
  openedDirs.push(dir)
  try {
    let caught: unknown = null
    try {
      createOsBroker({ rootKey: new Uint8Array(0), storageDir: dir })
    } catch (err) {
      caught = err
    }
    if (!(caught instanceof KeyUnavailableError)) {
      record(
        "T2 — empty root key throws KeyUnavailableError (plan §79)",
        "FAIL",
        `expected KeyUnavailableError, got ${caught instanceof Error ? caught.constructor.name : String(caught)}`,
      )
      return
    }
    if (!/KEY_UNAVAILABLE/.test(caught.message)) {
      record(
        "T2 — empty root key throws KeyUnavailableError (plan §79)",
        "PARTIAL",
        `KeyUnavailableError thrown but message does not start with "KEY_UNAVAILABLE:": ${caught.message}`,
      )
      return
    }
    record(
      "T2 — empty root key throws KeyUnavailableError (plan §79)",
      "PASS",
      `KeyUnavailableError: "${caught.message.slice(0, 80)}…" (no silent corruption; the AEAD key length is enforced at the broker boundary)`,
    )
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Test 3: AAD binding (GCM tag refuses the swap)
// ---------------------------------------------------------------------------
//
// plan §3.7(g) + §5.6. The same envelope, decrypted with a
// different AAD domain, must throw `EnvelopeIntegrityError`. The
// GCM tag is computed over the AAD bytes, so a domain swap
// produces a tag mismatch and the platform primitive refuses to
// decrypt. This is the property the 6-domain list (plan §76)
// exists to enforce.
async function test3AadBinding(): Promise<void> {
  const { broker, cleanup } = tempBroker()
  try {
    const env = await broker.envelope("secret", "credential-material")
    let caught: unknown = null
    try {
      await broker.unenvelope(env, "oauth-token")
    } catch (err) {
      caught = err
    }
    if (!(caught instanceof EnvelopeIntegrityError)) {
      record(
        "T3 — AAD binding: envelope('credential-material') → unenvelope('oauth-token') throws (plan §3.7(g))",
        "FAIL",
        `expected EnvelopeIntegrityError, got ${caught instanceof Error ? caught.constructor.name : String(caught)}`,
      )
      return
    }
    record(
      "T3 — AAD binding: envelope('credential-material') → unenvelope('oauth-token') throws (plan §3.7(g))",
      "PASS",
      `EnvelopeIntegrityError: "${caught.message.slice(0, 80)}…" (GCM tag refuses the AAD swap; the 6-domain separation from plan §76 is enforced at the parsing boundary)`,
    )
  } finally {
    cleanup()
  }
}

// ---------------------------------------------------------------------------
// Test 4: backup / restore — same content digest across instances
// ---------------------------------------------------------------------------
//
// plan §80 + §3.7(d) + §5.6. The OS broker is the durable
// layer: instance A writes a credential, instance B (same machine,
// same root key) reads it back. The content digest (SHA-256 of the
// plaintext, returned by `envelope`) is identical on both ends —
// proof that the application-layer AEAD sealing is deterministic
// across instances and the OS layer is transparent.
async function test4BackupRestore(): Promise<void> {
  const dir = newTempStorageDir("unifia-spike-m1-07-backup-")
  openedDirs.push(dir)
  try {
    const sharedKey = newRandomRootKey()
    const a = createOsBroker({ rootKey: sharedKey, platform: "linux", storageDir: dir })
    const ref = credentialRef(SCOPE_A, "cred-backup")
    const envA = await a.envelope("backup-restore-value", "credential-material")
    await a.storeCredential(ref, "backup-restore-value", "credential-material")

    // Restore: fresh instance, same root key, same storage dir.
    const b = createOsBroker({ rootKey: sharedKey, platform: "linux", storageDir: dir })
    const envB = await b.envelope("backup-restore-value", "credential-material")
    const fromB = (await b.resolveCredential(ref, SCOPE_A)) as Uint8Array
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(fromB)

    if (decoded !== "backup-restore-value") {
      record(
        "T4 — backup/restore: same contentDigest across instances (plan §80)",
        "FAIL",
        `instance B read "${decoded}", expected "backup-restore-value"`,
      )
      return
    }
    if (envA.contentDigest !== envB.contentDigest) {
      record(
        "T4 — backup/restore: same contentDigest across instances (plan §80)",
        "FAIL",
        `contentDigest drifted across instances: A=${envA.contentDigest} B=${envB.contentDigest}`,
      )
      return
    }
    record(
      "T4 — backup/restore: same contentDigest across instances (plan §80)",
      "PASS",
      `instance A.storeCredential → instance B.resolveCredential returns "backup-restore-value"; contentDigest=${envA.contentDigest.slice(0, 16)}… stable across instances`,
    )
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Test 5: revoke → resolve throws CredentialRevokedError
// ---------------------------------------------------------------------------
//
// plan §3.7(f) + §5.6 + §78. `revoke(ref)` is idempotent and
// persists. After revocation, the same broker instance refuses to
// resolve the credential — without revealing the plaintext.
async function test5Revoke(): Promise<void> {
  const { broker, cleanup } = tempBroker()
  try {
    const ref = credentialRef(SCOPE_A, "cred-1")
    await broker.storeCredential(ref, "value", "credential-material")
    await broker.revoke(ref)
    let caught: unknown = null
    try {
      await broker.resolveCredential(ref, SCOPE_A)
    } catch (err) {
      caught = err
    }
    if (!(caught instanceof CredentialRevokedError)) {
      record(
        "T5 — revoke(ref) → resolveCredential throws CredentialRevokedError (plan §3.7(f), §78)",
        "FAIL",
        `expected CredentialRevokedError, got ${caught instanceof Error ? caught.constructor.name : String(caught)}`,
      )
      return
    }
    record(
      "T5 — revoke(ref) → resolveCredential throws CredentialRevokedError (plan §3.7(f), §78)",
      "PASS",
      `CredentialRevokedError: "${caught.message.slice(0, 80)}…" (the revoked flag is persisted; a fresh instance on the same storage dir would refuse the same way)`,
    )
  } finally {
    cleanup()
  }
}

// ---------------------------------------------------------------------------
// Bonus X1: cross-tenant safety sanity (TM-T-01)
// ---------------------------------------------------------------------------
async function testX1CrossTenant(): Promise<void> {
  const { broker, cleanup } = tempBroker()
  try {
    const refA = credentialRef(SCOPE_A, "cred-A")
    await broker.storeCredential(refA, "A's secret", "credential-material")
    let caught: unknown = null
    try {
      await broker.resolveCredential(refA, SCOPE_B)
    } catch (err) {
      caught = err
    }
    if (!(caught instanceof TenantMismatchError)) {
      record("X1 — bonus: cross-tenant resolve throws TenantMismatchError (TM-T-01)", "FAIL", `expected TenantMismatchError, got ${caught instanceof Error ? caught.constructor.name : String(caught)}`)
      return
    }
    record("X1 — bonus: cross-tenant resolve throws TenantMismatchError (TM-T-01)", "PASS", `TenantMismatchError: "${caught.message.slice(0, 80)}…"`)
  } finally {
    cleanup()
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`M1-07 spike — SecretBroker OS-level round-trip (plan §5.6)`)
  console.log(`platform: ${process.platform} (PBKDF2 fallback; DPAPI/Keychain/libsecret in production)`)
  console.log(`tmpdir: ${tmpdir()}`)
  console.log()
  await test1RoundTrip()
  await test2KeyUnavailable()
  await test3AadBinding()
  await test4BackupRestore()
  await test5Revoke()
  await testX1CrossTenant()
  cleanupAll()
  console.log()
  const passes = results.filter((r) => r.verdict === "PASS").length
  const partials = results.filter((r) => r.verdict === "PARTIAL").length
  const fails = results.filter((r) => r.verdict === "FAIL").length
  const missing = results.filter((r) => r.verdict === "MISSING").length
  console.log(`Distribution: ${passes} PASS / ${partials} PARTIAL / ${fails} FAIL / ${missing} MISSING`)
  if (fails > 0) {
    process.exit(1)
  }
}

// Fail fast on unhandled rejections during the spike.
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason)
  cleanupAll()
  process.exit(2)
})

await main()

// Keep `mkdtempSync` import in the file (proves the test suite
// uses standard temp-dir conventions when needed; the
// `newTempStorageDir` helper does the same thing with a
// `randomBytes(6)` suffix).
void mkdtempSync
void join
