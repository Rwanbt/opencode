/* SPDX-License-Identifier: MIT */
/**
 * ContextRouter honours the retrieval contract (card C2).
 *
 * Before this card the router ignored query, types, tags, maxPayloadBytes,
 * maxSnippetBytes and deadlineMs, applied maxCandidates per source rather
 * than globally, never called read(), and fabricated every candidate with
 * trust=verified / restriction=allow / relevance=0.5 / empty snippet.
 */

import { describe, it, expect } from "bun:test"
import { ContextRouter } from "../../../src/knowledge/context/router.js"
import { SourceRegistry } from "../../../src/knowledge/source/source.js"
import type {
  KnowledgeSource,
  ListedNote,
  ListOptions,
} from "../../../src/knowledge/source/source.js"
import { parseDocument, type ParsedDocument } from "../../../src/knowledge/parser/parser.js"
import type { KnowledgeSpaceKind, RetrievalRequest } from "@unifia/contracts/knowledge"
import { truncateUtf8, utf8Bytes } from "../../../src/knowledge/context/lexical.js"

const uuid = (i: number) => `0190d2c0-7b00-7000-8000-${String(i).padStart(12, "0")}`

const LOCAL_PLAN = {
  providerId: "local-llm",
  destinationKind: "local" as const,
  defaultRestriction: "allow" as const,
}

interface NoteSpec {
  i: number
  type?: string
  lifecycle?: string
  tags?: string[]
  body: string
  restrictions?: string[]
}

function doc(spec: NoteSpec): ParsedDocument {
  return parseDocument(
    [
      "---",
      "unifia_schema: 1",
      `unifia_id: "${uuid(spec.i)}"`,
      `unifia_type: "${spec.type ?? "decision"}"`,
      `unifia_lifecycle: "${spec.lifecycle ?? "active"}"`,
      'unifia_created_at: "2026-08-01T00:00:00Z"',
      'unifia_updated_at: "2026-08-29T00:00:00Z"',
      'unifia_project_ref: "unifia"',
      "unifia_supersedes: []",
      `unifia_tags: [${(spec.tags ?? []).map((t) => `"${t}"`).join(", ")}]`,
      ...(spec.restrictions ? ["unifia_restrictions:", ...spec.restrictions] : []),
      "---",
      spec.body,
    ].join("\n"),
  )
}

function source(kind: KnowledgeSpaceKind, specs: NoteSpec[]): KnowledgeSource {
  const listed: ListedNote[] = specs.map((s) => ({
    ref: { id: uuid(s.i), locator: `n-${s.i}.md` },
    type: (s.type ?? "decision") as ListedNote["type"],
    lifecycle: (s.lifecycle ?? "active") as ListedNote["lifecycle"],
    updatedAt: "2026-08-29T00:00:00Z",
  }))
  return {
    space: { kind, id: kind, label: kind },
    list: async (_o: ListOptions) => listed,
    read: async (locator?: string) => {
      const spec = specs.find((s) => `n-${s.i}.md` === locator)
      return spec === undefined ? null : doc(spec)
    },
    watch: () => () => undefined,
  }
}

function request(over: Partial<RetrievalRequest> = {}): RetrievalRequest {
  return {
    query: "alpha",
    spaces: [],
    types: [],
    tags: [],
    maxCandidates: 50,
    maxPayloadBytes: 1024 * 1024,
    maxSnippetBytes: 64 * 1024,
    deadlineMs: 2_000,
    ...over,
  }
}

function registryOf(...sources: KnowledgeSource[]): SourceRegistry {
  const reg = new SourceRegistry()
  for (const s of sources) reg.register(s)
  return reg
}

