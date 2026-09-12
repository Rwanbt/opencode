import { describe, expect, test } from "bun:test"
import baseline from "../fixture/openapi-n-1-operations.json"

// N-1 compatibility guard for the generated SDK (TEAM-L03).
//
// packages/sdk/openapi.json is the contract the JS SDK is generated from, and
// through it every consumer — app, desktop, mobile, TUI, and anything built
// against a published SDK version. A regeneration that drops or moves an
// operation breaks those consumers silently: the spec regenerates cleanly, the
// SDK regenerates cleanly, and the failure only shows up at runtime in a
// client nobody rebuilt.
//
// The fixture is a snapshot of the operations that existed one version back.
// Everything in it must still exist, at the same path and method. Adding is
// free; removing and moving are not.

const spec = (await Bun.file(new URL("../../../sdk/openapi.json", import.meta.url)).json()) as {
  paths: Record<string, Record<string, { operationId?: string } | undefined>>
}

function currentOperations(): Map<string, { method: string; path: string }> {
  const found = new Map<string, { method: string; path: string }>()
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (operation?.operationId) found.set(operation.operationId, { method, path })
    }
  }
  return found
}

describe("OpenAPI — N-1 compatibility", () => {
  test("the fixture is a real baseline, not an empty one", () => {
    // An empty fixture would make every assertion below pass vacuously.
    expect(baseline.operations.length).toBe(baseline.operationCount)
    expect(baseline.operations.length).toBeGreaterThan(150)
  })

  test("no operation from the previous version has been removed", () => {
    const current = currentOperations()
    const missing = baseline.operations.filter((operation) => !current.has(operation.operationId))

    expect(missing.map((operation) => operation.operationId)).toEqual([])
  })

  test("no operation has moved to a different path or method", () => {
    // A moved operation is as breaking as a removed one: the generated client
    // still calls the old URL and gets a 404.
    const current = currentOperations()
    const moved = baseline.operations
      .filter((operation) => current.has(operation.operationId))
      .filter((operation) => {
        const now = current.get(operation.operationId)!
        return now.path !== operation.path || now.method !== operation.method
      })
      .map((operation) => `${operation.operationId}: ${operation.method} ${operation.path} -> ${current.get(operation.operationId)!.method} ${current.get(operation.operationId)!.path}`)

    expect(moved).toEqual([])
  })

  test("the spec has grown, so the guard is running against a real regeneration", () => {
    // If the spec had not changed at all, the two tests above would pass
    // without proving the generator was ever run.
    expect(currentOperations().size).toBeGreaterThan(baseline.operations.length)
  })
})

describe("OpenAPI — the Team and registry surface is documented", () => {
  test("exposes the Team read operations", () => {
    const current = currentOperations()

    for (const operationId of ["team.listRuns", "team.getRun", "team.listTasks", "team.listEvents", "team.listGates"]) {
      expect(current.has(operationId)).toBe(true)
    }
  })

  test("exposes the model-intelligence operations", () => {
    const current = currentOperations()

    for (const operationId of [
      "modelIntelligence.listModels",
      "modelIntelligence.listProviders",
      "modelIntelligence.getModel",
      "modelIntelligence.resolveAlias",
      "modelIntelligence.snapshot",
      "modelIntelligence.licenses",
      "modelIntelligence.health",
      "modelIntelligence.sync",
    ]) {
      expect(current.has(operationId)).toBe(true)
    }
  })

  test("every new operation carries a summary and a description", () => {
    // The spec is what the SDK's doc comments are generated from. An operation
    // with no description reaches every consumer as a bare method name.
    const undocumented: string[] = []
    for (const [path, item] of Object.entries(spec.paths)) {
      if (!path.startsWith("/team/") && !path.startsWith("/model-intelligence/")) continue
      for (const operation of Object.values(item)) {
        const doc = operation as { operationId?: string; summary?: string; description?: string } | undefined
        if (!doc?.operationId) continue
        if (!doc.summary?.trim() || !doc.description?.trim()) undocumented.push(doc.operationId)
      }
    }

    expect(undocumented).toEqual([])
  })
})
