/* SPDX-License-Identifier: MIT */
/**
 * @unifia/contracts — Unifia Workbench contracts
 *
 * 6 ports du Plan V3 §7 :
 * - RuntimeAdapter (ADR-0001) — abstraction sur le runtime
 * - WorkspacePort (ADR-0002) — abstraction sur le storage
 * - CapabilityPort (ADR-0003) — abstraction sur les capabilities
 * - ArtifactPort (ADR-0004) — abstraction sur les artefacts
 * - SandboxPort (ADR-0005) — abstraction sur les backends d'isolation
 * - RemoteTransportPort (Plan V3 §7.6) — abstraction sur les transports distants
 *
 * Source : docs/autonomy/plans/P2-C200-contracts-unifia.md
 */
export * from "./runtime.js"
export * from "./workspace.js"
export * from "./capability.js"
export * from "./artifact.js"
export * from "./sandbox.js"
export * from "./remote.js"

export * from './p3.js'

export * from './p3-runtime.js'
export * from "./runtime-adapters.js"

export * from "./approval-broker.js"
export * from "./browser.js"
export * from "./desktop.js"
export * from "./capability-registry.js"
export * from "./mcp-ui.js"
export * from "./generative-ui.js"
export * from "./event-sequencer.js"
export * from "./design-system.js"

export * from "./artifact-manifest.js"
export * from "./secrets.js"

// M1 type contracts (Plan V2.3.1, ADR-001/002/005/008/010/020/022).
// Re-exports for the V2.3.1 foundation: workflow IR, digest envelope,
// scopes, at-rest protection, credential references, worker identity,
// timer policies, and the V2 artifact record contract. The V2 artifact
// record lives in `artifact-record.ts` to avoid clashing with the
// legacy P2-C200 `artifact.ts` (ArtifactPort).
export * from "./scope.js"
export * from "./workflow-ir.js"
export * from "./digest.js"
export * from "./protection.js"
export * from "./credential.js"
export * from "./identity.js"
export * from "./timer.js"
export * from "./artifact-record.js"
// C-M1-08 — Capability Authority enforcer contracts (Plan V2.3.1 §114, ADR-002/020/024).
// Discriminated-union result for `enforce(principal, capability, scope, trustClass, manifest)`.
export * from "./enforcement.js"

// C-M1-09 — WorkflowRun identities + durable history boundary contracts
// (Plan V2.3.1 §41-§43, M1 plan §3.9, ADR-004 + ADR-022). The
// `DurableHistoryAuthority` *interface* lives in
// `packages/workflow-runtime/src/adapter.ts` and waits ADR-000 for its
// physical implementation (Native / DBOS / Temporal). This re-export
// binds the Zod schemas (the contract half) into the package barrel.
export * from "./workflow-run.js"

// M2-TEST — graph-level well-formedness (Plan V2.3.1 §199, ADR-002).
// `workflow-ir.js` validates one node family at a time; `workflow-graph.js`
// validates the graph those nodes form. `workflow-map-key.js` owns the
// stable per-item key material (ADR-005) — split out because the digest
// layer consumes only that half, and it shares nothing with the validator.
// Both are pure and deterministic; the hash itself belongs to
// `@unifia/digest-runtime`, which depends on this package.
export * from "./workflow-graph.js"
export * from "./workflow-map-key.js"
