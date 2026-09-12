/* SPDX-License-Identifier: MIT */

import { test, expect, beforeEach, afterEach } from "bun:test"
import { InstanceDiagnostics } from "../../src/project/instance-diagnostics"

beforeEach(() => {
  InstanceDiagnostics._resetForTests()
})

afterEach(() => {
  InstanceDiagnostics._resetForTests()
})

test("record then get returns the entry", () => {
  InstanceDiagnostics.record("/d1", "lsp", "touch-file")
  const r = InstanceDiagnostics.get("/d1")
  expect(r?.owner).toBe("lsp")
  expect(r?.reason).toBe("touch-file")
  expect(r?.directory).toBe("/d1")
  expect(typeof r?.createdAt).toBe("number")
})

test("record overwrites a previous entry for the same directory", () => {
  InstanceDiagnostics.record("/d1", "lsp", "first")
  InstanceDiagnostics.record("/d1", "session", "second")
  const r = InstanceDiagnostics.get("/d1")
  expect(r?.owner).toBe("session")
  expect(r?.reason).toBe("second")
})

test("clear removes the entry", () => {
  InstanceDiagnostics.record("/d1", "lsp", "touch-file")
  InstanceDiagnostics.clear("/d1")
  expect(InstanceDiagnostics.get("/d1")).toBeUndefined()
})

test("list returns all recorded entries", () => {
  InstanceDiagnostics.record("/d1", "lsp", "touch-file")
  InstanceDiagnostics.record("/d2", "session", "init")
  InstanceDiagnostics.record("/d3", "test", "fixture")
  const all = InstanceDiagnostics.list()
  expect(all).toHaveLength(3)
  const dirs = all.map((r) => r.directory).sort()
  expect(dirs).toEqual(["/d1", "/d2", "/d3"])
})

test("get returns undefined for unknown directory", () => {
  expect(InstanceDiagnostics.get("/never-recorded")).toBeUndefined()
})
