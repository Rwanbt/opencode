/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "vitest"
import {
  KnowledgeIdSchema,
  KnowledgeLocatorSchema,
  KnowledgeVersionHashSchema,
  KnowledgeRefSchema,
  KnowledgeSpaceSchema,
  PortableRestrictionsSchema,
  MemoryTypeSchema,
  KnowledgeLifecycleStateSchema,
  NoteFrontmatterSchema,
  RetrievalRequestSchema,
  RetrievalResponseSchema,
  ContextPackSchema,
  MutationIntentSchema,
  McpKnowledgeStatusResponseSchema,
  McpKnowledgeCapabilitySchema,
  KnowledgeErrorSchema,
  isKnowledgeError,
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_MAX_SNIPPET_BYTES,
  PERSONAL_ROOT_LOCATOR,
} from "../src/knowledge/index.js"

/**
 * Type-level and Zod-schema tests for the Knowledge contracts.
 *
 * These tests verify:
 * 1. UUIDv7 pattern is enforced (rejects UUIDv4, etc.).
 * 2. Locator cannot be an absolute path or contain '..'.
 * 3. Strict schemas reject unknown fields.
 * 4. Bounded retrieval requests reject out-of-range values.
 * 5. Mutation intent must be complete.
 * 6. McpKnowledgeCapability covers the six V1 methods.
 * 7. KnowledgeError has a typed kind discriminator.
 */

const VALID_UUIDV7 = "0190d2c0-7b00-7000-8000-000000000001"
const VALID_UUIDV4 = "550e8400-e29b-41d4-a716-446655440000" // version digit is 4, not 7
const VALID_HASH_64 = "0".repeat(64)
const VALID_HASH_64_ALT = "a".repeat(64)

describe("@unifia/contracts/knowledge/identity", () => {
  it("accepts a canonical UUIDv7", () => {
    const r = KnowledgeIdSchema.safeParse(VALID_UUIDV7)
    expect(r.success).toBe(true)
  })

  it("rejects a UUIDv4 (version digit must be 7)", () => {
    const r = KnowledgeIdSchema.safeParse(VALID_UUIDV4)
    expect(r.success).toBe(false)
  })

  it("rejects an empty string", () => {
    expect(KnowledgeIdSchema.safeParse("").success).toBe(false)
  })

  it("rejects a non-hex string", () => {
    expect(KnowledgeIdSchema.safeParse("not-a-uuid").success).toBe(false)
  })

  it("accepts a 64-char hex hash (BLAKE3 or SHA-256)", () => {
    expect(KnowledgeVersionHashSchema.safeParse(VALID_HASH_64).success).toBe(true)
    expect(KnowledgeVersionHashSchema.safeParse(VALID_HASH_64_ALT).success).toBe(true)
  })

  it("rejects a 63-char hex hash", () => {
    expect(KnowledgeVersionHashSchema.safeParse(VALID_HASH_64.slice(1)).success).toBe(false)
  })

  it("rejects a 65-char hex hash", () => {
    expect(
      KnowledgeVersionHashSchema.safeParse(VALID_HASH_64 + "0").success,
    ).toBe(false)
  })

  it("KnowledgeRefSchema is strict (rejects unknown fields)", () => {
    const ok = {
      id: VALID_UUIDV7,
      locator: "memory/decisions/x.md",
      versionHash: VALID_HASH_64,
      hashAlgorithm: "blake3" as const,
    }
    expect(KnowledgeRefSchema.safeParse(ok).success).toBe(true)
    const bad = { ...ok, extra: "nope" }
    expect(KnowledgeRefSchema.safeParse(bad).success).toBe(false)
  })
})

describe("@unifia/contracts/knowledge/space", () => {
  it("rejects a leading-slash locator", () => {
    expect(KnowledgeLocatorSchema.safeParse("/memory/x.md").success).toBe(false)
  })

  it("rejects a Windows-style absolute path", () => {
    expect(KnowledgeLocatorSchema.safeParse("C:/memory/x.md").success).toBe(false)
    expect(KnowledgeLocatorSchema.safeParse("D:\\memory\\x.md").success).toBe(false)
  })

  it("rejects a '..' segment", () => {
    expect(KnowledgeLocatorSchema.safeParse("../escape.md").success).toBe(false)
    expect(KnowledgeLocatorSchema.safeParse("memory/../x.md").success).toBe(false)
  })

  it("rejects a backslash separator", () => {
    expect(KnowledgeLocatorSchema.safeParse("memory\\x.md").success).toBe(false)
  })

  it("accepts a normal relative locator", () => {
    expect(KnowledgeLocatorSchema.safeParse("memory/decisions/x.md").success).toBe(true)
  })

  it("PERSONAL_ROOT_LOCATOR is valid", () => {
    expect(KnowledgeLocatorSchema.safeParse(PERSONAL_ROOT_LOCATOR).success).toBe(true)
  })

  it("KnowledgeSpaceSchema accepts a personal space", () => {
    const r = KnowledgeSpaceSchema.safeParse({
      kind: "personal",
      id: "p1",
      label: "Personal",
      rootLocator: PERSONAL_ROOT_LOCATOR,
    })
    expect(r.success).toBe(true)
  })

  it("KnowledgeSpaceSchema accepts an external space with read+watch only", () => {
    const r = KnowledgeSpaceSchema.safeParse({
      kind: "external",
      id: "ext1",
      label: "Mounted",
      capabilities: ["read", "watch"],
    })
    expect(r.success).toBe(true)
  })
})

