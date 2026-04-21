/**
 * Guards the PRODUCTION wave-ordering algorithm by invoking
 * `computeWaves` directly from `src/tool/team-waves.ts`.
 *
 * Complements the sibling `dag-team.test.ts` which currently keeps a
 * local copy of the algorithm for bootstrap reasons. If the prod
 * algorithm drifts from the mirror, this suite catches it here even
 * before the full e2e (still skipped) is unblocked.
 */
import { describe, it, expect } from "bun:test"
import { computeWaves, type WaveTask } from "../../src/tool/team-waves"

interface DagTask extends WaveTask {
  id: string
  run: (ctx: { inputs: string[] }) => Promise<string>
}

async function dispatchDag(tasks: DagTask[]): Promise<{
  order: string[]
  outputs: Record<string, string>
  contextSeen: Record<string, string[]>
}> {
  const waves = computeWaves(tasks)
  const order: string[] = []
  const outputs: Record<string, string> = {}
  const contextSeen: Record<string, string[]> = {}
  for (const wave of waves) {
    await Promise.all(
      wave.map(async (i) => {
        const t = tasks[i]
        const inputs = (t.depends_on ?? []).map((d) => outputs[tasks[d].id])
        contextSeen[t.id] = inputs
        const out = await t.run({ inputs })
        outputs[t.id] = out
        order.push(t.id)
      }),
    )
  }
  return { order, outputs, contextSeen }
}

describe("team-waves — PROD computeWaves wave-ordering guard", () => {
  it("places independent tasks in wave 0 and a dependent in wave 1", () => {
    const waves = computeWaves([
      { depends_on: [] }, // 0 explore
      { depends_on: [] }, // 1 critic
      { depends_on: [0, 1] }, // 2 tester
    ])
    expect(waves).toEqual([[0, 1], [2]])
  })

  it("detects cycles", () => {
    expect(() => computeWaves([{ depends_on: [1] }, { depends_on: [0] }])).toThrow()
  })

  it("chains a 4-long linear pipeline into 4 waves of 1", () => {
    const waves = computeWaves([
      { depends_on: [] },
      { depends_on: [0] },
      { depends_on: [1] },
      { depends_on: [2] },
    ])
    expect(waves.map((w) => w.length)).toEqual([1, 1, 1, 1])
  })

  it("fans out to parallel siblings after a common parent", () => {
    const waves = computeWaves([
      { depends_on: [] }, // 0 root
      { depends_on: [0] }, // 1 child A
      { depends_on: [0] }, // 2 child B
      { depends_on: [1, 2] }, // 3 join
    ])
    expect(waves).toEqual([[0], [1, 2], [3]])
  })
})

describe("team-waves — dispatch contract via PROD computeWaves", () => {
  it("runs explore+critic before tester and passes prior outputs as context", async () => {
    const tasks: DagTask[] = [
      { id: "explore", depends_on: [], run: async () => "explore-out" },
      { id: "critic", depends_on: [], run: async () => "critic-out" },
      { id: "tester", depends_on: [0, 1], run: async () => "tester-out" },
    ]
    const { order, contextSeen, outputs } = await dispatchDag(tasks)
    expect(order.indexOf("tester")).toBe(2)
    expect(order.indexOf("explore")).toBeLessThan(order.indexOf("tester"))
    expect(order.indexOf("critic")).toBeLessThan(order.indexOf("tester"))
    expect(contextSeen["tester"]).toEqual(["explore-out", "critic-out"])
    expect(contextSeen["explore"]).toEqual([])
    expect(contextSeen["critic"]).toEqual([])
    expect(Object.keys(outputs).sort()).toEqual(["critic", "explore", "tester"])
  })

  it("a failed parent in wave 0 prevents dispatch of a dependent in wave 1", async () => {
    const tasks: DagTask[] = [
      { id: "explore", depends_on: [], run: async () => "ok" },
      {
        id: "critic",
        depends_on: [],
        run: async () => {
          throw new Error("boom")
        },
      },
      { id: "tester", depends_on: [0, 1], run: async () => "tester-out" },
    ]
    await expect(dispatchDag(tasks)).rejects.toThrow("boom")
  })
})
