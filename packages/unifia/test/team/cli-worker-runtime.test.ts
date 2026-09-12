import { describe, expect, test } from "bun:test"
import { CliSandboxUnsupportedError, CliWorkerPolicyError, CliWorkerRuntime, type CliProcess, type CliProcessOutput, type CliWorkerAdapter, type CliWorkerRequest } from "../../src/team/cli-worker-runtime"

const request = (overrides: Partial<CliWorkerRequest> = {}): CliWorkerRequest => ({ executable: "C:\\Tools\\worker.exe", args: ["--task", "read"], cwd: "C:\\Work", allowedExecutables: ["C:\\Tools\\worker.exe"], supportedPlatforms: ["win32"], platform: "win32", mounts: [{ source: "C:\\Work\\input", target: "C:\\Sandbox\\input", readOnly: true }], network: { mode: "disabled" }, timeoutMs: 100, maxOutputBytes: 1000, ...overrides })

class FakeAdapter implements CliWorkerAdapter {
  killed: string[] = []
  collectedMaxOutputBytes = 0
  process: CliProcess = { id: "p-1" }
  output: CliProcessOutput = { exitCode: 0, stdout: "ok", stderr: "" }
  async spawn(): Promise<CliProcess> { return this.process }
  async collect(_process: CliProcess, maxOutputBytes: number): Promise<CliProcessOutput> { this.collectedMaxOutputBytes = maxOutputBytes; return this.output }
  async kill(_process: CliProcess, reason: "timeout" | "cancelled" | "output_limit"): Promise<void> { this.killed.push(reason) }
}

describe("CliWorkerRuntime", () => {
  test("runs only an allowlisted executable with explicit sandbox policy", async () => {
    const adapter = new FakeAdapter(); const result = await new CliWorkerRuntime().run(request(), adapter)
    expect(result.status).toBe("COMPLETED"); expect(result.exitCode).toBe(0); expect(result.status).toBe("COMPLETED"); expect(adapter.collectedMaxOutputBytes).toBe(1000); expect(adapter.killed).toEqual([])
  })
  test("rejects executable escape, traversal and shell/nested command arguments", async () => {
    const runtime = new CliWorkerRuntime(); const adapter = new FakeAdapter()
    await expect(runtime.run(request({ executable: "C:\\Tools\\other.exe" }), adapter)).rejects.toBeInstanceOf(CliWorkerPolicyError)
    await expect(runtime.run(request({ cwd: "C:\\Work\\..\\Secrets" }), adapter)).rejects.toBeInstanceOf(CliWorkerPolicyError)
    await expect(runtime.run(request({ args: ["-Command", "whoami"] }), adapter)).rejects.toBeInstanceOf(CliWorkerPolicyError)
  })
  test("fails closed on unsupported platforms", async () => {
    await expect(new CliWorkerRuntime().run(request({ platform: "darwin", supportedPlatforms: ["win32"] }), new FakeAdapter())).rejects.toBeInstanceOf(CliSandboxUnsupportedError)
  })
  test("kills once on timeout and cancellation", async () => {
    const timeoutAdapter = new FakeAdapter(); timeoutAdapter.collect = () => new Promise(() => {})
    const timeout = await new CliWorkerRuntime().run(request({ timeoutMs: 10 }), timeoutAdapter)
    expect(timeout.status).toBe("TIMED_OUT"); expect(timeoutAdapter.killed).toEqual(["timeout"])
    const cancelAdapter = new FakeAdapter(); cancelAdapter.collect = () => new Promise(() => {})
    const controller = new AbortController(); const pending = new CliWorkerRuntime().run(request(), cancelAdapter, controller.signal); controller.abort()
    const cancelled = await pending; expect(cancelled.status).toBe("CANCELLED"); expect(cancelAdapter.killed).toEqual(["cancelled"])
  })
  test("rejects raw secret-shaped auth and only accepts opaque unexpired handles", async () => {
    const runtime = new CliWorkerRuntime(); const adapter = new FakeAdapter()
    await expect(runtime.run(request({ authHandle: { handleId: "", providerID: "p", expiresAtUTC: "2026-07-28T00:00:00.000Z" } }), adapter)).rejects.toBeInstanceOf(CliWorkerPolicyError)
    await expect(runtime.run(request({ authHandle: { handleId: "h-raw", providerID: "p", expiresAtUTC: "2099-07-28T00:00:00.000Z", token: "secret" } as never }), adapter)).rejects.toBeInstanceOf(CliWorkerPolicyError)
    const result = await runtime.run(request({ authHandle: { handleId: "h-1", providerID: "p", expiresAtUTC: "2099-07-28T00:00:00.000Z" } }), adapter)
    expect(result.status).toBe("COMPLETED")
  })
  test("kills on bounded output overflow", async () => {
    const adapter = new FakeAdapter(); adapter.output = { exitCode: 0, stdout: "0123456789", stderr: "" }
    const result = await new CliWorkerRuntime().run(request({ maxOutputBytes: 4 }), adapter)
    expect(result.status).toBe("OUTPUT_LIMIT"); expect(adapter.killed).toEqual(["output_limit"])
  })
})