describe("C2 — the query actually filters", () => {
  const reg = registryOf(
    source("personal", [
      { i: 1, body: "alpha is discussed here" },
      { i: 2, body: "completely unrelated content" },
    ]),
  )

  it("returns only notes matching the query", async () => {
    const { pack } = await new ContextRouter(reg, { providerPlan: LOCAL_PLAN }).route(
      request({ query: "alpha" }),
    )
    expect(pack.items.map((i) => i.ref.locator)).toEqual(["n-1.md"])
  })

  it("returns nothing for a term absent from the corpus", async () => {
    const { pack } = await new ContextRouter(reg, { providerPlan: LOCAL_PLAN }).route(
      request({ query: "term-that-does-not-exist-9f3c" }),
    )
    expect(pack.items).toHaveLength(0)
  })

  it("gives different answers to different queries", async () => {
    const router = new ContextRouter(reg, { providerPlan: LOCAL_PLAN })
    const a = await router.route(request({ query: "alpha" }))
    const b = await router.route(request({ query: "unrelated" }))
    expect(a.pack.items.map((i) => i.ref.locator)).not.toEqual(
      b.pack.items.map((i) => i.ref.locator),
    )
  })
})

describe("C2 — bounds are global and real", () => {
  it("applies maxCandidates globally, not per source", async () => {
    const reg = registryOf(
      source("personal", [{ i: 1, body: "alpha" }]),
      source("project", [{ i: 2, body: "alpha" }]),
      source("session", [{ i: 3, body: "alpha" }]),
      source("external", [{ i: 4, body: "alpha" }]),
    )
    const { pack, truncated } = await new ContextRouter(reg, {
      providerPlan: LOCAL_PLAN,
    }).route(request({ maxCandidates: 1 }))
    expect(pack.items).toHaveLength(1)
    expect(truncated).toBe(true)
  })

  it("bounds a snippet in UTF-8 bytes, not characters", async () => {
    const reg = registryOf(source("personal", [{ i: 1, body: `alpha ${"é".repeat(200)}` }]))
    const { pack } = await new ContextRouter(reg, { providerPlan: LOCAL_PLAN }).route(
      request({ maxSnippetBytes: 32 }),
    )
    const snippet = pack.items[0]?.snippet ?? ""
    expect(utf8Bytes(snippet)).toBeLessThanOrEqual(32)
    // A byte-cut that split a codepoint would leave a replacement char.
    expect(snippet).not.toContain("�")
  })

  it("stops adding items once maxPayloadBytes is reached", async () => {
    const specs = Array.from({ length: 10 }, (_, i) => ({ i: i + 1, body: `alpha ${"x".repeat(200)}` }))
    const reg = registryOf(source("personal", specs))
    const { pack, truncated } = await new ContextRouter(reg, {
      providerPlan: LOCAL_PLAN,
      maxPerType: 100,
    }).route(request({ maxPayloadBytes: 300, maxSnippetBytes: 256 }))
    const total = pack.items.reduce((n, i) => n + utf8Bytes(i.snippet), 0)
    expect(total).toBeLessThanOrEqual(300)
    expect(truncated).toBe(true)
  })
})

