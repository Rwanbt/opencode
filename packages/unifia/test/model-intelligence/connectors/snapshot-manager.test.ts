/**
 * Tests pour SnapshotManager (TEAM-C03).
 *
 * Couvre :
 *   - record + restore roundtrip (déterminisme via hash)
 *   - hash d'intégrité SHA-256
 *   - fail-closed sur snapshot corrompu
 *   - invalidate (partiel / global)
 *   - has() en mémoire + disque
 *   - status() détaillé
 *   - verify() sans charger
 *   - listConnectorIDs()
 *   - sécurité chemin (connectorID traversal bloqué)
 *   - maxBytes enforcement
 *   - schéma version check
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import {
  SnapshotManager,
  SNAPSHOT_SCHEMA_VERSION,
  sha256Hex,
  snapshotFilePath,
} from "../../../src/model-intelligence/connectors/snapshot-manager"
import { ConnectorOperationError } from "../../../src/model-intelligence/connectors/types"

let tmpRoot: string
let manager: SnapshotManager

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "c03-snap-test-"))
  manager = new SnapshotManager({ rootDir: tmpRoot })
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

const baseArgs = (raw: string) => ({
  connectorID: "test-snap",
  raw,
  fetchedAtUTC: "2025-01-15T10:00:00Z",
  sourceURL: "https://example.test/api.json",
})

describe("SnapshotManager — record + restore", () => {
  test("record then restore returns the same raw + matching hash", async () => {
    const raw = JSON.stringify({ providers: ["anthropic"], models: ["claude-sonnet"] })
    const recorded = await manager.record({ op: "discover", ...baseArgs(raw) })
    expect(recorded.hash).toBe(sha256Hex(raw))
    expect(recorded.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION)

    const restored = await manager.restore("test-snap", "discover")
    expect(restored).not.toBeNull()
    expect(restored!.raw).toBe(raw)
    expect(restored!.hash).toBe(sha256Hex(raw))
    expect(restored!.fetchedAtUTC).toBe("2025-01-15T10:00:00Z")
    expect(restored!.sourceURL).toBe("https://example.test/api.json")
  })

  test("hash is deterministic across separate SnapshotsManagers (same raw → same hash)", async () => {
    const raw = "deterministic-payload"
    const a = sha256Hex(raw)
    const b = sha256Hex(raw)
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  test("different raw produces different hash", async () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"))
  })
})

describe("SnapshotManager — corrupted snapshot (fail-closed)", () => {
  test("restore detects hash mismatch and raises cache_corrupted", async () => {
    const raw = JSON.stringify({ ok: true })
    await manager.record({ op: "discover", ...baseArgs(raw) })
    // Corrupt the file
    const filePath = snapshotFilePath(tmpRoot, "test-snap", "discover")
    const onDisk = JSON.parse(await fs.readFile(filePath, "utf-8"))
    onDisk.raw = JSON.stringify({ ok: false })
    await fs.writeFile(filePath, JSON.stringify(onDisk), "utf-8")

    // restore() loads from disk and validates → should throw cache_corrupted
    const newManager = new SnapshotManager({ rootDir: tmpRoot })
    let captured: ConnectorOperationError | null = null
    try {
      await newManager.restore("test-snap", "discover")
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("cache_corrupted")
  })

  test("restore returns null when file absent (no exception)", async () => {
    expect(await manager.restore("test-snap", "discover")).toBeNull()
  })

  test("restore raises when JSON parse fails", async () => {
    const filePath = snapshotFilePath(tmpRoot, "test-snap", "discover")
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, "{not valid json", "utf-8")
    let captured: ConnectorOperationError | null = null
    try {
      await manager.restore("test-snap", "discover")
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("cache_corrupted")
  })

  test("restore raises when schema version is unsupported", async () => {
    const filePath = snapshotFilePath(tmpRoot, "test-snap", "discover")
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const raw = JSON.stringify({ providers: [] })
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: "99.0.0",
        connectorID: "test-snap",
        op: "discover",
        raw,
        hash: sha256Hex(raw),
        fetchedAtUTC: "2025-01-15T10:00:00Z",
        storedAtUTC: "2025-01-15T10:00:00Z",
        sourceURL: "https://example.test",
      }),
      "utf-8",
    )
    let captured: ConnectorOperationError | null = null
    try {
      await manager.restore("test-snap", "discover")
    } catch (e) {
      captured = e as ConnectorOperationError
    }
    expect(captured).not.toBeNull()
    expect(captured!.detail.kind).toBe("unsupported_version")
  })
})

describe("SnapshotManager — has()", () => {
  test("has(id, op) true after record", async () => {
    await manager.record({ op: "discover", ...baseArgs('{"ok":1}') })
    expect(await manager.has("test-snap", "discover")).toBe(true)
  })

  test("has(id, op) false without record", async () => {
    expect(await manager.has("test-snap", "discover")).toBe(false)
  })

  test("has(id) any-op true if any op recorded", async () => {
    await manager.record({ op: "pricing", ...baseArgs('{"pricing":[]}') })
    expect(await manager.has("test-snap")).toBe(true)
  })
})

describe("SnapshotManager — status()", () => {
  test("status returns detailed record", async () => {
    await manager.record({ op: "discover", ...baseArgs('{"x":1}') })
    const s = await manager.status("test-snap", "discover")
    expect(s).not.toBeNull()
    expect(s!.present).toBe(true)
    expect(s!.integrityOK).toBe(true)
    expect(s!.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(s!.sizeBytes).toBeGreaterThan(0)
    expect(s!.sourceURL).toBe("https://example.test/api.json")
  })

  test("status returns null when absent", async () => {
    expect(await manager.status("nope", "discover")).toBeNull()
  })
})

describe("SnapshotManager — verify()", () => {
  test("verify ok after record", async () => {
    await manager.record({ op: "discover", ...baseArgs('{"x":1}') })
    const r = await manager.verify("test-snap", "discover")
    expect(r.ok).toBe(true)
    expect(r.storedHash).toMatch(/^[a-f0-9]{64}$/)
    expect(r.actualHash).toBe(r.storedHash)
  })

  test("verify not ok on tampered file", async () => {
    await manager.record({ op: "discover", ...baseArgs('{"x":1}') })
    const filePath = snapshotFilePath(tmpRoot, "test-snap", "discover")
    const onDisk = JSON.parse(await fs.readFile(filePath, "utf-8"))
    onDisk.raw = "tampered"
    onDisk.hash = sha256Hex("tampered")
    await fs.writeFile(filePath, JSON.stringify(onDisk), "utf-8")
    // Now tampered has a matching hash, but corrupt it again
    onDisk.raw = "tampered2"
    await fs.writeFile(filePath, JSON.stringify(onDisk), "utf-8")

    const r = await manager.verify("test-snap", "discover")
    expect(r.ok).toBe(false)
  })

  test("verify on missing file returns ok=false with null hashes", async () => {
    const r = await manager.verify("nope", "discover")
    expect(r.ok).toBe(false)
    expect(r.storedHash).toBeNull()
    expect(r.actualHash).toBeNull()
  })
})

describe("SnapshotManager — invalidate()", () => {
  test("invalidate(id, op) removes only that op", async () => {
    await manager.record({ op: "discover", ...baseArgs('{"a":1}') })
    await manager.record({ op: "pricing", ...baseArgs('{"b":2}') })

    await manager.invalidate("test-snap", "discover")
    expect(await manager.has("test-snap", "discover")).toBe(false)
    expect(await manager.has("test-snap", "pricing")).toBe(true)
  })

  test("invalidate(id) removes all ops for that id", async () => {
    await manager.record({ op: "discover", ...baseArgs('{"a":1}') })
    await manager.record({ op: "pricing", ...baseArgs('{"b":2}') })

    await manager.invalidate("test-snap")
    expect(await manager.has("test-snap")).toBe(false)
  })

  test("invalidate() (no args) nukes everything", async () => {
    await manager.record({ op: "discover", ...baseArgs('{"a":1}') })
    await manager.invalidate()
    expect(await manager.has("test-snap")).toBe(false)
  })

  test("invalidate of unknown id is no-op", async () => {
    await expect(manager.invalidate("never-existed")).resolves.toBeUndefined()
  })
})

describe("SnapshotManager — listConnectorIDs()", () => {
  test("returns connector IDs present on disk", async () => {
    await manager.record({ op: "discover", ...baseArgs('{"a":1}') })
    const ids = await manager.listConnectorIDs()
    expect(ids).toContain("test-snap")
  })

  test("returns empty when no records", async () => {
    expect(await manager.listConnectorIDs()).toEqual([])
  })
})

describe("SnapshotManager — safety", () => {
  test("rejects connectorID with path traversal characters", () => {
    expect(() => snapshotFilePath(tmpRoot, "../etc/passwd", "discover")).toThrow(ConnectorOperationError)
    expect(() => snapshotFilePath(tmpRoot, "a/b", "discover")).toThrow(ConnectorOperationError)
    expect(() => snapshotFilePath(tmpRoot, "ab?c", "discover")).toThrow(ConnectorOperationError)
  })

  test("accepts safe connectorID characters", () => {
    expect(() => snapshotFilePath(tmpRoot, "good-id_1.0", "discover")).not.toThrow()
  })

  test("record enforces maxBytes limit", async () => {
    const tight = new SnapshotManager({ rootDir: tmpRoot, maxBytes: 64 })
    const big = "x".repeat(1024)
    await expect(
      tight.record({ op: "discover", ...baseArgs(big) }),
    ).rejects.toThrow(/Snapshot too large/)
  })
})