/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { cosine, BruteForceIndex } from "../../src/knowledge/semantic/vector.js"
import {
  scoreEmbeddingModel,
  selectBestModel,
} from "../../src/knowledge/semantic/embedding.js"
import {
  classifySource,
  mapStackSource,
} from "../../src/knowledge/stack/mapping.js"
import {
  scanForSecrets,
  GitProvider,
} from "../../src/knowledge/git/provider.js"
import {
  McpKnowledgeServer,
  McpOversizedPayload,
  McpRateLimitExceeded,
  McpUnauthorized,
} from "../../src/knowledge/mcp/server.js"
import {
  STORAGE_MATRIX_TEMPLATE,
  canManagedWrite,
} from "../../src/knowledge/mobile/storage.js"
import { DefaultKnowledgeService } from "../../src/knowledge/facade/service.js"
import {
  McpTokenRegistry,
  DEFAULT_TOKEN_TTL_MS,
  MAX_TOKEN_TTL_MS,
} from "../../src/knowledge/mcp/token.js"
import { MCP_KNOWLEDGE_METHODS } from "@unifia/contracts/knowledge"
import {
  SourceRegistry,
  PersonalSource,
  type KnowledgeSource,
  type ListOptions,
  type ListedNote,
  type SourceEvent,
} from "../../src/knowledge/source/index.js"
import type { KnowledgeSpaceKind } from "@unifia/contracts/knowledge"

const VALID_UUID = "0190d2c0-7b00-7000-8000-000000000001"

function makeSource(kind: KnowledgeSpaceKind, id: string, notes: ListedNote[]): KnowledgeSource {
  return {
    space: { kind, id, label: id },
    list: async (_opts: ListOptions) => notes,
    read: async () => null,
    watch: (_onChange: (e: SourceEvent) => void) => () => undefined,
  }
}

describe("P5 vector + embedding scoring", () => {
  it("cosine of identical vectors is 1", () => {
    const v = new Float32Array([1, 0, 0])
    expect(cosine(v, v)).toBeCloseTo(1, 6)
  })
  it("cosine of orthogonal vectors is 0", () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(cosine(a, b)).toBe(0)
  })
  it("BruteForceIndex returns topK", () => {
    const idx = new BruteForceIndex()
    idx.add({ id: "0190d2c0-7b00-7000-8000-000000000001", locator: "a.md", vector: new Float32Array([1, 0]) })
    idx.add({ id: "0190d2c0-7b00-7000-8000-000000000002", locator: "b.md", vector: new Float32Array([0, 1]) })
    const hits = idx.query({ vector: new Float32Array([1, 0]), topK: 1 })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.id).toBe("0190d2c0-7b00-7000-8000-000000000001")
  })
  it("selectBestModel picks the highest score", () => {
    const best = selectBestModel([
      { modelId: "x", quality: 0.5, latencyMs: 100, peakRamMiB: 200, sizeMiB: 100, simplicity: 0.5 },
      { modelId: "y", quality: 0.9, latencyMs: 200, peakRamMiB: 200, sizeMiB: 100, simplicity: 0.5 },
    ])
    expect(best?.modelId).toBe("y")
  })
  it("selectBestModel returns null on empty", () => {
    expect(selectBestModel([])).toBeNull()
  })
})

describe("P6 stack mapping", () => {
  it("classifies AGENTS.md", () => {
    expect(classifySource("AGENTS.md")).toBe("AGENTS.md")
  })
  it("classifies an ADR", () => {
    expect(classifySource("0001-foo.md")).toBe("ADR")
    expect(classifySource("0025-bar.md")).toBe("ADR")
  })
  it("classifies a failure pattern", () => {
    expect(classifySource("KNOWN_FAILURE_PATTERNS.md")).toBe("FAILURE_PATTERN")
  })
  it("maps a stack source to a StackMapping", () => {
    const m = mapStackSource(
      { kind: "AGENTS.md", path: "AGENTS.md", content: "x".repeat(100) },
      VALID_UUID,
    )
    expect(m.type).toBe("procedure")
    expect(m.lifecycle).toBe("active")
    expect(m.tags).toContain("source:agents-md")
  })
  it("truncates very long bodies", () => {
    const big = "x".repeat(200_000)
    const m = mapStackSource(
      { kind: "AGENTS.md", path: "AGENTS.md", content: big },
      VALID_UUID,
    )
    expect(m.body.length).toBeLessThan(big.length)
    expect(m.body).toContain("truncated")
  })
})

