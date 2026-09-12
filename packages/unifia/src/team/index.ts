/**
 * index.ts — TEAM-G01 + TEAM-G02
 *
 * Public entry point for the team package. Re-exports the runtime API used
 * by tests, CLI, and downstream workers.
 */

export * from "./lock-manager";
export * from "./fencing";
export * from "./scope-monitor";
export * from "./worktree-manager";
export * from "./hooks";
export * from "./application-service";
export * from "./run-registry";
export { TeamModelSchema, TeamSelectionSchema, TeamSelection, TeamSelectionStore } from "./selection";
// team-cli is intentionally NOT re-exported here because it calls process.exit.
