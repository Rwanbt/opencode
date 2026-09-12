/* SPDX-License-Identifier: MIT */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { WorkspaceRuntime, toWorkspacePath } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-workspace-"))
try {
  await mkdir(path.join(root, "src"))
  await writeFile(path.join(root, "src", "main.ts"), "export const value = 1\n")
  await writeFile(path.join(root, "README.md"), "# Fixture\n")
  const runtime = new WorkspaceRuntime({ now: () => 1_000, maxReadBytes: 100, maxWriteBytes: 100 })
  const workspace = await runtime.register({ name: "fixture", path: root })
  const handle = await runtime.open(workspace.id)

  const initial = await runtime.read(handle.token, ["src/main.ts"])
  if (initial[0]?.size !== Buffer.byteLength("export const value = 1\n")) throw new Error("read result did not preserve file size")
  const written = await runtime.write(handle.token, [{ path: "src/main.ts", content: "export const value = 2\n" }])
  if (written[0]?.sha.length !== 64) throw new Error("transactional write did not return sha256")
  if ((await readFile(path.join(root, "src", "main.ts"), "utf8")) !== "export const value = 2\n") throw new Error("write was not committed")
  const listing = await runtime.list(handle.token)
  if (!listing.entries.some((entry) => entry.path === "src" && entry.kind === "directory")) throw new Error("list did not include the source directory")
  if (!listing.entries.some((entry) => entry.path === "README.md" && entry.kind === "file")) throw new Error("list did not include the root file")
  const matches = await runtime.search(handle.token, "MAIN.TS")
  if (matches.length !== 1 || matches[0]?.path !== "src/main.ts") throw new Error("search was not case-insensitive")
  const recorded = await runtime.appendFileEvent(workspace.id, { type: "modified", path: "src/main.ts", timestamp: 1_001 })
  const replayed = await runtime.replayFileEvents(workspace.id, 0)
  if (recorded.sequence !== 1 || replayed[0]?.sequence !== 1) throw new Error("file event was not persisted with a cursor")
  await runtime.acknowledgeFileEvent(workspace.id, recorded.sequence ?? 0)
  if ((await runtime.replayFileEvents(workspace.id)).length !== 0) throw new Error("file event ack did not advance the outbox")
  const eventStream = runtime.watch(handle.token)[Symbol.asyncIterator]()
  await runtime.write(handle.token, [{ path: "src/main.ts", content: "export const value = 3\n" }])
  const observed = await Promise.race([eventStream.next(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("watcher timeout")), 5_000))])
  if (observed.done || observed.value.sequence === undefined) throw new Error("watcher did not emit a sequenced event")
  await eventStream.return?.()

  let escaped = false
  try { await runtime.read(handle.token, ["../outside.txt"]) } catch { escaped = true }
  if (!escaped) throw new Error("lexical escape was not denied")

  let missing = false
  try { await runtime.write(handle.token, [{ path: "new.txt", content: "no" }]) } catch { missing = true }
  if (!missing) throw new Error("silent file creation was not denied")

  // Phase 7.3 — create() is the deliberate opposite of write(): it must
  // succeed for a genuinely new path (the case write() just refused) and
  // refuse a path that already exists (write()'s job).
  const created = await runtime.create(handle.token, [{ path: "notes/new.txt", content: "fresh" }])
  if (created[0]?.bytesWritten !== Buffer.byteLength("fresh")) throw new Error("create did not report the written size")
  if ((await readFile(path.join(root, "notes", "new.txt"), "utf8")) !== "fresh") throw new Error("create did not write the file, or a missing parent directory")
  let collision = false
  try { await runtime.create(handle.token, [{ path: "notes/new.txt", content: "clobber" }]) } catch { collision = true }
  if (!collision) throw new Error("create silently overwrote an existing file")
  if ((await readFile(path.join(root, "notes", "new.txt"), "utf8")) !== "fresh") throw new Error("a refused create still mutated the file")

  // remove() is idempotent: the second call on the same path must not throw.
  const removed = await runtime.remove(handle.token, ["notes/new.txt"])
  if (removed[0]?.removed !== true) throw new Error("remove did not report the file as removed")
  let stillThere = true
  try { await readFile(path.join(root, "notes", "new.txt"), "utf8") } catch { stillThere = false }
  if (stillThere) throw new Error("remove did not delete the file")
  const removedAgain = await runtime.remove(handle.token, ["notes/new.txt"])
  if (removedAgain[0]?.removed !== false) throw new Error("removing an already-gone path was not reported as a no-op")

  const renamed = await runtime.rename(handle.token, "README.md", "docs/README.md")
  if (renamed.path !== "docs/README.md") throw new Error("rename did not report the new path")
  if ((await readFile(path.join(root, "docs", "README.md"), "utf8")) !== "# Fixture\n") throw new Error("rename did not move the content")
  let readOldPath = true
  try { await readFile(path.join(root, "README.md"), "utf8") } catch { readOldPath = false }
  if (readOldPath) throw new Error("rename left the old path behind")
  let renameCollision = false
  try { await runtime.rename(handle.token, "docs/README.md", "src/main.ts") } catch { renameCollision = true }
  if (!renameCollision) throw new Error("rename silently overwrote an existing destination")

  await runtime.close(handle.token)
  let revoked = false
  try { await runtime.read(handle.token, ["src/main.ts"]) } catch { revoked = true }
  if (!revoked) throw new Error("closed file session remained usable")
  // Regression: the watcher normalised with one escape too many, so it looked
  // for a doubled backslash and left every Windows event path unconverted
  // while listings were already POSIX. The two must agree or no consumer can
  // match an event against a listing.
  if (toWorkspacePath("src\\main.ts") !== "src/main.ts") throw new Error("single backslash was not normalised")
  if (toWorkspacePath("a\\b\\c.txt") !== "a/b/c.txt") throw new Error("nested backslashes were not normalised")
  // The exact sequence the old inlined literal searched for: it must also
  // collapse, otherwise the fix only moved the mistake.
  if (toWorkspacePath("a\\\\b.txt") !== "a//b.txt") throw new Error("doubled backslashes were not normalised")
  if (toWorkspacePath("src/main.ts") !== "src/main.ts") throw new Error("an already-POSIX path was altered")
  if (toWorkspacePath("") !== "") throw new Error("empty path was altered")

  console.log("WorkspaceRuntime: 28/28 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}
