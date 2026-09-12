/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * C-M1-04 — OwnershipScope Zod regex validation (structural tests).
 *
 * Plan V2.3.1 §195 (M1 gate) + §44-46 (scope model) + §226 (A-vs-B tests).
 * ADR-020 (Ownership / Deployment scope) DECIDED.
 * THREAT_MODEL TM-T-01 (cross-tenant data leak) + TM-T-02 (scope chain break).
 *
 * The 3-field OwnershipScopeSchema (organizationId, workspaceId, projectId?)
 * is the canonical address form for every contract. Before C-M1-04, the
 * Zod schema accepted empty strings and whitespace-only strings — that
 * let an attacker forge a credential / artifact / log entry bound to
 * the "empty tenant" (M1-03 EVIDENCE §5 E2 / E3). This file locks the
 * fix in place so any regression on the regex is caught in CI.
 *
 * Companion to the M1-04 throwaway spike
 * `docs/automation-v2/spikes/m1-04-scope-zod-fix.ts`. The spike is
 * the one-shot, throwaway evidence producer; this file is the durable
 * regression net in `@unifia/contracts`.
 */
import { describe, expect, test } from "bun:test"
import { OwnershipScopeSchema, DeploymentScopeSchema } from "../src/scope.ts"

describe("OwnershipScopeSchema — happy path (a/h)", () => {
  test("(a) accepts a fully-formed 2-field scope (no project)", () => {
    const parsed = OwnershipScopeSchema.parse({
      organizationId: "org-1",
      workspaceId: "ws-1",
    })
    expect(parsed.organizationId).toBe("org-1")
    expect(parsed.workspaceId).toBe("ws-1")
    // projectId is optional and absent in this input.
    expect(parsed.projectId).toBeUndefined()
  })

  test("(h) round-trips projectId when explicitly provided", () => {
    const parsed = OwnershipScopeSchema.parse({
      organizationId: "org-1",
      workspaceId: "ws-1",
      projectId: "proj-1",
    })
    expect(parsed.projectId).toBe("proj-1")
    expect(parsed.organizationId).toBe("org-1")
    expect(parsed.workspaceId).toBe("ws-1")
  })
})

describe("OwnershipScopeSchema — rejects empty / whitespace IDs (b/c/d/e)", () => {
  test("(b) rejects organizationId = '' (M1-03 finding E3)", () => {
    expect(() =>
      OwnershipScopeSchema.parse({ organizationId: "", workspaceId: "ws-1" }),
    ).toThrow(/organizationId/)
  })

  test("(c) rejects workspaceId = '' (M1-03 finding E2)", () => {
    expect(() =>
      OwnershipScopeSchema.parse({ organizationId: "org-1", workspaceId: "" }),
    ).toThrow(/workspaceId/)
  })

  test("(d) rejects whitespace-only workspaceId ('   ')", () => {
    expect(() =>
      OwnershipScopeSchema.parse({ organizationId: "org-1", workspaceId: "   " }),
    ).toThrow(/workspaceId/)
  })

  test("(e) projectId is strict-when-present: '' throws", () => {
    expect(() =>
      OwnershipScopeSchema.parse({
        organizationId: "org-1",
        workspaceId: "ws-1",
        projectId: "",
      }),
    ).toThrow(/projectId/)
  })
})

describe("OwnershipScopeSchema — DeploymentScope composes the regex (f)", () => {
  test("(f) DeploymentScopeSchema rejects nested empty organizationId", () => {
    expect(() =>
      DeploymentScopeSchema.parse({
        ownershipScope: { organizationId: "", workspaceId: "ws-1" },
        environmentId: "prod",
      }),
    ).toThrow(/organizationId/)
  })
})

describe("OwnershipScopeSchema — does NOT over-restrict (g)", () => {
  test("(g) spaces inside the value are allowed (regex is \\S+, not strip-spaces)", () => {
    // The regex /^\S+$/ only forbids whitespace INSIDE the string.
    // A scope id like "org with spaces" is a legal display name in
    // many tenant systems; we must not silently strip it. The
    // contract is a transport shape, not a normalisation policy.
    const parsed = OwnershipScopeSchema.parse({
      organizationId: "org with spaces",
      workspaceId: "ws-1",
    })
    expect(parsed.organizationId).toBe("org with spaces")
  })
})
