/* SPDX-License-Identifier: MIT */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { downgradeV1ToV0, migrateV0ToV1, WorkspaceStorage, type WorkspaceState } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-storage-"))
try {
  const storage = new WorkspaceStorage(root, () => 2_000)
  const legacy = { workspaceId: "ws-1", generation: 2, updatedAt: 1_000, metadata: { source: "legacy" } }
  const migrated = migrateV0ToV1(legacy)
  if (migrated.schemaVersion !== 1 || downgradeV1ToV0(migrated).workspaceId !== legacy.workspaceId) throw new Error("V0/V1 migration is not reversible")
  const initial = await storage.load("ws-1")
  if (initial.generation !== 0) throw new Error("missing state did not start at generation zero")
  const saved = await storage.save({ ...initial, metadata: { source: "test" } })
  if (saved.generation !== 1) throw new Error("save did not advance generation")
  const health = await storage.health("ws-1")
  if (!health.healthy || health.generation !== 1) throw new Error("healthy state was not reported")

  const stateDir = path.join(root, ".unifia")
  await mkdir(stateDir, { recursive: true })
  const recovered: WorkspaceState = { schemaVersion: 1, workspaceId: "ws-1", generation: 3, updatedAt: 3_000, metadata: { source: "recovery" } }
  await writeFile(path.join(stateDir, "workspace-state.json.tmp"), `${JSON.stringify(recovered)}\n`)
  const afterRecovery = await storage.recover("ws-1")
  if (afterRecovery.generation !== 3 || (await JSON.parse(await readFile(path.join(stateDir, "workspace-state.json"), "utf8"))).generation !== 3) throw new Error("valid temporary state was not recovered")
  // --- Migration conformance: reversible, lossless, non-destructive ---------
  let checks = 0
  const check = (condition: boolean, message: string): void => { checks += 1; if (!condition) throw new Error(message) }
  const rejects = async (run: () => Promise<unknown>, expected: string, message: string): Promise<void> => {
    checks += 1
    try { await run() } catch (error) { if (error instanceof Error && error.message.includes(expected)) return; throw new Error(`${message} (got: ${String(error)})`) }
    throw new Error(`${message} (resolved instead of rejecting)`)
  }

  const rich = { workspaceId: "ws-round", generation: 9, updatedAt: 4_242, metadata: { a: "1", b: "2", unicode: "éé" } }
  check(JSON.stringify(downgradeV1ToV0(migrateV0ToV1(rich))) === JSON.stringify(rich), "V0 -> V1 -> V0 round-trip is not lossless")
  const upgraded = migrateV0ToV1(rich)
  upgraded.metadata.a = "mutated"
  check(rich.metadata.a === "1", "migration aliased the source metadata instead of copying it")

  // A state file written by a newer schema must never be silently discarded.
  const futureRoot = await mkdtemp(path.join(os.tmpdir(), "unifia-storage-future-"))
  const futureDir = path.join(futureRoot, ".unifia")
  await mkdir(futureDir, { recursive: true })
  const futurePath = path.join(futureDir, "workspace-state.json")
  const futureBody = `${JSON.stringify({ schemaVersion: 2, workspaceId: "ws-1", generation: 12, updatedAt: 5_000, metadata: { source: "future" }, addedField: true })}\n`
  await writeFile(futurePath, futureBody)
  const futureStorage = new WorkspaceStorage(futureRoot, () => 6_000)
  await rejects(() => futureStorage.load("ws-1"), "unreadable", "load silently discarded a state written by a newer schema")
  check(await readFile(futurePath, "utf8") === futureBody, "a newer-schema state file was overwritten")
  const futureHealth = await futureStorage.health("ws-1")
  check(!futureHealth.healthy && futureHealth.problems.some((problem) => problem.includes("unsupported workspace state version: 2")), "health did not report the unsupported version")

  // A corrupt state file must fail loudly rather than reset the workspace.
  const corruptRoot = await mkdtemp(path.join(os.tmpdir(), "unifia-storage-corrupt-"))
  await mkdir(path.join(corruptRoot, ".unifia"), { recursive: true })
  await writeFile(path.join(corruptRoot, ".unifia", "workspace-state.json"), "{ this is not json")
  await rejects(() => new WorkspaceStorage(corruptRoot, () => 7_000).load("ws-1"), "unreadable", "load reset the workspace after a corrupt state file")

  // An absent state file is still a legitimate fresh start.
  const freshRoot = await mkdtemp(path.join(os.tmpdir(), "unifia-storage-fresh-"))
  check((await new WorkspaceStorage(freshRoot, () => 8_000).load("ws-1")).generation === 0, "an absent state file was not treated as a fresh workspace")

  // N-1 state on disk must be readable and upgraded in place without loss.
  const legacyRoot = await mkdtemp(path.join(os.tmpdir(), "unifia-storage-legacy-"))
  await mkdir(path.join(legacyRoot, ".unifia"), { recursive: true })
  await writeFile(path.join(legacyRoot, ".unifia", "workspace-state.json"), `${JSON.stringify(rich)}\n`)
  const legacyLoaded = await new WorkspaceStorage(legacyRoot, () => 9_000).load("ws-round")
  check(legacyLoaded.schemaVersion === 1 && legacyLoaded.generation === 9 && legacyLoaded.metadata.b === "2", "an unversioned V0 state on disk was not migrated losslessly")

  await Promise.all([futureRoot, corruptRoot, freshRoot, legacyRoot].map((directory) => rm(directory, { recursive: true, force: true })))
  console.log(`WorkspaceStorage: ${4 + checks}/${4 + checks} passed (4 legacy + ${checks} migration conformance)`)
} finally {
  await rm(root, { recursive: true, force: true })
}