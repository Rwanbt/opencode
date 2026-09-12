import { describe, expect, test } from "bun:test"
import { buildAliasIndex, resolveAlias, resolveAllAliases } from "../../src/model-intelligence/aliases"
import type { Alias } from "../../src/model-intelligence/schema"
import { CyclicAliasError, DuplicateAliasError } from "../../src/model-intelligence/errors"

describe("aliases resolution", () => {
  const baseAlias: Alias = {
    alias: "a",
    canonicalRef: { providerID: "p", modelID: "m1" },
    deprecated: false,
    replacedBy: null,
  }

  test("resolves direct alias", () => {
    const index = buildAliasIndex([baseAlias])
    const result = resolveAlias("a", index)
    expect(result?.canonicalRef.modelID).toBe("m1")
  })

  test("resolves deprecated alias via replacedBy (depth 1)", () => {
    const deprecated: Alias = {
      alias: "old",
      canonicalRef: { providerID: "p", modelID: "old-m" },
      deprecated: true,
      replacedBy: { providerID: "p", modelID: "new-m" },
    }
    const target: Alias = {
      alias: "new-m",
      canonicalRef: { providerID: "p", modelID: "new-m" },
      deprecated: false,
      replacedBy: null,
    }
    const index = buildAliasIndex([deprecated, target])
    const result = resolveAlias("old", index)
    expect(result?.canonicalRef.modelID).toBe("new-m")
    expect(result?.deprecated).toBe(true)
    expect(result?.chainDepth).toBe(2)
  })

  test("returns null for unknown alias", () => {
    const index = buildAliasIndex([baseAlias])
    expect(resolveAlias("nope", index)).toBeNull()
  })

  test("rejects duplicate alias at index build", () => {
    expect(() =>
      buildAliasIndex([
        baseAlias,
        { ...baseAlias, alias: "a" },
      ]),
    ).toThrow(DuplicateAliasError)
  })

  test("rejects cyclic alias", () => {
    const cyclic: Alias = {
      alias: "loop",
      canonicalRef: { providerID: "p", modelID: "loop-target" },
      deprecated: true,
      replacedBy: { providerID: "p", modelID: "loop" },
    }
    const index = buildAliasIndex([cyclic])
    expect(() => resolveAlias("loop", index)).toThrow(CyclicAliasError)
  })

  test("resolveAllAliases maps all aliases", () => {
    const a2: Alias = {
      alias: "b",
      canonicalRef: { providerID: "p", modelID: "m2" },
      deprecated: false,
      replacedBy: null,
    }
    const map = resolveAllAliases([baseAlias, a2])
    expect(map.size).toBe(2)
    expect(map.get("a")?.canonicalRef.modelID).toBe("m1")
    expect(map.get("b")?.canonicalRef.modelID).toBe("m2")
  })
})