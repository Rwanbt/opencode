/* SPDX-License-Identifier: MIT */
/**
 * Characterization suite for the defects confirmed by the frontier
 * counter-review (2026-08-29, HEAD 2b6d541dbb).
 *
 * Every test here asserts the CONTRACTED behaviour, not the current
 * behaviour. They are expected to be RED until the corresponding
 * remediation card lands, and they must never be weakened to go green.
 *
 * Card ids match the remediation plan:
 *   C3  — egress override must not widen a portable deny
 *   C6  — ExternalSource capabilities must be enforced, not advisory
 *   C9  — parser and indexer must not emit links from code fences
 *   C10 — every allowed lifecycle transition must have a MutationKind
 */

import { describe, it, expect } from "bun:test"
import type { ContextItem, ProviderDestinationPlan } from "@unifia/contracts/knowledge"
import { decideEgress } from "../../../src/knowledge/policy/egress.js"
import {
  isTransitionAllowed,
  intentForTransition,
} from "../../../src/knowledge/memory/lifecycle.js"
import { ExternalSource } from "../../../src/knowledge/source/external.js"
import { extractWikilinks } from "../../../src/knowledge/parser/wikilinks.js"
import { extractEdges } from "../../../src/knowledge/derived/indexer.js"
import { parseFrontmatter } from "../../../src/knowledge/parser/frontmatter.js"
import type { KnowledgeLifecycleState } from "@unifia/contracts/knowledge"
import {
  NoteFrontmatterSchema,
  portableRestrictionsFromFrontmatter,
  portableRestrictionsToFrontmatter,
  mostRestrictive,
} from "@unifia/contracts/knowledge"

const ID = "0190d2c0-7b00-7000-8000-000000000001"
const ZERO_HASH = "0".repeat(64)

function itemWith(restriction: "allow" | "deny", trust: "verified" | "unverified"): ContextItem {
  return {
    ref: { id: ID, locator: "secret.md" },
    source: "personal",
    type: "decision",
    trust,
    authority: "user",
    restriction,
    relevance: 1,
    tokenCost: 0,
    contentHash: ZERO_HASH,
    snippet: "",
    reason: "characterization",
  } as ContextItem
}

// ---------------------------------------------------------------------------
// C3 — egress: an override may restrict, never widen.
// ADR-KNOW-0006 §1 and §4: "ProviderPlan overrides may further restrict but
// never widen" / "restrictions portables ne peuvent que restreindre".
// ---------------------------------------------------------------------------

describe("C3 — egress overrides may restrict but never widen", () => {
  it("refuses a per-item allow override when the item itself is deny", () => {
    const plan: ProviderDestinationPlan = {
      providerId: "provider-cloud",
      defaultRestriction: "allow",
      overrides: { [ID]: "allow" },
    }
    const d = decideEgress({ item: itemWith("deny", "verified"), plan })
    expect(d.decision).toBe("deny")
  })

  it("refuses a locator-keyed allow override when the item itself is deny", () => {
    const plan: ProviderDestinationPlan = {
      providerId: "provider-cloud",
      defaultRestriction: "allow",
      overrides: { "secret.md": "allow" },
    }
    const d = decideEgress({ item: itemWith("deny", "verified"), plan })
    expect(d.decision).toBe("deny")
  })

  it("still honours an override that restricts an otherwise-allowed item", () => {
    const plan: ProviderDestinationPlan = {
      providerId: "provider-cloud",
      defaultRestriction: "allow",
      overrides: { [ID]: "deny" },
    }
    const d = decideEgress({ item: itemWith("allow", "verified"), plan })
    expect(d.decision).toBe("deny")
  })

  it("denies unresolved provenance toward a permissive provider (ADR-0006 §2)", () => {
    const plan: ProviderDestinationPlan = {
      providerId: "provider-cloud",
      defaultRestriction: "allow",
    }
    const d = decideEgress({ item: itemWith("allow", "unverified"), plan })
    expect(d.decision).toBe("deny")
  })

  it("allows unverified provenance toward an explicitly local destination", () => {
    // ADR-KNOW-0006 section 2 says DENY EXTERNAL, not deny everywhere: an
    // external mount must stay usable by a local model.
    const plan: ProviderDestinationPlan = {
      providerId: "local-llm",
      destinationKind: "local",
      defaultRestriction: "allow",
    }
    const d = decideEgress({ item: itemWith("allow", "unverified"), plan })
    expect(d.decision).toBe("allow")
  })
})


