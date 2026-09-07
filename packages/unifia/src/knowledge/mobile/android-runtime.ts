/* SPDX-License-Identifier: MIT */
/**
 * Android runtime check (P10.2 / P10.3).
 *
 * Per runbook §20 P10.2: validate the real chain (vault,
 * filesystem, FTS, graph, ContextRouter, semantic/fallback,
 * local model, policy, Git, offline) on a physical device.
 *
 * V1 in this module is a *probe* the device test harness
 * consumes. Without a connected `adb` device, all probes are
 * `NOT_EXECUTED_EXTERNAL_BOUNDARY`. This file is the typed
 * surface that the device tests will populate.
 */

export type ProbeStatus =
  | "PASS"
  | "FAIL"
  | "SKIP"
  | "NOT_EXECUTED_EXTERNAL_BOUNDARY"

export interface ProbeResult {
  probe: string
  status: ProbeStatus
  note: string
  durationMs: number
}

export interface DeviceContext {
  /** True if `adb devices` reports at least one device. */
  hasDevice: boolean
  /** True if a Tauri Android build is installed. */
  hasInstalledApk: boolean
  /** Path to the APK, if available. */
  apkPath: string | null
  /** Path to the on-device vault. */
  onDeviceVault: string | null
}

/** Default: no device attached. */
export const NO_DEVICE: DeviceContext = {
  hasDevice: false,
  hasInstalledApk: false,
  apkPath: null,
  onDeviceVault: null,
}

/** Catalogue of probes the device test must run. */
export const PROBES: readonly string[] = [
  "vault.read",
  "vault.write",
  "fts.search",
  "graph.backlinks",
  "context-router",
  "policy.egress",
  "git.prepush",
  "offline.boot",
  "battery.peak",
  "thermal.throttle",
]

/**
 * Evidence produced by the device harness for one probe. A probe without
 * evidence has not run, whatever the device is doing.
 */
export interface ProbeEvidence {
  probe: string
  status: Extract<ProbeStatus, "PASS" | "FAIL">
  /** The exact command the harness executed. */
  command: string
  /** Device this was captured on. */
  deviceId: string
  /** ISO-8601 capture time. */
  capturedAt: string
  /** Observed output or metric. */
  output: string
  /** Hash of the stored artefact, when one was written. */
  artifactHash?: string
  durationMs?: number
}

/**
 * Resolve the probe catalogue against whatever evidence the harness supplied.
 *
 * `hasDevice` alone never produces a PASS. It used to: with a device
 * attached, all ten probes returned PASS without executing anything, so the
 * completeness report showed ten green probes that had never run.
 */
/**
 * Reject evidence that cannot be acted on.
 *
 * Accepting a well-shaped but empty record produced
 * `note: " on  at : "` and a green PASS — a completeness signal built from
 * nothing. Evidence has to name a command, a device, a valid capture time and
 * an observed output, and it only counts when a device was actually attached.
 */
function isUsableEvidence(e: ProbeEvidence, ctx: DeviceContext): boolean {
  if (!ctx.hasDevice) return false
  if (!PROBES.includes(e.probe)) return false
  if (e.command.trim().length === 0) return false
  if (e.deviceId.trim().length === 0) return false
  if (e.output.trim().length === 0) return false
  const at = Date.parse(e.capturedAt)
  if (!Number.isFinite(at)) return false
  return true
}

export function runProbes(
  ctx: DeviceContext,
  evidence: readonly ProbeEvidence[] = [],
): ProbeResult[] {
  const byProbe = new Map(
    evidence.filter((e) => isUsableEvidence(e, ctx)).map((e) => [e.probe, e]),
  )

  return PROBES.map((p) => {
    const found = byProbe.get(p)
    if (found !== undefined) {
      return {
        probe: p,
        status: found.status,
        note: `${found.command} on ${found.deviceId} at ${found.capturedAt}: ${found.output}`,
        durationMs: found.durationMs ?? 0,
      }
    }
    return {
      probe: p,
      status: "NOT_EXECUTED_EXTERNAL_BOUNDARY" as ProbeStatus,
      note: ctx.hasDevice
        ? "device attached but no harness evidence recorded for this probe"
        : "no Android device attached",
      durationMs: 0,
    }
  })
}

export function hasFailures(results: readonly ProbeResult[]): boolean {
  return results.some((r) => r.status === "FAIL")
}
