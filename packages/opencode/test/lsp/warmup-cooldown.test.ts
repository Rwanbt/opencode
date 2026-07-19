import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import * as Lsp from "../../src/lsp/index"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Coverage for LSP-SAVE-LATENCY P1 (broken-server cooldown, status reporting)
// and P2 (warmup). See src/lsp/index.ts.

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
  // A bare tmpdir's root() resolves (falls back to Instance.directory) for
  // every extension-filtered builtin server, not just Typescript — mock all
  // of them so this test isn't at the mercy of ~30 real spawn attempts for
  // whatever tools happen to be installed on the machine running it.
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

  test(
    "spawns servers whose root resolves at the project directory, without any file touch",
    withInstance(async () => {
      await Lsp.LSP.warmup()
      // warmup() itself resolves once the fire-and-forget spawns are
      // dispatched, not once they complete — give the microtask queue a
      // tick to let the in-flight ensureClient() call reach spawn().
      await new Promise((r) => setTimeout(r, 20))
      expect(typescriptSpy).toHaveBeenCalled()
    }),
  )

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
