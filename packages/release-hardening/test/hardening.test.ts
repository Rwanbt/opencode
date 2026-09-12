/* SPDX-License-Identifier: MIT */
import { strict as assert } from "node:assert"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { FakeRuntimeAdapter, SessionEventHub, type RuntimeAdapter } from "@unifia/contracts"
import { DocumentPackRegistry, registerBuiltInDocumentWorkers } from "@unifia/document-packs"
import { WorkbenchOrchestrator } from "@unifia/workbench-orchestrator"
import { WorkspaceRuntime } from "@unifia/workspace-runtime"
import { ArtifactStore } from "@unifia/artifact-runtime"
import { assertMatrixMatchesPlan, formatReport, runHardeningMatrix, type HardeningEntry } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-hardening-"))

/** A runtime that fails partway, to prove a crash surfaces instead of hanging. */
const crashingRuntime = (): RuntimeAdapter => ({
  getInfo: async () => ({ id: "fake", version: "crashing", capabilities: [], healthy: true }),
  listSessions: async () => [],
  createSession: async (input) => ({ id: "s-crash", workspaceId: input.workspaceId, runtimeId: "fake", createdAt: 1, messageCount: 0 }),
  sendPrompt: async () => { throw new Error("runtime crashed mid-prompt") },
  subscribeEvents: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error("runtime crashed mid-stream") } }) }),
  cancelSession: async () => {},
})

