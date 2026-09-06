/* SPDX-License-Identifier: MIT */

// V14.5 — mock workbench bridge for the design journey e2e.
//
// The harness injects this platform via the test hook in
// `entry.tsx` (window.__UNIFIA_PLATFORM__). The e2e spec calls
// `installWorkbenchMock(page)` from a `addInitScript` so the
// global is set BEFORE the app code runs.
//
// The mock covers enough of `WorkbenchClient` to render the
// design surface and exercise a single prompt → artifact round
// trip. It is intentionally NOT a full server: methods that the
// design journey does not call return empty defaults via the
// Proxy fallback. The goal is the test infrastructure; the full
// mock is a follow-up card.

import type { Page } from "@playwright/test"
export type WorkbenchMockOptions = {
  /** Manifests returned by listDesignSystems. Default: one empty system. */
  designSystems?: ReadonlyArray<{
    id: string
    name: string
    version: string
    source: string
    tokens: Record<string, unknown>
  }>
  /** Skills returned by listDesignSkills. Default: empty list. */
  skills?: ReadonlyArray<Record<string, unknown>>
  /** DA-UI-01 — capability grants reported by the mock connection. Default: empty (Automate hidden). */
  grants?: readonly string[]
  /**
   * DA-UI-02 — what exportArtifact answers.
   *
   *   "exported"           the nominal success envelope (default)
   *   "approval-required"  the 202 the broker returns when it gates the
   *                        operation, which is what opens the approval modal
   *   "error"              a rejection, which is the surface's failed state
   */
  exportOutcome?: "exported" | "approval-required" | "error"
  /** Decision returned by resolveApproval. Default "allow". */
  approvalDecision?: "allow" | "deny"
  /** Make cancelApproval reject, the way a broker that already expired it does. */
  cancelFails?: boolean
}

/** One recorded call on the mock client, in order. */
export interface MockCall {
  method: string
  args: readonly unknown[]
}

/**
 * Every client call the page made, oldest first.
 *
 * The approval journey is only meaningful if the browser actually reaches the
 * broker: a modal that closes without withdrawing the request leaves it
 * pending server-side, which is the defect DA-UI-02 was written for. Asserting
 * on the rendered state alone cannot see that.
 */
export async function readMockCalls(page: Page): Promise<MockCall[]> {
  return await page.evaluate(() => (window as unknown as { __UNIFIA_MOCK_CALLS__?: MockCall[] }).__UNIFIA_MOCK_CALLS__ ?? [])
}

/**
 * Install the mock onto the page. Must be called via
 * `addInitScript` so the global is set before the app code runs.
 */
