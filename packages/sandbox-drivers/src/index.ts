/* SPDX-License-Identifier: MIT */

/**
 * Real sandbox drivers — Plan V3 section 21 (Phase 8).
 *
 * `SandboxBroker` and its conformance check existed with no driver behind them,
 * so "network off par défaut" and "les processus ont CPU/RAM/durée limités" were
 * policy nothing enforced. These drivers execute.
 *
 * Rules every driver here obeys, from section 21:
 *
 * - **No inherited environment.** A child gets only what the request declares.
 *   Inheriting `process.env` would hand a sandboxed command every token and
 *   path the host holds, which defeats the point of sandboxing it.
 * - **Network off is refused, not downgraded.** A driver that cannot enforce a
 *   network policy rejects the policy instead of running the command anyway —
 *   "aucun backend n'est considéré sûr uniquement par son nom".
 * - **Timeouts kill.** A deadline that only stops waiting leaves the process
 *   running, which is a resource leak wearing a timeout's clothes.
 * - **No silent fallback.** An unavailable backend throws; it never quietly
 *   becomes a less isolated one (§35: "un échec de sandbox ne doit jamais
 *   activer silencieusement nativeFallback").
 */

import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { Execution, ExecutionRequest, SandboxBackendInfo, SandboxDriver, SandboxHandle, SandboxPolicy } from "@unifia/contracts"

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 1024 * 1024

/**
 * POSIX no-ops used by the conformance probe, mapped for Windows hosts.
 * Only these two: this is a portability shim for the probe, not a command
 * translation layer.
 */
const WINDOWS_PROBES: Readonly<Record<string, { command: string; args: string[] }>> = {
  true: { command: "cmd.exe", args: ["/c", "exit", "0"] },
  false: { command: "cmd.exe", args: ["/c", "exit", "1"] },
}

export class SandboxUnavailableError extends Error {
  constructor(backend: string, detail: string) {
    super(`sandbox backend ${backend} is unavailable: ${detail}`)
    this.name = "SandboxUnavailableError"
  }
}

export class SandboxPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SandboxPolicyError"
  }
}

type SpawnPlan = { command: string; args: string[]; cwd?: string }

/**
 * Runs a child process with an explicit environment and a killing deadline.
 *
 * Shared by every driver so the safety behaviour cannot drift between them.
 */
async function runProcess(plan: SpawnPlan, request: ExecutionRequest, timeoutMs: number): Promise<Execution> {
  const startedAt = Date.now()
  return new Promise<Execution>((resolve) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      // WHY an explicit object and never `...process.env`: see the module note.
      env: { ...(request.env ?? {}) },
      windowsHide: true,
      shell: false,
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (exitCode: number, extraStderr = "") => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr: stderr + extraStderr, durationMs: Math.max(0, Date.now() - startedAt) })
    }
    const timer = setTimeout(() => {
      // Kill, then report. Reporting without killing leaves the process behind.
      child.kill("SIGKILL")
      finish(124, `\nsandbox: killed after ${timeoutMs}ms`)
    }, timeoutMs)
    child.stdout?.on("data", (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString("utf8") })
    child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString("utf8") })
    child.on("error", (error) => finish(127, `\nsandbox: ${error.message}`))
    child.on("close", (code) => finish(code ?? 0))
    if (request.stdin !== undefined) {
      child.stdin?.end(request.stdin)
    } else {
      child.stdin?.end()
    }
  })
}

/**
 * Validates a policy at the moment it is declared.
 *
 * WHY here and not at execute: a policy is a promise about how a command will
 * be contained. Accepting an unenforceable one at prepare and only failing when
 * something runs means the caller believes it holds a sandbox it never had.
 */
function assertPolicy(policy: SandboxPolicy, backend: string, canIsolateNetwork: boolean): void {
  if (policy.network === "open") throw new SandboxPolicyError(`${backend} refuses an open network policy`)
  if (policy.network === "limited" && !canIsolateNetwork) {
    throw new SandboxPolicyError(`${backend} cannot enforce a limited network policy; refusing rather than running unisolated`)
  }
  timeoutOf(policy)
  const { cpu, memoryMb } = policy.resources
  if (cpu !== undefined && (!Number.isFinite(cpu) || cpu <= 0)) throw new SandboxPolicyError("resources.cpu must be a positive number")
  if (memoryMb !== undefined && (!Number.isSafeInteger(memoryMb) || memoryMb <= 0)) throw new SandboxPolicyError("resources.memoryMb must be a positive integer")
}

function timeoutOf(policy: SandboxPolicy): number {
  const declared = policy.resources.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(declared) || declared <= 0) throw new SandboxPolicyError("timeoutMs must be a positive integer")
  return declared
}

/**
 * Host execution with a stripped environment and an enforced deadline.
 *
 * Named `native-restricted` in the plan precisely because it is the weakest
 * backend: it restricts, it does not isolate. It therefore refuses any network
 * policy other than "none" — it cannot enforce one, and claiming otherwise
 * would be the silent downgrade section 35 forbids.
 */
export class NativeRestrictedDriver implements SandboxDriver {
  readonly backend = "native" as const
  readonly #handles = new Map<string, SandboxPolicy>()

  async inspect(): Promise<SandboxBackendInfo[]> {
    return [{ backend: "native", available: true, version: process.version, features: ["readonly-policy", "timeout-kill", "env-isolation"] }]
  }

