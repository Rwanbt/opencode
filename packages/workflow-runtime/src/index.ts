/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `@unifia/workflow-runtime` — durable workflow runtime types and
 * implementations.
 *
 * - `adapter.ts` : `DurableHistoryAuthority` interface (substrate-agnostic).
 * - `in-memory.ts` : `InMemoryDurableHistoryAuthority` impl (M1-09).
 * - `file-backed.ts` : `FileBackedDurableHistoryAuthority` impl (M1-10)
 *   — wraps the in-memory impl with JSON snapshot persistence.
 * - `v1-migrating.ts` : `V1MigratingAuthority` (M1-11) — wraps any
 *   DurableHistoryAuthority and migrates V1 history records to V2.
 *
 * The legacy store-backed V2 approval broker is NOT re-exported here: it is
 * quarantined (LEGACY/TEST-ONLY, constructor-gated) and importable only via
 * its module path for the compatibility suites. ApprovalBrokerV4 is the
 * authority facade for production wiring.
 */
export * from "./adapter"
export * from "./in-memory"
export * from "./file-backed"
export * from "./v1-migrating"
export * from "./approval-v4"
// UNIFIA_NATIVE production durable authority (ADR-000 ratified 2026-09-05).
export * from "./native-history"
export * from "./native-approval-authority"
export * from "./native-attempts"