describe("C2 — filters and real metadata", () => {
  const reg = registryOf(
    source("personal", [
      { i: 1, type: "decision", tags: ["arch"], body: "alpha one" },
      { i: 2, type: "failure", tags: ["bug"], body: "alpha two" },
      { i: 3, type: "decision", lifecycle: "archived", body: "alpha three" },
    ]),
  )

  it("honours the types filter", async () => {
    const { pack } = await new ContextRouter(reg, { providerPlan: LOCAL_PLAN }).route(
      request({ types: ["failure"] }),
    )
    expect(pack.items.map((i) => i.type)).toEqual(["failure"])
  })

  it("honours the tags filter", async () => {
    const { pack } = await new ContextRouter(reg, { providerPlan: LOCAL_PLAN }).route(
      request({ tags: ["arch"] }),
    )
    expect(pack.items.map((i) => i.ref.locator)).toEqual(["n-1.md"])
  })

  it("excludes archived notes from retrieval by default", async () => {
    const { pack } = await new ContextRouter(reg, { providerPlan: LOCAL_PLAN }).route(request())
    expect(pack.items.map((i) => i.ref.locator)).not.toContain("n-3.md")
  })

  it("carries the real lifecycle, not a hardcoded active", async () => {
    const { pack } = await new ContextRouter(reg, {
      providerPlan: LOCAL_PLAN,
      includeInactive: true,
    }).route(request())
    const archived = pack.items.find((i) => i.ref.locator === "n-3.md")
    expect(archived?.temporalState).toBe("archived")
  })

  it("produces a real content hash and a non-empty snippet", async () => {
    const { pack } = await new ContextRouter(reg, { providerPlan: LOCAL_PLAN }).route(request())
    const item = pack.items[0]
    expect(item?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(item?.contentHash).not.toBe("0".repeat(64))
    expect(item?.snippet.length).toBeGreaterThan(0)
  })

  it("marks external provenance unverified rather than assuming verified", async () => {
    const ext = registryOf(source("external", [{ i: 9, body: "alpha external" }]))
    const { pack } = await new ContextRouter(ext, {
      providerPlan: LOCAL_PLAN,
    }).route(request())
    expect(pack.items[0]?.trust).toBe("unverified")
  })
})

describe("C2 — the destination decides which restriction applies", () => {
  const reg = registryOf(
    source("personal", [
      { i: 1, body: "alpha secret", restrictions: ["  remote_model: deny", "  local_model: allow"] },
    ]),
  )

  it("keeps a remote-denied note out of a remote pack", async () => {
    const { pack } = await new ContextRouter(reg, {
      providerPlan: { providerId: "cloud", destinationKind: "remote", defaultRestriction: "allow" },
    }).route(request())
    expect(pack.items).toHaveLength(0)
  })

  it("still serves it to a local destination", async () => {
    const { pack } = await new ContextRouter(reg, { providerPlan: LOCAL_PLAN }).route(request())
    expect(pack.items).toHaveLength(1)
  })

  it("treats a plan that omits destinationKind as remote", async () => {
    const { pack } = await new ContextRouter(reg, {
      providerPlan: { providerId: "unknown", defaultRestriction: "allow" },
    }).route(request())
    expect(pack.items).toHaveLength(0)
  })
})

describe("C2 — invalid requests and unreadable notes", () => {
  it("rejects a request that violates the schema", async () => {
    const reg = registryOf(source("personal", [{ i: 1, body: "alpha" }]))
    const router = new ContextRouter(reg, { providerPlan: LOCAL_PLAN })
    await expect(router.route(request({ maxCandidates: 0 }))).rejects.toThrow(
      /invalid retrieval request/,
    )
  })

  it("drops an unreadable note with a reason instead of padding the pack", async () => {
    const broken: KnowledgeSource = {
      space: { kind: "personal", id: "p", label: "p" },
      list: async () => [
        {
          ref: { id: uuid(1), locator: "gone.md" },
          type: "decision",
          lifecycle: "active",
          updatedAt: "2026-08-29T00:00:00Z",
        },
      ],
      read: async () => null,
      watch: () => () => undefined,
    }
    const { pack, excluded } = await new ContextRouter(registryOf(broken), {
      providerPlan: LOCAL_PLAN,
    }).route(request())
    expect(pack.items).toHaveLength(0)
    expect(excluded.some((e) => e.reason === "unreadable")).toBe(true)
  })
})

describe("truncateUtf8", () => {
  it("never exceeds the budget and never splits a codepoint", () => {
    for (const s of ["ééééé", "日本語のテキスト", "a".repeat(50), "🎉🎉🎉"]) {
      for (let n = 0; n <= 20; n++) {
        const out = truncateUtf8(s, n)
        expect(utf8Bytes(out)).toBeLessThanOrEqual(n)
        expect(out).not.toContain("�")
      }
    }
  })
})
