import { describe, expect, test } from "bun:test"

// Extract and test the wave computation logic from team.ts
// This is a pure function test - no side effects needed

interface TaskDef {
  description: string
  prompt: string
  agent: string
  depends_on?: number[]
}

function computeWaves(tasks: TaskDef[]): number[][] {
  const n = tasks.length
  const assigned = new Array<number>(n).fill(-1)
  let changed = true

  while (changed) {
    changed = false
    for (let i = 0; i < n; i++) {
      if (assigned[i] >= 0) continue
      const deps = tasks[i].depends_on ?? []
      if (deps.length === 0) {
        assigned[i] = 0
        changed = true
      } else if (deps.every((d) => assigned[d] >= 0)) {
        assigned[i] = Math.max(...deps.map((d) => assigned[d])) + 1
        changed = true
      }
    }
  }

  if (assigned.some((w) => w < 0)) {
    throw new Error("Circular or invalid dependencies detected in task graph")
  }

  const maxWave = Math.max(...assigned)
  const waves: number[][] = []
  for (let w = 0; w <= maxWave; w++) {
    waves.push(assigned.map((wave, idx) => (wave === w ? idx : -1)).filter((idx) => idx >= 0))
  }
  return waves
}

describe("team wave computation", () => {
  test("single task with no dependencies → wave 0", () => {
    const waves = computeWaves([
      { description: "task A", prompt: "do A", agent: "general" },
    ])
    expect(waves).toEqual([[0]])
  })

  test("all independent tasks → single wave", () => {
    const waves = computeWaves([
      { description: "A", prompt: "do A", agent: "explore" },
      { description: "B", prompt: "do B", agent: "explore" },
      { description: "C", prompt: "do C", agent: "general" },
    ])
    expect(waves).toEqual([[0, 1, 2]])
  })

  test("linear dependency chain → sequential waves", () => {
    const waves = computeWaves([
      { description: "research", prompt: "explore", agent: "explore" },
      { description: "implement", prompt: "code", agent: "general", depends_on: [0] },
      { description: "test", prompt: "test", agent: "general", depends_on: [1] },
    ])
    expect(waves).toEqual([[0], [1], [2]])
  })

  test("diamond dependency → 3 waves", () => {
    // 0 → 1, 0 → 2, 1+2 → 3
    const waves = computeWaves([
      { description: "start", prompt: "s", agent: "explore" },
      { description: "left", prompt: "l", agent: "general", depends_on: [0] },
      { description: "right", prompt: "r", agent: "general", depends_on: [0] },
      { description: "merge", prompt: "m", agent: "general", depends_on: [1, 2] },
    ])
    expect(waves).toEqual([[0], [1, 2], [3]])
  })

  test("mixed: some independent, some dependent", () => {
    const waves = computeWaves([
      { description: "independent", prompt: "a", agent: "explore" },
      { description: "also independent", prompt: "b", agent: "explore" },
      { description: "depends on both", prompt: "c", agent: "general", depends_on: [0, 1] },
    ])
    expect(waves).toEqual([[0, 1], [2]])
  })

  test("circular dependency throws error", () => {
    expect(() =>
      computeWaves([
        { description: "A", prompt: "a", agent: "general", depends_on: [1] },
        { description: "B", prompt: "b", agent: "general", depends_on: [0] },
      ]),
    ).toThrow("Circular or invalid dependencies")
  })

  test("self-dependency throws error", () => {
    expect(() =>
      computeWaves([
        { description: "A", prompt: "a", agent: "general", depends_on: [0] },
      ]),
    ).toThrow("Circular or invalid dependencies")
  })

  test("out-of-range dependency throws (via unresolved)", () => {
    // Note: in actual team.ts, this is validated before computeWaves
    // but computeWaves handles it gracefully by never resolving
    expect(() =>
      computeWaves([
        { description: "A", prompt: "a", agent: "general", depends_on: [5] },
      ]),
    ).toThrow("Circular or invalid dependencies")
  })

  test("deep chain respects wave ordering", () => {
    const waves = computeWaves([
      { description: "0", prompt: "p", agent: "explore" },
      { description: "1", prompt: "p", agent: "general", depends_on: [0] },
      { description: "2", prompt: "p", agent: "general", depends_on: [1] },
      { description: "3", prompt: "p", agent: "general", depends_on: [2] },
      { description: "4", prompt: "p", agent: "general", depends_on: [3] },
    ])
    expect(waves).toEqual([[0], [1], [2], [3], [4]])
    expect(waves.length).toBe(5)
  })

  test("multiple roots merge correctly", () => {
    // 0 independent, 1 independent, 2 depends on 0, 3 depends on 1, 4 depends on 2+3
    const waves = computeWaves([
      { description: "root-a", prompt: "p", agent: "explore" },
      { description: "root-b", prompt: "p", agent: "explore" },
      { description: "mid-a", prompt: "p", agent: "general", depends_on: [0] },
      { description: "mid-b", prompt: "p", agent: "general", depends_on: [1] },
      { description: "final", prompt: "p", agent: "general", depends_on: [2, 3] },
    ])
    expect(waves).toEqual([[0, 1], [2, 3], [4]])
  })
})
