// SPDX-License-Identifier: MIT

import { test, expect } from "bun:test"
import { validateArtifact } from "./schema.mjs"
import { SCENARIOS, getScenario, isValidScenarioId } from "./scenarios.mjs"

// Fixture conforme aux 8 champs obligatoires du contrat §3.
// Source référence le scenario id "startup.cold" du registre.
// artifact path suit le pattern <scenario>.<yyyymmdd>.<short-sha>.json.
const VALID_ARTIFACT = {
  source: "bench-startup.cold.v1",
  commit: "be0d39e9f0ff9bbac2a218bcf3cc0a68df10efc7",
  machine: {
    hostname: "DESKTOP-DEV",
    os: "windows",
    cpu: "AMD Ryzen 9 7950X",
    ramMb: 65536,
    gpu: "NVIDIA RTX 4090",
  },
  toolchain: {
    bun: "1.3.11",
    rust: "1.78.0",
    cargo: "1.78.0",
    tauri: "2.0.0",
    webview: "Edge 127",
  },
  N: 5,
  variance: { p50: 1234, p95: 1500, p99: 1700 },
  timestamp: "2026-08-24T10:30:00.000Z",
  artifact: "docs/perf-baselines/measurements/startup.cold.20260824.be0d39e.json",
}

test("valid artifact passes", () => {
  const r = validateArtifact(VALID_ARTIFACT)
  expect(r.valid).toBe(true)
  expect(r.errors).toEqual([])
})

test("missing required string field is rejected", () => {
  const broken = { ...VALID_ARTIFACT }
  delete broken.source
  const r = validateArtifact(broken)
  expect(r.valid).toBe(false)
  expect(r.errors.some((e) => e.includes('"source"'))).toBe(true)
})

test("N below 5 is rejected", () => {
  const r = validateArtifact({ ...VALID_ARTIFACT, N: 3 })
  expect(r.valid).toBe(false)
  expect(r.errors.some((e) => e.includes("N"))).toBe(true)
})

test("non-UTC timestamp is rejected", () => {
  const r = validateArtifact({ ...VALID_ARTIFACT, timestamp: "2026-08-24 10:30:00" })
  expect(r.valid).toBe(false)
  expect(r.errors.some((e) => e.includes("timestamp"))).toBe(true)
})

test("non-hex commit is rejected", () => {
  const r = validateArtifact({ ...VALID_ARTIFACT, commit: "not-a-sha" })
  expect(r.valid).toBe(false)
  expect(r.errors.some((e) => e.includes("commit"))).toBe(true)
})

test("non-object inputs are rejected", () => {
  expect(validateArtifact(null).valid).toBe(false)
  expect(validateArtifact(undefined).valid).toBe(false)
  expect(validateArtifact("string").valid).toBe(false)
  expect(validateArtifact([1, 2, 3]).valid).toBe(false)
})

test("SCENARIOS registry has unique ids and is non-empty", () => {
  const ids = SCENARIOS.map((s) => s.id)
  expect(ids.length).toBeGreaterThan(0)
  expect(new Set(ids).size).toBe(ids.length)
})

test("scenario lookup accepts known ids and rejects unknown", () => {
  expect(isValidScenarioId("startup.cold")).toBe(true)
  expect(isValidScenarioId("desktop.code")).toBe(true)
  expect(isValidScenarioId("unknown.id")).toBe(false)
  expect(getScenario("startup.cold")?.kind).toBe("startup")
  expect(getScenario("unknown.id")).toBeNull()
})