export function workbenchMockInitScript(): string {
  // Returns a JavaScript string that the page side executes
  // via page.addInitScript. The descriptor is reconstructed
  // here; the actual client behaviour is implemented as a
  // lightweight in-page object that satisfies the structural
  // shape the app expects.
  return `
    (() => {
      const descriptor = window.__UNIFIA_MOCK_DESCRIPTOR__ || { designSystems: [], skills: [] }
      // The native bridge is asynchronous across an IPC/HTTP turn. Resolving
      // immediately in the current microtask re-enters Solid Query while it
      // is updating its observer and does not represent production timing.
      const reply = (value) => new Promise((resolve) => setTimeout(() => resolve(value), 0))
      // Recorded so a test can assert the browser reached the broker, not
      // merely that the modal closed.
      const calls = []
      window.__UNIFIA_MOCK_CALLS__ = calls
      const record = (method, args) => { calls.push({ method: method, args: args }) }
      let approvalCounter = 0
      const makeArtifact = (input) => {
        const id = input.artifactId || ("art-" + Math.random().toString(36).slice(2, 10))
        return {
          artifactId: id,
          version: 1,
          kind: input.kind,
          filename: input.filename,
          relativePath: "design/" + input.filename,
          sha256: "deadbeef",
          bytes: input.content.length,
          createdAt: Date.now(),
          metadata: input.metadata || {},
          provenance: input.provenance || {},
        }
      }
      // Keep the mock structurally close to a real client. A permissive Proxy
      // made every property lookup look like an async method, including
      // framework-internal probes, which caused a Solid update recursion.
      const client = {
        listDesignSystems: () => reply({ designSystems: descriptor.designSystems }),
        listDesignSkills: () => reply({ skills: descriptor.skills }),
        githubStatus: () => reply({ connected: false, configured: false }),
        validateSpec: (spec) => reply({ valid: true, spec, capabilities: { granted: [], denied: [] } }),
        createArtifact: (input) => {
          record("createArtifact", [input.kind, input.filename])
          return reply({ artifact: makeArtifact(input) })
        },
        exportArtifact: (_workspaceId, artifactId) => {
          record("exportArtifact", [artifactId])
          const outcome = descriptor.exportOutcome || "exported"
          if (outcome === "error") return Promise.reject(new Error("mock export refused"))
          if (outcome === "approval-required") {
            approvalCounter += 1
            return reply({ approvalId: "apr-" + approvalCounter })
          }
          return reply({ exported: { artifactId, version: 1, relativePath: "design/out.svg", sha256: "deadbeef", metadata: {} } })
        },
        resolveApproval: (approvalId, decision) => {
          record("resolveApproval", [approvalId, decision])
          return reply({ decision: { kind: descriptor.approvalDecision || "allow" } })
        },
        cancelApproval: (approvalId) => {
          record("cancelApproval", [approvalId])
          if (descriptor.cancelFails) return Promise.reject(new Error("mock broker refused the cancellation"))
          return reply({ cancelled: true })
        },
        artifactHistory: () => reply({ history: [] }),
        listArtifacts: () => reply({ artifacts: [] }),
        listDocuments: () => reply({ documents: [] }),
        listFiles: () => reply({ entries: [], skipped: 0 }),
        readFiles: () => reply({ results: [] }),
        listApprovals: () => reply({ approvals: [] }),
        trace: () => reply({ kind: "trace", events: [], nextCursor: null }),
        activity: () => reply({ kind: "activity", events: [], nextCursor: null }),
        searchCapabilities: () => reply({ records: [] }),
        events: async function* (_workspaceId, _dispatcher, signal) {
          if (!signal) return
          await new Promise((resolve) => {
            if (signal.aborted) return resolve()
            signal.addEventListener("abort", resolve, { once: true })
          })
        },
        current: () => undefined,
        refresh: async () => "",
      }
      const connection = {
        client,
        serverOrigin: "mock://workbench",
        instanceId: "mock-instance-1",
        workspaceId: descriptor.workspaceId || "mock-workspace-1",
        // DA-UI-01 — capability-gated UI (Automate rail entry, …) reads
        // the connection's \`grants\` to decide visibility. The mock
        // starts empty; tests that need \`workflow.run\` etc. inject a
        // populated set via \`installWorkbenchMock({ grants: [...] })\`.
        grants: new Set(descriptor.grants || []),
        async revoke() {
          // No-op: the mock does not own any native resource.
        },
      }
      window.__UNIFIA_PLATFORM__ = { workbench: { connect: async () => connection } }
    })()
  `
}

export async function installWorkbenchMock(
  page: Page,
  opts: WorkbenchMockOptions & { workspaceId?: string } = {},
): Promise<void> {
  const descriptor = {
    designSystems: opts.designSystems ?? [
      {
        id: "test-system",
        name: "Test system",
        version: "1.0.0",
        source: "test",
        tokens: { colors: {}, spacing: {}, typography: {} },
      },
    ],
    skills: opts.skills ?? [],
    workspaceId: opts.workspaceId ?? "mock-workspace-1",
    exportOutcome: opts.exportOutcome ?? "exported",
    approvalDecision: opts.approvalDecision ?? "allow",
    cancelFails: opts.cancelFails ?? false,
  }
  // Pass the descriptor through a single init script so the
  // page side can read it. Two scripts: first sets the
  // descriptor, second reads it and builds the platform.
  await page.addInitScript((value) => {
    ;(window as unknown as { __UNIFIA_MOCK_DESCRIPTOR__: unknown }).__UNIFIA_MOCK_DESCRIPTOR__ = value
  }, { ...descriptor, grants: opts.grants ?? [] })
  await page.addInitScript({
    content: workbenchMockInitScript(),
  })
}