// ---------------------------------------------------------------------------
// C10 — lifecycle: the transition table and the mutation mapping must agree.
// ---------------------------------------------------------------------------

describe("C10 — every allowed lifecycle transition is executable", () => {
  const states: KnowledgeLifecycleState[] = ["candidate", "active", "superseded", "archived"]

  it("never allows a transition that intentForTransition then refuses", () => {
    const contradictions: string[] = []
    for (const from of states) {
      for (const to of states) {
        if (!isTransitionAllowed(from, to)) continue
        const decision = intentForTransition(from, to, ID, ZERO_HASH, "characterization", "test")
        if (!decision.allowed) contradictions.push(`${from} -> ${to}: ${decision.reason}`)
      }
    }
    expect(contradictions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// C6 — ExternalSource capabilities must gate the backend, not describe it.
// ---------------------------------------------------------------------------

describe("C6 — ExternalSource enforces its declared capabilities", () => {
  function countingImpl() {
    const calls = { list: 0, read: 0, watch: 0 }
    const impl = {
      space: { kind: "external" as const, id: "m", label: "m" },
      async list() {
        calls.list += 1
        return []
      },
      async read() {
        calls.read += 1
        return null
      },
      watch() {
        calls.watch += 1
        return () => {}
      },
    }
    return { calls, impl: impl as never }
  }

  it("does not reach the backend for list/read when 'read' is not granted", async () => {
    const { calls, impl } = countingImpl()
    const src = new ExternalSource({ mountId: "m", label: "m", capabilities: [] }, impl)
    expect(src.canRead).toBe(false)
    await src.list({}).catch(() => undefined)
    await src.read("x.md").catch(() => undefined)
    expect(calls.list).toBe(0)
    expect(calls.read).toBe(0)
  })

  it("does not reach the backend for watch when 'watch' is not granted", () => {
    const { calls, impl } = countingImpl()
    const src = new ExternalSource({ mountId: "m", label: "m", capabilities: ["read"] }, impl)
    expect(src.canWatch).toBe(false)
    try {
      src.watch(() => {})
    } catch {
      /* a typed refusal is the expected outcome */
    }
    expect(calls.watch).toBe(0)
  })

  it("still reaches the backend once the capability is granted", async () => {
    const { calls, impl } = countingImpl()
    const src = new ExternalSource(
      { mountId: "m", label: "m", capabilities: ["read", "watch"] },
      impl,
    )
    await src.list({})
    src.watch(() => {})
    expect(calls.list).toBe(1)
    expect(calls.watch).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// C9 — code fences and inline code are not link sources.
// Both extractors must agree; the indexer duplicates the parser's regex today.
// ---------------------------------------------------------------------------

const FENCED_DOC = [
  "# Real heading",
  "",
  "```ts",
  "# Fake heading inside a fence",
  "const link = `[[SecretFence]]`",
  "```",
  "",
  "Inline `[[InlineSecret]]` stays code, but [[Visible]] is a link.",
].join("\n")

describe("C9 — link extraction ignores code fences and inline code", () => {
  it("extractWikilinks returns only the real link", () => {
    const targets = extractWikilinks(FENCED_DOC).map((w) => w.target)
    expect(targets).toEqual(["Visible"])
  })

  it("extractEdges (indexer) agrees with the parser", () => {
    const targets = extractEdges(FENCED_DOC, "note.md").map((e) => e.target)
    expect(targets).toEqual(["Visible"])
  })

  it("the two extractors never disagree", () => {
    const fromParser = extractWikilinks(FENCED_DOC).map((w) => w.target)
    const fromIndexer = extractEdges(FENCED_DOC, "note.md").map((e) => e.target)
    expect(fromIndexer).toEqual(fromParser)
  })

  it("tilde fences are excluded too", () => {
    const doc = ["~~~", "[[TildeSecret]]", "~~~", "", "[[Kept]]"].join("\n")
    expect(extractWikilinks(doc).map((w) => w.target)).toEqual(["Kept"])
  })
})

// ---------------------------------------------------------------------------
// C5 — one canonical representation for portable restrictions.
// The frontmatter key rejected outright before V1; three spellings competed
// across the ADRs, PERMISSIONS.md and the contracts type.
// ---------------------------------------------------------------------------

const BASE_FM = {
  unifia_schema: 1 as const,
  unifia_id: ID,
  unifia_type: "decision" as const,
  unifia_lifecycle: "active" as const,
  unifia_created_at: "2026-08-29T00:00:00Z",
  unifia_updated_at: "2026-08-29T00:00:00Z",
  unifia_project_ref: "unifia",
  unifia_supersedes: [],
  unifia_tags: [],
}

describe("C5 — portable restrictions are expressible and canonical", () => {
  it("accepts a note carrying unifia_restrictions", () => {
    const r = NoteFrontmatterSchema.safeParse({
      ...BASE_FM,
      unifia_restrictions: { remote_model: "deny", local_model: "allow" },
    })
    expect(r.success).toBe(true)
  })

  it("still accepts a note without any restrictions block", () => {
    expect(NoteFrontmatterSchema.safeParse(BASE_FM).success).toBe(true)
  })

  it("treats an absent block as deny-remote, deny-export (UNCLASSIFIED)", () => {
    const r = portableRestrictionsFromFrontmatter(undefined)
    expect(r.remoteModel).toBe("deny")
    expect(r.exportable).toBe("deny")
    expect(r.localModel).toBe("allow")
  })

  it("round-trips through the on-disk shape", () => {
    const original = {
      remoteModel: "deny",
      localModel: "deny",
      embeddable: "deny",
      exportable: "allow",
    } as const
    expect(portableRestrictionsFromFrontmatter(portableRestrictionsToFrontmatter(original))).toEqual(
      original,
    )
  })

  it("rejects an unknown restriction field rather than ignoring it", () => {
    const r = NoteFrontmatterSchema.safeParse({
      ...BASE_FM,
      unifia_restrictions: { remote_model: "deny", git_remote: "deny" },
    })
    expect(r.success).toBe(false)
  })

  it("refuses a malformed block instead of reading it as unrestricted", () => {
    const raw = [
      "---",
      "unifia_schema: 1",
      `unifia_id: ${ID}`,
      "unifia_type: decision",
      "unifia_lifecycle: active",
      "unifia_created_at: 2026-08-29T00:00:00Z",
      "unifia_updated_at: 2026-08-29T00:00:00Z",
      "unifia_project_ref: unifia",
      "unifia_supersedes: []",
      "unifia_tags: []",
      "unifia_restrictions:",
      "  remote_model: maybe",
      "---",
      "body",
    ].join("\n")
    expect(() => parseFrontmatter(raw)).toThrow()
  })

  it("lets the strictest restriction win when several are combined", () => {
    const open = {
      remoteModel: "allow",
      localModel: "allow",
      embeddable: "allow",
      exportable: "allow",
    } as const
    const closed = {
      remoteModel: "deny",
      localModel: "allow",
      embeddable: "allow",
      exportable: "deny",
    } as const
    expect(mostRestrictive(open, closed)).toEqual({
      remoteModel: "deny",
      localModel: "allow",
      embeddable: "allow",
      exportable: "deny",
    })
  })
})
