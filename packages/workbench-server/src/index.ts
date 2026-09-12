/* SPDX-License-Identifier: MIT */
/**
 * Public surface of `@unifia/workbench-server`.
 *
 * The implementation lives in sibling files; this module is a thin
 * re-export so existing imports (`@unifia/workbench-server`) continue
 * to work after the structural refactor that split the 1368-line
 * monolith into one-file-per-responsibility units.
 */
export * from "./auth.js"
export * from "./security.js"
export * from "./operations.js"
export * from "./logging.js"
export * from "./types.js"
export * from "./constants.js"
export { sseFrame } from "./workspace-events.js"
export { WorkbenchServer } from "./server.js"
export { ApprovalCapabilityGate } from "./approval-gate.js"
