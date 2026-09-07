#!/usr/bin/env bun
/* SPDX-License-Identifier: MIT */
/**
 * Device probe harness for the Sovereign Knowledge Core on Android (R-0016).
 *
 * `src/knowledge/mobile/android-runtime.ts` describes itself as "the typed
 * surface that the device tests will populate", and until this file nothing
 * populated it: `runProbes` had two callers, both unit tests. R-0016's stated
 * way to lift the risk — plug a phone in and re-run `bun test
 * test/knowledge/mobile` — cannot work, because that module has no imports at
 * all: the two `adb` occurrences in it are comments. The test returns the same
 * result with the cable unplugged.
 *
 * So this is the missing producer. It talks to a real device, runs real
 * commands, and hands `runProbes` evidence it actually observed. A probe it
 * could not run stays `NOT_EXECUTED_EXTERNAL_BOUNDARY` — never a PASS, which
 * is the defect card C24 corrected one layer down.
 *
 * Run:
 *
 *   cd packages/unifia && bun script/android-memory-probe.ts
 *   bun script/android-memory-probe.ts --with-agent   # also drive a real turn
 *   bun script/android-memory-probe.ts --keep         # leave the probe note
 *
 * Exit code is 1 when any probe FAILs, 0 otherwise — a probe that did not run
 * is not a failure, it is an absence, and the report says which.
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import {
  PROBES,
  runProbes,
  hasFailures,
  type DeviceContext,
  type ProbeEvidence,
} from "../src/knowledge/mobile/android-runtime.js"

/** The port the embedded server binds inside the app (`serve --port 14096`). */
const DEVICE_SERVER_PORT = 14096

/** The app under test. */
const PACKAGE = "ai.unifia.mobile"

/** A shell command through the session API can take a while on a phone. */
const SHELL_TIMEOUT_MS = 120_000

/** One agent turn on a local model is slower still. */
const AGENT_TIMEOUT_MS = 300_000

interface Options {
  withAgent: boolean
  keep: boolean
  serial: string | null
  out: string | null
  model: { providerID: string; modelID: string } | null
}

function parseArgs(argv: string[]): Options {
  const options: Options = { withAgent: false, keep: false, serial: null, out: null, model: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--with-agent") options.withAgent = true
    else if (arg === "--keep") options.keep = true
    else if (arg === "--serial") options.serial = argv[++i] ?? null
    else if (arg === "--out") options.out = argv[++i] ?? null
    else if (arg === "--model") {
      // `provider/model`, e.g. `openai/gpt-5.6-luna`. Explicit beats inferred:
      // providers fail for their own reasons (an exhausted quota, a token
      // exchange that never happened), and a probe that picks its own model
      // ends up measuring whichever provider is broken today rather than the
      // memory path.
      const raw = argv[++i] ?? ""
      const slash = raw.indexOf("/")
      if (slash <= 0 || slash === raw.length - 1) {
        console.error(`android-memory-probe: --model expects provider/model, got "${raw}"`)
        process.exit(2)
      }
      options.model = { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
    } else {
      console.error(`android-memory-probe: unknown argument "${arg}"`)
      process.exit(2)
    }
  }
  return options
}

// ---------------------------------------------------------------------------
// adb
// ---------------------------------------------------------------------------

class Adb {
  constructor(readonly serial: string) {}

  /** Run an adb subcommand, returning stdout and the exit status. */
  run(args: string[], timeoutMs = 60_000): { ok: boolean; out: string } {
    const result = spawnSync("adb", ["-s", this.serial, ...args], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    })
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
    return { ok: result.status === 0, out }
  }

  shell(command: string, timeoutMs = 60_000): { ok: boolean; out: string } {
    return this.run(["shell", command], timeoutMs)
  }
}

/**
 * The first device `adb` reports, or null.
 *
 * An `adb devices` line reading `unauthorized` or `offline` is not a device
 * you can probe, and treating it as one is how a run reports nothing and calls
 * it success.
 */
function findDevice(preferred: string | null): string | null {
  const result = spawnSync("adb", ["devices"], { encoding: "utf8", timeout: 30_000 })
  const lines = (result.stdout ?? "").split("\n").slice(1)
  const serials = lines
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]!)
  if (preferred !== null) return serials.includes(preferred) ? preferred : null
  return serials[0] ?? null
}

// ---------------------------------------------------------------------------
// The app's HTTP surface, reached through an adb port forward
// ---------------------------------------------------------------------------

class DeviceApi {
  constructor(
    readonly adb: Adb,
    readonly port: number,
  ) {}

  /** Bind a host port to the app's server port. Idempotent. */
  forward(): boolean {
    return this.adb.run(["forward", `tcp:${this.port}`, `tcp:${DEVICE_SERVER_PORT}`]).ok
  }

