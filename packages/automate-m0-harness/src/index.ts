/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * `@unifia/automate-m0-harness` — M0 substrate proof runtime half.
 *
 * Per ADR-000 §6 (correction pack 2026-09-03), the M0 proof has two
 * halves:
 *   (a) CONTRACT half — `@unifia/automate-m0-contract` tests (PASS).
 *   (b) RUNTIME half — this package.
 *
 * The runtime half drives a minimal in-process substrate through the
 * 10 M0 criteria. Per ADR-000 §7, any non-PASS blocks M1.
 */
export * from "./minimal-substrate.ts"
