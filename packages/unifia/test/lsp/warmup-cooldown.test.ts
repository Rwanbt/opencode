import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import * as Lsp from "../../src/lsp/index"
import { LSPServer } from "../../src/lsp/server"
import { StrictNearestRoot } from "../../src/lsp/server-shared"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Coverage for LSP-SAVE-LATENCY P1 (broken-server cooldown, status reporting)
// and P2 (warmup). See src/lsp/index.ts.

// FORK (LSP-TEST-SUITE-REGRESSION): test/preload.ts disables LSP.warmup() by
// default for the whole suite. This file specifically tests warmup(), so it
// opts back in — and restores the suite-wide default afterward so the
// derogation doesn't leak into files that run later in the same bun process.
delete process.env.UNIFIA_DISABLE_LSP_WARMUP
afterAll(() => {
  process.env.UNIFIA_DISABLE_LSP_WARMUP = "true"
})

function withInstance(fn: (dir: string) => Promise<void>) {
  return async () => {
    await using tmp = await tmpdir()
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: () => fn(tmp.path),
      })
    } finally {
      await Instance.disposeAll()
    }
  }
}

describe("LSP broken-server cooldown (P1)", () => {
  // .ts matches several builtin servers — mock all of them so only the
  // "typescript" spy's call count is meaningful (avoids incidental real
  // spawns of whatever else happens to be on this machine).
  let otherSpies: ReturnType<typeof spyOn>[]
  let typescriptSpy: ReturnType<typeof spyOn>
  let nowSpy: ReturnType<typeof spyOn>
  const base = Date.now()

  beforeEach(() => {
    otherSpies = Object.values(LSPServer)
      .filter((server) => server !== LSPServer.Typescript)
      .map((server) => spyOn(server, "spawn").mockResolvedValue(undefined))
    typescriptSpy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)
    nowSpy = spyOn(Date, "now").mockImplementation(() => base)
  })

  afterEach(() => {
    for (const spy of otherSpies) spy.mockRestore()
    typescriptSpy.mockRestore()
    nowSpy.mockRestore()
  })

  test(
    "a failed spawn is not retried immediately, but is retried after the cooldown window",
    withInstance(async (dir) => {
      const file = path.join(dir, "a.ts")

      await Lsp.LSP.touchFile(file)
      expect(typescriptSpy).toHaveBeenCalledTimes(1)

      // Immediate retry within the cooldown window: no new spawn attempt.
      await Lsp.LSP.touchFile(file)
      expect(typescriptSpy).toHaveBeenCalledTimes(1)

      // Past the cooldown window (5 min + margin): retried.
      nowSpy.mockImplementation(() => base + 5 * 60_000 + 1_000)
      await Lsp.LSP.touchFile(file)
      expect(typescriptSpy).toHaveBeenCalledTimes(2)
    }),
  )
})

describe("LSP.status() surfaces cooldown entries (P1)", () => {
  // .ts matches several builtin servers (typescript, eslint, oxlint, biome,
  // deno) — mock all of them so this test only reasons about "typescript",
  // not incidental real spawns of tools that happen to be on this machine.
  let spawnSpies: ReturnType<typeof spyOn>[]
  let nowSpy: ReturnType<typeof spyOn>
  const base = Date.now()

  beforeEach(() => {
    spawnSpies = Object.values(LSPServer).map((server) => spyOn(server, "spawn").mockResolvedValue(undefined))
    nowSpy = spyOn(Date, "now").mockImplementation(() => base)
  })

  afterEach(() => {
    for (const spy of spawnSpies) spy.mockRestore()
    nowSpy.mockRestore()
  })

  test(
    "a server within its cooldown reports status: error; it disappears once cooldown lapses",
    withInstance(async (dir) => {
      await Lsp.LSP.touchFile(path.join(dir, "a.ts"))

      const status = await Lsp.LSP.status()
      const typescriptEntry = status.find((s) => s.id === "typescript")
      expect(typescriptEntry?.status).toBe("error")

      // Past the cooldown window, the failed entry is no longer reported —
      // it's eligible for a fresh retry on next touch, not meaningfully
      // "broken" anymore.
      nowSpy.mockImplementation(() => base + 5 * 60_000 + 1_000)
      const laterStatus = await Lsp.LSP.status()
      expect(laterStatus.find((s) => s.id === "typescript")).toBeUndefined()
    }),
  )
})

