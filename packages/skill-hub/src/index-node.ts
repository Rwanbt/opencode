/* SPDX-License-Identifier: MIT */

/**
 * Node-only entry of `@unifia/skill-hub`.
 *
 * WHY a separate entry: `InMemorySkillRegistry` uses `node:crypto` to
 * verify skill digests. Surfacing it from the main entry would break
 * the web UI bundle (Vite externalizes `node:crypto` and the stub
 * does not export `createHash`). Server routes and the hardening
 * test suite import the registry through this sub-export.
 */

export * from "./index.js"
export { InMemorySkillRegistry } from "./registry.js"
export { discoverTemplates, templateReferenceLooksRenderable, type DiscoveredTemplate, type TemplateRegistryResult } from "./template-registry.js"
