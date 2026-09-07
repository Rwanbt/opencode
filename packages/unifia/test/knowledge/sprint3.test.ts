/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import {
  benchmarkOne,
  summarise,
  recallAtK,
  mrr,
  ndcg,
} from "../../src/knowledge/semantic/benchmark.js"
import { DomainBus } from "../../src/knowledge/events/bus.js"
import { CrossModePipeline } from "../../src/knowledge/cross-mode/e2e.js"
import {
  fuzz,
  FUZZ_TARGETS,
} from "../../src/knowledge/hardening/fuzz.js"
import { simulateLargeVault } from "../../src/knowledge/hardening/large-vault.js"
import { buildSbomFromPackages } from "../../src/knowledge/hardening/sbom.js"
import { join } from "node:path"

const VALID_HASH = "0".repeat(64)
const VALID_UUID = "0190d2c0-7b00-7000-8000-000000000001"

describe("P5.3 benchmark", () => {
  it("recallAtK returns 0 on empty", () => {
    expect(recallAtK([], [], 5)).toBe(0)
  })
  it("recallAtK returns 1 when expected is in the top-K", () => {
    expect(recallAtK(["a"] as never, ["a", "b"] as never, 5)).toBe(1)
  })
  it("mrr returns 1/rank of the first hit", () => {
    expect(mrr(["a"] as never, ["x", "a"] as never)).toBe(0.5)
  })
  it("mrr returns 0 when no hit", () => {
    expect(mrr(["a"] as never, ["x"] as never)).toBe(0)
  })
  it("ndcg returns 0 for empty ideal", () => {
    expect(ndcg([] as never, [] as never, 5)).toBe(0)
  })
  it("benchmarkOne produces the expected metrics", () => {
    const r = benchmarkOne(
      { query: "q", expected: ["a"] as never, forbidden: ["x"] as never },
      [
        { id: "a" as never, locator: "l", type: "decision", space: "personal", trust: "verified", authority: "user", restriction: "allow", relevance: 1, snippet: "", snippetBytes: 0, snippetHash: VALID_HASH },
        { id: "x" as never, locator: "l", type: "decision", space: "personal", trust: "verified", authority: "user", restriction: "allow", relevance: 0, snippet: "", snippetBytes: 0, snippetHash: VALID_HASH },
      ],
      12,
    )
    expect(r.recallAt5).toBe(1)
    expect(r.mrr).toBe(1)
    expect(r.forbiddenRate).toBeGreaterThan(0)
    expect(r.latencyMs).toBe(12)
  })
  it("summarise activates only when violation rates are 0", () => {
    const clean = benchmarkOne(
      { query: "q", expected: ["a"] as never },
      [
        { id: "a" as never, locator: "l", type: "decision", space: "personal", trust: "verified", authority: "user", restriction: "allow", relevance: 1, snippet: "", snippetBytes: 0, snippetHash: VALID_HASH },
      ],
      5,
    )
    expect(summarise([clean]).activate).toBe(true)
    const dirty = benchmarkOne(
      { query: "q", expected: ["a"] as never, forbidden: ["a"] as never },
      [
        { id: "a" as never, locator: "l", type: "decision", space: "personal", trust: "verified", authority: "user", restriction: "allow", relevance: 1, snippet: "", snippetBytes: 0, snippetHash: VALID_HASH },
      ],
      5,
    )
    expect(summarise([dirty]).activate).toBe(false)
  })
})

describe("P6.2 domain bus", () => {
  it("delivers events to subscribers", () => {
    const bus = new DomainBus()
    const received: string[] = []
    bus.on("session.started", (e) => received.push(e.id))
    bus.emit({ id: "1", kind: "session.started", timestamp: "t", payload: {} })
    bus.emit({ id: "2", kind: "session.ended", timestamp: "t", payload: {} })
    expect(received).toEqual(["1"])
  })
  it("onAny receives all events", () => {
    const bus = new DomainBus()
    const n: number[] = []
    bus.onAny(() => n.push(1))
    bus.emit({ id: "1", kind: "session.started", timestamp: "t", payload: {} })
    bus.emit({ id: "2", kind: "file.changed", timestamp: "t", payload: {} })
    expect(n).toHaveLength(2)
  })
  it("returns an unsubscribe function", () => {
    const bus = new DomainBus()
    let n = 0
    const off = bus.on("session.started", () => n++)
    bus.emit({ id: "1", kind: "session.started", timestamp: "t", payload: {} })
    off()
    bus.emit({ id: "2", kind: "session.started", timestamp: "t", payload: {} })
    expect(n).toBe(1)
  })
})

describe("P7.2 cross-mode E2E", () => {
  it("design -> code -> work produces three events with one source", () => {
    const p = new CrossModePipeline()
    p.designCreates({ id: VALID_UUID as never, locator: "m/x.md" as never, versionHash: VALID_HASH, title: "Use BLAKE3", body: "because", timestamp: "t1" })
    p.codeReads(VALID_UUID as never, "t2")
    p.workSurfaces(VALID_UUID as never, "t3")
    const events = p.events()
    expect(events).toHaveLength(3)
    expect(events[0]?.mode).toBe("design")
    expect(events[1]?.mode).toBe("code")
    expect(events[2]?.mode).toBe("work")
    expect(new Set(events.map((e) => e.id))).toEqual(new Set([VALID_UUID]))
  })
  it("refuses a secret decision", () => {
    const p = new CrossModePipeline()
    expect(() =>
      p.designCreates({
        id: VALID_UUID as never,
        locator: "m/x.md" as never,
        versionHash: VALID_HASH,
        title: "x",
        body: "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",
        timestamp: "t1",
      }),
    ).toThrow()
  })
})

describe("P11.1 fuzz", () => {
  const corpus = [
    "---\nunifia_schema: 1\nunifia_id: \"0190d2c0-7b00-7000-8000-000000000001\"\nunifia_type: decision\nunifia_lifecycle: active\nunifia_created_at: \"2026-08-29T00:00:00Z\"\nunifia_updated_at: \"2026-08-29T00:00:00Z\"\nunifia_project_ref: unifia\nunifia_supersedes: []\nunifia_tags: []\n---\n\n# Hello\n\nSee [[Other]] for context.\n",
    "Plain text body with wikilinks [[A]] and [[B|alias]] and [[C#heading]].",
    "x".repeat(2000),
  ]
  for (const t of FUZZ_TARGETS) {
    it(`target ${t.name} survives 50 mutations`, () => {
      const r = fuzz(42, 50, t, corpus)
      expect(r.crashed).toBe(0)
      expect(r.survived).toBe(50)
    })
  }
})

describe("P11.2 large vault", () => {
  it("parses 100 notes in under 5 s", () => {
    const r = simulateLargeVault(100, 256, 1024)
    expect(r.count).toBe(100)
    expect(r.totalParseMs).toBeLessThan(5_000)
    expect(r.totalIndexMs).toBeLessThan(5_000)
  })
})

describe("P11.3 SBOM", () => {
  it("builds an SBOM for the workspace", () => {
    const workspace = join(import.meta.dir, "../../../..")
    const sbom = buildSbomFromPackages(workspace)
    expect(sbom.bomFormat).toBe("CycloneDX")
    expect(sbom.components.length).toBeGreaterThan(0)
    expect(sbom.components.some((c) => c.name === "@unifia/contracts")).toBe(true)
  })
})
