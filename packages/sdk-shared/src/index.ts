/**
 * @opencode-ai/sdk-shared — workspace package shared across app/ui/plugin/opencode.
 *
 * Phase 7.2: single source of truth for the SDK type shim. Prior to this
 * package, packages/app/src/types/sdk-shim.ts and packages/ui/src/types/sdk-shim.ts
 * were maintained as independent mirrors with manual sync. The plugin and
 * backend (packages/opencode) each had their own ad-hoc shims.
 *
 * With Option X locked in (2026-06-26 01h22), this package consolidates the
 * shim so all consumers import from "@opencode-ai/sdk-shared". Drift between
 * the app and ui shims becomes structurally impossible (single source).
 *
 * Public surface:
 *   - this file re-exports the SDK client + the structural aliases
 *   - consumers can swap `from "@opencode-ai/sdk/v2"` for `from "@opencode-ai/sdk-shared"`
 *     to access both the SDK route types and the legacy top-level aliases.
 *
 * When to delete: once consumers import model types from a stable location
 * (e.g. a dedicated `@opencode-ai/sdk/v2/model` subpath backed by the backend
 * Zod schema). At that point the structural aliases become unnecessary.
 */

export * from "@opencode-ai/sdk/v2/client"
export * from "./types/sdk-shim.js"