import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// The installer must be able to run on a machine that already has OpenCode and
// leave it exactly as it found it.
//
// It could not: INSTALL_DIR was $HOME/.opencode/bin and the binary was written
// as `opencode`, so installing this fork overwrote the user's real OpenCode CLI
// — while never creating anything named `unifia`, which the script then went
// looking for. This runs the real script against a throwaway HOME and checks
// both halves.

const SCRIPT = path.resolve(import.meta.dir, "../../../../install")

/** `D:\a\b` -> `/d/a/b`. Git Bash on Windows drops the backslashes otherwise. */
function toPosix(p: string) {
  return p.replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
}

/**
 * Git Bash, not whatever `bash` resolves to.
 *
 * On Windows the first bash on PATH is usually WSL's, which mounts the drives
 * under /mnt and therefore cannot see /d/... — the script "does not exist" and
 * the test fails for a reason that has nothing to do with the installer.
 */
function resolveBash() {
  if (process.platform !== "win32") return "bash"
  for (const candidate of ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"]) {
    if (Bun.file(candidate).size > 0) return candidate
  }
  return "bash"
}

let home: string
let fakeBinary: string
let officialBinary: string

async function sha(file: string) {
  return Bun.SHA256.hash(await Bun.file(file).arrayBuffer(), "hex")
}

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), "unifia-install-coex-"))

  // A pre-existing OpenCode install, complete with its binary and a config file.
  const official = path.join(home, ".opencode", "bin")
  await mkdir(official, { recursive: true })
  officialBinary = path.join(official, "opencode")
  await writeFile(officialBinary, "#!/bin/sh\necho official-opencode\n", { mode: 0o755 })
  await writeFile(path.join(home, ".opencode", "config.json"), '{"official":true}\n')

  fakeBinary = path.join(home, "unifia-build")
  await writeFile(fakeBinary, "#!/bin/sh\necho unifia\n", { mode: 0o755 })
})

afterAll(async () => {
  await rm(home, { recursive: true, force: true })
})

test("installs unifia without touching an existing OpenCode install", async () => {
  const before = await sha(officialBinary)

  const proc = Bun.spawn([resolveBash(), toPosix(SCRIPT), "--binary", toPosix(fakeBinary), "--no-modify-path"], {
    env: { ...process.env, HOME: toPosix(home) },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited])

  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: expect.any(String) })

  // Installed under its own name, in its own directory.
  // One handle for both assertions: stat-then-read on a path is a TOCTOU race
  // (CodeQL `js/file-system-race`), and reusing the handle keeps the "it is a
  // regular file" check without re-resolving the path.
  const installed = path.join(home, ".unifia", "bin", "unifia")
  const handle = await open(installed, "r")
  try {
    expect((await handle.stat()).isFile()).toBe(true)
    expect(await handle.readFile("utf8")).toContain("echo unifia")
  } finally {
    await handle.close()
  }

  // The OpenCode install is byte-for-byte what it was.
  expect(await sha(officialBinary)).toBe(before)
  expect(await readFile(path.join(home, ".opencode", "config.json"), "utf8")).toBe('{"official":true}\n')

  // And nothing named opencode appeared in our directory.
  expect(await Bun.file(path.join(home, ".unifia", "bin", "opencode")).exists()).toBe(false)
})

test("the installer never writes into the OpenCode directory", async () => {
  const source = await readFile(SCRIPT, "utf8")

  // A guard on the text, not just on one run: a future edit that reintroduces
  // the old path would otherwise only be caught if it happened to be exercised.
  const writesToOpencodeDir = /(?:mv|cp|chmod|mkdir|rm)[^\n]*\.opencode\b/.test(source)
  expect(writesToOpencodeDir).toBe(false)
  expect(source).toContain("INSTALL_DIR=$HOME/.unifia/bin")
})
