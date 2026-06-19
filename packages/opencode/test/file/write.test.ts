import { test, expect, describe } from "bun:test"
import path from "path"
import { Bus } from "../../src/bus"
import { File } from "../../src/file"
import { FileWatcher } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Behavioral coverage for the file write API (ADR-0004): write / readRaw /
// rename / move / delete. Path-escape coverage lives in path-traversal.test.ts.

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
        const stamp = await File.write({ path: "new.txt", content: "hello" })
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
        const stamp = await File.write({ path: "ws.txt", content })
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
          const full = path.join(tmp.path, "evt.txt")
          await waitFor(() => edited.includes(full) && updated.some((u) => u.file === full))
          expect(edited).toContain(full)
          expect(updated.find((u) => u.file === full)?.event).toBe("add")
        } finally {
          u1()
          u2()
        }
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
          await waitFor(() => updated.some((e) => e.file === newFull && e.event === "add"))
          expect(updated.find((e) => e.file === oldFull)?.event).toBe("unlink")
          expect(updated.find((e) => e.file === newFull)?.event).toBe("add")
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
          await waitFor(() => updated.some((e) => e.file === full && e.event === "unlink"))
          expect(updated.find((e) => e.file === full)?.event).toBe("unlink")
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
