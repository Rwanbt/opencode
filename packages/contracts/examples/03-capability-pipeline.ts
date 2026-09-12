/* SPDX-License-Identifier: MIT */
/**
 * Example 03: CapabilityPort pipeline
 *
 * Demonstrates a multi-step capability pipeline:
 * 1. Search for a capability
 * 2. Authorize the request
 * 3. Execute (with handling)
 * 4. Cancel if needed
 *
 * Run with: bun run examples/03-capability-pipeline.ts
 */

import type {
  CapabilityPort,
  CapabilityDescriptor,
  CapabilityRequest,
  CapabilityExecution,
  AuthorizationDecision,
} from "../src/capability.js"

// === Implementation ===
class SimpleCapabilityRegistry implements CapabilityPort {
  private capabilities: Map<string, CapabilityDescriptor> = new Map()
  private audit: Map<string, boolean> = new Map() // WorkspaceId+capabilityId -> allowed

  register(desc: CapabilityDescriptor) {
    this.capabilities.set(desc.id, desc)
  }

  async search(query: { namePattern?: string; tags?: string[] }) {
    const results: CapabilityDescriptor[] = []
    for (const desc of this.capabilities.values()) {
      if (query.namePattern && !desc.name.includes(query.namePattern)) continue
      if (query.tags && !query.tags.some((t) => desc.tags.includes(t))) continue
      results.push(desc)
    }
    return results
  }

  async authorize(request: CapabilityRequest): Promise<AuthorizationDecision> {
    // Check if this is a previously-allowed capability
    const auditKey = `${request.context.workspaceId}:${request.capabilityId}`
    if (this.audit.get(auditKey)) {
      return { type: "allow" }
    }
    // Default: require approval for new capabilities
    return { type: "require-approval", approvers: ["user"] }
  }

  async execute(request: { capabilityId: string; inputs: any; context: any }): Promise<CapabilityExecution> {
    const executionId = `e_${Date.now()}`
    const desc = this.capabilities.get(request.capabilityId)
    if (!desc) {
      return {
        executionId,
        status: "failed",
        error: "Capability not found",
        startedAt: Date.now(),
        completedAt: Date.now(),
      }
    }
    // Simulate execution
    return {
      executionId,
      status: "completed",
      output: `Executed ${request.capabilityId} with ${JSON.stringify(request.inputs)}`,
      startedAt: Date.now(),
      completedAt: Date.now(),
    }
  }

  approve(workspaceId: string, capabilityId: string) {
    this.audit.set(`${workspaceId}:${capabilityId}`, true)
  }

  async cancel(_executionId: string): Promise<void> {
    // Mark as cancelled in real impl
  }
}

// === Usage ===
async function main() {
  const registry = new SimpleCapabilityRegistry()

  // Register capabilities
  registry.register({
    id: "unifia.document.docx",
    name: "DOCX Document",
    description: "Create DOCX documents",
    version: "1.0.0",
    author: "Unifia",
    license: "MIT",
    schema: {},
    tags: ["document", "office"],
    trustLevel: "official",
  })

  registry.register({
    id: "unifia.command.bash",
    name: "Bash Command",
    description: "Execute bash commands",
    version: "1.0.0",
    author: "Unifia",
    license: "MIT",
    schema: {},
    tags: ["shell"],
    trustLevel: "verified",
  })

  // 1. Search
  const docs = await registry.search({ tags: ["document"] })
  console.log("Found docs:", docs.length)

  // 2. Authorize
  const auth = await registry.authorize({
    capabilityId: "unifia.command.bash",
    inputs: { command: "ls" },
    context: { workspaceId: "ws1", userId: "u1" },
  })
  console.log("Auth decision:", auth)

  // 3. Approve (simulating user click)
  if (auth.type === "require-approval") {
    registry.approve("ws1", "unifia.command.bash")
    console.log("Capability approved")
  }

  // 4. Execute
  const result = await registry.execute({
    capabilityId: "unifia.command.bash",
    inputs: { command: "ls" },
    context: { workspaceId: "ws1", userId: "u1" },
  })
  console.log("Execution:", result.status, result.output)
}

main().catch(console.error)