describe("P8 git provider", () => {
  it("detects an OpenAI key", () => {
    const hits = scanForSecrets([
      { locator: "a.md", commit: "abc", content: "sk-abcdefghijklmnopqrstuv" },
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe("openai_anthropic_key")
  })
  it("returns no hit for plain text", () => {
    const hits = scanForSecrets([
      { locator: "a.md", commit: "abc", content: "Just some prose." },
    ])
    expect(hits).toHaveLength(0)
  })
  it("GitProvider autoPush defaults to false", () => {
    const g = new GitProvider()
    expect(g.getAutoPush()).toBe(false)
  })
  it("prepushScan returns ok=true when no secret", async () => {
    const g = new GitProvider()
    const r = await g.prepushScan(
      { from: "a", to: "b", touchedLocators: ["x.md"] },
      [{ locator: "x.md", commit: "abc", content: "no secrets here" }],
    )
    expect(r.ok).toBe(true)
  })
  it("prepushScan returns ok=false when secret present", async () => {
    const g = new GitProvider()
    const r = await g.prepushScan(
      { from: "a", to: "b", touchedLocators: ["x.md"] },
      [{ locator: "x.md", commit: "abc", content: "AKIAIOSFODNN7EXAMPLE" }],
    )
    expect(r.ok).toBe(false)
  })
})

describe("P9 MCP server", () => {
  const plan = { providerId: "x", destinationKind: "local" as const, defaultRestriction: "allow" as const }
  function newService() {
    const reg = new SourceRegistry()
    reg.register(new PersonalSource({ spaceId: "p" }, makeSource("personal", "p", [])))
    return new DefaultKnowledgeService(reg, { providerPlan: plan })
  }
  function newServer(rateLimitPerMinute = 100) {
    const tokens = new McpTokenRegistry()
    const token = tokens.issue({ workspace: "ws-1", methods: [...MCP_KNOWLEDGE_METHODS] })
    const server = new McpKnowledgeServer(
      newService(),
      { rateLimitPerMinute, maxRequestBytes: 64 * 1024, maxResponseBytes: 64 * 1024, workspace: "ws-1" },
      tokens,
    )
    return { server, ctx: { tokenId: token.id }, tokens, token }
  }
  const searchReq = (over: Record<string, unknown> = {}) => ({
    workspace: "ws-1", query: "x", maxCandidates: 1, maxPayloadBytes: 1,
    maxSnippetBytes: 1, deadlineMs: 1000, spaces: [], types: [], tags: [], ...over,
  })

  it("exposes six capabilities", () => {
    expect(newServer().server.capabilities()).toHaveLength(6)
  })

  it("throws on oversized payload", async () => {
    const { server, ctx } = newServer()
    await expect(
      server.search(searchReq({ tags: ["x".repeat(100_000)] }) as never, ctx),
    ).rejects.toBeInstanceOf(McpOversizedPayload)
  })

  it("throws on rate limit", async () => {
    const { server, ctx } = newServer(2)
    await server.search(searchReq() as never, ctx)
    await server.search(searchReq() as never, ctx)
    await expect(server.search(searchReq() as never, ctx)).rejects.toBeInstanceOf(McpRateLimitExceeded)
  })

  it("refuses an anonymous call", async () => {
    const { server } = newServer()
    await expect(
      server.search(searchReq() as never, { tokenId: "" }),
    ).rejects.toBeInstanceOf(McpUnauthorized)
  })

  it("refuses an unknown, revoked or expired token", async () => {
    const { server, tokens, token } = newServer()
    await expect(server.search(searchReq() as never, { tokenId: "tok_nope" })).rejects.toBeInstanceOf(McpUnauthorized)
    tokens.revoke(token.id)
    await expect(server.search(searchReq() as never, { tokenId: token.id })).rejects.toBeInstanceOf(McpUnauthorized)
  })

  it("refuses a request naming another workspace", async () => {
    const { server, ctx } = newServer()
    await expect(
      server.search(searchReq({ workspace: "ws-other" }) as never, ctx),
    ).rejects.toBeInstanceOf(McpUnauthorized)
  })

  it("refuses a method outside the token allowlist", async () => {
    const tokens = new McpTokenRegistry()
    const readOnly = tokens.issue({ workspace: "ws-1" })
    const server = new McpKnowledgeServer(
      newService(),
      { rateLimitPerMinute: 100, maxRequestBytes: 64 * 1024, maxResponseBytes: 64 * 1024, workspace: "ws-1" },
      tokens,
    )
    await expect(
      server.propose({ workspace: "ws-1", intent: {} } as never, { tokenId: readOnly.id }),
    ).rejects.toBeInstanceOf(McpUnauthorized)
  })

  it("rate-limits status like every other method", async () => {
    const { server, ctx } = newServer(1)
    await server.status(ctx)
    await expect(server.status(ctx)).rejects.toBeInstanceOf(McpRateLimitExceeded)
  })

  it("refuses an anonymous status call", async () => {
    const { server } = newServer()
    await expect(server.status({ tokenId: "" })).rejects.toBeInstanceOf(McpUnauthorized)
  })

  it("enforces the response byte cap", async () => {
    const tokens = new McpTokenRegistry()
    const token = tokens.issue({ workspace: "ws-1", methods: [...MCP_KNOWLEDGE_METHODS] })
    const server = new McpKnowledgeServer(
      newService(),
      { rateLimitPerMinute: 100, maxRequestBytes: 64 * 1024, maxResponseBytes: 1, workspace: "ws-1" },
      tokens,
    )
    await expect(
      server.status({ tokenId: token.id }),
    ).rejects.toBeInstanceOf(McpOversizedPayload)
  })
})

describe("P9.2 MCP tokens", () => {
  it("issues a CSPRNG id, not a clock-derived one", () => {
    const r = new McpTokenRegistry()
    const a = r.issue({ workspace: "w" })
    const b = r.issue({ workspace: "w" })
    expect(a.id).not.toBe(b.id)
    expect(a.id.startsWith("tok_")).toBe(true)
    expect(a.id.length).toBeGreaterThan(40)
  })

  it("always applies a TTL and defaults it to one hour", () => {
    const t = new McpTokenRegistry().issue({ workspace: "w" })
    const ttl = Date.parse(t.expiresAt) - Date.parse(t.issuedAt)
    expect(ttl).toBe(DEFAULT_TOKEN_TTL_MS)
  })

  it("refuses a TTL beyond the 24 hour maximum, or a non-positive one", () => {
    const r = new McpTokenRegistry()
    expect(() => r.issue({ workspace: "w", ttlMs: MAX_TOKEN_TTL_MS + 1 })).toThrow()
    expect(() => r.issue({ workspace: "w", ttlMs: 0 })).toThrow()
    expect(() => r.issue({ workspace: "w", ttlMs: Number.NaN })).toThrow()
  })

  it("defaults to the read-only scope, excluding knowledge_propose", () => {
    const t = new McpTokenRegistry().issue({ workspace: "w" })
    expect(t.methods).not.toContain("knowledge_propose")
    expect(t.methods).toContain("knowledge_search")
  })

  it("expires", () => {
    const r = new McpTokenRegistry()
    const t = r.issue({ workspace: "w", ttlMs: 1000 })
    expect(r.isValid(t.id, Date.parse(t.issuedAt))).toBe(true)
    expect(r.isValid(t.id, Date.parse(t.expiresAt))).toBe(false)
  })

  it("does not authorise another workspace", () => {
    const r = new McpTokenRegistry()
    const t = r.issue({ workspace: "w" })
    expect(r.authorize(t.id, "other", "knowledge_search")).toBeNull()
    expect(r.authorize(t.id, "w", "knowledge_search")).not.toBeNull()
  })
})

describe("P10 storage matrix", () => {
  it("template lists 4 storage kinds", () => {
    expect(STORAGE_MATRIX_TEMPLATE).toHaveLength(4)
  })
  it("canManagedWrite requires all 5 capabilities", () => {
    expect(canManagedWrite({
      kind: "app_private",
      available: true,
      capabilities: ["read", "write", "fsync", "lock", "atomic", "recover"],
      notes: "ok",
    })).toBe(true)
    expect(canManagedWrite({
      kind: "app_private",
      available: true,
      capabilities: ["read", "write", "fsync", "lock", "atomic"],
      notes: "missing recover",
    })).toBe(false)
  })
  it("canManagedWrite requires available=true", () => {
    expect(canManagedWrite({
      kind: "app_private",
      available: false,
      capabilities: ["read", "write", "fsync", "lock", "atomic", "recover"],
      notes: "not available",
    })).toBe(false)
  })
})

describe("P7 facade", () => {
  it("DefaultKnowledgeService.status returns the six capabilities", async () => {
    const reg = new SourceRegistry()
    reg.register(new PersonalSource({ spaceId: "p" }, makeSource("personal", "p", [])))
    const svc = new DefaultKnowledgeService(reg, {
      providerPlan: { providerId: "x", defaultRestriction: "allow" },
    })
    const status = await svc.status()
    expect(status.capabilities).toHaveLength(6)
  })
})
