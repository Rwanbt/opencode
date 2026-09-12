/* SPDX-License-Identifier: MIT */
import assert from "node:assert/strict"
import { SandboxPathDouble } from "../src/p3.ts"
const root = "/workspace"
const sandbox = new SandboxPathDouble(root)
const clean = { existing: new Set(["/workspace/known"]), symlinks: new Map<string, string>() }
const outsideLink = { existing: new Set(["/workspace/link/new"]), symlinks: new Map([["/workspace/link", "/etc"]]) }
let passed = 0
function test(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`) }
function deny(value: { kind: string; ruleId: string }, ruleId: string) { assert.equal(value.kind, "deny"); assert.equal(value.ruleId, ruleId) }

test("C6-symlinked-parent-denied", () => deny(sandbox.decide("link/new", "create", outsideLink), "C6-symlinked-parent-denied"))
test("C6-toctou-denied", () => { const before = { existing: new Set(["/workspace/link/file"]), symlinks: new Map<string, string>() }; const after = { existing: new Set(["/workspace/link/file"]), symlinks: new Map([["/workspace/link", "/outside"]]) }; deny(sandbox.decideAtUse("link/file", "write", before, after), "C6-toctou-denied") })
test("C6-windows-no-widen", () => { deny(sandbox.decide("C:\\Windows\\system32", "read", clean), "C6-windows-no-widen"); deny(sandbox.decide("\\\\server\\share", "read", clean), "C6-windows-no-widen") })
test("C6-lexical-escape-denied", () => deny(sandbox.decide("safe/../outside", "write", clean), "C6-lexical-escape-denied"))
test("C6-write-no-silent-create", () => { deny(sandbox.decide("missing", "read", clean), "C6-write-no-silent-create"); assert.equal(sandbox.decide("missing", "write", clean).kind, "allow") })
test("C6-denylist-only-denied", () => deny(sandbox.validateCommand("rm -rf /etc", []), "C6-denylist-only-denied"))
assert.equal(passed, 6)
console.log(`P3 Lot 2: ${passed}/6 passed`)