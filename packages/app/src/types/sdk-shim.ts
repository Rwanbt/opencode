/**
 * @deprecated Re-exports from @opencode-ai/sdk-shared. Consumers should
 * import directly from "@opencode-ai/sdk-shared" in new code. This file
 * remains for backward compatibility with the ~163 existing call-sites in
 * packages/app/src.
 *
 * Phase 7.x cleanup: replace remaining relative imports
 * (`from "../types/sdk-shim"`) with the canonical shared import.
 *
 * Prior to Phase 7.2, this file was a 259-LOC hand-curated mirror of the
 * SDK route shapes. It became a 1-line re-export once Option X (workspace
 * package) landed — see Plan-Correction-Phase7 §7.2.3.
 */
export * from "@opencode-ai/sdk-shared"