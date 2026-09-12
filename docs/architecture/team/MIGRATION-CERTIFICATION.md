# Team V3 Migration Validation — 2026-07-29

Status: **LOCAL SCHEMA VALIDATION PASSED — NO DOWN-MIGRATION CLAIM**

Team has two distinct version domains:

- Durable SQLite store: `TEAM_STORE_SCHEMA_VERSION = 1.0.0`, migration id `20260726193000_team_store`. Migration is idempotent and preserves WAL, foreign keys, bounded JSON and monotonic events.
- Domain payloads: `TEAM_SCHEMA_VERSION = 2.0.0`. `Attempt` explicitly supports N-1 (`1.0.0`) through `loadAttempt`; malformed, missing and N-2 versions fail closed.

Verified by the Team store, type and checkpoint tests in the 814-test Team suite. Transaction rollback, replay, payload bounds and N-1 Attempt migration pass.

No generic down-migration exists for every Team schema, and this document does not claim one. Before a future SQLite schema bump, add an explicit backup/restore rehearsal and migration test against a copy of a real user database.
