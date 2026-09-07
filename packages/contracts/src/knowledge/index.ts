/* SPDX-License-Identifier: MIT */
/**
 * @unifia/contracts — Knowledge contracts.
 *
 * Cross-package types for the Sovereign Knowledge Core V1. All
 * types in this directory are referenced by `packages/unifia`,
 * `packages/{app,desktop,mobile}`, the future
 * `crates/unifia-knowledge-core`, and any MCP server exposing
 * knowledge_* methods.
 *
 * Conventions:
 * - No runtime code, types and Zod schemas only.
 * - All identifiers use the `unifia_` prefix in the data, but
 *   TypeScript identifiers do not (they are `KnowledgeId`, not
 *   `UnifiaId`).
 * - All schemas are `.strict()`; unknown fields are rejected.
 * - No `any`. No `unknown` in exported types except in error
 *   context, where keys are constrained to string.
 */

export * from "./identity.js"
export * from "./space.js"
export * from "./restrictions.js"
export * from "./lifecycle.js"
export * from "./retrieval.js"
export * from "./mutation.js"
export * from "./context.js"
export * from "./native-port.js"
export * from "./errors.js"
export * from "./mcp.js"
