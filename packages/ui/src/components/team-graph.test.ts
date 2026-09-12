import { describe, expect, test } from "bun:test"
import { emphasisFor, NO_RELATIONS, relationsFor, wavesFor, type TeamGraphTask } from "./team-graph"

// Coverage for the TEAM-M03 interactive graph's one decidable question: given a
// selected task, what else is related to it and in which direction.
//
// Asserted here rather than through the DOM because this is the part that has a
// right answer. Whether the highlight is blue is a matter of taste; whether a
// task three levels upstream counts as an ancestor is not.

const task = (taskId: string, dependsOn: string[] = [], status = "pending"): TeamGraphTask => ({
  taskId,
  dependsOn,
  status,
})

const chain = [task("a"), task("b", ["a"]), task("c", ["b"]), task("d", ["c"])]

describe("relationsFor — related means transitively, not adjacently", () => {
  test("nothing selected relates to nothing", () => {
    expect(relationsFor(chain, undefined)).toEqual(NO_RELATIONS)
  })

  test("ancestors reach all the way up, not one hop", () => {
    // "What has to finish before this can start?" is the question a reader
    // actually has. One hop answers a different one.
    const relations = relationsFor(chain, "d")

    expect([...relations.ancestors].toSorted()).toEqual(["a", "b", "c"])
  })

  test("descendants reach all the way down", () => {
    const relations = relationsFor(chain, "a")

    expect([...relations.descendants].toSorted()).toEqual(["b", "c", "d"])
  })

  test("a task in the middle has both", () => {
    const relations = relationsFor(chain, "c")

    expect([...relations.ancestors].toSorted()).toEqual(["a", "b"])
    expect([...relations.descendants].toSorted()).toEqual(["d"])
  })

  test("the selected task is in neither set", () => {
    // Otherwise it would be styled as its own ancestor.
    const relations = relationsFor(chain, "c")

    expect(relations.ancestors.has("c")).toBe(false)
    expect(relations.descendants.has("c")).toBe(false)
  })

  test("an unrelated branch stays unrelated", () => {
    const tasks = [...chain, task("x"), task("y", ["x"])]
    const relations = relationsFor(tasks, "d")

    expect(relations.ancestors.has("x")).toBe(false)
    expect(relations.descendants.has("y")).toBe(false)
  })

  test("selecting a task the graph does not contain relates to nothing", () => {
    expect(relationsFor(chain, "ghost")).toEqual(NO_RELATIONS)
  })

  test("a cycle colours its nodes instead of hanging the panel", () => {
    // The traversal's visited check is the cycle guard. Without it this test
    // never returns, which is exactly what it exists to prevent.
    const cyclic = [task("a", ["b"]), task("b", ["a"])]
    const relations = relationsFor(cyclic, "a")

    expect([...relations.ancestors]).toEqual(["b"])
    expect([...relations.descendants]).toEqual(["b"])
  })

  test("a diamond does not double-count", () => {
    const diamond = [task("top"), task("left", ["top"]), task("right", ["top"]), task("bottom", ["left", "right"])]
    const relations = relationsFor(diamond, "bottom")

    expect([...relations.ancestors].toSorted()).toEqual(["left", "right", "top"])
  })
})

describe("emphasisFor — a task is in exactly one relation to the selection", () => {
  test("nothing selected means no emphasis anywhere", () => {
    expect(emphasisFor("a", undefined, NO_RELATIONS)).toBe("none")
  })

  test("the selection is selected", () => {
    expect(emphasisFor("c", "c", relationsFor(chain, "c"))).toBe("selected")
  })

  test("upstream is ancestor, downstream is descendant", () => {
    const relations = relationsFor(chain, "c")

    expect(emphasisFor("a", "c", relations)).toBe("ancestor")
    expect(emphasisFor("d", "c", relations)).toBe("descendant")
  })

  test("everything else is unrelated, not 'none'", () => {
    // "none" means nothing is selected at all. Reusing it for a task that is
    // simply not connected would make the two indistinguishable to a caller
    // deciding whether to dim.
    const tasks = [...chain, task("x")]
    const relations = relationsFor(tasks, "c")

    expect(emphasisFor("x", "c", relations)).toBe("unrelated")
  })

  test("in a cycle, the selection still wins over its relations", () => {
    const cyclic = [task("a", ["b"]), task("b", ["a"])]
    const relations = relationsFor(cyclic, "a")

    expect(emphasisFor("a", "a", relations)).toBe("selected")
    expect(emphasisFor("b", "a", relations)).toBe("ancestor")
  })
})
describe("wavesFor — one deterministic DAG layout for every surface", () => {
  test("groups independent tasks and keeps dependencies in later waves", () => {
    expect(wavesFor([task("b"), task("a"), task("c", ["a", "b"])])).toEqual([
      { index: 0, taskIds: ["a", "b"] },
      { index: 1, taskIds: ["c"] },
    ])
  })

  test("renders malformed cyclic input in a final deterministic wave instead of hanging", () => {
    expect(wavesFor([task("b", ["a"]), task("a", ["b"])])).toEqual([{ index: 0, taskIds: ["a", "b"] }])
  })
})
