/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * PostM3-R1 Security Core — SC-01..05 + SC-07..08 (Plan V2.3.1 §203,
 * ADR-008, ADR-009, ADR-010, ADR-015, ADR-022).
 *
 * SC-06 (Secret Broker) is intentionally NOT covered here — it lives
 * in `@unifia/secret-broker` (M1-07) and is re-used, not re-built.
 *
 * Locked invariants (regression net, 30 tests):
 *   SC-01 Capability Authority (5):
 *     - all 4 subjects, 5 actions, 8 resourceKinds parse
 *     - rejects negative `grantedAt`
 *     - accepts optional `expiresAt`
 *     - full JSON round-trip
 *     - throws on bad shape
 *
 *   SC-02 Policy (5):
 *     - parses 3 effects (allow / deny / require-approval)
 *     - multi-rule policy parses
 *     - default `priority` is 0
 *     - rejects empty `when`
 *     - full JSON round-trip
 *
 *   SC-03 Approval (5):
 *     - minimal valid (1 approver, 1 required, scope set)
 *     - accepts `expiresAt`
 *     - rejects `requiredApprovals: 0`
 *     - rejects too many approvers (> 32)
 *     - rejects empty `scope`
 *
 *   SC-04 Tenant (3):
 *     - minimal valid
 *     - accepts `region`
 *     - rejects empty `tenantId` (full round-trip also)
 *
 *   SC-05 Taint (5):
 *     - parses all 4 sources
 *     - level 0..10 boundary (0 and 10 both valid; 11 rejected)
 *     - propagation rule JSON round-trip
 *     - `denyIfLevelExceeds` optional
 *     - full TaintPolicy round-trip
 *
 *   SC-07 Key Authority (3):
 *     - parses all 4 purposes
 *     - rejects empty `authorityId`
 *     - full JSON round-trip
 *
 *   SC-08 Worker / Service identities (4):
 *     - `WorkerId` rejects special chars (e.g. "wrk/1")
 *     - `ServiceId` accepts dotted names (e.g. "auth.broker.v1")
 *     - `WorkerIdentity` full JSON round-trip
 *     - `ServiceIdentity` full JSON round-trip
 */
import { describe, expect, test } from "bun:test"
import {
  // SC-01
  CapabilitySubjectSchema,
  CapabilityActionSchema,
  CapabilityResourceKindSchema,
  CapabilitySchema,
  parseCapability,
  // SC-02
  PolicyEffectSchema,
  PolicyRuleSchema,
  parsePolicy,
  // SC-03
  APPROVAL_MAX_APPROVERS,
  parseApprovalBinding,
  // SC-04
  parseTenantContext,
  // SC-05
  TAINT_LEVEL_MAX,
  TaintLevelSchema,
  TaintMarkSchema,
  TaintPropagationRuleSchema,
  TaintPolicySchema,
  // SC-07
  parseKeyAuthorityReference,
  // SC-08
  WorkerIdSchema,
  ServiceIdSchema,
  parseWorkerIdentity,
  parseServiceIdentity,
} from "../src/security-core.ts"

// =========================================================================
// SC-01 Capability
// =========================================================================

describe("SC-01 Capability — enum coverage", () => {
  test("CapabilitySubjectSchema — accepts the 4 documented subjects", () => {
    expect(CapabilitySubjectSchema.parse("user").valueOf()).toBe("user")
    expect(CapabilitySubjectSchema.parse("service").valueOf()).toBe("service")
    expect(CapabilitySubjectSchema.parse("worker").valueOf()).toBe("worker")
    expect(CapabilitySubjectSchema.parse("system").valueOf()).toBe("system")
  })

  test("CapabilitySubjectSchema — rejects an unknown subject", () => {
    expect(() => CapabilitySubjectSchema.parse("guest")).toThrow()
  })

  test("CapabilityActionSchema — accepts the 5 documented actions", () => {
    for (const a of ["read", "write", "execute", "approve", "admin"]) {
      expect(CapabilityActionSchema.parse(a).valueOf()).toBe(a)
    }
  })

  test("CapabilityResourceKindSchema — accepts the 8 documented kinds", () => {
    const expected = [
      "workflow",
      "workflow-run",
      "node",
      "secret",
      "artifact",
      "tenant",
      "policy",
      "capability",
    ]
    expect(CapabilityResourceKindSchema.options).toHaveLength(expected.length)
    for (const k of expected) {
      expect(CapabilityResourceKindSchema.parse(k).valueOf()).toBe(k)
    }
  })
})

