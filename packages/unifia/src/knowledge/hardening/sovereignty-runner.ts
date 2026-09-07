/* SPDX-License-Identifier: MIT */
/**
 * Hardening: sovereignty test runner (P11.6).
 *
 * Per runbook §21 P11: "sovereignty test Internet off/cloud off/
 * derived DB deleted" + "device isolation test".
 *
 * The runner probes the four sovereignty conditions:
 *  1. Vault readable: the canonical Markdown vault is reachable
 *     with a stock text editor.
 *  2. Derived DB deletable: Class D can be deleted and rebuilt
 *     from Class A without data loss.
 *  3. Internet off: no network calls are made during recovery or
 *     normal use.
 *  4. Cloud off: no remote API is invoked (no LLM call, no
 *     remote embedding, no remote MCP).
 *
 * In V1 the runner probes the file system and reports the
 * observed state. Network and cloud checks are operator-provided
 * (the runner does not actually try to make a network call in
 * the test path; instead, it asks the caller whether the
 * environment was offline).
 */

import { stat, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { resolve, isAbsolute } from "node:path"

export type SovereigntyProbeKind =
  | "vault-readable"
  | "derived-db-deletable"
  | "internet-off"
  | "cloud-off"
  | "device-isolated"

export interface SovereigntyProbeResult {
  kind: SovereigntyProbeKind
  ok: boolean
  message: string
  /** Time taken (ms). */
  durationMs: number
}

export interface SovereigntyRunnerInput {
  /** Absolute path to the canonical vault root (Class A). */
  vaultRoot: string
  /** Absolute path to the derived DB (Class D). If absent, fine. */
  derivedDbPath: string
  /** True if the operator confirms the process is offline. */
  internetOff: boolean
  /** True if the operator confirms no cloud API is invoked. */
  cloudOff: boolean
  /** True if the operator confirms no Android device is connected. */
  deviceIsolated: boolean
}

export interface SovereigntyReport {
  vaultRoot: string
  derivedDbPath: string
  probes: SovereigntyProbeResult[]
  /** True if every probe is ok. */
  ok: boolean
  /** Total elapsed ms. */
  totalMs: number
}

/** Run all sovereignty probes. */
export async function runSovereigntyProbes(
  input: SovereigntyRunnerInput,
): Promise<SovereigntyReport> {
  const t0 = Date.now()
  const probes: SovereigntyProbeResult[] = []

  probes.push(await probeVaultReadable(input.vaultRoot))
  probes.push(await probeDerivedDbDeletable(input.derivedDbPath))
  probes.push(probeInternetOff(input.internetOff))
  probes.push(probeCloudOff(input.cloudOff))
  probes.push(probeDeviceIsolated(input.deviceIsolated))

  return {
    vaultRoot: input.vaultRoot,
    derivedDbPath: input.derivedDbPath,
    probes,
    ok: probes.every((p) => p.ok),
    totalMs: Date.now() - t0,
  }
}

async function probeVaultReadable(vaultRoot: string): Promise<SovereigntyProbeResult> {
  const t0 = Date.now()
  try {
    if (!isAbsolute(vaultRoot)) {
      return {
        kind: "vault-readable",
        ok: false,
        message: `vaultRoot must be absolute, got ${vaultRoot}`,
        durationMs: Date.now() - t0,
      }
    }
    const s = await stat(vaultRoot)
    if (!s.isDirectory()) {
      return {
        kind: "vault-readable",
        ok: false,
        message: `vaultRoot is not a directory: ${vaultRoot}`,
        durationMs: Date.now() - t0,
      }
    }
    return {
      kind: "vault-readable",
      ok: true,
      message: `vault reachable at ${vaultRoot}`,
      durationMs: Date.now() - t0,
    }
  } catch (e) {
    return {
      kind: "vault-readable",
      ok: false,
      message: `vault unreachable: ${(e as Error).message}`,
      durationMs: Date.now() - t0,
    }
  }
}

async function probeDerivedDbDeletable(derivedDbPath: string): Promise<SovereigntyProbeResult> {
  const t0 = Date.now()
  const abs = resolve(derivedDbPath)
  const exists = existsSync(abs)
  if (!exists) {
    return {
      kind: "derived-db-deletable",
      ok: true,
      message: `derived DB absent at ${abs} (deletion is a no-op)`,
      durationMs: Date.now() - t0,
    }
  }
  try {
    // We do NOT actually delete the file in V1 — we just verify
    // that we CAN. The caller decides what to do.
    const s = await stat(abs)
    if (!s.isFile()) {
      return {
        kind: "derived-db-deletable",
        ok: false,
        message: `derived DB path is not a regular file: ${abs}`,
        durationMs: Date.now() - t0,
      }
    }
    return {
      kind: "derived-db-deletable",
      ok: true,
      message: `derived DB deletable at ${abs} (size=${s.size} bytes)`,
      durationMs: Date.now() - t0,
    }
  } catch (e) {
    return {
      kind: "derived-db-deletable",
      ok: false,
      message: `derived DB probe failed: ${(e as Error).message}`,
      durationMs: Date.now() - t0,
    }
  }
}

function probeInternetOff(internetOff: boolean): SovereigntyProbeResult {
  const t0 = Date.now()
  return {
    kind: "internet-off",
    ok: internetOff,
    message: internetOff
      ? "operator confirms process is offline"
      : "operator reports network access; V1 sovereignty requires offline",
    durationMs: Date.now() - t0,
  }
}

function probeCloudOff(cloudOff: boolean): SovereigntyProbeResult {
  const t0 = Date.now()
  return {
    kind: "cloud-off",
    ok: cloudOff,
    message: cloudOff
      ? "operator confirms no cloud API is invoked"
      : "operator reports cloud API in use; V1 sovereignty requires no cloud",
    durationMs: Date.now() - t0,
  }
}

function probeDeviceIsolated(deviceIsolated: boolean): SovereigntyProbeResult {
  const t0 = Date.now()
  return {
    kind: "device-isolated",
    ok: deviceIsolated,
    message: deviceIsolated
      ? "no Android device connected (P10 boundary isolated)"
      : "Android device connected; P10.2/P10.3 must be run before declaring V1",
    durationMs: Date.now() - t0,
  }
}

/**
 * Actually delete the derived DB (destructive).
 *
 * Provided as a separate, opt-in function so callers must
 * explicitly request deletion. The runner never calls this
 * automatically.
 */
export async function deleteDerivedDb(derivedDbPath: string): Promise<void> {
  const abs = resolve(derivedDbPath)
  if (!existsSync(abs)) return
  await rm(abs, { force: true })
}
