/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "vitest"
import {
  KnowledgeIdSchema,
  NoteFrontmatterSchema,
  MutationIntentSchema,
  McpKnowledgeSearchRequestSchema,
  KnowledgeSpaceSchema,
  RestrictionLevelSchema,
} from "../src/knowledge/index.js"

/**
 * Cross-package integration tests. The Zod schemas in
 * `@unifia/contracts/knowledge` are the only stable surface
 * the runtime can depend on; these tests pin the most
 * important invariants.
 */
const VALID_UUID = "0190d2c0-7b00-7000-8000-000000000001"
const VALID_HASH = "0".repeat(64)

describe("integration: UUIDv7 ↔ locator ↔ frontmatter", () => {
  it("produces a frontmatter that round-trips through the schema", () => {
    const fm = NoteFrontmatterSchema.parse({
      unifia_schema: 1,
      unifia_id: VALID_UUID,
      unifia_type: "decision",
      unifia_lifecycle: "active",
      unifia_created_at: "2026-08-29T00:00:00Z",
      unifia_updated_at: "2026-08-29T00:00:00Z",
      unifia_project_ref: "unifia",
      unifia_supersedes: [],
      unifia_tags: ["a", "b"],
    })
    expect(fm.unifia_id).toBe(VALID_UUID)
    expect(fm.unifia_type).toBe("decision")
  })
  it("rejects a UUIDv4 (non-v7) id", () => {
    expect(() =>
      NoteFrontmatterSchema.parse({
        unifia_schema: 1,
        unifia_id: "550e8400-e29b-41d4-a716-446655440000",
        unifia_type: "decision",
        unifia_lifecycle: "active",
        unifia_created_at: "2026-08-29T00:00:00Z",
        unifia_updated_at: "2026-08-29T00:00:00Z",
        unifia_project_ref: "unifia",
        unifia_supersedes: [],
        unifia_tags: [],
      }),
    ).toThrow()
  })
  it("KnowledgeSpaceSchema accepts every kind + a label", () => {
    for (const kind of ["personal", "project", "session", "external"] as const) {
      const r = KnowledgeSpaceSchema.parse({ kind, id: "x", label: "X" })
      expect(r.kind).toBe(kind)
    }
  })
})

describe("integration: restrictions are valid in every direction", () => {
  it("RestrictionLevelSchema accepts allow|deny", () => {
    expect(RestrictionLevelSchema.parse("allow")).toBe("allow")
    expect(RestrictionLevelSchema.parse("deny")).toBe("deny")
  })
})

describe("integration: mutation intent", () => {
  it("accepts a complete update intent", () => {
    const r = MutationIntentSchema.parse({
      kind: "update",
      targetId: VALID_UUID,
      expectedVersionHash: VALID_HASH,
      reason: "r",
      source: "test",
    })
    expect(r.kind).toBe("update")
  })
  it("rejects an update without expectedVersionHash", () => {
    expect(() =>
      MutationIntentSchema.parse({
        kind: "update",
        targetId: VALID_UUID,
        reason: "r",
        source: "test",
      }),
    ).toThrow()
  })
})

describe("integration: MCP search request bounds", () => {
  it("accepts a default-bounded request", () => {
    const r = McpKnowledgeSearchRequestSchema.parse({
      workspace: "ws-1",
      query: "x",
      maxCandidates: 50,
      maxPayloadBytes: 1024 * 1024,
      maxSnippetBytes: 64 * 1024,
      deadlineMs: 2_000,
      spaces: ["personal"],
      types: ["decision"],
      tags: ["model:gemma-4"],
    })
    expect(r.workspace).toBe("ws-1")
  })
  it("rejects a 70 s deadline", () => {
    expect(() =>
      McpKnowledgeSearchRequestSchema.parse({
        workspace: "ws-1",
        query: "x",
        maxCandidates: 1,
        maxPayloadBytes: 1,
        maxSnippetBytes: 1,
        deadlineMs: 70_000,
        spaces: [],
        types: [],
        tags: [],
      }),
    ).toThrow()
  })
})

describe("integration: KnowledgeId is exported as a type guard", () => {
  it("KnowledgeIdSchema.success is true for canonical UUIDv7", () => {
    expect(KnowledgeIdSchema.safeParse(VALID_UUID).success).toBe(true)
  })
  it("KnowledgeIdSchema.success is false for an empty string", () => {
    expect(KnowledgeIdSchema.safeParse("").success).toBe(false)
  })
})
