/* SPDX-License-Identifier: MIT */

import { test, expect } from "bun:test"
import path from "path"
import * as fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { NearestRoot } from "../../src/lsp/root-match"

test("NearestRoot returns marker dir when include pattern found", async () => {
  await using tmp = await tmpdir()
  const stopDir = path.join(tmp.path, "stop")
  await fs.mkdir(stopDir, { recursive: true })
  const withMarker = path.join(stopDir, "with-marker")
  await fs.mkdir(withMarker, { recursive: true })
  await fs.writeFile(path.join(withMarker, "Cargo.toml"), "")
  const file = path.join(withMarker, "file.txt")
  await fs.writeFile(file, "")

  const root = NearestRoot(["Cargo.toml"], () => stopDir)
  const result = await root(file)
  expect(result).toBe(withMarker)
})

test("NearestRoot returns stopDir when no include match", async () => {
  await using tmp = await tmpdir()
  const stopDir = path.join(tmp.path, "stop")
  await fs.mkdir(stopDir, { recursive: true })
  const noMarker = path.join(stopDir, "no-marker")
  await fs.mkdir(noMarker, { recursive: true })
  const file = path.join(noMarker, "file.txt")
  await fs.writeFile(file, "")

  const root = NearestRoot(["Cargo.toml"], () => stopDir)
  const result = await root(file)
  expect(result).toBe(stopDir)
})

test("NearestRoot returns undefined when exclude pattern found first", async () => {
  await using tmp = await tmpdir()
  const stopDir = path.join(tmp.path, "stop")
  await fs.mkdir(stopDir, { recursive: true })
  const excluded = path.join(stopDir, "excluded")
  await fs.mkdir(path.join(excluded, ".git"), { recursive: true })
  const src = path.join(excluded, "src")
  await fs.mkdir(src, { recursive: true })
  const file = path.join(src, "file.txt")
  await fs.writeFile(file, "")

  const root = NearestRoot(["Cargo.toml"], () => stopDir, [".git"])
  const result = await root(file)
  expect(result).toBeUndefined()
})

test("NearestRoot ignores exclude pattern if not found", async () => {
  await using tmp = await tmpdir()
  const stopDir = path.join(tmp.path, "stop")
  await fs.mkdir(stopDir, { recursive: true })
  const withMarker = path.join(stopDir, "with-marker")
  await fs.mkdir(withMarker, { recursive: true })
  await fs.writeFile(path.join(withMarker, "Cargo.toml"), "")
  const file = path.join(withMarker, "file.txt")
  await fs.writeFile(file, "")

  const root = NearestRoot(["Cargo.toml"], () => stopDir, [".svn"])
  const result = await root(file)
  expect(result).toBe(withMarker)
})

test("strict mode returns undefined when no include match (B11)", async () => {
  await using tmp = await tmpdir()
  const stopDir = path.join(tmp.path, "stop")
  await fs.mkdir(stopDir, { recursive: true })
  const noMarker = path.join(stopDir, "no-marker")
  await fs.mkdir(noMarker, { recursive: true })
  const file = path.join(noMarker, "file.txt")
  await fs.writeFile(file, "")

  // Without strict (legacy): returns stopDir as fallback
  const legacy = NearestRoot(["Cargo.toml"], () => stopDir)
  expect(await legacy(file)).toBe(stopDir)
  // With strict: returns undefined (no fallback)
  const strict = NearestRoot(["Cargo.toml"], () => stopDir, undefined, { strict: true })
  expect(await strict(file)).toBeUndefined()
})

test("strict mode still returns marker dir when include pattern found (B11)", async () => {
  await using tmp = await tmpdir()
  const stopDir = path.join(tmp.path, "stop")
  await fs.mkdir(stopDir, { recursive: true })
  const withMarker = path.join(stopDir, "with-marker")
  await fs.mkdir(withMarker, { recursive: true })
  await fs.writeFile(path.join(withMarker, "Cargo.toml"), "")
  const file = path.join(withMarker, "file.txt")
  await fs.writeFile(file, "")

  const strict = NearestRoot(["Cargo.toml"], () => stopDir, undefined, { strict: true })
  expect(await strict(file)).toBe(withMarker)
})
