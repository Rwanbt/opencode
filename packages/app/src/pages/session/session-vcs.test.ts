import { describe, expect, test } from "bun:test"
import type { FileDiff } from "@opencode-ai/sdk/v2"
import { createVcsHelpers } from "./session-vcs"

// D-08: createVcsHelpers is a factory-with-deps (ADR-0001) whose internal state
// is plain Maps + an injected setVcs (no reactive memos), so single-flight,
// the stale-run guard, force-refresh and the error path are all unit-testable.

interface Deferred {
  resolve: (v: { data?: FileDiff[] | null }) => void
  reject: (e: unknown) => void
}

function makeDeps(projectVcs: string | undefined = "git") {
  const vcs = {
    diff: { git: [] as FileDiff[], branch: [] as FileDiff[] },
    ready: { git: false, branch: false },
  }
  const deferreds: Deferred[] = []
  const diffCalls: { mode: string }[] = []
  const deps = {
    sync: { project: projectVcs === undefined ? null : { vcs: projectVcs } },
    vcs,
    setVcs: (key: "diff" | "ready", mode: "git" | "branch", value: never) => {
      // Mirror the store mutation so loadVcs's own reads (vcs.ready[mode]) work.
      ;(vcs[key] as Record<string, unknown>)[mode] = value
    },
    sdk: {
      client: {
        vcs: {
          diff: (opts: { mode: "git" | "branch" }) => {
            diffCalls.push(opts)
            return new Promise<{ data?: FileDiff[] | null }>((resolve, reject) => {
              deferreds.push({ resolve, reject })
            })
          },
        },
      },
    },
  }
  return { deps: deps as unknown as Parameters<typeof createVcsHelpers>[0], vcs, deferreds, diffCalls }
}

const diffItem = (path: string) => ({ path }) as unknown as FileDiff

describe("bumpVcs", () => {
  test("increments and returns the per-mode run counter", () => {
    const { deps } = makeDeps()
    const h = createVcsHelpers(deps)
    expect(h.bumpVcs("git")).toBe(1)
    expect(h.bumpVcs("git")).toBe(2)
    expect(h.bumpVcs("branch")).toBe(1)
  })
})

describe("loadVcs", () => {
  test("is a no-op when the project is not a git repo", async () => {
    const { deps, diffCalls } = makeDeps("none")
    const h = createVcsHelpers(deps)
    await h.loadVcs("git")
    expect(diffCalls).toHaveLength(0)
  })

  test("is a no-op when the mode is already ready and not forced", async () => {
    const { deps, vcs, diffCalls } = makeDeps()
    vcs.ready.git = true
    const h = createVcsHelpers(deps)
    await h.loadVcs("git")
    expect(diffCalls).toHaveLength(0)
  })

  test("loads the diff and marks the mode ready on success", async () => {
    const { deps, vcs, deferreds } = makeDeps()
    const h = createVcsHelpers(deps)
    const p = h.loadVcs("git")
    deferreds[0].resolve({ data: [diffItem("a.ts")] })
    await p
    expect(vcs.diff.git).toEqual([diffItem("a.ts")])
    expect(vcs.ready.git).toBe(true)
  })

  test("coalesces concurrent loads into a single request (single-flight)", async () => {
    const { deps, diffCalls, deferreds } = makeDeps()
    const h = createVcsHelpers(deps)
    const p1 = h.loadVcs("git")
    const p2 = h.loadVcs("git")
    expect(p1).toBe(p2)
    expect(diffCalls).toHaveLength(1)
    deferreds[0].resolve({ data: [] })
    await p1
  })

  test("force re-fetches even when the mode is already ready", async () => {
    const { deps, vcs, diffCalls, deferreds } = makeDeps()
    const h = createVcsHelpers(deps)
    const p1 = h.loadVcs("git")
    deferreds[0].resolve({ data: [diffItem("a.ts")] })
    await p1
    expect(vcs.ready.git).toBe(true)

    const p2 = h.loadVcs("git", true)
    expect(diffCalls).toHaveLength(2)
    deferreds[1].resolve({ data: [diffItem("b.ts")] })
    await p2
    expect(vcs.diff.git).toEqual([diffItem("b.ts")])
  })

  test("recovers gracefully on error: empty diff, still marked ready", async () => {
    const { deps, vcs, deferreds } = makeDeps()
    const h = createVcsHelpers(deps)
    const p = h.loadVcs("git")
    deferreds[0].reject(new Error("boom"))
    await p
    expect(vcs.diff.git).toEqual([])
    expect(vcs.ready.git).toBe(true)
  })

  test("discards a stale result when the run is bumped mid-flight", async () => {
    const { deps, vcs, deferreds } = makeDeps()
    const h = createVcsHelpers(deps)
    const p = h.loadVcs("git")
    // A reset (or new force) bumps the run counter and clears state.
    h.resetVcs("git")
    // The original in-flight request now resolves, but it is stale.
    deferreds[0].resolve({ data: [diffItem("a.ts")] })
    await p
    expect(vcs.diff.git).toEqual([]) // not overwritten by the stale result
    expect(vcs.ready.git).toBe(false)
  })
})

describe("resetVcs", () => {
  test("clears diff and ready for a single mode and bumps its run", () => {
    const { deps, vcs } = makeDeps()
    vcs.diff.git = [diffItem("a.ts")]
    vcs.ready.git = true
    const h = createVcsHelpers(deps)
    const before = h.bumpVcs("git")
    h.resetVcs("git")
    expect(vcs.diff.git).toEqual([])
    expect(vcs.ready.git).toBe(false)
    expect(h.bumpVcs("git")).toBeGreaterThan(before + 1)
  })

  test("clears both modes when called without an argument", () => {
    const { deps, vcs } = makeDeps()
    vcs.ready.git = true
    vcs.ready.branch = true
    const h = createVcsHelpers(deps)
    h.resetVcs()
    expect(vcs.ready.git).toBe(false)
    expect(vcs.ready.branch).toBe(false)
  })
})
