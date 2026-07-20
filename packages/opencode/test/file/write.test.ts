import { test, expect, describe, spyOn, beforeAll, afterAll } from "bun:test"
import path from "path"
import { Bus } from "../../src/bus"
import { File } from "../../src/file"
import { FileWatcher } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"
import { LSPServer } from "../../src/lsp/server"
import { tmpdir } from "../fixture/fixture"

// Behavioral coverage for the file write API (ADR-0004): write / readRaw /
// rename / move / delete. Path-escape coverage lives in path-traversal.test.ts.

// FORK (LSP-SAVE-LATENCY): File.write()'s notifyWrite() fires LSP.touchFile()
// in the background (P0 — see src/file/index.ts). A few tests below write
// real .ts files, and MULTIPLE configured servers match that extension
// (Typescript, Deno, ESLint, Oxlint, ...) — any of them finding a real binary
// on this dev machine would spawn a REAL process purely as an unintended side
// effect of testing unrelated file-write/format behavior. None of these
// tests assert anything about LSP status, so keep the whole suite
// deterministic by never letting ANY real language server spawn.
//
// FORK (LSP-TEST-SUITE-REGRESSION): mocked via beforeAll/afterAll, not
// beforeEach/afterEach — the fire-and-forget touchFile() triggered by
// notifyWrite/notifyDelete can still be resolving when a test ends. With a
// per-test beforeEach/afterEach cycle, afterEach's mockRestore() briefly
// re-exposes the REAL spawn() before the next test's beforeEach re-mocks it,
// and a touchFile() call landing in that window spawns a real language
// server whose connection is never tracked/disposed by this file's own
// tests — surfacing later as an unhandled ERR_STREAM_DESTROYED when Bun
// force-kills the leaked process at file teardown. A single beforeAll/afterAll
// pair keeps spawn() mocked for the file's entire run, with no per-test gap.
let lspSpawnSpies: ReturnType<typeof spyOn>[]
// FORK (LSP-TEST-SUITE-REGRESSION): kept separately so the "hangs on spawn"
// tests below can override its behavior for exactly one call via
// mockReturnValueOnce() — restoring a NESTED spyOn() on an already-mocked
// property unwinds all the way back to the true, unmocked spawn() (verified
// empirically), not to this outer beforeAll mock, which would silently
// re-expose real spawning for the rest of this file's run.
let typescriptSpawnSpy: ReturnType<typeof spyOn>
beforeAll(() => {
  const servers = Object.values(LSPServer)
  lspSpawnSpies = servers.map((server) => spyOn(server, "spawn").mockResolvedValue(undefined))
  typescriptSpawnSpy = lspSpawnSpies[servers.indexOf(LSPServer.Typescript)]
})
afterAll(async () => {
  // FORK (LSP-TEST-SUITE-REGRESSION): the last test's fire-and-forget
  // touchFile() call (from notifyWrite/notifyDelete) may not have reached
  // its ensureClient()/spawn() step yet when afterAll fires — restoring the
  // spies immediately would let that lingering call slip through to the
  // real, unmocked spawn() (same race the beforeAll/afterAll switch above
  // closed between tests, now narrowed to this one file-teardown boundary).
  // Same idiom as client.ts's shutdown() flush delay and preload.ts's
  // afterEach buffer — give the fire-and-forget chain a moment to land.
  await new Promise((r) => setTimeout(r, 100))
  for (const spy of lspSpawnSpies) spy.mockRestore()
})

