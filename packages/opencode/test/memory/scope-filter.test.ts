import { describe, expect, test } from "bun:test"

// Test the scope matching logic extracted from turboquant.ts
// Pure function test - no side effects needed

type MemoryScope = {
  type: "global" | "project" | "session" | "agent"
  id?: string
}

interface MemoryEntry {
  metadata: {
    scope?: MemoryScope
  }
}

function matchesScope(entry: MemoryEntry, scope?: MemoryScope): boolean {
  if (!scope) return true
  const entryScope = entry.metadata.scope
  // Global entries are always visible
  if (!entryScope || entryScope.type === "global") return true
  // Exact match (same type and id)
  if (entryScope.type === scope.type && entryScope.id === scope.id) return true
  // Hierarchy: session includes project, project includes global (already handled above)
  if (scope.type === "session" && entryScope.type === "project") return true
  // Agent scope only sees global (already handled above) and own entries
  return false
}

describe("memory scope filtering", () => {
  // Helper to create entries with different scopes
  const global = (): MemoryEntry => ({ metadata: { scope: { type: "global" } } })
  const noScope = (): MemoryEntry => ({ metadata: {} })
  const project = (id = "proj1"): MemoryEntry => ({ metadata: { scope: { type: "project", id } } })
  const session = (id = "sess1"): MemoryEntry => ({ metadata: { scope: { type: "session", id } } })
  const agent = (id = "explore"): MemoryEntry => ({ metadata: { scope: { type: "agent", id } } })

  describe("no scope filter (undefined)", () => {
    test("all entries are visible", () => {
      expect(matchesScope(global())).toBe(true)
      expect(matchesScope(noScope())).toBe(true)
      expect(matchesScope(project())).toBe(true)
      expect(matchesScope(session())).toBe(true)
      expect(matchesScope(agent())).toBe(true)
    })
  })

  describe("global scope query", () => {
    test("global entries visible", () => {
      expect(matchesScope(global(), { type: "global" })).toBe(true)
    })
    test("unscoped entries visible", () => {
      expect(matchesScope(noScope(), { type: "global" })).toBe(true)
    })
    test("project entries NOT visible", () => {
      expect(matchesScope(project(), { type: "global" })).toBe(false)
    })
    test("session entries NOT visible", () => {
      expect(matchesScope(session(), { type: "global" })).toBe(false)
    })
    test("agent entries NOT visible", () => {
      expect(matchesScope(agent(), { type: "global" })).toBe(false)
    })
  })

  describe("project scope query", () => {
    test("global entries visible", () => {
      expect(matchesScope(global(), { type: "project", id: "proj1" })).toBe(true)
    })
    test("same project visible", () => {
      expect(matchesScope(project("proj1"), { type: "project", id: "proj1" })).toBe(true)
    })
    test("different project NOT visible", () => {
      expect(matchesScope(project("proj2"), { type: "project", id: "proj1" })).toBe(false)
    })
    test("session entries NOT visible from project scope", () => {
      expect(matchesScope(session(), { type: "project", id: "proj1" })).toBe(false)
    })
  })

  describe("session scope query", () => {
    test("global entries visible", () => {
      expect(matchesScope(global(), { type: "session", id: "sess1" })).toBe(true)
    })
    test("project entries visible (hierarchy)", () => {
      expect(matchesScope(project("proj1"), { type: "session", id: "sess1" })).toBe(true)
    })
    test("same session visible", () => {
      expect(matchesScope(session("sess1"), { type: "session", id: "sess1" })).toBe(true)
    })
    test("different session NOT visible", () => {
      expect(matchesScope(session("sess2"), { type: "session", id: "sess1" })).toBe(false)
    })
    test("agent entries NOT visible from session scope", () => {
      expect(matchesScope(agent(), { type: "session", id: "sess1" })).toBe(false)
    })
  })

  describe("agent scope query", () => {
    test("global entries visible", () => {
      expect(matchesScope(global(), { type: "agent", id: "explore" })).toBe(true)
    })
    test("same agent visible", () => {
      expect(matchesScope(agent("explore"), { type: "agent", id: "explore" })).toBe(true)
    })
    test("different agent NOT visible", () => {
      expect(matchesScope(agent("general"), { type: "agent", id: "explore" })).toBe(false)
    })
    test("project entries NOT visible from agent scope", () => {
      expect(matchesScope(project(), { type: "agent", id: "explore" })).toBe(false)
    })
    test("session entries NOT visible from agent scope", () => {
      expect(matchesScope(session(), { type: "agent", id: "explore" })).toBe(false)
    })
  })
})