describe("@unifia/contracts/knowledge/restrictions", () => {
  it("PortableRestrictionsSchema is strict", () => {
    const ok = {
      remoteModel: "deny" as const,
      localModel: "allow" as const,
      embeddable: "allow" as const,
      exportable: "deny" as const,
    }
    expect(PortableRestrictionsSchema.safeParse(ok).success).toBe(true)
    const bad = { ...ok, secret: true }
    expect(PortableRestrictionsSchema.safeParse(bad).success).toBe(false)
  })
})

describe("@unifia/contracts/knowledge/lifecycle", () => {
  it("MemoryTypeSchema covers the 9 V1 types", () => {
    const types = [
      "decision",
      "constraint",
      "preference",
      "failure",
      "learning",
      "procedure",
      "reference",
      "semantic",
      "episodic",
    ]
    for (const t of types) {
      expect(MemoryTypeSchema.safeParse(t).success).toBe(true)
    }
  })

  it("KnowledgeLifecycleStateSchema covers the 4 states", () => {
    const states = ["candidate", "active", "superseded", "archived"]
    for (const s of states) {
      expect(KnowledgeLifecycleStateSchema.safeParse(s).success).toBe(true)
    }
  })

  it("NoteFrontmatterSchema accepts a valid note", () => {
    const fm = {
      unifia_schema: 1 as const,
      unifia_id: VALID_UUIDV7,
      unifia_type: "decision" as const,
      unifia_lifecycle: "active" as const,
      unifia_created_at: "2026-08-29T00:00:00Z",
      unifia_updated_at: "2026-08-29T00:00:00Z",
      unifia_project_ref: "unifia",
      unifia_supersedes: [] as string[],
      unifia_tags: ["model:gemma-4", "tool:bash"],
    }
    expect(NoteFrontmatterSchema.safeParse(fm).success).toBe(true)
  })

  it("NoteFrontmatterSchema rejects an unknown field", () => {
    const fm = {
      unifia_schema: 1 as const,
      unifia_id: VALID_UUIDV7,
      unifia_type: "decision" as const,
      unifia_lifecycle: "active" as const,
      unifia_created_at: "2026-08-29T00:00:00Z",
      unifia_updated_at: "2026-08-29T00:00:00Z",
      unifia_project_ref: "unifia",
      unifia_supersedes: [] as string[],
      unifia_tags: [],
      unifia_extra: "nope",
    }
    expect(NoteFrontmatterSchema.safeParse(fm).success).toBe(false)
  })
})

describe("@unifia/contracts/knowledge/retrieval", () => {
  it("RetrievalRequestSchema accepts a valid request", () => {
    const r = RetrievalRequestSchema.safeParse({
      query: "Adreno K-quants",
      maxCandidates: DEFAULT_MAX_CANDIDATES,
      maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
      maxSnippetBytes: DEFAULT_MAX_SNIPPET_BYTES,
      deadlineMs: 2_000,
    })
    expect(r.success).toBe(true)
  })

  it("RetrievalRequestSchema rejects a negative maxCandidates", () => {
    const r = RetrievalRequestSchema.safeParse({
      query: "x",
      maxCandidates: 0,
      maxPayloadBytes: 1024,
      maxSnippetBytes: 256,
      deadlineMs: 1_000,
    })
    expect(r.success).toBe(false)
  })

  it("RetrievalRequestSchema rejects an empty query", () => {
    const r = RetrievalRequestSchema.safeParse({
      query: "",
      maxCandidates: 1,
      maxPayloadBytes: 1024,
      maxSnippetBytes: 256,
      deadlineMs: 1_000,
    })
    expect(r.success).toBe(false)
  })

  it("RetrievalRequestSchema rejects a deadline over 60s", () => {
    const r = RetrievalRequestSchema.safeParse({
      query: "x",
      maxCandidates: 1,
      maxPayloadBytes: 1024,
      maxSnippetBytes: 256,
      deadlineMs: 120_000,
    })
    expect(r.success).toBe(false)
  })

  it("RetrievalResponseSchema accepts a valid response", () => {
    const r = RetrievalResponseSchema.safeParse({
      candidates: [],
      payloadBytes: 0,
      truncated: false,
      diagnostics: {
        sourcesQueried: ["personal"],
        candidatesScanned: 0,
        candidatesDroppedByRestriction: 0,
        durationMs: 1,
        indexVersion: "v1",
      },
    })
    expect(r.success).toBe(true)
  })
})