describe("LSP.warmup() (P2)", () => {
  // Every builtin server is mocked so the test never depends on which language
  // tools happen to be installed on the machine running it.
  let otherSpies: ReturnType<typeof spyOn>[]
  let typescriptSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    otherSpies = Object.values(LSPServer)
      .filter((server) => server !== LSPServer.Typescript)
      .map((server) => spyOn(server, "spawn").mockResolvedValue(undefined))
    typescriptSpy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)
  })

  afterEach(() => {
    for (const spy of otherSpies) spy.mockRestore()
    typescriptSpy.mockRestore()
  })

  // This pair is the regression guard for the warmup storm. The old assertion
  // here was "a bare tmpdir spawns typescript", which encoded the defect: root()
  // fell back to the project directory when it found no marker, so warmup
  // pre-spawned every language on every project — measured at 15 servers on a
  // directory holding nothing but CSS and HTML.
  test(
    "spawns nothing in a project with no marker file",
    withInstance(async () => {
      await Lsp.LSP.warmup()
      // warmup() resolves once the fire-and-forget spawns are dispatched, not
      // once they complete — give the microtask queue a tick to let any
      // in-flight ensureClient() reach spawn().
      await new Promise((r) => setTimeout(r, 20))
      expect(typescriptSpy).not.toHaveBeenCalled()
      for (const spy of otherSpies) expect(spy).not.toHaveBeenCalled()
    }),
  )

  // The other half: warmup must still do its job where there IS evidence,
  // otherwise the ~49 s first-save stall that motivated it (commit 7d1e08a7b0)
  // comes straight back.
  test("spawns the matching server when the project carries its marker", async () => {
    await using tmp = await tmpdir()
    const { writeFile } = await import("fs/promises")
    await writeFile(path.join(tmp.path, "bun.lock"), "")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Lsp.LSP.warmup()
          await new Promise((r) => setTimeout(r, 20))
          expect(typescriptSpy).toHaveBeenCalled()
        },
      })
    } finally {
      await Instance.disposeAll()
    }
  })

  test(
    "warmup() resolves quickly even if a server hangs on spawn",
    withInstance(async () => {
      typescriptSpy.mockReturnValue(new Promise(() => {}))
      const start = Date.now()
      await Lsp.LSP.warmup()
      expect(Date.now() - start).toBeLessThan(500)
    }),
  )
})

describe("LSP.warmup() respects config (P2 edge case)", () => {
  test("spawns nothing when cfg.lsp === false (all LSPs disabled)", async () => {
    const typescriptSpy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)
    try {
      await using tmp = await tmpdir({ config: { lsp: false } })
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            await Lsp.LSP.warmup()
            await new Promise((r) => setTimeout(r, 20))
            expect(typescriptSpy).not.toHaveBeenCalled()
          },
        })
      } finally {
        await Instance.disposeAll()
      }
    } finally {
      typescriptSpy.mockRestore()
    }
  })
})

// B11 — strict warmup foundation. The full warmup integration (passing the strict
// option through `LSP.warmup()`) lives in B12. This describe block tests the
// `StrictNearestRoot` contract directly: a server using the strict wrapper must
// report `undefined` when no marker is found, so the future warmup can skip it.
describe("StrictNearestRoot contract (B11)", () => {
  test("strict mode returns undefined when no include match (no warmup would spawn)", async () => {
    await using tmp = await tmpdir()
    const noMarker = path.join(tmp.path, "no-marker")
    const { mkdir, writeFile } = await import("fs/promises")
    await mkdir(noMarker, { recursive: true })
    const file = path.join(noMarker, "a.ts")
    await writeFile(file, "")
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const strictRoot = StrictNearestRoot(["Cargo.toml"])
          const result = await strictRoot(file)
          expect(result).toBeUndefined()
        },
      })
    } finally {
      await Instance.disposeAll()
    }
  })
})
