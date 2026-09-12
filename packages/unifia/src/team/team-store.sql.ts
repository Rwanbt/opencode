/**
 * Durable Team persistence schema for D02.
 *
 * Payload columns are deliberately bounded JSON text: the database stores
 * state and references, never artifact contents or unbounded blobs.
 */
export const TEAM_STORE_MIGRATION_ID = "20260726193000_team_store" as const
export const TEAM_STORE_SCHEMA_VERSION = "1.0.0" as const
export const TEAM_STORE_MAX_JSON_BYTES = 64 * 1024
export const TEAM_STORE_MAX_EVENT_BYTES = 16 * 1024

export const TEAM_STORE_TABLES = [
  "team_store_meta",
  "team_runs",
  "team_tasks",
  "team_attempts",
  "team_locks",
  "team_gates",
  "team_events",
  "team_artifacts",
  "team_checkpoints",
  "team_audit",
] as const

export type TeamStoreTable = (typeof TEAM_STORE_TABLES)[number]
