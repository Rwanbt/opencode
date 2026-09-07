/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { CrossModeBusPipeline } from "../../../src/knowledge/cross-mode/bus-pipeline.js"
import { DomainBus } from "../../../src/knowledge/events/bus.js"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

describe("P7.4 cross-mode pipeline with DomainBus", () => {
  it("emits decision.created after designCreates", () => {
    const bus = new DomainBus()
    const received: string[] = []
    bus.on("decision.created", (e) => {
      const id = e.payload["id"]
      received.push(typeof id === "string" ? id : String(id))
    })

    const p = new CrossModeBusPipeline({ bus })
    p.designCreates({
      id: "0190d2c0-7b00-7000-8000-000000000001" as KnowledgeId,
      locator: "memory/x.md" as KnowledgeLocator,
      versionHash: "a".repeat(64),
      title: "Use UUIDv7",
      body: "All IDs MUST be UUIDv7.",
      timestamp: "2026-08-29T00:00:00Z",
    })
    expect(received).toEqual(["0190d2c0-7b00-7000-8000-000000000001"])
  })

  it("emits the three events in order through the bus", () => {
    const bus = new DomainBus()
    const kinds: string[] = []
    bus.onAny((e) => kinds.push(e.kind))

    const p = new CrossModeBusPipeline({ bus })
    p.designCreates({
      id: "0190d2c0-7b00-7000-8000-000000000002" as KnowledgeId,
      locator: "memory/y.md" as KnowledgeLocator,
      versionHash: "a".repeat(64),
      title: "t",
      body: "b",
      timestamp: "2026-08-29T00:00:00Z",
    })
    p.codeReads("0190d2c0-7b00-7000-8000-000000000002" as KnowledgeId, "2026-08-29T00:00:01Z")
    p.workSurfaces("0190d2c0-7b00-7000-8000-000000000002" as KnowledgeId, "2026-08-29T00:00:02Z")

    expect(kinds).toEqual(["decision.created", "tool.executed", "session.ended"])
  })

  it("does not emit anything when designCreates refuses a secret body", () => {
    const bus = new DomainBus()
    const kinds: string[] = []
    bus.onAny((e) => kinds.push(e.kind))

    const p = new CrossModeBusPipeline({ bus })
    expect(() =>
      p.designCreates({
        id: "0190d2c0-7b00-7000-8000-000000000003" as KnowledgeId,
        locator: "memory/secret.md" as KnowledgeLocator,
        versionHash: "a".repeat(64),
        title: "Config",
        body: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890",
        timestamp: "2026-08-29T00:00:00Z",
      }),
    ).toThrow(/secret/i)
    expect(kinds).toEqual([])
  })

  it("shares one bus across two pipelines", () => {
    const bus = new DomainBus()
    const p1 = new CrossModeBusPipeline({ bus })
    const p2 = new CrossModeBusPipeline({ bus })
    let count = 0
    bus.onAny(() => count++)

    p1.designCreates({
      id: "0190d2c0-7b00-7000-8000-000000000010" as KnowledgeId,
      locator: "memory/a.md" as KnowledgeLocator,
      versionHash: "a".repeat(64),
      title: "t",
      body: "b",
      timestamp: "2026-08-29T00:00:00Z",
    })
    p2.designCreates({
      id: "0190d2c0-7b00-7000-8000-000000000011" as KnowledgeId,
      locator: "memory/b.md" as KnowledgeLocator,
      versionHash: "a".repeat(64),
      title: "t",
      body: "b",
      timestamp: "2026-08-29T00:00:00Z",
    })
    expect(count).toBe(2)
  })
})
