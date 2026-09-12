/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { ContextRouter, inspect, classifyText, decideWrite } from "../../../src/knowledge/context/index.js"
import {
  SourceRegistry,
  PersonalSource,
  ProjectSource,
  SessionSource,
  ExternalSource,
  type KnowledgeSource,
  type ListOptions,
  type ListedNote,
  type SourceEvent,
} from "../../../src/knowledge/source/index.js"
import { decideEgress } from "../../../src/knowledge/policy/index.js"
import type { KnowledgeSpaceKind } from "@unifia/contracts/knowledge"
import { parseDocument, type ParsedDocument } from "../../../src/knowledge/parser/parser.js"

const VALID_UUID = (i: number) =>
  `0190d2c0-7b00-7000-8000-${String(i).padStart(12, "0")}`

function makeNote(i: number, type: ListedNote["type"]): ListedNote {
  return {
    ref: { id: VALID_UUID(i), locator: `memory/x-${i}.md` },
    type,
    lifecycle: "active",
    updatedAt: "2026-08-29T00:00:00Z",
  }
}

/**
 * A real document for `note`, so the router can score and snippet it. The
 * body carries the term the router tests query for ("q"); a source whose
 * `read` returns null is a source whose notes are correctly dropped.
 */
function documentFor(note: ListedNote): ParsedDocument {
  return parseDocument(
    [
      "---",
      "unifia_schema: 1",
      `unifia_id: "${note.ref.id}"`,
      `unifia_type: "${note.type}"`,
      `unifia_lifecycle: "${note.lifecycle}"`,
      `unifia_created_at: "${note.updatedAt}"`,
      `unifia_updated_at: "${note.updatedAt}"`,
      'unifia_project_ref: "unifia"',
      "unifia_supersedes: []",
      'unifia_tags: ["q"]',
      "---",
      `q body for ${note.ref.locator}`,
    ].join("\n"),
  )
}

function makeSource(
  kind: KnowledgeSpaceKind,
  id: string,
  notes: ListedNote[],
): KnowledgeSource {
  return {
    space: { kind, id, label: id },
    list: async (_opts: ListOptions) => notes,
    read: async (locator?: string) =>
      documentFor(notes.find((n) => n.ref.locator === locator) ?? (notes[0] as ListedNote)),
    watch: (_onChange: (e: SourceEvent) => void) => () => undefined,
  }
}

// A local destination: these tests exercise routing and bounds, not the
// remote-egress rule (covered by the C3 characterization suite). Notes with
// no restrictions block default to local_model: allow, remote_model: deny.
const basePlan = {
  providerId: "local-llm",
  destinationKind: "local" as const,
  defaultRestriction: "allow" as const,
}

describe("decideEgress", () => {
  it("denies a deny-restricted item with deny default", () => {
    const item = {
      ref: { id: VALID_UUID(1), locator: "x" },
      source: "personal" as const,
      type: "decision" as const,
      trust: "verified" as const,
      authority: "user" as const,
      restriction: "deny" as const,
      relevance: 1,
      tokenCost: 0,
      contentHash: "0".repeat(64),
      snippet: "",
      reason: "test",
    }
    const d = decideEgress({ item, plan: { providerId: "x", defaultRestriction: "deny" } })
    expect(d.decision).toBe("deny")
  })

  it("allows an allow-restricted item with allow default", () => {
    const item = {
      ref: { id: VALID_UUID(1), locator: "x" },
      source: "personal" as const,
      type: "decision" as const,
      trust: "verified" as const,
      authority: "user" as const,
      restriction: "allow" as const,
      relevance: 1,
      tokenCost: 0,
      contentHash: "0".repeat(64),
      snippet: "",
      reason: "test",
    }
    const d = decideEgress({ item, plan: { providerId: "x", defaultRestriction: "allow" } })
    expect(d.decision).toBe("allow")
  })

  it("honours a per-item override deny", () => {
    const item = {
      ref: { id: VALID_UUID(1), locator: "x" },
      source: "personal" as const,
      type: "decision" as const,
      trust: "verified" as const,
      authority: "user" as const,
      restriction: "allow" as const,
      relevance: 1,
      tokenCost: 0,
      contentHash: "0".repeat(64),
      snippet: "",
      reason: "test",
    }
    const d = decideEgress({
      item,
      plan: {
        providerId: "x",
        defaultRestriction: "allow",
        overrides: { [VALID_UUID(1)]: "deny" },
      },
    })
    expect(d.decision).toBe("deny")
  })
})