describe("SC-01 Capability — payload validation", () => {
  test("RejectsNegativeGrantedAt — `grantedAt: -1` is refused", () => {
    expect(() =>
      CapabilitySchema.parse({
        subject: "user",
        subjectId: "u-1",
        action: "read",
        resourceKind: "workflow",
        resourceId: "wf-1",
        grantedAt: -1,
      }),
    ).toThrow()
  })

  test("AcceptsExpiresAt — optional `expiresAt` is preserved when set", () => {
    const parsed = parseCapability({
      subject: "user",
      subjectId: "u-2",
      action: "write",
      resourceKind: "workflow",
      resourceId: "wf-2",
      grantedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_100_000,
    })
    expect(parsed.expiresAt).toBe(1_700_000_100_000)
  })

  test("FullRoundTrip — Capability parses → JSON → re-parses equal", () => {
    const original = {
      subject: "service" as const,
      subjectId: "svc-scheduler",
      action: "execute" as const,
      resourceKind: "workflow-run" as const,
      resourceId: "run-42",
      grantedAt: 1_700_000_000_000,
    }
    const first = parseCapability(original)
    const roundTripped = parseCapability(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
  })

  test("ThrowsOnBadShape — non-object input is rejected", () => {
    expect(() => parseCapability("not-a-capability")).toThrow()
    expect(() => parseCapability(null)).toThrow()
    expect(() => parseCapability({})).toThrow() // missing required subject/action/...
  })
})

// =========================================================================
// SC-02 Policy
// =========================================================================

describe("SC-02 Policy — enum coverage", () => {
  test("PolicyEffectSchema — parses the 3 documented effects", () => {
    expect(PolicyEffectSchema.parse("allow").valueOf()).toBe("allow")
    expect(PolicyEffectSchema.parse("deny").valueOf()).toBe("deny")
    expect(PolicyEffectSchema.parse("require-approval").valueOf()).toBe("require-approval")
  })

  test("PolicyEffectSchema — rejects an unknown effect", () => {
    expect(() => PolicyEffectSchema.parse("maybe")).toThrow()
  })
})

describe("SC-02 Policy — payloads", () => {
  test("MultiRulePolicy — policy with 2 rules parses, both rules preserved", () => {
    const policy = parsePolicy({
      id: "pol-1",
      name: "default",
      rules: [
        {
          id: "r-1",
          when: "input.kind == 'http'",
          // biome-ignore lint/suspicious/noThenProperty: domain field in PolicyRule (when/then/else).
          then: "allow",
          priority: 10,
        },
        {
          id: "r-2",
          when: "input.kind == 'shell'",
          // biome-ignore lint/suspicious/noThenProperty: domain field in PolicyRule (when/then/else).
          then: "deny",
        },
      ],
    })
    expect(policy.rules).toHaveLength(2)
    expect(policy.rules[0]?.id).toBe("r-1")
    expect(policy.rules[0]?.priority).toBe(10)
    expect(policy.rules[1]?.id).toBe("r-2")
  })

  test("DefaultPriorityIsZero — a rule with no `priority` defaults to 0", () => {
    const parsed = PolicyRuleSchema.parse({
      id: "r-default",
      when: "true",
      // biome-ignore lint/suspicious/noThenProperty: domain field in PolicyRule (when/then/else).
      then: "allow",
    })
    expect(parsed.priority).toBe(0)
  })

  test("RejectsEmptyWhen — empty `when` expression is refused", () => {
    expect(() =>
      PolicyRuleSchema.parse({
        id: "r-empty",
        when: "",
        // biome-ignore lint/suspicious/noThenProperty: domain field in PolicyRule (when/then/else).
        then: "allow",
      }),
    ).toThrow(/when/)
  })

  test("FullRoundTrip — Policy JSON round-trip is stable", () => {
    const original = {
      id: "pol-rt",
      name: "rt",
      rules: [
        {
          id: "r-a",
          description: "block shell",
          when: "input.kind == 'shell'",
          // biome-ignore lint/suspicious/noThenProperty: domain field in PolicyRule (when/then/else).
          then: "deny" as const,
          else: "allow" as const,
          priority: 5,
        },
      ],
    }
    const first = parsePolicy(original)
    const roundTripped = parsePolicy(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.rules[0]?.description).toBe("block shell")
  })
})

// =========================================================================
// SC-03 Approval
// =========================================================================

describe("SC-03 Approval", () => {
  test("MinimalValid — 1 approver, 1 required approval, scope set", () => {
    const parsed = parseApprovalBinding({
      id: "appr-1",
      requiredApprovals: 1,
      approvers: ["u-owner"],
      scope: "workflow:wf-deploy",
    })
    expect(parsed.requiredApprovals).toBe(1)
    expect(parsed.approvers).toEqual(["u-owner"])
    expect(parsed.scope).toBe("workflow:wf-deploy")
    expect(parsed.expiresAt).toBeUndefined()
  })

  test("AcceptsExpiresAt — `expiresAt` is preserved when set", () => {
    const parsed = parseApprovalBinding({
      id: "appr-2",
      requiredApprovals: 2,
      approvers: ["u-1", "u-2"],
      scope: "workflow:wf-prod",
      expiresAt: 1_700_000_000_000,
    })
    expect(parsed.expiresAt).toBe(1_700_000_000_000)
  })

  test("RejectsZeroRequiredApprovals — requiredApprovals: 0 is not positive", () => {
    expect(() =>
      parseApprovalBinding({
        id: "appr-3",
        requiredApprovals: 0,
        approvers: ["u-1"],
        scope: "workflow:wf-x",
      }),
    ).toThrow(/requiredApprovals/)
  })

  test("RejectsTooManyApprovers — > APPROVAL_MAX_APPROVERS (32) is refused", () => {
    const approvers = Array.from({ length: APPROVAL_MAX_APPROVERS + 1 }, (_, i) => `u-${i}`)
    expect(() =>
      parseApprovalBinding({
        id: "appr-4",
        requiredApprovals: 1,
        approvers,
        scope: "workflow:wf-big",
      }),
    ).toThrow()
  })

  test("RejectsEmptyScope — empty `scope` is refused", () => {
    expect(() =>
      parseApprovalBinding({
        id: "appr-5",
        requiredApprovals: 1,
        approvers: ["u-1"],
        scope: "",
      }),
    ).toThrow(/scope/)
  })
})

// =========================================================================
// SC-04 Tenant
// =========================================================================

describe("SC-04 Tenant", () => {
  test("MinimalValid — only `tenantId` and `isolation` required", () => {
    const parsed = parseTenantContext({
      tenantId: "t-1",
      isolation: "shared",
    })
    expect(parsed.tenantId).toBe("t-1")
    expect(parsed.isolation).toBe("shared")
    expect(parsed.region).toBeUndefined()
  })

  test("AcceptsRegion — `region` is preserved when set", () => {
    const parsed = parseTenantContext({
      tenantId: "t-2",
      isolation: "dedicated",
      region: "eu-west-1",
    })
    expect(parsed.region).toBe("eu-west-1")
  })

  test("RejectsEmptyTenantId — empty `tenantId` is refused; full round-trip works", () => {
    expect(() =>
      parseTenantContext({ tenantId: "", isolation: "isolated" }),
    ).toThrow(/tenantId/)
    const original = {
      tenantId: "t-rt",
      isolation: "isolated" as const,
      region: "us-east-1",
    }
    const first = parseTenantContext(original)
    const roundTripped = parseTenantContext(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
  })
})

// =========================================================================
// SC-05 Taint
// =========================================================================

describe("SC-05 Taint", () => {
  test("ParsesAllSources — TaintMark accepts user / external / internal / system", () => {
    for (const source of ["user", "external", "internal", "system"]) {
      const parsed = TaintMarkSchema.parse({
        input: "in-1",
        source,
        level: 3,
        at: 1_700_000_000_000,
      })
      expect(parsed.source).toBe(source)
    }
  })

  test("LevelBoundary — 0 and TAINT_LEVEL_MAX (10) are accepted, 11 is refused", () => {
    expect(TaintLevelSchema.parse(0)).toBe(0)
    expect(TaintLevelSchema.parse(TAINT_LEVEL_MAX)).toBe(TAINT_LEVEL_MAX)
    expect(() => TaintLevelSchema.parse(TAINT_LEVEL_MAX + 1)).toThrow()
    expect(() => TaintLevelSchema.parse(-1)).toThrow()
  })

  test("PropagationRuleRoundTrip — TaintPropagationRule JSON round-trip", () => {
    const original = {
      fromLevel: 2 as const,
      toLevel: 5 as const,
      when: "output" as const,
    }
    const first = TaintPropagationRuleSchema.parse(original)
    const roundTripped = TaintPropagationRuleSchema.parse(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
  })

  test("DenyIfLevelExceedsOptional — TaintPolicy parses with and without the threshold", () => {
    const withThreshold = TaintPolicySchema.parse({
      rules: [],
      denyIfLevelExceeds: 7,
    })
    expect(withThreshold.denyIfLevelExceeds).toBe(7)

    const withoutThreshold = TaintPolicySchema.parse({ rules: [] })
    expect(withoutThreshold.denyIfLevelExceeds).toBeUndefined()
  })

  test("FullTaintPolicyRoundTrip — entire policy JSON round-trip", () => {
    const original = {
      rules: [
        { fromLevel: 0, toLevel: 2, when: "input" as const },
        { fromLevel: 3, toLevel: 5, when: "always" as const },
      ],
      denyIfLevelExceeds: 6,
    }
    const first = TaintPolicySchema.parse(original)
    const roundTripped = TaintPolicySchema.parse(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.rules).toHaveLength(2)
  })
})

// =========================================================================
// SC-07 Key Authority
// =========================================================================

describe("SC-07 Key Authority", () => {
  test("ParsesAllPurposes — encryption / signing / hmac / kdf all accepted", () => {
    for (const purpose of ["encryption", "signing", "hmac", "kdf"]) {
      const parsed = parseKeyAuthorityReference({
        authorityId: "ka-1",
        version: "v1",
        purpose,
      })
      expect(parsed.purpose).toBe(purpose)
    }
  })

  test("RejectsEmptyAuthorityId — empty `authorityId` is refused", () => {
    expect(() =>
      parseKeyAuthorityReference({
        authorityId: "",
        version: "v1",
        purpose: "encryption",
      }),
    ).toThrow(/authorityId/)
  })

  test("FullRoundTrip — KeyAuthorityReference JSON round-trip is stable", () => {
    const original = {
      authorityId: "ka-prod-eu",
      version: "2026-08-15",
      purpose: "signing" as const,
    }
    const first = parseKeyAuthorityReference(original)
    const roundTripped = parseKeyAuthorityReference(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.authorityId).toBe("ka-prod-eu")
  })
})

// =========================================================================
// SC-08 Worker / Service identities
// =========================================================================

describe("SC-08 Worker / Service identities", () => {
  test("WorkerIdRejectsSpecialChars — `/`, space, `:` are all refused", () => {
    expect(() => WorkerIdSchema.parse("wrk/1")).toThrow()
    expect(() => WorkerIdSchema.parse("wrk 1")).toThrow()
    expect(() => WorkerIdSchema.parse("wrk:1")).toThrow()
    // But the documented alphabet passes
    expect(WorkerIdSchema.parse("wrk-1_ABC")).toBe("wrk-1_ABC")
  })

  test("ServiceIdAcceptsDottedNames — `auth.broker.v1` parses; `/` is refused", () => {
    expect(ServiceIdSchema.parse("auth.broker.v1")).toBe("auth.broker.v1")
    expect(ServiceIdSchema.parse("scheduler")).toBe("scheduler")
    expect(() => ServiceIdSchema.parse("auth/broker")).toThrow()
  })

  test("WorkerIdentityFullRoundTrip — parse → JSON → re-parse is equal", () => {
    const original = {
      workerId: "wrk-eu-1",
      serviceId: "scheduler.v1",
      capabilities: ["network.outbound", "secrets.read"] as const,
      lastHeartbeat: 1_700_000_000_000,
    }
    const first = parseWorkerIdentity(original)
    const roundTripped = parseWorkerIdentity(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.workerId).toBe("wrk-eu-1")
    expect(roundTripped.capabilities).toHaveLength(2)
  })

  test("ServiceIdentityFullRoundTrip — parse → JSON → re-parse is equal", () => {
    const original = {
      serviceId: "auth.broker.v2",
      version: "2.4.0",
      capabilities: ["secrets.read", "secrets.rotate"] as const,
      registeredAt: 1_700_000_000_000,
    }
    const first = parseServiceIdentity(original)
    const roundTripped = parseServiceIdentity(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.serviceId).toBe("auth.broker.v2")
    expect(roundTripped.version).toBe("2.4.0")
  })
})
