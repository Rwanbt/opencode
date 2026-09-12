/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `@unifia/automate-m0-harness/qualification` — substrate-neutral
 * qualification harness (ADR-000 §6, post review v1.1).
 *
 * Drives a candidate durable authority through the M0 functional
 * criteria. No candidate-specific logic lives in this module; the
 * two adapters (`adapters/native-sqlite.ts`,
 * `adapters/dbos-go.ts`) are interchangeable at this boundary.
 *
 * Per pack gelé §4 (interdiction de pré-sélection) :
 *   - Common oracle != candidate implementation
 *   - 51/51 tests in `..` (minimal-substrate) are feasibility, not
 *     this qualification
 *   - Both candidates use the same fixtures and the same result schema
 */
export * from "./contract.ts"
export * from "./result.ts"
export * from "./runner.ts"
export * from "./vectors/fc31-fixtures.ts"
export * from "./providers/fake-external.ts"
export * from "./errors.ts"
export { NativeSqliteCandidate } from "./adapters/native-sqlite.ts"
export { DBOSGoCandidate, DBOS_GO_IPC_SKETCH } from "./adapters/dbos-go.ts"
export { DBOSRealCandidate } from "./adapters/dbos-real.ts"
