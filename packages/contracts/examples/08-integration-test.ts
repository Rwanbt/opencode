/* SPDX-License-Identifier: MIT */
/**
 * Example 08: Complete integration test
 *
 * Shows how to wire all 6 ports together for a complete end-to-end test.
 *
 * Run with: bun run examples/08-integration-test.ts
 */

import type {
  RuntimeAdapter,
  WorkspacePort,
  CapabilityPort,
  ArtifactPort,
  SandboxPort,
} from "../src/index.js"

/**
 * Integration scenario:
 * 1. Open a workspace
 * 2. Create a session
 * 3. Send a prompt
 * 4. Execute a capability (bash)
 * 5. Create an artifact
 * 6. Render the artifact
 * 7. Export the artifact
 */

// === 1. Workspace ===
class MemWorkspace implements WorkspacePort {
  private files = new Map<string, string>()
  async register(input: { name: string; path: string }) {
    return {
      id: "w1",
      name: input.name,
      path: input.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }
  async open(id: string) {
    return { id, token: "tok" }
  }
  async read(_: string, paths: string[]) {
    return paths.map((p) => ({
      path: p,
      content: this.files.get(p) || "",
      mime: "text/plain",
      size: 0,
    }))
  }
  async write(_: string, writes: any[]) {
    return writes.map((w) => {
      const c = typeof w.content === "string" ? w.content : ""
      this.files.set(w.path, c)
      return { path: w.path, bytesWritten: c.length, sha: "x" }
    })
  }
  async list() { return [] }
  async search() { return [] }
  async *watch() {}
  async close() {}
}

// === 2. Runtime ===
class FakeRuntime implements RuntimeAdapter {
  async getInfo() {
    return { id: "fake" as const, version: "1.0.0", capabilities: ["*"], healthy: true }
  }
  async listSessions() {
    return []
  }
  async createSession(_input: { workspaceId: string }) {
    return {
      id: "s1",
      workspaceId: "w1",
      runtimeId: "fake" as const,
      createdAt: Date.now(),
      messageCount: 0,
    }
  }
  async sendPrompt(_input: { sessionId: string; prompt: string }) {}
  async *subscribeEvents() {
    yield {
      sessionId: "s1",
      type: "text" as const,
      data: "Result",
      timestamp: Date.now(),
    }
  }
  async cancelSession() {}
}

// === 3. Capability ===
class FakeCapability implements CapabilityPort {
  async search() {
    return []
  }
  async authorize(_request: any) {
    return { type: "allow" as const }
  }
  async execute(request: any) {
    return {
      executionId: "e1",
      status: "completed" as const,
      output: `Executed ${request.capabilityId}`,
      startedAt: Date.now(),
    }
  }
  async cancel() {}
}

// === 4. Artifact ===
class FakeArtifact implements ArtifactPort {
  async create(input: any) {
    return {
      id: "a1",
      type: input.type,
      content: input.content,
      metadata: {},
      createdAt: Date.now(),
    }
  }
  async version(input: any) {
    return {
      artifactId: input.artifactId,
      version: 1,
      content: input.content,
      createdAt: Date.now(),
    }
  }
  async render(_input: any) {
    return {
      format: "pdf",
      content: new Uint8Array(),
      renderTime: 0,
    }
  }
  async export(_input: any) {
    return {
      destination: "/tmp/a1.pdf",
      size: 1024,
      exportedAt: Date.now(),
    }
  }
}

// === 5. Sandbox ===
class FakeSandbox implements SandboxPort {
  async inspect() {
    return []
  }
  async prepare(policy: any) {
    return { id: "s1", backend: policy.backend, createdAt: Date.now(), policy }
  }
  async execute(_handle: any, _req: any) {
    return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 10 }
  }
  async terminate(_handle: any) {}
}

// === Main integration ===
async function main() {
  console.log("=== Unifia Integration Test ===\n")

  const ws = new MemWorkspace()
  const runtime = new FakeRuntime()
  const cap = new FakeCapability()
  const artifact = new FakeArtifact()
  const _sandbox = new FakeSandbox()

  // 1. Open workspace
  console.log("1. Open workspace")
  const workspace = await ws.register({ name: "demo", path: "/tmp/demo" })
  const handle = await ws.open(workspace.id)
  console.log(`   workspace: ${workspace.id}`)

  // 2. Create session
  console.log("\n2. Create session")
  const session = await runtime.createSession({ workspaceId: workspace.id })
  console.log(`   session: ${session.id}`)

  // 3. Send prompt
  console.log("\n3. Send prompt")
  await runtime.sendPrompt({ sessionId: session.id, prompt: "Create a README" })
  console.log("   prompt sent")

  // 4. Execute capability (bash to make a file)
  console.log("\n4. Execute capability")
  const authz = await cap.authorize({
    capabilityId: "unifia.command.bash",
    inputs: { command: "echo hello" },
    context: { workspaceId: workspace.id, userId: "u1" },
  })
  console.log(`   authorize: ${authz.type}`)
  const exec = await cap.execute({
    capabilityId: "unifia.command.bash",
    inputs: { command: "echo hello" },
    context: { workspaceId: workspace.id, userId: "u1" },
  })
  console.log(`   execute: ${exec.status}`)

  // 5. Write file via workspace
  console.log("\n5. Write file via workspace")
  await ws.write(handle.id, [
    { path: "README.md", content: "# Hello from Unifia" },
  ])
  const files = await ws.read(handle.id, ["README.md"])
  console.log(`   file: ${files[0].path}`)

  // 6. Create artifact
  console.log("\n6. Create artifact")
  const art = await artifact.create({
    type: "text",
    content: "# Hello",
  })
  console.log(`   artifact: ${art.id}`)

  // 7. Render
  console.log("\n7. Render artifact")
  const render = await artifact.render({
    artifactId: art.id,
    format: "pdf",
  })
  console.log(`   rendered: ${render.format}`)

  // 8. Export
  console.log("\n8. Export artifact")
  const exported = await artifact.export({
    artifactId: art.id,
    destination: { type: "filesystem", path: "/tmp/README.pdf" },
  })
  console.log(`   exported: ${exported.destination}`)

  console.log("\n✅ Integration test PASSED")
}

main().catch(console.error)
