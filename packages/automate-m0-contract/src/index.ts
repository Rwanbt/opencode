/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `@unifia/automate-m0-contract` — the substrate-neutral canonical contract
 * for the ADR-000 M0 qualification (ADR-000 §17, §48).
 *
 * Qualification-only. This package exists to let two candidate durable
 * authorities be measured against the *same* semantics; it is not a
 * production package and nothing outside the M0 harness should depend on
 * it. ADR-000 §17 is explicit that "le contrat M0 n'est pas encore le
 * WorkflowIR complet" — `@unifia/contracts` owns that, and the two are
 * deliberately kept apart so the harness cannot inherit an M1 decision.
 */
export * from "./ids.js"
export * from "./value.js"
export * from "./effect.js"
export * from "./timer.js"
export * from "./vectors.js"
