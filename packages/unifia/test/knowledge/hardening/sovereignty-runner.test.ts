/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runSovereigntyProbes, deleteDerivedDb } from "../../../src/knowledge/hardening/sovereignty-runner.js"

function makeTmpVault(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "unifia-sov-"))
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

describe("P11.6 sovereignty runner", () => {
  it("returns ok=true on a clean offline environment", async () => {
    const { root, cleanup } = makeTmpVault()
    try {
      const report = await runSovereigntyProbes({
        vaultRoot: root,
        derivedDbPath: join(root, "derived.db"),
        internetOff: true,
        cloudOff: true,
        deviceIsolated: true,
      })
      expect(report.probes).toHaveLength(5)
      expect(report.ok).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("reports vault-unreadable when the root does not exist", async () => {
    const report = await runSovereigntyProbes({
      vaultRoot: "Z:/this/does/not/exist",
      derivedDbPath: "Z:/this/does/not/exist/derived.db",
      internetOff: true,
      cloudOff: true,
      deviceIsolated: true,
    })
    const vault = report.probes.find((p) => p.kind === "vault-readable")
    expect(vault?.ok).toBe(false)
    expect(report.ok).toBe(false)
  })

  it("flags internet-on as a sovereignty failure", async () => {
    const { root, cleanup } = makeTmpVault()
    try {
      const report = await runSovereigntyProbes({
        vaultRoot: root,
        derivedDbPath: join(root, "derived.db"),
        internetOff: false,
        cloudOff: true,
        deviceIsolated: true,
      })
      const probe = report.probes.find((p) => p.kind === "internet-off")
      expect(probe?.ok).toBe(false)
      expect(report.ok).toBe(false)
    } finally {
      cleanup()
    }
  })

  it("flags a connected device as a sovereignty warning (P10 boundary)", async () => {
    const { root, cleanup } = makeTmpVault()
    try {
      const report = await runSovereigntyProbes({
        vaultRoot: root,
        derivedDbPath: join(root, "derived.db"),
        internetOff: true,
        cloudOff: true,
        deviceIsolated: false,
      })
      const probe = report.probes.find((p) => p.kind === "device-isolated")
      expect(probe?.ok).toBe(false)
    } finally {
      cleanup()
    }
  })

  it("deleteDerivedDb removes the file when present", async () => {
    const { root, cleanup } = makeTmpVault()
    try {
      const db = join(root, "derived.db")
      writeFileSync(db, "fake")
      await deleteDerivedDb(db)
      const { existsSync } = await import("node:fs")
      expect(existsSync(db)).toBe(false)
    } finally {
      cleanup()
    }
  })

  it("deleteDerivedDb is a no-op when the file is absent", async () => {
    const { root, cleanup } = makeTmpVault()
    try {
      const db = join(root, "nope.db")
      await deleteDerivedDb(db) // must not throw
    } finally {
      cleanup()
    }
  })
})