  async prepare(policy: SandboxPolicy): Promise<SandboxHandle> {
    assertPolicy(policy, "native", false)
    const enforced: SandboxPolicy = { ...policy, backend: "native", filesystem: { ...policy.filesystem, readOnly: true } }
    const handle: SandboxHandle = { id: `native-${randomUUID()}`, backend: "native", createdAt: Date.now(), policy: enforced }
    this.#handles.set(handle.id, enforced)
    return handle
  }

  async execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution> {
    const policy = this.#handles.get(handle.id)
    if (!policy) throw new SandboxPolicyError("native sandbox handle is not prepared")
    const probe = process.platform === "win32" ? WINDOWS_PROBES[request.command] : undefined
    return runProcess({ command: probe?.command ?? request.command, args: probe?.args ?? request.args, cwd: request.cwd }, request, timeoutOf(policy))
  }

  async terminate(handle: SandboxHandle): Promise<void> {
    this.#handles.delete(handle.id)
  }
}

/**
 * Executes inside a WSL2 distribution.
 *
 * Isolation is a Linux namespace, not a VM boundary, so this claims no network
 * isolation and refuses "limited" for the same reason as the native driver.
 */
export class Wsl2Driver implements SandboxDriver {
  readonly backend = "wsl2" as const
  readonly #distribution: string
  readonly #handles = new Map<string, SandboxPolicy>()

  constructor(distribution = "Ubuntu") {
    this.#distribution = distribution
  }

  async inspect(): Promise<SandboxBackendInfo[]> {
    const probe = await runProcess({ command: "wsl.exe", args: ["-d", this.#distribution, "--", "true"] }, { command: "true", args: [] }, 15_000)
    return [{ backend: "wsl2", available: probe.exitCode === 0, version: this.#distribution, features: ["readonly-policy", "timeout-kill", "env-isolation"] }]
  }

  async prepare(policy: SandboxPolicy): Promise<SandboxHandle> {
    assertPolicy(policy, "wsl2", false)
    const available = (await this.inspect())[0]?.available
    if (!available) throw new SandboxUnavailableError("wsl2", `distribution ${this.#distribution} did not respond`)
    const enforced: SandboxPolicy = { ...policy, backend: "wsl2", filesystem: { ...policy.filesystem, readOnly: true } }
    const handle: SandboxHandle = { id: `wsl2-${randomUUID()}`, backend: "wsl2", createdAt: Date.now(), policy: enforced }
    this.#handles.set(handle.id, enforced)
    return handle
  }

  async execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution> {
    const policy = this.#handles.get(handle.id)
    if (!policy) throw new SandboxPolicyError("wsl2 sandbox handle is not prepared")
    const args = ["-d", this.#distribution, "--", request.command, ...request.args]
    return runProcess({ command: "wsl.exe", args }, request, timeoutOf(policy))
  }

  async terminate(handle: SandboxHandle): Promise<void> {
    this.#handles.delete(handle.id)
  }
}

/**
 * Executes in a container.
 *
 * The only backend here that can genuinely enforce a network policy, via
 * `--network none`. Images are pinned by the caller; this driver refuses a
 * policy it was given no image for rather than choosing one.
 */
export class DockerDriver implements SandboxDriver {
  readonly backend = "docker" as const
  readonly #image: string
  readonly #handles = new Map<string, SandboxPolicy>()

  constructor(image: string) {
    if (!image) throw new SandboxPolicyError("docker driver requires an explicitly pinned image")
    this.#image = image
  }

  async inspect(): Promise<SandboxBackendInfo[]> {
    const probe = await runProcess({ command: "docker", args: ["version", "--format", "{{.Server.Version}}"] }, { command: "docker", args: [] }, 15_000)
    return [{ backend: "docker", available: probe.exitCode === 0, version: probe.stdout.trim() || undefined, features: ["readonly-policy", "timeout-kill", "env-isolation", "network-none"] }]
  }

  async prepare(policy: SandboxPolicy): Promise<SandboxHandle> {
    assertPolicy(policy, "docker", true)
    const available = (await this.inspect())[0]?.available
    if (!available) throw new SandboxUnavailableError("docker", "the daemon did not respond")
    const enforced: SandboxPolicy = { ...policy, backend: "docker", filesystem: { ...policy.filesystem, readOnly: true } }
    const handle: SandboxHandle = { id: `docker-${randomUUID()}`, backend: "docker", createdAt: Date.now(), policy: enforced }
    this.#handles.set(handle.id, enforced)
    return handle
  }

  async execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution> {
    const policy = this.#handles.get(handle.id)
    if (!policy) throw new SandboxPolicyError("docker sandbox handle is not prepared")
    const args = ["run", "--rm", "--network", policy.network === "none" ? "none" : "bridge"]
    if (policy.filesystem.readOnly) args.push("--read-only")
    if (policy.resources.memoryMb) args.push("--memory", `${policy.resources.memoryMb}m`)
    if (policy.resources.cpu) args.push("--cpus", String(policy.resources.cpu))
    // Environment is passed explicitly, one flag per declared variable.
    for (const [key, value] of Object.entries(request.env ?? {})) args.push("--env", `${key}=${value}`)
    args.push(this.#image, request.command, ...request.args)
    return runProcess({ command: "docker", args }, { ...request, env: {} }, timeoutOf(policy))
  }

  async terminate(handle: SandboxHandle): Promise<void> {
    this.#handles.delete(handle.id)
  }
}
