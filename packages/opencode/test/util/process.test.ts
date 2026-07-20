import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"

function node(script: string) {
  return [process.execPath, "-e", script]
}

describe("util.process", () => {
  test("captures stdout and stderr", async () => {
    const out = await Process.run(node('process.stdout.write("out");process.stderr.write("err")'))
    expect(out.code).toBe(0)
    expect(out.stdout.toString()).toBe("out")
    expect(out.stderr.toString()).toBe("err")
  })

  test("returns code when nothrow is enabled", async () => {
    const out = await Process.run(node("process.exit(7)"), { nothrow: true })
    expect(out.code).toBe(7)
  })

  test("throws RunFailedError on non-zero exit", async () => {
    const err = await Process.run(node('process.stderr.write("bad");process.exit(3)')).catch((error) => error)
    expect(err).toBeInstanceOf(Process.RunFailedError)
    if (!(err instanceof Process.RunFailedError)) throw err
    expect(err.code).toBe(3)
    expect(err.stderr.toString()).toBe("bad")
  })

  test("aborts a running process", async () => {
    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node("setInterval(() => {}, 1000)"), {
      abort: abort.signal,
      nothrow: true,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test("kills after timeout when process ignores terminate signal", async () => {
    if (process.platform === "win32") return

    const abort = new AbortController()
    const started = Date.now()
    setTimeout(() => abort.abort(), 25)

    const out = await Process.run(node('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'), {
      abort: abort.signal,
      nothrow: true,
      timeout: 25,
    })

    expect(out.code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(1000)
  }, 3000)

  test("uses cwd when spawning commands", async () => {
    await using tmp = await tmpdir()
    const out = await Process.run(node("process.stdout.write(process.cwd())"), {
      cwd: tmp.path,
    })
    expect(out.stdout.toString()).toBe(tmp.path)
  })

  test("merges environment overrides", async () => {
    const out = await Process.run(node('process.stdout.write(process.env.OPENCODE_TEST ?? "")'), {
      env: {
        OPENCODE_TEST: "set",
      },
    })
    expect(out.stdout.toString()).toBe("set")
  })

  test("uses shell in run on Windows", async () => {
    if (process.platform !== "win32") return

    const out = await Process.run(["set", "OPENCODE_TEST_SHELL"], {
      shell: true,
      env: {
        OPENCODE_TEST_SHELL: "ok",
      },
    })

    expect(out.code).toBe(0)
    expect(out.stdout.toString()).toContain("OPENCODE_TEST_SHELL=ok")
  })

  test("runs cmd scripts with spaces on Windows without shell", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "with space")
    const file = path.join(dir, "echo cmd.cmd")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(file, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n")

    const proc = Process.spawn([file, "--stdio"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(await proc.exited).toBe(0)
  })

  test("stop() terminates a real process quickly (nominal case)", async () => {
    const target = Process.spawn(node("setInterval(() => {}, 10_000)"), {
      stdout: "ignore",
      stderr: "ignore",
    })
    const started = Date.now()
    await Process.stop(target)
    // FORK (LSP-TEST-SUITE-REGRESSION): the 5s taskkill timeout must never
    // trigger in the sane case — a real, responsive taskkill returns almost
    // immediately.
    expect(Date.now() - started).toBeLessThan(3_000)
    // stop() only waits for taskkill's own exit, not for Node to finish
    // processing `target`'s "exit" event — await it explicitly instead of
    // racing exitCode/signalCode right after stop() resolves.
    await target.exited
  }, 5_000)

  test("stop() bounds a hanging taskkill instead of waiting forever (Windows)", async () => {
    if (process.platform !== "win32") return

    // FORK (LSP-TEST-SUITE-REGRESSION): reproduces the 6-minute project.initGit
    // hang — shadow the real taskkill.exe on PATH with a script that never
    // exits on its own, and verify Process.stop() still returns in bounded
    // time (via the abort timeout) instead of hanging indefinitely.
    await using tmp = await tmpdir()
    const fakeBinDir = path.join(tmp.path, "fake-bin")
    await fs.mkdir(fakeBinDir, { recursive: true })
    // Self-bounded to ~8s so an orphaned grandchild (Node's kill() only
    // terminates the direct cmd.exe child on Windows, not the whole tree)
    // cleans itself up quickly instead of lingering for the test run.
    await Bun.write(path.join(fakeBinDir, "taskkill.cmd"), "@echo off\r\nping -n 8 127.0.0.1 >nul\r\n")

    const target = Process.spawn(node("setInterval(() => {}, 10_000)"), {
      stdout: "ignore",
      stderr: "ignore",
    })
    const originalPath = process.env.PATH
    process.env.PATH = fakeBinDir + path.delimiter + originalPath
    try {
      const started = Date.now()
      await Process.stop(target)
      // Bound is generous (observed ~7s: 5s abort trigger + Windows process
      // teardown overhead) — the point is proving this is bounded at all,
      // not hanging for the 6 minutes seen before this fix.
      expect(Date.now() - started).toBeLessThan(9_000)
      await target.exited
    } finally {
      process.env.PATH = originalPath
      target.kill()
    }
  }, 15_000)

  test("rejects missing commands without leaking unhandled errors", async () => {
    await using tmp = await tmpdir()
    const cmd = path.join(tmp.path, "missing" + (process.platform === "win32" ? ".cmd" : ""))
    const err = await Process.spawn([cmd], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }).exited.catch((err) => err)

    expect(err).toBeInstanceOf(Error)
    if (!(err instanceof Error)) throw err
    expect(err).toMatchObject({
      code: "ENOENT",
    })
  })
})
