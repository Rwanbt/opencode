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
 */
export * from "./adapter"
export * from "./in-memory"
export * from "./file-backed"
export * from "./v1-migrating"
export * from "./approval-v2"
