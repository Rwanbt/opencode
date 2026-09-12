import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire a free port")))
        return
      }
      server.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function waitForHealth(url: string) {
  const timeout = Date.now() + 120_000
  const errors: string[] = []
  while (Date.now() < timeout) {
    const result = await fetch(url)
      .then((r) => ({ ok: r.ok, error: undefined }))
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    if (result.ok) return
    if (result.error) errors.push(result.error)
    await new Promise((r) => setTimeout(r, 250))
  }
  const last = errors.length ? ` (last error: ${errors[errors.length - 1]})` : ""
  throw new Error(`Timed out waiting for server health: ${url}${last}`)
}

const appDir = process.cwd()
const repoDir = path.resolve(appDir, "../..")

// A missing cwd is reported as an executable spawn failure, so validate the
// renamed server package explicitly to keep path drift actionable.
const serverDir = path.join(repoDir, "packages", "unifia")
if (!existsSync(serverDir)) {
  throw new Error(`Server package directory not found: ${serverDir}. Was packages/unifia renamed?`)
}

const extraArgs = (() => {
  const args = process.argv.slice(2)
  if (args[0] === "--") return args.slice(1)
  return args
})()

const [serverPort, webPort] = await Promise.all([freePort(), freePort()])

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "unifia-e2e-"))
const keepSandbox = process.env.OPENCODE_E2E_KEEP_SANDBOX === "1"

const serverEnv = {
  ...process.env,
  UNIFIA_DISABLE_SHARE: process.env.UNIFIA_DISABLE_SHARE ?? "true",
  UNIFIA_DISABLE_LSP_DOWNLOAD: "true",
  // UNIFIA_DISABLE_LSP is deliberately NOT defaulted here — it is inherited
  // from process.env above, so it stays available as an opt-in and nothing
  // more.
  //
  // It was briefly defaulted to "true" on the claim that language servers were
  // "the mechanism behind the suite's flakiness". Measurement refuted that:
  // three local runs of the same two tests gave LSP on -> pass (43.7 s), LSP
  // off -> fail, LSP off -> pass (37.3 s). The flag does remove four 45 s
  // `initialize` timeouts and every `spawned lsp server` line, so it shortens
  // the run — it does not make it deterministic. Defaulting it on would only
  // have hidden any LSP regression from the suite for good.
  UNIFIA_DISABLE_DEFAULT_PLUGINS: "true",
  UNIFIA_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
  UNIFIA_TEST_HOME: path.join(sandbox, "home"),
  XDG_DATA_HOME: path.join(sandbox, "share"),
  XDG_CACHE_HOME: path.join(sandbox, "cache"),
  XDG_CONFIG_HOME: path.join(sandbox, "config"),
  XDG_STATE_HOME: path.join(sandbox, "state"),
  OPENCODE_E2E_PROJECT_DIR: repoDir,
  OPENCODE_E2E_SESSION_TITLE: "E2E Session",
  OPENCODE_E2E_MESSAGE: "Seeded for UI e2e",
  ...(process.env.OPENCODE_E2E_MODEL ? { OPENCODE_E2E_MODEL: process.env.OPENCODE_E2E_MODEL } : {}),
  UNIFIA_CLIENT: "app",
  UNIFIA_STRICT_CONFIG_DEPS: "true",
} satisfies Record<string, string>

const runnerEnv = {
  ...serverEnv,
  PLAYWRIGHT_SERVER_HOST: "127.0.0.1",
  PLAYWRIGHT_SERVER_PORT: String(serverPort),
  VITE_OPENCODE_SERVER_HOST: "127.0.0.1",
  VITE_OPENCODE_SERVER_PORT: String(serverPort),
  PLAYWRIGHT_PORT: String(webPort),
} satisfies Record<string, string>

let seed: ReturnType<typeof Bun.spawn> | undefined
let runner: ReturnType<typeof Bun.spawn> | undefined
let server: { stop: () => Promise<void> | void } | undefined
let inst: { Instance: { disposeAll: () => Promise<void> | void } } | undefined
let cleaned = false

const cleanup = async () => {
  if (cleaned) return
  cleaned = true

  if (seed && seed.exitCode === null) seed.kill("SIGTERM")
  if (runner && runner.exitCode === null) runner.kill("SIGTERM")

  const jobs = [
    inst?.Instance.disposeAll(),
    server?.stop(),
    keepSandbox ? undefined : fs.rm(sandbox, { recursive: true, force: true }),
  ].filter(Boolean)
  await Promise.allSettled(jobs)
}

const shutdown = (code: number, reason: string) => {
  process.exitCode = code
  void cleanup().finally(() => {
    console.error(`e2e-local shutdown: ${reason}`)
    process.exit(code)
  })
}

const reportInternalError = (reason: string, error: unknown) => {
  console.warn(`e2e-local ignored server error: ${reason}`)
  console.warn(error)
}

process.once("SIGINT", () => shutdown(130, "SIGINT"))
process.once("SIGTERM", () => shutdown(143, "SIGTERM"))
process.once("SIGHUP", () => shutdown(129, "SIGHUP"))
process.once("uncaughtException", (error) => {
  reportInternalError("uncaughtException", error)
})
process.once("unhandledRejection", (error) => {
  reportInternalError("unhandledRejection", error)
})

let code = 1

try {
  // An earlier version of this comment blamed PATH resolution for the
  // `ENOENT: posix_spawn 'bun'` on the Linux runner. That was wrong: the cwd
  // above did not exist, and posix_spawn attributes that ENOENT to the
  // executable. `process.execPath` is kept because naming the interpreter
  // already running this file is unambiguous, not because a bare "bun" fails.
  seed = Bun.spawn([process.execPath, "script/seed-e2e.ts"], {
    cwd: serverDir,
    env: serverEnv,
    stdout: "inherit",
    stderr: "inherit",
  })

  const seedExit = await seed.exited
  if (seedExit !== 0) {
    code = seedExit
  } else {
    Object.assign(process.env, serverEnv)
    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.UNIFIA_PID = String(process.pid)

    const log = await import("../../unifia/src/util/log")
    const install = await import("../../unifia/src/installation")
    await log.Log.init({
      print: true,
      dev: install.Installation.isLocal(),
      level: "WARN",
    })

    const servermod = await import("../../unifia/src/server/server")
    inst = await import("../../unifia/src/project/instance")
    server = servermod.Server.listen({ port: serverPort, hostname: "127.0.0.1" })
    console.log(`unifia server listening on http://127.0.0.1:${serverPort}`)

    await waitForHealth(`http://127.0.0.1:${serverPort}/global/health`)
    runner = Bun.spawn([process.execPath, "test:e2e", ...extraArgs], {
      cwd: appDir,
      env: runnerEnv,
      stdout: "inherit",
      stderr: "inherit",
    })
    code = await runner.exited
  }
} catch (error) {
  console.error(error)
  code = 1
} finally {
  await cleanup()
}

process.exit(code)
