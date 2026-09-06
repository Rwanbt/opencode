/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * C-M1-04 — secret-broker scope-migration structural tests.
 *
 * Plan V2.3.1 §195 (M1 gate) + §44-46 (scope model) + §226 (A-vs-B tests).
 * ADR-020 (Ownership / Deployment scope) DECIDED.
 * M1-03 EVIDENCE §6 "Backward compat" — the 2-field scaffold in
 * `packages/secret-broker/src/index.ts:38` is a local type, not the
 * canonical 3-field OwnershipScope from `@unifia/contracts`.
 *
 * The migration of the broker's local 2-field type to the canonical
 * 3-field type is a separate C-M1-07 step. This file documents the
 * structural delta: the canonical 3-field schema is now
 * `projectId-optional-and-strict-when-present`, and the broker's
 * local 2-field type is still in flight (it has no `projectId` and
 * does not accept the 3rd field).
 *
 * The 4 tests below are a CI gate on the `@unifia/contracts` side
 * of the migration. They do NOT touch the broker; they document the
 * shape the broker will pick up at C-M1-07.
 */
import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { OwnershipScopeSchema } from "../src/scope.ts"

describe("OwnershipScopeSchema — canonical 3-field export (a)", () => {
  test("(a) the 3-field Zod schema is exported from @unifia/contracts", () => {
    // Smoke test: schema is a real ZodObject, not undefined.
    expect(OwnershipScopeSchema).toBeDefined()
    expect(OwnershipScopeSchema).toBeInstanceOf(z.ZodObject)
  })
})

describe("OwnershipScopeSchema — per-field shape (b/c/d)", () => {
  test("(b) shape.organizationId is a ZodString", () => {
    // In Zod 4, .shape.<key> gives the field schema. Before C-M1-04
    // it was a bare ZodString; after the fix, it is a ZodString
    // chained with .min(1) and .regex(...). Both chain steps
    // return a ZodString, so the constructor name does not change.
    const field = OwnershipScopeSchema.shape.organizationId
    expect(field).toBeInstanceOf(z.ZodString)
  })

  test("(c) shape.workspaceId is a ZodString", () => {
    const field = OwnershipScopeSchema.shape.workspaceId
    expect(field).toBeInstanceOf(z.ZodString)
  })

  test("(d) shape.projectId is ZodOptional<ZodString>", () => {
    // projectId is `.optional()` — the wrapper is ZodOptional. Inside,
    // it must still be a ZodString (so it inherits the .regex check
    // when present). The structural check below pins both halves.
    const field = OwnershipScopeSchema.shape.projectId
    expect(field).toBeInstanceOf(z.ZodOptional)
    // The wrapped inner type must be a ZodString.
    const inner = (field as z.ZodOptional<z.ZodString>).def.innerType
    expect(inner).toBeInstanceOf(z.ZodString)
  })
})