const entries: HardeningEntry[] = [
  // --- Runtime conformance ---------------------------------------------------
  { suite: "runtime-conformance", scenario: "OpenCode adapter", kind: "covered", by: "@unifia/runtime-conformance", note: "10 scenarios over the delegating adapter" },
  { suite: "runtime-conformance", scenario: "Unifia adapter", kind: "covered", by: "@unifia/runtime-conformance", note: "same 10 scenarios" },
  { suite: "runtime-conformance", scenario: "fake adapter", kind: "covered", by: "@unifia/runtime-conformance", note: "same 10 scenarios" },
  { suite: "runtime-conformance", scenario: "N-1 protocol", kind: "blocked", reason: "no N-1 protocol version exists yet; there is nothing to be compatible with" },

  // --- Imported capability regression -----------------------------------------
  { suite: "imported-capability", scenario: "document packs", kind: "covered", by: "@unifia/document-packs", note: "6 packs, golden hashes" },
  { suite: "imported-capability", scenario: "sandbox backends", kind: "covered", by: "@unifia/sandbox-drivers", note: "native and wsl2 execute, docker refuses when absent" },
  { suite: "imported-capability", scenario: "remote transports", kind: "covered", by: "@unifia/contracts remote-broker-smoke", note: "pairing, replay, rate limit, kill switch" },
  { suite: "imported-capability", scenario: "computer use", kind: "covered", by: "@unifia/computer-use-safety", note: "observation receipts, 7 refusal reasons" },
  { suite: "imported-capability", scenario: "file sessions", kind: "covered", by: "@unifia/workbench-server", note: "scoped tokens, revoked on shutdown" },

  // --- Supply chain --------------------------------------------------------------
  { suite: "supply-chain", scenario: "provenance completeness", kind: "covered", by: "scripts/unifia-conformance.mjs", note: "SPDX headers over owned sources" },
  { suite: "supply-chain", scenario: "forbidden path /ee", kind: "covered", by: "scripts/unifia-conformance.mjs", note: "segment match plus excluded-import scan" },
  { suite: "supply-chain", scenario: "detached signatures", kind: "blocked", reason: "signing keys are not on this machine and must not be" },
  {
    suite: "supply-chain",
    scenario: "hashes",
    kind: "executed",
    run: async () => {
      const store = new ArtifactStore(root, () => 1_000)
      const artifact = await store.create({ kind: "text", filename: "hashed.txt", content: "content under hash" })
      assert.equal(artifact.sha256.length, 64, "artefact hash is not a sha256")
      const readBack = await store.read(artifact)
      assert.equal(new TextDecoder().decode(readBack), "content under hash", "hash-verified read returned the wrong bytes")
      // Corrupt the recorded hash: the read must refuse rather than serve.
      await assert.rejects(() => store.read({ ...artifact, sha256: "0".repeat(64) }), /hash mismatch/, "a mismatched hash was served")
    },
  },
  { suite: "supply-chain", scenario: "SBOM", kind: "covered", by: "docs/autonomy/SBOM-cyclonedx.json", note: "present; regeneration is a release step" },
  {
    suite: "supply-chain",
    scenario: "binary inventory",
    kind: "executed",
    run: async () => {
      // Every dependency of an owned package must be workspace, catalog or exactly pinned.
      const manifest = JSON.parse(await Bun.file(path.join(import.meta.dirname, "..", "package.json")).text()) as { dependencies?: Record<string, string> }
      for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
        assert.ok(range.startsWith("workspace:") || range === "catalog:" || /^\d/.test(range), `${name} is not pinned: ${range}`)
      }
    },
  },
  { suite: "supply-chain", scenario: "reproducibility", kind: "covered", by: "docs/autonomy/reports/REPO-TOPOLOGY-2026-08-04.md", note: "rootfs rebuilt to 0.02 percent; bit-for-bit blocked by unpinned apk revisions" },
  {
    suite: "supply-chain",
    scenario: "malicious update manifest",
    kind: "executed",
    run: async () => {
      const { InMemorySkillRegistry } = await import("@unifia/skill-hub/node")
      const registry = new InMemorySkillRegistry(() => 1_000)
      const artifact = new TextEncoder().encode("payload")
      // A manifest whose digest does not match its artefact is refused.
      await assert.rejects(
        () => registry.publish({ manifest: { name: "evil-skill", version: "1.0.0", digest: "f".repeat(64), trust: "untrusted", tags: [], capabilities: [] }, artifact }),
        /digest does not match/,
        "a manifest lying about its artefact digest was published",
      )
      // A manifest claiming trust without a signature is refused.
      const { createHash } = await import("node:crypto")
      const digest = createHash("sha256").update(artifact).digest("hex")
      await assert.rejects(
        () => registry.publish({ manifest: { name: "trusted-lie", version: "1.0.0", digest, trust: "official", tags: [], capabilities: [] }, artifact }),
        /signature required/,
        "a manifest claiming official trust without a signature was published",
      )
    },
  },

  // --- Security ---------------------------------------------------------------------
  { suite: "security", scenario: "remote replay", kind: "covered", by: "@unifia/contracts remote-broker-smoke", note: "nonce and timestamp anti-replay" },
  { suite: "security", scenario: "webhook forgery", kind: "covered", by: "packages/slack and packages/function", note: "provider-specific signature verification" },
  { suite: "security", scenario: "screenshot secret leakage", kind: "covered", by: "@unifia/computer-use-safety", note: "typing into a secret field is refused outright" },
  { suite: "security", scenario: "visual prompt injection", kind: "covered", by: "@unifia/computer-use-safety", note: "6 injection families; acting on a flagged screen is refused" },
  { suite: "security", scenario: "window focus swap", kind: "covered", by: "@unifia/computer-use-safety", note: "observation receipts invalidated by identity or focus change" },
  {
    suite: "security",
    scenario: "symlink/junction escape",
    kind: "executed",
    run: async () => {
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "unifia-escape-"))
      const outside = await mkdtemp(path.join(os.tmpdir(), "unifia-outside-"))
      await writeFile(path.join(outside, "secret.txt"), "outside the workspace")
      await writeFile(path.join(workspaceRoot, "inside.txt"), "inside")
      let linked = true
      try {
        await symlink(outside, path.join(workspaceRoot, "escape"), "dir")
      } catch {
        // Windows without developer mode refuses symlink creation for a non-admin.
        linked = false
      }
      const workspace = new WorkspaceRuntime()
      const registered = await workspace.register({ name: "escape", path: workspaceRoot })
      const handle = await workspace.open(registered.id)
      await assert.rejects(() => workspace.read(handle.token, ["../outside.txt"]), "a parent-directory traversal was served")
      if (linked) await assert.rejects(() => workspace.read(handle.token, ["escape/secret.txt"]), "a symlink escape was served")
      const inside = await workspace.read(handle.token, ["inside.txt"])
      assert.equal(inside.length, 1, "a legitimate in-workspace read was refused")
      await workspace.close(handle.token)
      await Promise.all([rm(workspaceRoot, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })])
    },
  },
  { suite: "security", scenario: "zip-slip", kind: "covered", by: "@unifia/document-packs inspectStoredZip", note: "traversal names and malformed archives refused" },
  {
    suite: "security",
    scenario: "office macro handling",
    kind: "executed",
    run: async () => {
      const { createStoredZip } = await import("@unifia/document-packs")
      const { previewArtifact, UnsafeDocumentError } = await import("@unifia/artifact-studio")
      const macroDoc = createStoredZip([
        { name: "[Content_Types].xml", content: "<Types/>" },
        { name: "word/document.xml", content: "<w:document><w:body><w:t>text</w:t></w:body></w:document>" },
        { name: "word/vbaProject.bin", content: "MZ" },
      ])
      assert.throws(() => previewArtifact("docx", macroDoc), UnsafeDocumentError, "a macro-bearing document was previewed")
    },
  },
  { suite: "security", scenario: "sandbox fallback downgrade", kind: "covered", by: "@unifia/sandbox-drivers", note: "an unavailable backend throws instead of becoming a weaker one" },
  { suite: "security", scenario: "secret + network exfiltration", kind: "covered", by: "@unifia/contracts p3-lot3-smoke", note: "taint veto denies secret.read combined with network.request" },
  { suite: "security", scenario: "package install escalation", kind: "covered", by: "@unifia/contracts p3-lot3-smoke", note: "package.install combined with desktop.control is denied" },

  // --- Reliability ---------------------------------------------------------------------
  {
    suite: "reliability",
    scenario: "crash orchestrator",
    kind: "executed",
    run: async () => {
      const runtime = new FakeRuntimeAdapter(() => 1_000)
      const orchestrator = new WorkbenchOrchestrator(runtime)
      orchestrator.open("ws-a")
      await orchestrator.router.createSession("ws-a")
      // Losing the orchestrator must not take the runtime with it.
      orchestrator.shutdown()
      const survivor = new WorkbenchOrchestrator(runtime)
      survivor.open("ws-a")
      const session = await survivor.router.createSession("ws-a")
      assert.equal(session.workspaceId, "ws-a", "the runtime did not survive an orchestrator restart")
    },
  },
  {
    suite: "reliability",
    scenario: "crash runtime",
    kind: "executed",
    run: async () => {
      const orchestrator = new WorkbenchOrchestrator(crashingRuntime())
      orchestrator.open("ws-a")
      const session = await orchestrator.router.createSession("ws-a")
      await assert.rejects(() => orchestrator.router.sendPrompt("ws-a", { sessionId: session.id, prompt: "x" }), /crashed mid-prompt/, "a runtime crash was swallowed")
      const iterator = orchestrator.router.subscribeEvents("ws-a", session.id)[Symbol.asyncIterator]()
      await assert.rejects(() => iterator.next(), /crashed mid-stream/, "a crash mid-stream hung instead of surfacing")
      const health = await orchestrator.health()
      assert.equal(health.openWorkspaces, 1, "the orchestrator lost its bookkeeping when the runtime crashed")
    },
  },
  {
    suite: "reliability",
    scenario: "crash worker document",
    kind: "executed",
    run: async () => {
      const store = new ArtifactStore(root, () => 2_000)
      const registry = new DocumentPackRegistry(store)
      registerBuiltInDocumentWorkers(registry)
      const manifest = registry.manifest("unifia.document.pdf")
      assert.ok(manifest, "the pdf manifest is missing")
      registry.register(manifest, async () => { throw new Error("worker crashed") })
      await assert.rejects(() => registry.execute("unifia.document.pdf", "ws-1", "input"), /worker crashed/, "a worker crash was swallowed")
      // The registry must still serve other packs after one worker died.
      const ok = await registry.execute("unifia.document.docx", "ws-1", "still working")
      assert.equal(ok.kind, "docx", "a crashed worker took the registry down with it")
    },
  },
  { suite: "reliability", scenario: "crash WSL2/Lima/Docker", kind: "covered", by: "@unifia/sandbox-drivers", note: "an unresponsive backend raises SandboxUnavailableError at prepare" },
  {
    suite: "reliability",
    scenario: "network interruption",
    kind: "executed",
    run: async () => {
      // An interrupted reader resumes from its cursor without losing events.
      const hub = new SessionEventHub()
      hub.publish({ sessionId: "s", type: "text", data: "one", timestamp: 1 })
      const reader = hub.subscribe(0)[Symbol.asyncIterator]()
      const first = await reader.next()
      assert.equal(first.value?.data, "one", "the first event was not delivered")
      await reader.return?.()
      hub.publish({ sessionId: "s", type: "text", data: "during outage", timestamp: 2 })
      const resumed = hub.subscribe(first.value?.sequence ?? 0)[Symbol.asyncIterator]()
      const missed = await resumed.next()
      assert.equal(missed.value?.data, "during outage", "an event published during the outage was lost")
      await resumed.return?.()
    },
  },
  { suite: "reliability", scenario: "remote reconnect", kind: "covered", by: "@unifia/workbench-server", note: "SSE Last-Event-ID resumes from the cursor" },
  { suite: "reliability", scenario: "event replay", kind: "covered", by: "@unifia/contracts event-sequencer", note: "25 checks; a cursor outside the window raises EventGapError" },
  {
    suite: "reliability",
    scenario: "workspace switch during execution",
    kind: "executed",
    run: async () => {
      const orchestrator = new WorkbenchOrchestrator(new FakeRuntimeAdapter(() => 1_000))
      orchestrator.open("ws-a")
      orchestrator.open("ws-b")
      const session = await orchestrator.router.createSession("ws-a")
      const stream = orchestrator.router.subscribeEvents("ws-a", session.id)[Symbol.asyncIterator]()
      const pending = stream.next()
      // Switch workspace while a stream is live, then feed the original session.
      orchestrator.use("ws-b")
      await orchestrator.router.createSession("ws-b")
      await orchestrator.router.sendPrompt("ws-a", { sessionId: session.id, prompt: "still mine" })
      const event = await Promise.race([pending, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stream stalled after a workspace switch")), 5_000))])
      assert.equal(event.value?.data, "still mine", "a workspace switch disturbed a live stream")
      await stream.return?.()
    },
  },
]

try {
  assertMatrixMatchesPlan(entries)
  const report = await runHardeningMatrix(entries)
  process.stdout.write(`${formatReport(report)}\n`)
  if (!report.passed) throw new Error(`${report.failed} hardening scenario(s) failed`)
  const total = report.executed + report.covered + report.blocked
  console.log(`ReleaseHardening: ${total}/${total} scenarios accounted for (${report.executed} executed, ${report.covered} covered elsewhere, ${report.blocked} blocked externally)`)
} finally {
  await rm(root, { recursive: true, force: true })
}