describe("ContextRouter", () => {
  it("routes from one source into a pack", async () => {
    const reg = new SourceRegistry()
    const personal = new PersonalSource(
      { spaceId: "p" },
      makeSource("personal", "p", [makeNote(1, "decision"), makeNote(2, "failure")]),
    )
    reg.register(personal)
    const router = new ContextRouter(reg, { providerPlan: basePlan })
    const { pack } = await router.route({
      query: "q",
      spaces: ["personal"],
      types: [],
      tags: [],
      maxCandidates: 50,
      maxPayloadBytes: 1024,
      maxSnippetBytes: 256,
      deadlineMs: 1_000,
    })
    expect(pack.items).toHaveLength(2)
    expect(pack.diagnostics.sourcesQueried).toEqual(["personal"])
    expect(pack.diagnostics.candidatesScanned).toBe(2)
  })

  it("defaults to all V1 spaces when none requested", async () => {
    const reg = new SourceRegistry()
    reg.register(new PersonalSource({ spaceId: "p" }, makeSource("personal", "p", [])))
    reg.register(
      new ProjectSource({ projectRef: "unifia" }, makeSource("project", "pr", [])),
    )
    reg.register(new SessionSource({ sessionId: "s" }, makeSource("session", "s", [])))
    reg.register(new ExternalSource({ mountId: "m", label: "Mount" }, makeSource("external", "m", [])))
    const router = new ContextRouter(reg, { providerPlan: basePlan })
    const { pack } = await router.route({
      query: "q",
      spaces: [],
      types: [],
      tags: [],
      maxCandidates: 50,
      maxPayloadBytes: 1024,
      maxSnippetBytes: 256,
      deadlineMs: 1_000,
    })
    expect(pack.diagnostics.sourcesQueried).toEqual(["personal", "project", "session", "external"])
  })

  it("respects a per-type cap", async () => {
    const reg = new SourceRegistry()
    const notes: ListedNote[] = []
    for (let i = 0; i < 10; i++) notes.push(makeNote(i + 1, "decision"))
    reg.register(new PersonalSource({ spaceId: "p" }, makeSource("personal", "p", notes)))
    const router = new ContextRouter(reg, { providerPlan: basePlan, maxPerType: 3 })
    const { pack, excluded } = await router.route({
      query: "q",
      spaces: ["personal"],
      types: [],
      tags: [],
      maxCandidates: 50,
      maxPayloadBytes: 1024,
      maxSnippetBytes: 256,
      deadlineMs: 1_000,
    })
    expect(pack.items).toHaveLength(3)
    expect(excluded.length).toBeGreaterThan(0)
    for (const e of excluded) {
      expect(e.reason).toBe("per-type cap reached")
    }
  })

  it("respects a token budget", async () => {
    const reg = new SourceRegistry()
    const notes: ListedNote[] = []
    for (let i = 0; i < 5; i++) notes.push(makeNote(i + 1, "decision"))
    reg.register(new PersonalSource({ spaceId: "p" }, makeSource("personal", "p", notes)))
    const router = new ContextRouter(reg, { providerPlan: basePlan, tokenBudget: 2 })
    const { pack, excluded } = await router.route({
      query: "q",
      spaces: ["personal"],
      types: [],
      tags: [],
      maxCandidates: 50,
      maxPayloadBytes: 1024,
      maxSnippetBytes: 256,
      deadlineMs: 1_000,
    })
    expect(pack.items.length).toBeLessThanOrEqual(5)
    expect(excluded.some((e) => e.reason === "token budget exhausted")).toBe(true)
  })

  it("drops items denied by the egress policy and reports them", async () => {
    const reg = new SourceRegistry()
    reg.register(
      new PersonalSource(
        { spaceId: "p" },
        makeSource("personal", "p", [makeNote(1, "decision"), makeNote(2, "decision")]),
      ),
    )
    const router = new ContextRouter(reg, {
      providerPlan: {
        providerId: "x",
        defaultRestriction: "deny",
      },
    })
    const { pack, excluded } = await router.route({
      query: "q",
      spaces: ["personal"],
      types: [],
      tags: [],
      maxCandidates: 50,
      maxPayloadBytes: 1024,
      maxSnippetBytes: 256,
      deadlineMs: 1_000,
    })
    // Per ADR-KNOW-0006, a deny provider default denies every
    // item regardless of the item's allow restriction (portable
    // restrictions may only restrict).
    expect(pack.items).toHaveLength(0)
    expect(excluded).toHaveLength(2)
    for (const e of excluded) {
      expect(e.reason).toMatch(/deny/i)
    }
  })
})

describe("inspect", () => {
  it("returns one row per item with destination and decision", async () => {
    const reg = new SourceRegistry()
    reg.register(
      new PersonalSource({ spaceId: "p" }, makeSource("personal", "p", [makeNote(1, "decision")])),
    )
    const router = new ContextRouter(reg, { providerPlan: basePlan })
    const { pack } = await router.route({
      query: "q",
      spaces: ["personal"],
      types: [],
      tags: [],
      maxCandidates: 50,
      maxPayloadBytes: 1024,
      maxSnippetBytes: 256,
      deadlineMs: 1_000,
    })
    const view = inspect(pack, basePlan)
    expect(view.destination).toBe("local-llm")
    expect(view.rows).toHaveLength(1)
    expect(view.rows[0]?.destination).toBe("local-llm")
    expect(view.rows[0]?.decision).toBe("allow")
  })
})

describe("classifyText and decideWrite", () => {
  it("classifies an OpenAI-style key as secret", () => {
    const out = classifyText("export OPENAI_API_KEY=sk-abcdef0123456789abcdef0123")
    expect(out.classification).toBe("secret")
  })

  it("classifies a private key block as secret", () => {
    const out = classifyText("-----BEGIN RSA PRIVATE KEY-----\nMIIE...")
    expect(out.classification).toBe("secret")
  })

  it("classifies a GitHub PAT as secret", () => {
    const out = classifyText("GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789")
    expect(out.classification).toBe("secret")
  })

  it("classifies plain prose as internal", () => {
    const out = classifyText("Just some text without secrets.")
    expect(out.classification).toBe("internal")
  })

  it("allows a non-secret write", () => {
    const d = decideWrite("internal", false)
    expect(d.allowed).toBe(true)
  })

  it("denies a secret write without a declassification grant", () => {
    const d = decideWrite("secret", false)
    expect(d.allowed).toBe(false)
  })

  it("allows a secret write with a declassification grant", () => {
    const d = decideWrite("secret", true)
    expect(d.allowed).toBe(true)
  })
})
