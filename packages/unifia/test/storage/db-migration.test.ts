/* SPDX-License-Identifier: MIT */
// Copyright (c) 2026 Unifia contributors
//
// These tests cover the one-shot copy that brings a legacy `opencode.db`
// (and its -wal / -shm siblings) over to `unifia.db` on first access, so
// existing installs keep their data after the rebrand. Carte C8-A of the
// Runbook-Autonome-Independance-Unifia-2026-08-10.

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { migrateLegacyDatabaseFile } from "../../src/storage/db"

describe("migrateLegacyDatabaseFile (carte C8-A)", () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unifia-db-migrate-"))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  test("copies legacy db to new path when only legacy is present", () => {
    const oldPath = path.join(tmp, "opencode.db")
    const newPath = path.join(tmp, "unifia.db")
    fs.writeFileSync(oldPath, "legacy-content")

    const migrated = migrateLegacyDatabaseFile(newPath, oldPath)

    expect(migrated).toBe(true)
    expect(fs.readFileSync(newPath, "utf-8")).toBe("legacy-content")
    // Legacy file is preserved (copy, not move)
    expect(fs.existsSync(oldPath)).toBe(true)
  })

  test("copies -wal and -shm siblings alongside the main file", () => {
    const oldPath = path.join(tmp, "opencode.db")
    const newPath = path.join(tmp, "unifia.db")
    fs.writeFileSync(oldPath, "main")
    fs.writeFileSync(oldPath + "-wal", "wal-bytes")
    fs.writeFileSync(oldPath + "-shm", "shm-bytes")

    migrateLegacyDatabaseFile(newPath, oldPath)

    expect(fs.readFileSync(newPath, "utf-8")).toBe("main")
    expect(fs.readFileSync(newPath + "-wal", "utf-8")).toBe("wal-bytes")
    expect(fs.readFileSync(newPath + "-shm", "utf-8")).toBe("shm-bytes")
  })

  test("is idempotent: does not overwrite an existing new file", () => {
    const oldPath = path.join(tmp, "opencode.db")
    const newPath = path.join(tmp, "unifia.db")
    fs.writeFileSync(oldPath, "legacy")
    fs.writeFileSync(newPath, "current")

    const migrated = migrateLegacyDatabaseFile(newPath, oldPath)

    expect(migrated).toBe(false)
    expect(fs.readFileSync(newPath, "utf-8")).toBe("current")
  })

  test("is a no-op when the legacy file is absent", () => {
    const newPath = path.join(tmp, "unifia.db")
    const oldPath = path.join(tmp, "opencode.db")

    const migrated = migrateLegacyDatabaseFile(newPath, oldPath)

    expect(migrated).toBe(false)
    expect(fs.existsSync(newPath)).toBe(false)
  })

  test("prefers the new file when both are present", () => {
    const oldPath = path.join(tmp, "opencode.db")
    const newPath = path.join(tmp, "unifia.db")
    fs.writeFileSync(oldPath, "legacy")
    fs.writeFileSync(newPath, "current")

    migrateLegacyDatabaseFile(newPath, oldPath)

    expect(fs.readFileSync(newPath, "utf-8")).toBe("current")
  })
})