async function waitFor(predicate: () => boolean, timeout = 1000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) return
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe("File.write", () => {
  test("creates a new file (no expectedHash) and returns a stamp", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { stamp } = await File.write({ path: "new.txt", content: "hello" })
        expect(typeof stamp.hash).toBe("string")
        expect(stamp.hash.length).toBe(64)
        expect(await Bun.file(path.join(tmp.path, "new.txt")).text()).toBe("hello")
      },
    })
  })

  test("creates missing parent directories", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.write({ path: "a/b/c.txt", content: "deep" })
        expect(await Bun.file(path.join(tmp.path, "a", "b", "c.txt")).text()).toBe("deep")
      },
    })
  })

  test("overwrite with matching expectedHash succeeds", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "f.txt"), "v1") })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const before = await File.readRaw("f.txt")
        await File.write({ path: "f.txt", content: "v2", expectedHash: before.stamp.hash })
        expect(await Bun.file(path.join(tmp.path, "f.txt")).text()).toBe("v2")
      },
    })
  })

  test("overwrite of existing file WITHOUT expectedHash is rejected", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "f.txt"), "v1") })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.write({ path: "f.txt", content: "v2" })).rejects.toBeInstanceOf(File.ConflictError)
        expect(await Bun.file(path.join(tmp.path, "f.txt")).text()).toBe("v1")
      },
    })
  })

  test("stale expectedHash (file changed on disk) is rejected", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "f.txt"), "v1") })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const before = await File.readRaw("f.txt")
        // out-of-band change between read and write
        await Bun.write(path.join(tmp.path, "f.txt"), "v2-external")
        await expect(
          File.write({ path: "f.txt", content: "v3", expectedHash: before.stamp.hash }),
        ).rejects.toThrow(/changed on disk/)
        expect(await Bun.file(path.join(tmp.path, "f.txt")).text()).toBe("v2-external")
      },
    })
  })

  test("expectedHash supplied for a non-existent file is rejected (stale precondition)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(
          File.write({ path: "ghost.txt", content: "x", expectedHash: "0".repeat(64) }),
        ).rejects.toBeInstanceOf(File.ConflictError)
      },
    })
  })

  test("writes exact bytes (no trimming) and the stamp hash round-trips", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = "  leading and trailing  \n\n"
        const { stamp } = await File.write({ path: "ws.txt", content })
        expect(await Bun.file(path.join(tmp.path, "ws.txt")).text()).toBe(content)
        const raw = await File.readRaw("ws.txt")
        expect(raw.content).toBe(content)
        expect(raw.stamp.hash).toBe(stamp.hash)
        // a follow-up overwrite using the round-tripped hash must succeed
        await File.write({ path: "ws.txt", content: "next", expectedHash: raw.stamp.hash })
      },
    })
  })

  test("publishes File.Event.Edited and FileWatcher.Updated(add) on create", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edited: string[] = []
        const updated: Array<{ file: string; event: string }> = []
        const u1 = Bus.subscribe(File.Event.Edited, (e) => edited.push(e.properties.file))
        const u2 = Bus.subscribe(FileWatcher.Event.Updated, (e) => updated.push(e.properties))
        try {
          await File.write({ path: "evt.txt", content: "x" })
          const key = "evt.txt"
          await waitFor(() => edited.includes(key) && updated.some((u) => u.file === key))
          expect(edited).toContain(key)
          expect(updated.find((u) => u.file === key)?.event).toBe("add")
        } finally {
          u1()
          u2()
        }
      },
    })
  })
})

describe("File.write format-on-save", () => {
  test("format=false writes exact raw content, formatted=false", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const content = "const x=1\n"
        const res = await File.write({ path: "a.ts", content, format: false })
        expect(res.content).toBe(content)
        expect(res.formatted).toBe(false)
        expect(await Bun.file(path.join(tmp.path, "a.ts")).text()).toBe(content)
      },
    })
  })

  test("format=true with no formatter configured preserves raw content (no data loss)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // A bare tmp project has no formatter configured, so Format.file is a
        // best-effort no-op. The raw content must survive and formatted=false.
        const content = "const   x =1\n"
        const res = await File.write({ path: "a.ts", content, format: true })
        expect(res.content).toBe(content)
        expect(res.formatted).toBe(false)
        expect(await Bun.file(path.join(tmp.path, "a.ts")).text()).toBe(content)
        // stamp must match the final on-disk content so the next save round-trips
        const raw = await File.readRaw("a.ts")
        expect(res.stamp.hash).toBe(raw.stamp.hash)
      },
    })
  })
})

describe("File.readRaw", () => {
  test("returns untrimmed content + stamp", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "f.txt"), "body\n") })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const raw = await File.readRaw("f.txt")
        expect(raw.content).toBe("body\n")
        expect(raw.stamp.hash.length).toBe(64)
      },
    })
  })

  test("404 for a missing file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.readRaw("nope.txt")).rejects.toBeInstanceOf(File.PathNotFoundError)
      },
    })
  })
})

