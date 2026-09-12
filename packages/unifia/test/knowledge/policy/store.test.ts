/* SPDX-License-Identifier: MIT */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  readPolicy,
  writePolicy,
  patchPolicy,
  isDestinationAllowed,
  POLICY_FILE,
  DEFAULT_POLICY,
  type KnowledgePolicy,
} from "../../../src/knowledge/policy/store.js"

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unifia-policy-"))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const basePolicy: KnowledgePolicy = {
  ...DEFAULT_POLICY,
  updatedAt: "2026-08-29T00:00:00Z",
}

describe("P11.14 policy store", () => {
  it("readPolicy returns DEFAULT_POLICY when the file is absent", () => {
    const p = readPolicy(root)
    expect(p.version).toBe(1)
    expect(p.egress).toBe("deny")
    expect(p.features.embedding).toBe(false)
  })

  it("writePolicy creates the .unifia directory and the file", () => {
    writePolicy(root, basePolicy)
    expect(existsSync(resolve(root, POLICY_FILE))).toBe(true)
  })

  it("round-trips through disk", () => {
    writePolicy(root, { ...basePolicy, defaultTokenTtlMs: 120_000 })
    const p = readPolicy(root)
    expect(p.defaultTokenTtlMs).toBe(120_000)
  })

  it("patchPolicy preserves the existing fields", () => {
    writePolicy(root, basePolicy)
    const next = patchPolicy(root, { features: { ...basePolicy.features, embedding: true } })
    expect(next.features.embedding).toBe(true)
    expect(next.egress).toBe("deny")
  })

  it("isDestinationAllowed respects the per-destination override", () => {
    const p: KnowledgePolicy = {
      ...basePolicy,
      egress: "deny",
      egressByDestination: { "provider:openai": "allow" },
    }
    expect(isDestinationAllowed(p, "provider:openai")).toBe(true)
    expect(isDestinationAllowed(p, "provider:anthropic")).toBe(false)
  })

  it("isDestinationAllowed falls back to the default", () => {
    const p: KnowledgePolicy = { ...basePolicy, egress: "allow" }
    expect(isDestinationAllowed(p, "anything")).toBe(true)
    const q: KnowledgePolicy = { ...basePolicy, egress: "deny" }
    expect(isDestinationAllowed(q, "anything")).toBe(false)
  })

  it("rejects a non-absolute workspaceRoot", () => {
    expect(() => readPolicy("relative/path")).toThrow(/absolute/)
    expect(() => writePolicy("relative/path", basePolicy)).toThrow(/absolute/)
  })

  it("rejects a corrupt policy file", () => {
    const { writeFileSync, mkdirSync } = require("node:fs")
    mkdirSync(resolve(root, ".unifia"), { recursive: true })
    writeFileSync(resolve(root, POLICY_FILE), "{not json", "utf8")
    expect(() => readPolicy(root)).toThrow()
  })

  it("rejects a policy with an unsupported version", () => {
    const bad = { ...basePolicy, version: 99 as never }
    expect(() => writePolicy(root, bad)).toThrow(/version/)
  })

  it("rejects a policy with an invalid shape", () => {
    const { writeFileSync, mkdirSync } = require("node:fs")
    mkdirSync(resolve(root, ".unifia"), { recursive: true })
    writeFileSync(resolve(root, POLICY_FILE), JSON.stringify({ version: 1, egress: "maybe" }), "utf8")
    expect(() => readPolicy(root)).toThrow()
  })
})
