import { describe, expect, it } from "bun:test"
import { PermissionBroker, type PermissionGrantInput, type PermissionRequest } from "../../src/team/permission-broker"

const identity = {
  runId: "run-1",
  taskId: "task-1",
  workerId: "worker-1",
  providerId: "provider-1",
  leaseId: "lease-1",
  fencingToken: 7,
} as const

function grant(overrides: Partial<PermissionGrantInput> = {}): PermissionGrantInput {
  return {
    grantId: "grant-1",
    ...identity,
    operations: ["invoke"],
    resource: { kind: "network", value: "https://api.example.com" },
    maxUses: 2,
    ...overrides,
  }
}

function request(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    grantId: "grant-1",
    ...identity,
    operation: "invoke",
    resource: { kind: "network", value: "https://api.example.com/v1" },
    nonce: "nonce-1",
    ...overrides,
  }
}

describe("PermissionBroker", () => {
  it("denies by default when no grant exists", () => {
    expect(new PermissionBroker().authorize(request())).toEqual({ allowed: false, reason: "GRANT_NOT_FOUND" })
  })

  it("allows only the scoped identity, operation, resource, lease, and provider", () => {
    const broker = new PermissionBroker()
    broker.grant(grant())

    expect(broker.authorize(request())).toMatchObject({ allowed: true, reason: "ALLOWED", remainingUses: 2 })
    expect(broker.authorize(request({ workerId: "other-worker" }))).toMatchObject({ allowed: false, reason: "IDENTITY_MISMATCH" })
    expect(broker.authorize(request({ operation: "read" }))).toMatchObject({ allowed: false, reason: "OPERATION_DENIED" })
    expect(broker.authorize(request({ providerId: "other-provider" }))).toMatchObject({ allowed: false, reason: "PROVIDER_DENIED" })
    expect(broker.authorize(request({ leaseId: "other-lease" }))).toMatchObject({ allowed: false, reason: "LEASE_MISMATCH" })
    expect(broker.authorize(request({ fencingToken: 8 }))).toMatchObject({ allowed: false, reason: "LEASE_MISMATCH" })
    expect(broker.authorize(request({ resource: { kind: "network", value: "https://evil.example.net" } }))).toMatchObject({ allowed: false, reason: "RESOURCE_DENIED" })
    expect(broker.authorize(request({ resource: { kind: "network", value: "https://child.api.example.com" } }))).toMatchObject({ allowed: false, reason: "RESOURCE_DENIED" })
  })

  it("enforces TTL and quota", () => {
    let now = 10_000
    const broker = new PermissionBroker({ now: () => now })
    broker.grant(grant({ ttlMs: 100, maxUses: 2 }))

    expect(broker.authorize(request())).toMatchObject({ allowed: true, remainingUses: 2 })
    expect(broker.authorize(request())).toMatchObject({ allowed: true, remainingUses: 1 })
    expect(broker.authorize(request())).toMatchObject({ allowed: false, reason: "QUOTA_EXHAUSTED" })
    now += 100
    expect(broker.authorize(request())).toMatchObject({ allowed: false, reason: "EXPIRED" })
    expect(() => broker.grant(grant({ grantId: "too-long", ttlMs: 300_001 }))).toThrow(RangeError)
  })

  it("requires approval for human-gated grants", () => {
    const broker = new PermissionBroker()
    broker.grant(grant({ requiresHumanApproval: true }))

    expect(broker.authorize(request())).toMatchObject({ allowed: false, reason: "APPROVAL_REQUIRED" })
    broker.approve("grant-1", "approval-1")
    expect(broker.authorize(request({ approvalId: "approval-1" }))).toMatchObject({ allowed: true })
  })

  it("keeps handle-only grants opaque and single-use with nonce binding", () => {
    const broker = new PermissionBroker()
    broker.grant(grant({ handleOnly: true, maxUses: 2 }))

    expect(broker.authorize(request())).toMatchObject({ allowed: false, reason: "HANDLE_REQUIRED" })
    const handle = broker.issueProviderHandle(request())
    expect(handle).not.toBeNull()
    expect(handle?.handleId.startsWith("hnd_")).toBe(true)
    expect(handle?.nonce).toBe("nonce-1")
    expect(handle?.handleId).not.toContain("api.example.com")
    expect(broker.useProviderHandle(handle?.handleId ?? "", request({ nonce: "wrong" }))).toMatchObject({ allowed: false, reason: "NONCE_REQUIRED" })
    expect(broker.useProviderHandle(handle?.handleId ?? "", request())).toMatchObject({ allowed: true, reason: "ALLOWED" })
    expect(broker.useProviderHandle(handle?.handleId ?? "", request())).toMatchObject({ allowed: false, reason: "DEFAULT_DENY" })
  })

  it("revokes grants and handles immediately", () => {
    const broker = new PermissionBroker()
    broker.grant(grant({ handleOnly: true }))
    const handle = broker.issueProviderHandle(request())
    broker.revoke("grant-1")

    expect(broker.authorize(request())).toMatchObject({ allowed: false, reason: "REVOKED" })
    expect(broker.useProviderHandle(handle?.handleId ?? "", request())).toMatchObject({ allowed: false, reason: "DEFAULT_DENY" })
  })

  it("blocks path traversal and keeps sensitive audit data hashed", () => {
    const audit: string[] = []
    const secret = "prompt-secret-value"
    const broker = new PermissionBroker({ onAudit: (entry) => audit.push(JSON.stringify(entry)) })
    broker.grant({ ...grant({ grantId: "path-grant", operations: ["read"], resource: { kind: "path", value: "C:/capsule/output" } }), providerId: undefined })

    expect(broker.authorize(request({ grantId: "path-grant", operation: "read", providerId: undefined, resource: { kind: "path", value: "C:/capsule/output/file.txt" } }))).toMatchObject({ allowed: true })
    expect(broker.authorize(request({ grantId: "path-grant", operation: "read", providerId: undefined, resource: { kind: "path", value: `C:/capsule/output/../${secret}` } }))).toMatchObject({ allowed: false, reason: "RESOURCE_DENIED" })
    expect(audit.join("\n")).not.toContain(secret)
    expect(audit.join("\n")).toMatch(/[a-f0-9]{64}/)
  })

  it("scopes prompt, log, event, subprocess, and network resources independently", () => {
    const broker = new PermissionBroker()
    const kinds = ["prompt", "log", "event", "subprocess", "network"] as const
    for (const kind of kinds) {
      const allowedValue = kind === "network" ? "https://api.example.com" : `${kind}-channel`
      const deniedValue = kind === "network" ? "https://evil.example.net" : `${kind}-other`
      broker.grant(grant({ grantId: `grant-${kind}`, operations: ["emit"], resource: { kind, value: allowedValue } }))
      expect(broker.authorize(request({ grantId: `grant-${kind}`, operation: "emit", resource: { kind, value: allowedValue } }))).toMatchObject({ allowed: true })
      expect(broker.authorize(request({ grantId: `grant-${kind}`, operation: "emit", resource: { kind, value: deniedValue } }))).toMatchObject({ allowed: false, reason: "RESOURCE_DENIED" })
    }
  })
})
