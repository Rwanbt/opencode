/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  PROBES,
  NO_DEVICE,
  runProbes,
  hasFailures,
} from "../../../src/knowledge/mobile/android-runtime.js"

describe("P10 Android runtime probe", () => {
  it("PROBES lists 10 canonical probes", () => {
    expect(PROBES).toHaveLength(10)
  })

  it("returns NOT_EXECUTED_EXTERNAL_BOUNDARY for every probe when no device", () => {
    const r = runProbes(NO_DEVICE)
    expect(r.every((p) => p.status === "NOT_EXECUTED_EXTERNAL_BOUNDARY")).toBe(true)
  })

  it("does not report failures when no device is attached", () => {
    const r = runProbes(NO_DEVICE)
    expect(hasFailures(r)).toBe(false)
  })

  const WITH_DEVICE = {
    hasDevice: true,
    hasInstalledApk: true,
    apkPath: "/tmp/app.apk",
    onDeviceVault: "/sdcard/Documents/UnifiaVault",
  }

  it("does not turn a present device into a PASS on its own", () => {
    // The defect this replaces: with hasDevice true, all ten probes returned
    // PASS without executing anything.
    const r = runProbes(WITH_DEVICE)
    expect(r.every((p) => p.status === "NOT_EXECUTED_EXTERNAL_BOUNDARY")).toBe(true)
    expect(r.some((p) => p.status === "PASS")).toBe(false)
  })

  it("reports a PASS only for a probe the harness supplied evidence for", () => {
    const r = runProbes(WITH_DEVICE, [
      {
        probe: "vault.write",
        status: "PASS",
        command: "adb shell touch /sdcard/Documents/UnifiaVault/x.md",
        deviceId: "cmi_eea",
        capturedAt: "2026-08-29T10:00:00Z",
        output: "ok",
        durationMs: 12,
      },
    ])
    const passed = r.filter((p) => p.status === "PASS")
    expect(passed).toHaveLength(1)
    expect(passed[0]?.probe).toBe("vault.write")
    expect(passed[0]?.note).toContain("cmi_eea")
    expect(r.filter((p) => p.status === "NOT_EXECUTED_EXTERNAL_BOUNDARY")).toHaveLength(
      r.length - 1,
    )
  })

  it("propagates a FAIL from the harness", () => {
    const r = runProbes(WITH_DEVICE, [
      {
        probe: "vault.write",
        status: "FAIL",
        command: "adb shell touch ...",
        deviceId: "cmi_eea",
        capturedAt: "2026-08-29T10:00:00Z",
        output: "Read-only file system",
      },
    ])
    expect(hasFailures(r)).toBe(true)
  })
})
