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
export * from "./scope.js"
export * from "./digest.js"
export * from "./protection.js"
export * from "./credential.js"
export * from "./identity.js"
export * from "./timer.js"
export * from "./artifact-record.js"
export * from "./enforcement.js"
export * from "./workflow-ir.js"
export * from "./workflow-run.js"
export * from "./workflow-map-key.js"
export * from "./workflow-graph.js"
