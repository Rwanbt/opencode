/* SPDX-License-Identifier: MIT */
/**
 * Portable store I/O (P2.6) — real filesystem operations for
 * Class B (portable copy-on-write metadata).
 *
 * Per runbook §12 P2.4: "Copy-on-write des révisions Class B,
 * invariant OLD VALID/NEW VALID/VALID + orphan harmless. GC
 * uniquement en Admin Task sous lock exclusif avec reachability
 * revalidée."
 *
 * V1 provides:
 * - `readPortableStore(root)` — read `.unifia/portable/store.json`
 *   from disk. Returns an empty store if the file is absent.
 * - `writePortableStore(root, store)` — atomic write (write to
 *   `.tmp` + rename) so the canonical state is always present.
 * - `upsertPortableEntry(root, alias, locator, externalSource)`
 *   — load → upsertEntry → atomic write.
 * - `removePortableEntry(root, alias)` — load → delete → atomic
 *   write.
 * - `listPortableEntries(root)` — read-only enumeration.
 *
 * All write operations are atomic on POSIX. On Windows, the
 * `rename` is the closest we can get to atomicity in pure Node;
 * the recovery layer (P2.5 WAL) revalidates the canonical state
 * before the next mutation.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { upsertEntry, type ClassBEntry } from "./classb.js"

export const PORTABLE_DIR = ".unifia/portable"
export const PORTABLE_FILE = `${PORTABLE_DIR}/store.json`
export const PORTABLE_TMP = `${PORTABLE_DIR}/store.json.tmp`

export interface PortableStore {
  /** Map alias -> ClassBEntry, serialised as a record. */
  entries: Record<string, ClassBEntry>
  /** Schema version (always 1 in V1). */
  version: 1
  /** Last update timestamp (ISO 8601). */
  updatedAt: string
}

export class PortableStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PortableStoreError"
  }
}

/** Read the portable store from disk. Empty store if absent. */
export function readPortableStore(workspaceRoot: string): PortableStore {
  if (!isAbsolute(workspaceRoot)) {
    throw new PortableStoreError(`workspaceRoot must be absolute, got ${workspaceRoot}`)
  }
  const file = resolve(workspaceRoot, PORTABLE_FILE)
  if (!existsSync(file)) {
    return { entries: {}, version: 1, updatedAt: new Date(0).toISOString() }
  }
  try {
    const text = readFileSync(file, "utf8")
    const parsed = JSON.parse(text) as unknown
    if (!isPortableStore(parsed)) {
      throw new PortableStoreError(`portable store has invalid shape at ${file}`)
    }
    return parsed
  } catch (e) {
    if (e instanceof PortableStoreError) throw e
    throw new PortableStoreError(
      `failed to read portable store at ${file}: ${(e as Error).message}`,
    )
  }
}

/** Atomically write the portable store to disk. */
export function writePortableStore(workspaceRoot: string, store: PortableStore): void {
  if (!isAbsolute(workspaceRoot)) {
    throw new PortableStoreError(`workspaceRoot must be absolute, got ${workspaceRoot}`)
  }
  if (store.version !== 1) {
    throw new PortableStoreError(`unsupported store version: ${store.version}`)
  }
  const file = resolve(workspaceRoot, PORTABLE_FILE)
  const tmp = resolve(workspaceRoot, PORTABLE_TMP)
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const text = JSON.stringify(store, null, 2)
  writeFileSync(tmp, text, "utf8")
  renameSync(tmp, file)
}

/** Upsert an entry. Returns the new store. */
export function upsertPortableEntry(
  workspaceRoot: string,
  alias: string,
  locator: string,
  externalSource: string | undefined,
): PortableStore {
  const store = readPortableStore(workspaceRoot)
  const b = new Map(Object.entries(store.entries))
  const current = b.get(alias)
  const currentRevision = current?.revision ?? -1
  const { next, entry } = upsertEntry(b, alias, locator, externalSource, currentRevision)
  const newStore: PortableStore = {
    entries: Object.fromEntries(next),
    version: 1,
    updatedAt: new Date().toISOString(),
  }
  writePortableStore(workspaceRoot, newStore)
  void entry // explicit unused marker for lint
  return newStore
}

/** Remove an entry. Returns the new store. No-op if absent. */
export function removePortableEntry(workspaceRoot: string, alias: string): PortableStore {
  const store = readPortableStore(workspaceRoot)
  const b = new Map(Object.entries(store.entries))
  if (!b.has(alias)) return store
  b.delete(alias)
  const newStore: PortableStore = {
    entries: Object.fromEntries(b),
    version: 1,
    updatedAt: new Date().toISOString(),
  }
  writePortableStore(workspaceRoot, newStore)
  return newStore
}

/** List entries in the portable store. */
export function listPortableEntries(workspaceRoot: string): ClassBEntry[] {
  const store = readPortableStore(workspaceRoot)
  return Object.values(store.entries)
}

// --- internals -----------------------------------------------------------

function isAbsolute(p: string): boolean {
  // avoid importing 'node:path' at module top so this module
  // is easy to test in environments without node:fs.
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\")
}

function isPortableStore(v: unknown): v is PortableStore {
  if (typeof v !== "object" || v === null) return false
  const o = v as Record<string, unknown>
  if (o.version !== 1) return false
  if (typeof o.entries !== "object" || o.entries === null) return false
  if (typeof o.updatedAt !== "string") return false
  return true
}
