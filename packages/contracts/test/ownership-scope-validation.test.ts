/* SPDX-License-Identifier: MIT */
import { describe, expect, test } from "bun:test"
import { DeploymentScopeSchema, OwnershipScopeSchema } from "../src/scope.ts"

describe("OwnershipScopeSchema", () => {
  test("accepts a scope with an optional project", () => {
    expect(
      OwnershipScopeSchema.parse({
        organizationId: "org-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
      }),
    ).toEqual({ organizationId: "org-1", workspaceId: "workspace-1", projectId: "project-1" })
  })

  test("rejects blank ownership identifiers", () => {
    for (const scope of [
      { organizationId: "", workspaceId: "workspace-1" },
      { organizationId: "org-1", workspaceId: "   " },
      { organizationId: "org-1", workspaceId: "workspace-1", projectId: "" },
    ]) {
      expect(() => OwnershipScopeSchema.parse(scope)).toThrow(/organizationId|workspaceId|projectId/)
    }
  })

  test("allows internal spaces without trimming the identifier", () => {
    expect(
      OwnershipScopeSchema.parse({ organizationId: "org with spaces", workspaceId: "workspace-1" }),
    ).toMatchObject({ organizationId: "org with spaces" })
  })

  test("applies ownership validation inside deployment scopes", () => {
    expect(() =>
      DeploymentScopeSchema.parse({
        ownershipScope: { organizationId: "", workspaceId: "workspace-1" },
        environmentId: "production",
      }),
    ).toThrow()
  })
})