describe("@unifia/contracts/knowledge/mutation", () => {
  it("MutationIntentSchema accepts a complete update intent", () => {
    const r = MutationIntentSchema.safeParse({
      kind: "update" as const,
      targetId: VALID_UUIDV7,
      expectedVersionHash: VALID_HASH_64,
      reason: "Patch bash tool schema",
      source: "agent:test",
    })
    expect(r.success).toBe(true)
  })

  it("MutationIntentSchema rejects an update without expectedVersionHash", () => {
    const r = MutationIntentSchema.safeParse({
      kind: "update" as const,
      targetId: VALID_UUIDV7,
      reason: "x",
      source: "agent:test",
    })
    expect(r.success).toBe(false)
  })

  it("MutationIntentSchema accepts a create intent with locator", () => {
    const r = MutationIntentSchema.safeParse({
      kind: "create" as const,
      targetLocator: "memory/decisions/new.md",
      newContent: {
        type: "decision" as const,
        restrictions: {
          remoteModel: "deny" as const,
          localModel: "allow" as const,
          embeddable: "allow" as const,
          exportable: "deny" as const,
        },
        body: "Body",
      },
      reason: "x",
      source: "agent:test",
    })
    expect(r.success).toBe(true)
  })

  it("MutationIntentSchema rejects a supersede without successorId", () => {
    const r = MutationIntentSchema.safeParse({
      kind: "supersede" as const,
      targetId: VALID_UUIDV7,
      reason: "x",
      source: "agent:test",
    })
    expect(r.success).toBe(false)
  })
})

describe("@unifia/contracts/knowledge/context", () => {
  it("ContextPackSchema accepts a minimal valid pack", () => {
    const r = ContextPackSchema.safeParse({
      providerPlan: {
        providerId: "anthropic",
        defaultRestriction: "deny",
      },
      tokenBudget: 8_000,
      items: [],
      diagnostics: {
        sourcesQueried: ["personal"],
        candidatesScanned: 0,
        candidatesDroppedByRestriction: 0,
        totalTokenCost: 0,
        durationMs: 5,
      },
    })
    expect(r.success).toBe(true)
  })
})

describe("@unifia/contracts/knowledge/mcp", () => {
  it("McpKnowledgeCapabilitySchema covers the six V1 methods", () => {
    const methods = [
      "knowledge_search",
      "knowledge_get",
      "knowledge_backlinks",
      "knowledge_trace",
      "knowledge_status",
      "knowledge_propose",
    ]
    for (const m of methods) {
      expect(McpKnowledgeCapabilitySchema.safeParse(m).success).toBe(true)
    }
  })

  it("McpKnowledgeStatusResponseSchema accepts a valid status", () => {
    const r = McpKnowledgeStatusResponseSchema.safeParse({
      indexVersion: "v1",
      rebuiltAt: "2026-08-29T00:00:00Z",
      candidatesCount: 0,
      spaces: ["personal"],
      capabilities: [
        { name: "knowledge_search", readOnly: true },
        { name: "knowledge_get", readOnly: true },
        { name: "knowledge_backlinks", readOnly: true },
        { name: "knowledge_trace", readOnly: true },
        { name: "knowledge_status", readOnly: true },
        { name: "knowledge_propose", readOnly: false },
      ],
      enabled: { fts: true, vector: false, graph: true },
    })
    expect(r.success).toBe(true)
  })
})

describe("@unifia/contracts/knowledge/errors", () => {
  it("KnowledgeErrorSchema accepts a typed error", () => {
    const r = KnowledgeErrorSchema.safeParse({
      kind: "egress_denied",
      message: "UNCLASSIFIED cannot egress to remote",
    })
    expect(r.success).toBe(true)
  })

  it("isKnowledgeError returns true for a valid error", () => {
    expect(
      isKnowledgeError({ kind: "cas_mismatch", message: "hash mismatch" }),
    ).toBe(true)
  })

  it("isKnowledgeError returns false for a non-error value", () => {
    expect(isKnowledgeError("not an error")).toBe(false)
    expect(isKnowledgeError(null)).toBe(false)
    expect(isKnowledgeError({ kind: "unknown", message: "x" })).toBe(false)
  })

  it("KnowledgeError context rejects non-string/number/boolean values", () => {
    const r = KnowledgeErrorSchema.safeParse({
      kind: "internal",
      message: "x",
      context: { ok: "str", count: 1, flag: true },
    })
    expect(r.success).toBe(true)

    const r2 = KnowledgeErrorSchema.safeParse({
      kind: "internal",
      message: "x",
      context: { bad: { nested: "object" } },
    })
    expect(r2.success).toBe(false)
  })
})