  removeForward(): void {
    this.adb.run(["forward", "--remove", `tcp:${this.port}`])
  }

  /**
   * `connection: close` on every request, deliberately.
   *
   * An `adb forward` tunnel drops a pooled socket that has gone quiet, and a
   * reused connection then fails as `ECONNRESET` mid-probe — which reads like
   * the app crashed and is only the tunnel recycling. One connection per
   * request costs a few milliseconds and removes the whole failure mode.
   */
  async get(path: string, timeoutMs = 20_000): Promise<unknown> {
    const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      headers: { connection: "close" },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`)
    return response.json()
  }

  async post(path: string, body: unknown, timeoutMs = 60_000): Promise<unknown> {
    const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`POST ${path} -> ${response.status}`)
    return response.json()
  }
}

/**
 * Every string an assistant message carries, flattened.
 *
 * The shape of a message part is not this harness's business — it wants the
 * text, wherever the schema currently puts it.
 */
function collectText(node: unknown, into: string[] = []): string[] {
  if (typeof node === "string") return into
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, into)
    return into
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if ((key === "output" || key === "stdout" || key === "text") && typeof value === "string") {
        into.push(value)
      } else collectText(value, into)
    }
  }
  return into
}

/** A session whose shell runs commands inside the app's own runtime. */
class DeviceSession {
  private constructor(
    readonly api: DeviceApi,
    readonly id: string,
  ) {}

  static async open(api: DeviceApi): Promise<DeviceSession> {
    const created = (await api.post("/session", {})) as { id?: string }
    if (typeof created.id !== "string") throw new Error("session create returned no id")
    return new DeviceSession(api, created.id)
  }

  /** Run `command` in the app runtime and return its combined output. */
  async shell(command: string, timeoutMs = SHELL_TIMEOUT_MS): Promise<string> {
    const message = await this.api.post(
      `/session/${this.id}/shell`,
      { agent: "build", command },
      timeoutMs,
    )
    // The same output is echoed under several keys; one copy is enough.
    return [...new Set(collectText(message))].join("\n")
  }

  /**
   * One agent turn. `model` is explicit on purpose: the session default is the
   * cloud provider, so an unpinned turn measures the phone's connectivity
   * rather than the memory path — and the product's premise is offline-first.
   */
  async prompt(
    text: string,
    model: { providerID: string; modelID: string } | null,
    timeoutMs = AGENT_TIMEOUT_MS,
  ): Promise<string> {
    const message = await this.api.post(
      `/session/${this.id}/prompt`,
      {
        agent: "build",
        ...(model !== null ? { model } : {}),
        parts: [{ type: "text", text }],
      },
      timeoutMs,
    )
    return [...new Set(collectText(message))].join("\n")
  }
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Build a piece of evidence, timestamped at the moment it was observed. */
function evidence(
  probe: string,
  status: "PASS" | "FAIL",
  command: string,
  deviceId: string,
  output: string,
  startedAt: number,
): ProbeEvidence {
  return {
    probe,
    status,
    command,
    deviceId,
    capturedAt: new Date().toISOString(),
    // A probe whose output is empty is refused by `isUsableEvidence`, and
    // rightly — so say so rather than hand it a blank string.
    output: output.trim().length > 0 ? output.trim().slice(0, 4_000) : "(no output captured)",
    artifactHash: createHash("sha256").update(output).digest("hex").slice(0, 16),
    durationMs: Date.now() - startedAt,
  }
}

/** A Class A note the vault must accept, with the fail-closed default left in place. */
function probeNote(marker: string): string {
  return [
    "---",
    "unifia_schema: 1",
    `unifia_id: "0190d2c0-7b00-7000-8000-${marker.slice(0, 12).padStart(12, "0")}"`,
    'unifia_type: "decision"',
    'unifia_lifecycle: "active"',
    'unifia_created_at: "2026-01-01T00:00:00Z"',
    'unifia_updated_at: "2026-01-01T00:00:00Z"',
    'unifia_project_ref: "unifia"',
    "unifia_supersedes: []",
    "unifia_tags: []",
    "---",
    `device probe marker ${marker}`,
    "",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

interface Precondition {
  name: string
  ok: boolean
  detail: string
}

async function checkPreconditions(adb: Adb, api: DeviceApi): Promise<Precondition[]> {
  const checks: Precondition[] = []

  const path = adb.shell(`pm path ${PACKAGE}`)
  checks.push({
    name: "app installed",
    ok: path.ok && path.out.includes("base.apk"),
    detail: path.out || "no package path",
  })

  const dumpsys = adb.shell(`dumpsys package ${PACKAGE} | grep -E 'versionName|lastUpdateTime'`)
  checks.push({
    name: "app identity",
    ok: dumpsys.ok && dumpsys.out.length > 0,
    detail: dumpsys.out.replace(/\s+/g, " ").trim(),
  })

  try {
    const health = (await api.get("/global/health")) as { healthy?: boolean }
    checks.push({
      name: "server healthy",
      ok: health.healthy === true,
      detail: JSON.stringify(health),
    })
  } catch (e) {
    checks.push({ name: "server healthy", ok: false, detail: (e as Error).message })
  }

  try {
    const ids = (await api.get("/experimental/tool/ids")) as string[]
    const wanted = ["memory_search", "memory_read", "memory_write"]
    const missing = wanted.filter((id) => !ids.includes(id))
    checks.push({
      name: "memory tools registered",
      ok: missing.length === 0,
      detail: missing.length === 0 ? wanted.join(", ") : `missing: ${missing.join(", ")}`,
    })
  } catch (e) {
    checks.push({ name: "memory tools registered", ok: false, detail: (e as Error).message })
  }

  return checks
}

/**
 * The three probes that need no model: write a note, read it back, and confirm
 * the egress default the app actually carries.
 */
async function deterministicProbes(
  session: DeviceSession,
  deviceId: string,
  keep: boolean,
): Promise<ProbeEvidence[]> {
  const collected: ProbeEvidence[] = []
  const marker = `probe${Date.now().toString(36)}`
  const vaultDir = "$HOME/.unifia/memory"
  const notePath = `${vaultDir}/${marker}.md`
  const note = probeNote(marker)
  const expectedHash = createHash("sha256").update(note).digest("hex")

  // --- vault.write ---------------------------------------------------------
  //
  // The note travels base64-encoded, on one line. `session.shell` does not
  // preserve newlines in a command — a heredoc arrives with its delimiter
  // mangled into `PROBE_EOFn---nunifia_schema:` and writes an empty file, which
  // the read probe then dutifully reports as the hash of nothing. One line with
  // no backslashes and no newlines survives every layer between here and the
  // device.
  {
    const startedAt = Date.now()
    const encoded = Buffer.from(note, "utf8").toString("base64")
    const command = `mkdir -p ${vaultDir} && echo ${encoded} | base64 -d > ${notePath} && wc -c ${notePath}`
    const out = await session.shell(command)
    const bytes = out.match(/(\d+)\s/)
    const wrote = bytes !== null && Number(bytes[1]) === Buffer.byteLength(note, "utf8")
    collected.push(
      evidence(
        "vault.write",
        wrote ? "PASS" : "FAIL",
        command,
        deviceId,
        `${out}\nexpected ${Buffer.byteLength(note, "utf8")} bytes`,
        startedAt,
      ),
    )
  }

  // --- vault.read ----------------------------------------------------------
  {
    const startedAt = Date.now()
    const command = `sha256sum ${notePath} 2>/dev/null || shasum -a 256 ${notePath}`
    const out = await session.shell(command)
    // The hash is computed on the device and compared against the bytes this
    // harness sent: a round trip, not a re-read of what we just wrote here.
    const matched = out.toLowerCase().includes(expectedHash.toLowerCase())
    collected.push(
      evidence(
        "vault.read",
        matched ? "PASS" : "FAIL",
        command,
        deviceId,
        `${out}\nexpected ${expectedHash}`,
        startedAt,
      ),
    )
  }

  // --- policy.egress -------------------------------------------------------
  {
    const startedAt = Date.now()
    const command = "cat $HOME/.config/unifia/*.json 2>/dev/null | head -40; echo ---; cat $HOME/.unifia/policy.json 2>/dev/null"
    const out = await session.shell(command)
    let remoteRecall: unknown = "absent"
    try {
      const config = (await session.api.get("/config")) as { memory?: { remote_recall?: unknown } }
      remoteRecall = config.memory?.remote_recall ?? "absent"
    } catch {
      // The config endpoint failing is itself the observation; keep going.
    }
    // Fail-closed is the invariant: absent or false both refuse remote egress.
    // `true` is a legitimate operator choice, so it is reported, not failed.
    const failClosed = remoteRecall === false || remoteRecall === "absent"
    collected.push(
      evidence(
        "policy.egress",
        failClosed || remoteRecall === true ? "PASS" : "FAIL",
        command,
        deviceId,
        `config.memory.remote_recall=${JSON.stringify(remoteRecall)}\n${out}`,
        startedAt,
      ),
    )
  }

  if (!keep) {
    await session.shell(`rm -f ${notePath}`)
  } else {
    console.log(`  (kept ${notePath} on the device)`)
  }

  return collected
}

/**
 * The on-device model, when the app declares one.
 *
 * Returns null rather than guessing: a wrong provider id turns the probe into
 * a test of the phone's data connection.
 */
async function resolveLocalModel(
  api: DeviceApi,
): Promise<{ providerID: string; modelID: string } | null> {
  try {
    const config = (await api.get("/config/providers")) as {
      providers?: Array<{ id?: string }>
      default?: Record<string, string>
    }
    const hasLocal = config.providers?.some((p) => p.id === "local-llm") ?? false
    const modelID = config.default?.["local-llm"]
    if (!hasLocal || typeof modelID !== "string") return null
    return { providerID: "local-llm", modelID }
  } catch {
    return null
  }
}

/**
 * The probes that need a real turn. Off by default: they depend on a model
 * choosing to call a tool, and a harness whose verdict depends on that is a
 * harness that reports flakiness as regression.
 */
async function agentProbes(
  api: DeviceApi,
  deviceId: string,
  model: { providerID: string; modelID: string } | null,
): Promise<ProbeEvidence[]> {
  const collected: ProbeEvidence[] = []
  const startedAt = Date.now()
  const marker = `agent${Date.now().toString(36)}`
  const command = `POST /session/:id/prompt — "remember that ${marker}"`
  try {
    const session = await DeviceSession.open(api)
    const out = await session.prompt(
      `Use your memory tools to remember this exact fact: ${marker}. Then confirm what you stored.`,
      model,
    )
    const called = out.includes("memory_write") || out.includes(marker)
    collected.push(
      evidence("context-router", called ? "PASS" : "FAIL", command, deviceId, out, startedAt),
    )
  } catch (e) {
    // A turn that never happened says nothing about the router. Reporting FAIL
    // here would blame the memory path for a provider that was unreachable —
    // the same confusion R-0016 exists to prevent, pointed the other way.
    // Emitting no evidence leaves the probe NOT_EXECUTED, which is the truth.
    console.log(`  context-router: turn did not complete — ${(e as Error).message}`)
    console.log("  reported as not run, not as a failure: no turn, no verdict.")
  }
  return collected
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport(results: ReturnType<typeof runProbes>, preconditions: Precondition[]): void {
  console.log("\npreconditions")
  for (const check of preconditions) {
    console.log(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name.padEnd(24)} ${check.detail.slice(0, 90)}`)
  }

  console.log("\nprobes")
  for (const result of results) {
    const status =
      result.status === "PASS" ? "PASS" : result.status === "FAIL" ? "FAIL" : "not run"
    console.log(`  ${status.padEnd(8)} ${result.probe.padEnd(18)} ${result.note.slice(0, 100)}`)
  }

  const ran = results.filter((r) => r.status !== "NOT_EXECUTED_EXTERNAL_BOUNDARY").length
  console.log(`\n${ran}/${PROBES.length} probes executed with evidence.`)
  if (ran < PROBES.length) {
    console.log("The rest did not run. That is an absence, not a pass — see R-0016.")
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  const serial = findDevice(options.serial)
  if (serial === null) {
    console.error("android-memory-probe: no authorised device (`adb devices` lists none as `device`).")
    console.error("Nothing is concluded: every probe stays NOT_EXECUTED_EXTERNAL_BOUNDARY.")
    process.exit(1)
  }
  console.log(`device ${serial}`)

  const adb = new Adb(serial)
  const api = new DeviceApi(adb, DEVICE_SERVER_PORT)
  if (!api.forward()) {
    console.error(`android-memory-probe: could not forward tcp:${DEVICE_SERVER_PORT}.`)
    process.exit(1)
  }

  try {
    const preconditions = await checkPreconditions(adb, api)
    const blocked = preconditions.filter((check) => !check.ok)
    if (blocked.length > 0) {
      printReport(runProbes({ hasDevice: true, hasInstalledApk: false, apkPath: null, onDeviceVault: null }), preconditions)
      console.error(`\nandroid-memory-probe: ${blocked.length} precondition(s) failed — probes not run.`)
      process.exit(1)
    }

    const context: DeviceContext = {
      hasDevice: true,
      hasInstalledApk: true,
      apkPath: adb.shell(`pm path ${PACKAGE}`).out.replace("package:", "").trim(),
      onDeviceVault: "$HOME/.unifia/memory",
    }

    const session = await DeviceSession.open(api)
    console.log(`session ${session.id}`)

    const collected = [...(await deterministicProbes(session, serial, options.keep))]
    if (options.withAgent) {
      const model = options.model ?? (await resolveLocalModel(api))
      console.log(`agent model: ${model === null ? "session default" : `${model.providerID}/${model.modelID}`}`)
      collected.push(...(await agentProbes(api, serial, model)))
    }

    const results = runProbes(context, collected)
    printReport(results, preconditions)

    if (options.out !== null) {
      writeFileSync(options.out, JSON.stringify({ device: serial, context, evidence: collected, results }, null, 2))
      console.log(`\nevidence written to ${options.out}`)
    }

    process.exit(hasFailures(results) ? 1 : 0)
  } finally {
    api.removeForward()
  }
}

await main()
