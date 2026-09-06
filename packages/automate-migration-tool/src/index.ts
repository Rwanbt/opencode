/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `@unifia/automate-migration-tool` — V1 → V2 IR migration (ADR-017,
 * plan V2.3.1 §182-185 + §222-223).
 *
 * Substrate-neutral mapping contract. The runtime execution step
 * (`WorkflowRuntime`, M1-09) is blocked by ADR-000; the migration
 * tool itself is a pure function over IR shapes and is runnable in CI
 * without a substrate.
 *
 *   V1 fixture  ──►  migrateV1ToV2  ──►  V2 WorkflowDefinition
 *                                          │
 *                                          └─►  isAcceptableMigration?
 *                                          └─►  consumer's
 *                                              WorkflowDefinitionSchema.parse
 *
 * Acceptance:
 *   - 8-12 tests covering: simple sequential, requiresApproval, wait
 *     step, schedule trigger, manual trigger, no-steps (warn), shell
 *     (block), openapi (block), round-trip determinism.
 *   - Tests live in `test/mapping.test.ts`.
 */
export * from "./v1-ir"
export * from "./v2-ir"
export * from "./mapping"
