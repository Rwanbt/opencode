/**
 * @deprecated Re-exports from @opencode-ai/sdk-shared. Consumers should
 * import directly from "@opencode-ai/sdk-shared" in new code. This file
 * remains for backward compatibility with the ~fewer existing call-sites
 * in packages/ui/src.
 *
 * Phase 7.x cleanup: replace remaining relative imports
 * (`from "../types/sdk-shim"`) with the canonical shared import.
 *
 * Prior to Phase 7.2, this file was a 134-LOC hand-curated mirror of
 * packages/app/src/types/sdk-shim.ts. It became a 1-line re-export once
 * Option X (workspace package) landed — see Plan-Correction-Phase7 §7.2.4.
 *
 * Side fix: the previous ui shim did `export * from "@opencode-ai/sdk/v2"`
 * (without the /client subpath) while the app shim used `/v2/client`.
 * After Phase 4.3 regen, only `/v2/client` re-exports the route-shaped
 * types — the bare `/v2` entry point re-exports only the runtime client
 * and server. The shared package uses `/v2/client`, so this fix lands
 * implicitly with the re-export migration.
 */
export * from "@opencode-ai/sdk-shared"