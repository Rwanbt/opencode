/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { parseFrontmatter, serialiseNote } from "../../../src/knowledge/parser/frontmatter.js"
import { KnowledgeFailure } from "../../../src/knowledge/domain/errors.js"

const VALID_UUIDV7 = "0190d2c0-7b00-7000-8000-000000000001"
const VALID_HASH = "0".repeat(64)

const VALID_NOTE = `---
unifia_schema: 1
unifia_id: "${VALID_UUIDV7}"
unifia_type: decision
unifia_lifecycle: active
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: unifia
unifia_supersedes: []
unifia_tags:
  - "model:gemma-4"
  - "tool:bash"
---

# Decision

Body text.
`

describe("parseFrontmatter", () => {
  it("accepts a valid note", () => {
    const out = parseFrontmatter(VALID_NOTE)
    expect(out.frontmatter.unifia_id).toBe(VALID_UUIDV7)
    expect(out.frontmatter.unifia_type).toBe("decision")
    expect(out.frontmatter.unifia_lifecycle).toBe("active")
    expect(out.frontmatter.unifia_tags).toEqual(["model:gemma-4", "tool:bash"])
    expect(out.body).toContain("# Decision")
  })

  it("rejects a missing unifia_id", () => {
    const bad = VALID_NOTE.replace(`unifia_id: "${VALID_UUIDV7}"`, "")
    expect(() => parseFrontmatter(bad)).toThrow(KnowledgeFailure)
  })

  it("rejects a non-UUIDv7 unifia_id", () => {
    const bad = VALID_NOTE.replace(VALID_UUIDV7, "not-a-uuid")
    expect(() => parseFrontmatter(bad)).toThrow(KnowledgeFailure)
  })

  it("rejects an invalid unifia_type", () => {
    const bad = VALID_NOTE.replace("unifia_type: decision", "unifia_type: nonsense")
    expect(() => parseFrontmatter(bad)).toThrow(KnowledgeFailure)
  })

  it("rejects an invalid unifia_lifecycle", () => {
    const bad = VALID_NOTE.replace("unifia_lifecycle: active", "unifia_lifecycle: deleted")
    expect(() => parseFrontmatter(bad)).toThrow(KnowledgeFailure)
  })

  it("rejects an empty frontmatter", () => {
    const bad = `---\n---\n# Body\n`
    expect(() => parseFrontmatter(bad)).toThrow(KnowledgeFailure)
  })

  it("rejects a missing unifia_project_ref", () => {
    const bad = VALID_NOTE.replace("unifia_project_ref: unifia", "")
    expect(() => parseFrontmatter(bad)).toThrow(KnowledgeFailure)
  })
})

describe("serialiseNote", () => {
  it("round-trips frontmatter and body", () => {
    const parsed = parseFrontmatter(VALID_NOTE)
    const out = serialiseNote(parsed)
    expect(out).toContain(`unifia_id: ${VALID_UUIDV7}`)
    expect(out).toContain("unifia_type: decision")
    expect(out).toContain("# Decision")
    // re-parse should succeed
    const re = parseFrontmatter(out)
    expect(re.frontmatter.unifia_id).toBe(VALID_UUIDV7)
  })

  it("appends a trailing newline", () => {
    const parsed = parseFrontmatter(VALID_NOTE)
    const out = serialiseNote(parsed)
    expect(out.endsWith("\n")).toBe(true)
  })
})
