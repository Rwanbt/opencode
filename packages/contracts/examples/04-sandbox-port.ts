/* SPDX-License-Identifier: MIT */
/**
 * Example 04: SandboxPort — Multi-backend isolation
 *
 * Demonstrates how to use the SandboxPort for safe code execution
 * across multiple backends (native, docker, wsl2, lima).
 *
 * Run with: bun run examples/04-sandbox-port.ts
 */

import type {
  SandboxPort,
  SandboxBackendInfo,
  SandboxPolicy,
  SandboxHandle,
  Execution,
} from "../src/sandbox.js"

// === Step 1: Define a Multi-backend sandbox router ===
class MultiBackendSandbox implements SandboxPort {
  private backends: Map<string, (handle: SandboxHandle, req: any) => Promise<Execution>> = new Map()

  registerBackend(name: string, executor: (h: SandboxHandle, req: any) => Promise<Execution>) {
    this.backends.set(name, executor)
    return this
  }

  async inspect(): Promise<SandboxBackendInfo[]> {
    const features = this.backends.keys()
    return Array.from(features).map((backend) => ({
      backend: backend as any,
      available: true,
      version: "1.0.0",
      features: ["file.read", "file.write", "command.run"],
    }))
  }

  async prepare(policy: SandboxPolicy): Promise<SandboxHandle> {
    if (!this.backends.has(policy.backend)) {
      throw new Error(`Backend ${policy.backend} not available`)
    }
    return {
      id: `s_${Date.now()}_${policy.backend}`,
      backend: policy.backend,
      createdAt: Date.now(),
      policy,
    }
  }

  async execute(handle: SandboxHandle, request: any): Promise<Execution> {
    const backend = this.backends.get(handle.backend)
    if (!backend) {
      throw new Error(`Backend ${handle.backend} not registered`)
    }
    return backend(handle, request)
  }

  async terminate(handle: SandboxHandle): Promise<void> {
    console.log(`Sandbox ${handle.id} terminated`)
  }
}

// === Step 2: Define backends ===
const sandbox = new MultiBackendSandbox()

sandbox.registerBackend("native", async (_handle, request) => {
  console.log(`[native] Executing: ${request.command} ${request.args.join(" ")}`)
  return {
    exitCode: 0,
    stdout: `native: ${request.command} executed`,
    stderr: "",
    durationMs: 12,
  }
})

sandbox.registerBackend("docker", async (_handle, request) => {
  console.log(`[docker] Container: ${request.command} ${request.args.join(" ")}`)
  return {
    exitCode: 0,
    stdout: `docker: ${request.command} executed in container`,
    stderr: "",
    durationMs: 245,
  }
})

sandbox.registerBackend("wsl2", async (_handle, request) => {
  console.log(`[wsl2] WSL: ${request.command}`)
  return {
    exitCode: 0,
    stdout: `wsl2: ${request.command} executed in WSL`,
    stderr: "",
    durationMs: 1024,
  }
})

// === Step 3: Use it ===
async function main() {
  // Inspect
  const backends = await sandbox.inspect()
  console.log("Available backends:", backends.map((b) => b.backend).join(", "))

  // Choose backend
  const backend = "docker" as const
  console.log(`\nUsing backend: ${backend}`)

  // Prepare
  const policy: SandboxPolicy = {
    backend,
    network: "none", // default-deny
    filesystem: { readOnly: true },
    resources: { cpu: 1, memoryMb: 512, timeoutMs: 30000 },
  }
  const handle = await sandbox.prepare(policy)
  console.log("Sandbox prepared:", handle.id)

  // Execute
  const result = await sandbox.execute(handle, {
    command: "ls",
    args: ["-la"],
  })
  console.log("Result:", result)

  // Cleanup
  await sandbox.terminate(handle)
  console.log("Done")
}

main().catch(console.error)
