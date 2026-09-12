export const CLI_WORKER_RUNTIME_SCHEMA_VERSION = "1.0.0"
export const MAX_CLI_TIMEOUT_MS = 300_000

export type CliPlatform = "win32" | "linux" | "darwin"
export interface CliMount { readonly source: string; readonly target: string; readonly readOnly: boolean }
export type CliNetworkPolicy = { readonly mode: "disabled" } | { readonly mode: "allowlist"; readonly allowedHosts: readonly string[] }
export interface OpaqueAuthHandle { readonly handleId: string; readonly providerID: string; readonly expiresAtUTC: string }
export interface CliWorkerRequest {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly allowedExecutables: readonly string[]
  readonly supportedPlatforms: readonly CliPlatform[]
  readonly platform?: CliPlatform
  readonly mounts: readonly CliMount[]
  readonly network: CliNetworkPolicy
  readonly authHandle?: OpaqueAuthHandle
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}
export interface CliProcess { readonly id: string }
export interface CliProcessOutput { readonly exitCode: number; readonly stdout: string; readonly stderr: string }
export interface CliWorkerAdapter {
  spawn(input: { executable: string; args: readonly string[]; cwd: string; mounts: readonly CliMount[]; network: CliNetworkPolicy; authHandle?: OpaqueAuthHandle; maxOutputBytes: number }): Promise<CliProcess>
  collect(process: CliProcess, maxOutputBytes: number): Promise<CliProcessOutput>
  kill(process: CliProcess, reason: "timeout" | "cancelled" | "output_limit"): Promise<void>
}
export interface CliWorkerResult extends CliProcessOutput { readonly status: "COMPLETED" | "CANCELLED" | "TIMED_OUT" | "OUTPUT_LIMIT"; readonly processID: string }

export class CliSandboxUnsupportedError extends Error { constructor(platform: string) { super(`CLI sandbox is unsupported on platform ${platform}`); this.name = "CliSandboxUnsupportedError" } }
export class CliWorkerPolicyError extends Error { constructor(message: string) { super(message); this.name = "CliWorkerPolicyError" } }

function assertAbsolute(path: string, field: string): void {
  if (!path.trim() || path.includes("\0") || !(/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/"))) throw new CliWorkerPolicyError(`${field} must be an absolute path without NUL`)
  if (path.split(/[\\/]/).includes("..")) throw new CliWorkerPolicyError(`${field} must not contain parent traversal`)
}
function assertArgs(args: readonly string[]): void {
  for (const arg of args) {
    if (arg.includes("\0")) throw new CliWorkerPolicyError("argv must not contain NUL")
    if (["-c", "/c", "-Command", "/Command", "--command", "--shell"].includes(arg)) throw new CliWorkerPolicyError("shell or nested command execution is forbidden")
  }
}
function validateNetwork(network: CliNetworkPolicy): void {
  if (network.mode === "allowlist") {
    if (network.allowedHosts.length === 0) throw new CliWorkerPolicyError("network allowlist must not be empty")
    for (const host of network.allowedHosts) if (!/^[a-z0-9.-]+$/i.test(host) || host.includes("..")) throw new CliWorkerPolicyError("network host is invalid")
  }
}
function validateAuth(handle: OpaqueAuthHandle | undefined): void {
  if (!handle) return
  const allowedKeys = ["handleId", "providerID", "expiresAtUTC"]
  if (Object.keys(handle).some((key) => !allowedKeys.includes(key))) throw new CliWorkerPolicyError("auth handle contains non-opaque fields")
  if (!handle.handleId.trim() || !handle.providerID.trim() || !handle.expiresAtUTC.endsWith("Z") || Number.isNaN(Date.parse(handle.expiresAtUTC)) || Date.parse(handle.expiresAtUTC) <= Date.now()) throw new CliWorkerPolicyError("auth handle must be opaque, identified and unexpired")
}
function validateRequest(request: CliWorkerRequest): CliPlatform {
  const platformName = request.platform ?? process.platform
  if (!("win32|linux|darwin".split("|") as readonly string[]).includes(platformName)) throw new CliSandboxUnsupportedError(platformName)
  const platform = platformName as CliPlatform
  if (!request.supportedPlatforms.includes(platform)) throw new CliSandboxUnsupportedError(platform)
  if (!request.executable.trim() || request.executable.includes("\0") || !request.allowedExecutables.includes(request.executable)) throw new CliWorkerPolicyError("executable is not in the allowlist")
  assertAbsolute(request.cwd, "cwd"); assertArgs(request.args); validateNetwork(request.network); validateAuth(request.authHandle)
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > MAX_CLI_TIMEOUT_MS) throw new CliWorkerPolicyError("timeoutMs is outside the bounded limit")
  if (!Number.isInteger(request.maxOutputBytes) || request.maxOutputBytes <= 0) throw new CliWorkerPolicyError("maxOutputBytes must be positive")
  for (const mount of request.mounts) { assertAbsolute(mount.source, "mount.source"); assertAbsolute(mount.target, "mount.target") }
  return platform
}
function outputBytes(output: CliProcessOutput): number { return new TextEncoder().encode(`${output.stdout}${output.stderr}`).byteLength }

export class CliWorkerRuntime {
  async run(request: CliWorkerRequest, adapter: CliWorkerAdapter, signal?: AbortSignal): Promise<CliWorkerResult> {
    validateRequest(request)
    if (signal?.aborted) return Promise.reject(new CliWorkerPolicyError("worker was cancelled before spawn"))
    const process = await adapter.spawn({ executable: request.executable, args: request.args, cwd: request.cwd, mounts: request.mounts, network: request.network, authHandle: request.authHandle, maxOutputBytes: request.maxOutputBytes })
    let killed = false
    const kill = async (reason: "timeout" | "cancelled" | "output_limit") => { if (!killed) { killed = true; await adapter.kill(process, reason) } }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("CLI worker timeout")), request.timeoutMs) })
    const cancelled = signal ? new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("CLI worker cancelled")), { once: true })) : new Promise<never>(() => {})
    try {
      const output = await Promise.race([adapter.collect(process, request.maxOutputBytes), timeout, cancelled])
      if (outputBytes(output) > request.maxOutputBytes) { await kill("output_limit"); return { ...output, status: "OUTPUT_LIMIT", processID: process.id } }
      return { ...output, status: "COMPLETED", processID: process.id }
    } catch (error) {
      const reason = signal?.aborted ? "cancelled" : error instanceof Error && error.message === "CLI worker timeout" ? "timeout" : "cancelled"
      await kill(reason)
      return { exitCode: -1, stdout: "", stderr: error instanceof Error ? error.message : "CLI worker failed", status: reason === "timeout" ? "TIMED_OUT" : "CANCELLED", processID: process.id }
    } finally { if (timer) clearTimeout(timer) }
  }
}
