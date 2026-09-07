/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { CrossModePipeline } from "../../../src/knowledge/cross-mode/e2e.js"
import type { KnowledgeId, KnowledgeLocator } from "@unifia/contracts/knowledge"

describe("P7.3 cross-mode pipeline (Design → Code → Work)", () => {
  it("delivers a single source to all three modes with the same hash", () => {
    const pipeline = new CrossModePipeline()
    const id = "0190d2c0-7b00-7000-8000-000000000042" as KnowledgeId
    const locator = "memory/x.md" as KnowledgeLocator
    const hash = "a".repeat(64)

    pipeline.designCreates({
      id,
      locator,
      versionHash: hash,
      title: "Use UUIDv7",
      body: "All IDs MUST be UUIDv7.",
      timestamp: "2026-08-29T00:00:00Z",
    })
    pipeline.codeReads(id, "2026-08-29T00:00:01Z")
    const surfaced = pipeline.workSurfaces(id, "2026-08-29T00:00:02Z")

    expect(pipeline.events()).toHaveLength(3)
    // Same hash across all three modes.
    expect(surfaced.ref.versionHash).toBe(hash)
    // Events are ordered.
    const evts = pipeline.events()
    expect(evts[0]?.mode).toBe("design")
    expect(evts[1]?.mode).toBe("code")
    expect(evts[2]?.mode).toBe("work")
  })

  it("refuses a decision body that contains a secret", () => {
    const pipeline = new CrossModePipeline()
    const id = "0190d2c0-7b00-7000-8000-000000000043" as KnowledgeId
    const locator = "memory/secret.md" as KnowledgeLocator
    const hash = "b".repeat(64)
    expect(() =>
      pipeline.designCreates({
        id,
        locator,
        versionHash: hash,
        title: "Config",
        body: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890",
        timestamp: "2026-08-29T00:00:00Z",
      }),
    ).toThrow(/secret/i)
    expect(pipeline.decisionCount()).toBe(0)
  })

  it("refuses a Code read for an unknown decision", () => {
    const pipeline = new CrossModePipeline()
    expect(() =>
      pipeline.codeReads(
        "0190d2c0-7b00-7000-8000-000000000099" as KnowledgeId,
        "2026-08-29T00:00:00Z",
      ),
    ).toThrow(/not found/i)
  })
})
