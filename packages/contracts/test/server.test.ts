/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * PostM3-R2 Distributed Server contracts — DS-01..DS-08
 * (Plan V2.3.1 §208, ADR-008, ADR-009).
 *
 * DS-09/10/11 (HA, rolling upgrade, cluster recovery) are RED —
 * architecture choices not yet made. They are out of scope for
 * this round.
 *
 * Locked invariants (regression net):
 *   (1) WorkerRegistrationSchema accepts the 4 statuses, rejects
 *       workerIds that violate `/^[a-zA-Z0-9_-]{1,128}$/`.
 *   (2) LeaseSchema rejects `fencingToken: 0` (`.positive()`),
 *       empty `leaseId` (`.min(1)`), and round-trips valid input.
 *   (3) FencingTokenSchema accepts the optional `predecessor` and
 *       `isValidFencingToken` strictly compares against lastKnown.
 *   (4) QueueItemSchema accepts all 4 priorities; WorkQueueSchema
 *       rejects an empty `name`.
 *   (5) FairSchedulerConfigSchema rejects rebalanceIntervalMs
 *       greater than 60_000 (one minute cap).
 *   (6) QuotaSchema defaults to "0 = unlimited" and rejects
 *       `resetHourUtc` > 23.
 *   (7) RateLimiterSchema rejects `windowMs` longer than 24h.
 *   (8) BudgetSchema's `.refine` rejects `currentSpend > maxAmount`
 *       and accepts the boundary `currentSpend === maxAmount`.
 */
import { describe, expect, test } from "bun:test"
import {
  WorkerRegistrationSchema,
  parseWorkerRegistration,
  LeaseSchema,
  FencingTokenSchema,
  isValidFencingToken,
  QueueItemSchema,
  WorkQueueSchema,
  FairSchedulerConfigSchema,
  QuotaSchema,
  RateLimiterSchema,
  BudgetSchema,
  BUDGET_MAX_AMOUNT,
} from "../src/server.ts"

// ---------------------------------------------------------------------------
// DS-01 Worker registry
// ---------------------------------------------------------------------------