describe("File.rename / File.move", () => {
  test("rename moves content and publishes unlink(old) + add(new)", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "data") })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const updated: Array<{ file: string; event: string }> = []
        const u = Bus.subscribe(FileWatcher.Event.Updated, (e) => updated.push(e.properties))
        try {
          await File.rename("a.txt", "b.txt")
          const oldFull = path.join(tmp.path, "a.txt")
          const newFull = path.join(tmp.path, "b.txt")
          expect(await Bun.file(newFull).text()).toBe("data")
          expect(await Bun.file(oldFull).exists()).toBe(false)
          await waitFor(() => updated.some((e) => e.file === "b.txt" && e.event === "add"))
          expect(updated.find((e) => e.file === "a.txt")?.event).toBe("unlink")
          expect(updated.find((e) => e.file === "b.txt")?.event).toBe("add")
        } finally {
          u()
        }
      },
    })
  })

  test("move into a (new) subdirectory creates parents", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "data") })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.move("a.txt", "sub/dir/a.txt")
        expect(await Bun.file(path.join(tmp.path, "sub", "dir", "a.txt")).text()).toBe("data")
      },
    })
  })

  test("refuses to clobber an existing destination", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.txt"), "a")
        await Bun.write(path.join(dir, "b.txt"), "b")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.rename("a.txt", "b.txt")).rejects.toBeInstanceOf(File.TargetExistsError)
        expect(await Bun.file(path.join(tmp.path, "a.txt")).text()).toBe("a")
        expect(await Bun.file(path.join(tmp.path, "b.txt")).text()).toBe("b")
      },
    })
  })

  test("404 when source does not exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.rename("missing.txt", "x.txt")).rejects.toBeInstanceOf(File.PathNotFoundError)
      },
    })
  })

  test("stale source expectedHash is rejected", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "v1") })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.rename("a.txt", "b.txt", "0".repeat(64))).rejects.toBeInstanceOf(File.ConflictError)
      },
    })
  })
})

describe("File.remove", () => {
  test("deletes a file and publishes unlink", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "data") })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const updated: Array<{ file: string; event: string }> = []
        const u = Bus.subscribe(FileWatcher.Event.Updated, (e) => updated.push(e.properties))
        try {
          await File.remove({ path: "a.txt" })
          const full = path.join(tmp.path, "a.txt")
          expect(await Bun.file(full).exists()).toBe(false)
          await waitFor(() => updated.some((e) => e.file === "a.txt" && e.event === "unlink"))
          expect(updated.find((e) => e.file === "a.txt")?.event).toBe("unlink")
        } finally {
          u()
        }
      },
    })
  })

  test("404 for a missing file", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.remove({ path: "ghost.txt" })).rejects.toBeInstanceOf(File.PathNotFoundError)
      },
    })
  })

  test("refuses to delete a directory", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await File.mkdir("adir")
        await expect(File.remove({ path: "adir" })).rejects.toThrow(/Access denied/)
      },
    })
  })

  test("stale expectedHash is rejected", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "a.txt"), "v1") })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.remove({ path: "a.txt", expectedHash: "0".repeat(64) })).rejects.toBeInstanceOf(
          File.ConflictError,
        )
        expect(await Bun.file(path.join(tmp.path, "a.txt")).exists()).toBe(true)
      },
    })
  })
})

// FORK (LSP-SAVE-LATENCY, P0): notifyWrite()'s LSP.touchFile() must be
// fire-and-forget — a slow/hung LSP spawn (e.g. rust-analyzer initializing a
// real crate) must never delay File.write()'s response. See
// packages/opencode/src/file/index.ts notifyWrite/notifyDelete.
describe("File.write — does not block on LSP notify (P0)", () => {
  test("write() resolves quickly even if the matching LSP server hangs on spawn", async () => {
    await using tmp = await tmpdir()
    // FORK (LSP-TEST-SUITE-REGRESSION): override the shared beforeAll spy for
    // exactly the next call, not a nested spyOn()/mockRestore() — see the
    // comment on typescriptSpawnSpy's declaration above.
    typescriptSpawnSpy.mockReturnValueOnce(new Promise(() => {}))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const start = Date.now()
        await File.write({ path: "slow.ts", content: "export const x = 1" })
        expect(Date.now() - start).toBeLessThan(500)
        expect(await Bun.file(path.join(tmp.path, "slow.ts")).text()).toBe("export const x = 1")
      },
    })
  })

  test("remove() resolves quickly even if the matching LSP server hangs on spawn", async () => {
    await using tmp = await tmpdir({ init: async (dir) => Bun.write(path.join(dir, "slow.ts"), "x") })
    typescriptSpawnSpy.mockReturnValueOnce(new Promise(() => {}))
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const start = Date.now()
        await File.remove({ path: "slow.ts" })
        expect(Date.now() - start).toBeLessThan(500)
      },
    })
  })
})
