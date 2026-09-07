/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { parseDocument } from "../../../src/knowledge/parser/parser.js"
import {
  SourceRegistry,
  PersonalSource,
  type KnowledgeSource,
  type ListOptions,
  type ListedNote,
  type SourceEvent,
} from "../../../src/knowledge/source/index.js"
import { ContextRouter } from "../../../src/knowledge/context/router.js"
import { inspect } from "../../../src/knowledge/context/inspector.js"
import { indexNote } from "../../../src/knowledge/derived/indexer.js"

const DEV_DIR = join(import.meta.dir, "../../../../../tests/knowledge/eval/dev")

/**
 * End-to-end test: load every dev fixture, parse it, build a
 * Source backed by the parsed fixtures, run a search through
 * the ContextRouter, and inspect the result.
 *
 * This is the closest V1 analogue of a real E2E test. The
 * P10.2 device run is the real-world equivalent.
 */

function makeSourceFromFixtures(): KnowledgeSource {
  const files = readdirSync(DEV_DIR).filter((n) => n.endsWith(".md") && n !== "README.md")
  const items: ListedNote[] = []
  const docs = new Map<string, string>()
  for (const f of files) {
    const raw = readFileSync(join(DEV_DIR, f), "utf8")
    const doc = parseDocument(raw)
    items.push({
      ref: { id: doc.note.frontmatter.unifia_id, locator: doc.note.frontmatter.unifia_id + ".md" },
      type: doc.note.frontmatter.unifia_type,
      lifecycle: doc.note.frontmatter.unifia_lifecycle,
      updatedAt: doc.note.frontmatter.unifia_updated_at,
    })
    docs.set(doc.note.frontmatter.unifia_id, raw)
  }
  return {
    space: { kind: "personal", id: "p", label: "Personal" },
    list: async (_opts: ListOptions) => items,
    read: async (locator) => {
      if (locator === undefined) return null
      const id = locator.replace(/\.md$/, "")
      const raw = docs.get(id)
      if (raw === undefined) return null
      return parseDocument(raw)
    },
    watch: (_onChange: (e: SourceEvent) => void) => () => undefined,
  }
}

describe("P7 E2E on dev fixtures", () => {
  it("parses all dev fixtures and indexes them", () => {
    const files = readdirSync(DEV_DIR).filter((n) => n.endsWith(".md") && n !== "README.md")
    for (const f of files) {
      const raw = readFileSync(join(DEV_DIR, f), "utf8")
      const doc = parseDocument(raw)
      expect(doc.note.frontmatter.unifia_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
      const indexed = indexNote({
        id: doc.note.frontmatter.unifia_id,
        locator: f,
        versionHash: "0".repeat(64),
        body: doc.note.body,
        chunkSize: 1024,
      })
      expect(indexed.chunks.length).toBeGreaterThan(0)
    }
  })

  it("searches via ContextRouter and inspects the result", async () => {
    const reg = new SourceRegistry()
    reg.register(new PersonalSource({ spaceId: "p" }, makeSourceFromFixtures()))
    const router = new ContextRouter(reg, {
      providerPlan: { providerId: "anthropic", defaultRestriction: "allow" },
    })
    const { pack } = await router.route({
      query: "Adreno K-quants",
      spaces: ["personal"],
      types: [],
      tags: [],
      maxCandidates: 50,
      maxPayloadBytes: 1024 * 1024,
      maxSnippetBytes: 64 * 1024,
      deadlineMs: 2_000,
    })
    expect(pack.diagnostics.sourcesQueried).toEqual(["personal"])
    expect(pack.diagnostics.candidatesScanned).toBeGreaterThan(0)
    const view = inspect(pack, { providerId: "anthropic", defaultRestriction: "allow" })
    expect(view.destination).toBe("anthropic")
  })
})