describe("DS-01 WorkerRegistrationSchema (1)", () => {
  test("(1) ParsesValid — workerId, serviceId, capabilities, status", () => {
    const parsed = WorkerRegistrationSchema.parse({
      workerId: "wkr-abc_123",
      serviceId: "svc-payments",
      capabilities: ["http", "postgres"],
      registeredAt: 1_700_000_000_000,
      lastHeartbeat: 1_700_000_005_000,
      status: "active",
    })
    expect(parsed.workerId).toBe("wkr-abc_123")
    expect(parsed.serviceId).toBe("svc-payments")
    expect(parsed.capabilities).toEqual(["http", "postgres"])
    expect(parsed.status).toBe("active")
  })

  test("(1+) AcceptsAllStatuses — registering/active/draining/dead", () => {
    for (const status of ["registering", "active", "draining", "dead"] as const) {
      const parsed = WorkerRegistrationSchema.parse({
        workerId: "wkr-1",
        serviceId: "svc-1",
        capabilities: [],
        registeredAt: 0,
        lastHeartbeat: 0,
        status,
      })
      expect(parsed.status).toBe(status)
    }
  })

  test("(1R) RejectsBadWorkerId — 'id with space' and 'id@with@at' rejected", () => {
    for (const workerId of ["id with space", "id@with@at", "id/with/slash", ""]) {
      const result = WorkerRegistrationSchema.safeParse({
        workerId,
        serviceId: "svc-1",
        capabilities: [],
        registeredAt: 0,
        lastHeartbeat: 0,
        status: "active",
      })
      expect(result.success).toBe(false)
    }
  })

  test("(1R+) parseWorkerRegistration_RoundTripsValid — round-trip via JSON", () => {
    const original = {
      workerId: "wkr-rt-1",
      serviceId: "svc-rt",
      capabilities: ["kafka", "redis"] as const,
      registeredAt: 1_700_000_000,
      lastHeartbeat: 1_700_000_500,
      status: "active" as const,
    }
    const first = parseWorkerRegistration(original)
    const roundTripped = parseWorkerRegistration(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
  })
})

// ---------------------------------------------------------------------------
// DS-02 Leases
// ---------------------------------------------------------------------------

describe("DS-02 LeaseSchema (2)", () => {
  test("(2) ParsesValid — all 6 fields parse", () => {
    const parsed = LeaseSchema.parse({
      leaseId: "lease-001",
      holder: "wkr-1",
      acquiredAt: 1_700_000_000_000,
      expiresAt: 1_700_000_060_000,
      fencingToken: 42,
      resource: "workflow-run:abc",
    })
    expect(parsed.leaseId).toBe("lease-001")
    expect(parsed.holder).toBe("wkr-1")
    expect(parsed.fencingToken).toBe(42)
    expect(parsed.resource).toBe("workflow-run:abc")
  })

  test("(2R) RejectsZeroFencingToken — fencingToken: 0 rejected (.positive())", () => {
    expect(() =>
      LeaseSchema.parse({
        leaseId: "lease-1",
        holder: "wkr-1",
        acquiredAt: 0,
        expiresAt: 1,
        fencingToken: 0,
        resource: "r",
      }),
    ).toThrow(/fencingToken/)
  })

  test("(2R+) RejectsEmptyLeaseId — leaseId: '' rejected", () => {
    expect(() =>
      LeaseSchema.parse({
        leaseId: "",
        holder: "wkr-1",
        acquiredAt: 0,
        expiresAt: 1,
        fencingToken: 1,
        resource: "r",
      }),
    ).toThrow(/leaseId/)
  })

  test("(2R++) parseLease_RoundTripsValid — round-trip via JSON", () => {
    const original = {
      leaseId: "lease-rt",
      holder: "wkr-rt",
      acquiredAt: 1_700_000_000,
      expiresAt: 1_700_000_500,
      fencingToken: 7,
      resource: "queue:payments",
    }
    const first = LeaseSchema.parse(original)
    const roundTripped = LeaseSchema.parse(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
  })
})

// ---------------------------------------------------------------------------
// DS-03 Fencing
// ---------------------------------------------------------------------------

describe("DS-03 FencingTokenSchema (3)", () => {
  test("(3) ParsesValid — token, issuedAt (no predecessor)", () => {
    const parsed = FencingTokenSchema.parse({
      token: 10,
      issuedAt: 1_700_000_000_000,
    })
    expect(parsed.token).toBe(10)
    expect(parsed.issuedAt).toBe(1_700_000_000_000)
    expect(parsed.predecessor).toBeUndefined()
  })

  test("(3+) ParsesWithPredecessor — optional predecessor accepted", () => {
    const parsed = FencingTokenSchema.parse({
      token: 11,
      issuedAt: 1_700_000_500_000,
      predecessor: 10,
    })
    expect(parsed.token).toBe(11)
    expect(parsed.predecessor).toBe(10)
  })

  test("(3I) isValidFencingToken_AcceptsNewerToken — candidate > lastKnown → true", () => {
    const candidate = FencingTokenSchema.parse({ token: 11, issuedAt: 0 })
    expect(isValidFencingToken(candidate, 10)).toBe(true)
  })

  test("(3I+) isValidFencingToken_RejectsOlderToken — candidate < lastKnown → false", () => {
    const candidate = FencingTokenSchema.parse({ token: 9, issuedAt: 0 })
    expect(isValidFencingToken(candidate, 10)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DS-04 Queues
// ---------------------------------------------------------------------------

describe("DS-04 QueueItemSchema (4)", () => {
  test("(4) ParsesValid — all fields parse", () => {
    const parsed = QueueItemSchema.parse({
      itemId: "item-1",
      enqueuedAt: 1_700_000_000_000,
      priority: "high",
      payload: { userId: "u-1", amount: 100 },
      attempts: 2,
      deadline: 1_700_000_500_000,
    })
    expect(parsed.itemId).toBe("item-1")
    expect(parsed.priority).toBe("high")
    expect(parsed.payload).toEqual({ userId: "u-1", amount: 100 })
    expect(parsed.attempts).toBe(2)
  })

  test("(4+) AcceptsAllPriorities — low/normal/high/critical", () => {
    for (const priority of ["low", "normal", "high", "critical"] as const) {
      const parsed = QueueItemSchema.parse({
        itemId: "item-p",
        enqueuedAt: 0,
        priority,
        payload: {},
      })
      expect(parsed.priority).toBe(priority)
    }
  })
})

describe("DS-04 WorkQueueSchema (4)", () => {
  test("(4Q) ParsesValid — name, maxItems, ordering", () => {
    const parsed = WorkQueueSchema.parse({
      name: "payments",
      maxItems: 5_000,
      ordering: "fifo",
    })
    expect(parsed.name).toBe("payments")
    expect(parsed.maxItems).toBe(5_000)
    expect(parsed.ordering).toBe("fifo")
  })

  test("(4Q+) RejectsEmptyName — name: '' rejected", () => {
    expect(() => WorkQueueSchema.parse({ name: "" })).toThrow(/name/)
  })
})

// ---------------------------------------------------------------------------
// DS-05 Fair scheduling
// ---------------------------------------------------------------------------

describe("DS-05 FairSchedulerConfigSchema (5)", () => {
  test("(5) AcceptsAllStrategies — round-robin/least-loaded/priority-weighted/random", () => {
    for (const strategy of ["round-robin", "least-loaded", "priority-weighted", "random"] as const) {
      const parsed = FairSchedulerConfigSchema.parse({ strategy })
      expect(parsed.strategy).toBe(strategy)
    }
  })

  test("(5R) RejectsTooLongRebalance — 70_000ms rejected (> 60_000)", () => {
    expect(() =>
      FairSchedulerConfigSchema.parse({
        strategy: "round-robin",
        rebalanceIntervalMs: 70_000,
      }),
    ).toThrow(/rebalanceIntervalMs/)
  })

  test("(5R+) RoundTripsValid — round-trip via JSON", () => {
    const original = {
      strategy: "priority-weighted" as const,
      rebalanceIntervalMs: 10_000,
      maxJobsPerWorker: 16,
    }
    const first = FairSchedulerConfigSchema.parse(original)
    const roundTripped = FairSchedulerConfigSchema.parse(
      JSON.parse(JSON.stringify(first)),
    )
    expect(roundTripped).toEqual(first)
  })
})

// ---------------------------------------------------------------------------
// DS-06 Resource quotas
// ---------------------------------------------------------------------------

describe("DS-06 QuotaSchema (6)", () => {
  test("(6) ParsesMinimal — empty input → all defaults (0 = unlimited)", () => {
    const parsed = QuotaSchema.parse({})
    expect(parsed.cpuMsPerHour).toBe(0)
    expect(parsed.memoryMbPeak).toBe(0)
    expect(parsed.networkBytesPerDay).toBe(0)
    expect(parsed.resetHourUtc).toBe(0)
  })

  test("(6R) RejectsInvalidResetHour — resetHourUtc: 24 rejected (> 23)", () => {
    expect(() => QuotaSchema.parse({ resetHourUtc: 24 })).toThrow(/resetHourUtc/)
  })

  test("(6R+) RoundTripsValid — round-trip with explicit values", () => {
    const original = {
      cpuMsPerHour: 60_000,
      memoryMbPeak: 1024,
      networkBytesPerDay: 1_000_000,
      resetHourUtc: 4,
    }
    const first = QuotaSchema.parse(original)
    const roundTripped = QuotaSchema.parse(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
  })
})

// ---------------------------------------------------------------------------
// DS-07 Global rate limiting
// ---------------------------------------------------------------------------

describe("DS-07 RateLimiterSchema (7)", () => {
  test("(7) AcceptsAllScopes — global/per-tenant/per-worker/per-workflow-run", () => {
    for (const scope of ["global", "per-tenant", "per-worker", "per-workflow-run"] as const) {
      const parsed = RateLimiterSchema.parse({
        maxRequests: 100,
        windowMs: 60_000,
        scope,
      })
      expect(parsed.scope).toBe(scope)
    }
  })

  test("(7R) RejectsTooLongWindow — 90_000_000ms rejected (> 24h)", () => {
    expect(() =>
      RateLimiterSchema.parse({
        maxRequests: 100,
        windowMs: 90_000_000,
        scope: "global",
      }),
    ).toThrow(/windowMs/)
  })
})

// ---------------------------------------------------------------------------
// DS-08 Budgets
// ---------------------------------------------------------------------------

describe("DS-08 BudgetSchema (8)", () => {
  test("(8) ParsesValid — all 6 fields parse", () => {
    const parsed = BudgetSchema.parse({
      budgetId: "bgt-1",
      scope: "monthly",
      currency: "USD",
      maxAmount: 10_000,
      currentSpend: 250,
      alertAt: 8_000,
      resetAt: 1_700_000_000_000,
    })
    expect(parsed.budgetId).toBe("bgt-1")
    expect(parsed.currency).toBe("USD")
    expect(parsed.maxAmount).toBe(10_000)
    expect(parsed.currentSpend).toBe(250)
    expect(parsed.alertAt).toBe(8_000)
  })

  test("(8R) RejectsCurrentOverMax — refine rejects currentSpend > maxAmount", () => {
    expect(() =>
      BudgetSchema.parse({
        budgetId: "bgt-over",
        scope: "monthly",
        currency: "USD",
        maxAmount: 1_000,
        currentSpend: 1_500,
      }),
    ).toThrow(/currentSpend/)
  })

  test("(8R+) AcceptsCurrentEqualMax — boundary case accepted (currentSpend === maxAmount)", () => {
    // The refine uses `currentSpend <= maxAmount`. Equality is allowed
    // because a fully-spent budget is a valid state (you just can't
    // spend any more). We pin this invariant here so a future change
    // to `<` does not silently regress.
    const parsed = BudgetSchema.parse({
      budgetId: "bgt-eq",
      scope: "one-off",
      currency: "EUR",
      maxAmount: BUDGET_MAX_AMOUNT,
      currentSpend: BUDGET_MAX_AMOUNT,
    })
    expect(parsed.currentSpend).toBe(BUDGET_MAX_AMOUNT)
    expect(parsed.maxAmount).toBe(BUDGET_MAX_AMOUNT)
  })

  test("(8++) AcceptsAllCurrencies — USD/EUR/GBP/JPY/CAD/AUD", () => {
    for (const currency of ["USD", "EUR", "GBP", "JPY", "CAD", "AUD"] as const) {
      const parsed = BudgetSchema.parse({
        budgetId: `bgt-${currency}`,
        scope: "monthly",
        currency,
        maxAmount: 1_000,
      })
      expect(parsed.currency).toBe(currency)
    }
  })
})
