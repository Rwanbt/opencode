/* SPDX-License-Identifier: MIT */
/**
 * Distributed Server contracts (Plan V2.3.1 §208, ADR-008, ADR-009).
 *
 * Defines the primitives for a multi-worker orchestrator: worker
 * registry, leases with fencing, work queues, fair scheduling,
 * resource quotas, rate limiting, and budgets. The contracts here
 * are the *shape*; the runtime enforcement is in the worktree's
 * scheduler package (out of scope for M2/M3/Post-M3-contracts).
 *
 * The `fencing` invariant is the keystone: a fencing token is a
 * monotonically increasing counter attached to a lease. When a
 * worker's lease expires (network partition, crash, slow GC), the
 * control plane increments the token; the next attempt by the
 * zombie worker is rejected with `STALE_FENCING_TOKEN` and cannot
 * dispatch side effects.
 */
import { z } from "zod"

// DS-01 Worker registry
export const WORKER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/
export const WORKER_HEARTBEAT_TIMEOUT_MS = 30_000

export const WorkerStatusSchema = z.enum(["registering", "active", "draining", "dead"])
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>

export const WorkerRegistrationSchema = z.object({
  workerId: z.string().regex(WORKER_ID_PATTERN, "server: workerId must match /^[a-zA-Z0-9_-]{1,128}$/"),
  serviceId: z.string().min(1).max(256),
  capabilities: z.array(z.string()).readonly(),
  registeredAt: z.number().int().nonnegative(),
  lastHeartbeat: z.number().int().nonnegative(),
  status: WorkerStatusSchema,
})
export type WorkerRegistration = z.infer<typeof WorkerRegistrationSchema>

export function parseWorkerRegistration(input: unknown): WorkerRegistration {
  return WorkerRegistrationSchema.parse(input)
}

// DS-02 Leases
export const LEASE_MAX_DURATION_MS = 24 * 60 * 60 * 1000  // 24h
export const LEASE_MIN_DURATION_MS = 1_000  // 1 second

export const LeaseSchema = z.object({
  leaseId: z.string().min(1).max(128),
  holder: z.string().min(1).max(128),
  acquiredAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  fencingToken: z.number().int().positive(),
  resource: z.string().min(1).max(512),
})
export type Lease = z.infer<typeof LeaseSchema>

// DS-03 Fencing
export const FencingTokenSchema = z.object({
  token: z.number().int().positive(),
  issuedAt: z.number().int().nonnegative(),
  /** The previous token — used to reject a zombie worker holding an old token. */
  predecessor: z.number().int().positive().optional(),
})
export type FencingToken = z.infer<typeof FencingTokenSchema>

export function isValidFencingToken(candidate: FencingToken, lastKnown: number): boolean {
  return candidate.token > lastKnown
}

// DS-04 Queues
export const QUEUE_MAX_ITEMS = 100_000
export const QUEUE_MAX_NAME_CHARS = 128

export const QueuePrioritySchema = z.enum(["low", "normal", "high", "critical"])
export type QueuePriority = z.infer<typeof QueuePrioritySchema>

export const QueueItemSchema = z.object({
  itemId: z.string().min(1).max(128),
  enqueuedAt: z.number().int().nonnegative(),
  priority: QueuePrioritySchema,
  payload: z.record(z.string(), z.unknown()),
  attempts: z.number().int().nonnegative().default(0),
  /** Optional deadline — items past this are dropped on dequeue. */
  deadline: z.number().int().nonnegative().optional(),
})
export type QueueItem = z.infer<typeof QueueItemSchema>

export const WorkQueueSchema = z.object({
  name: z.string().min(1).max(QUEUE_MAX_NAME_CHARS),
  /** Maximum number of items the queue may hold. */
  maxItems: z.number().int().positive().max(QUEUE_MAX_ITEMS).default(10_000),
  /** FIFO/LIFO. Default FIFO. */
  ordering: z.enum(["fifo", "lifo"]).default("fifo"),
})
export type WorkQueue = z.infer<typeof WorkQueueSchema>

// DS-05 Fair scheduling
export const SCHEDULING_STRATEGY_VALUES = ["round-robin", "least-loaded", "priority-weighted", "random"] as const

export const FairSchedulerConfigSchema = z.object({
  strategy: z.enum(SCHEDULING_STRATEGY_VALUES),
  /** Re-balance interval in milliseconds. */
  rebalanceIntervalMs: z.number().int().positive().max(60_000).default(5_000),
  /** Maximum jobs in flight per worker. */
  maxJobsPerWorker: z.number().int().positive().max(1024).default(8),
})
export type FairSchedulerConfig = z.infer<typeof FairSchedulerConfigSchema>

// DS-06 Resource quotas
export const QUOTA_DEFAULT_RESET_HOUR = 0  // midnight UTC

export const QuotaSchema = z.object({
  /** CPU time allowed per hour, in milliseconds. 0 = unlimited. */
  cpuMsPerHour: z.number().int().nonnegative().max(3_600_000).default(0),
  /** Memory peak allowed, in MB. 0 = unlimited. */
  memoryMbPeak: z.number().int().nonnegative().max(65536).default(0),
  /** Network bytes per day (in+out). 0 = unlimited. */
  networkBytesPerDay: z.number().int().nonnegative().max(1_099_511_627_776).default(0),
  /** UTC hour at which the daily counters reset. */
  resetHourUtc: z.number().int().min(0).max(23).default(QUOTA_DEFAULT_RESET_HOUR),
})
export type Quota = z.infer<typeof QuotaSchema>

// DS-07 Global rate limiting
export const RATE_LIMIT_MAX_REQUESTS = 1_000_000
export const RATE_LIMIT_MAX_WINDOW_MS = 24 * 60 * 60 * 1000  // 24h

export const RateLimiterSchema = z.object({
  /** Max requests in the window. */
  maxRequests: z.number().int().positive().max(RATE_LIMIT_MAX_REQUESTS),
  /** Window duration in milliseconds. */
  windowMs: z.number().int().positive().max(RATE_LIMIT_MAX_WINDOW_MS),
  /** Per what key the limit is applied. */
  scope: z.enum(["global", "per-tenant", "per-worker", "per-workflow-run"]),
})
export type RateLimiter = z.infer<typeof RateLimiterSchema>

// DS-08 Budgets
export const BUDGET_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD"] as const
export const BUDGET_MIN_AMOUNT = 0
export const BUDGET_MAX_AMOUNT = 1_000_000  // 1M units

export const BudgetSchema = z.object({
  budgetId: z.string().min(1).max(128),
  scope: z.enum(["monthly", "quarterly", "annual", "one-off"]),
  currency: z.enum(BUDGET_CURRENCIES),
  /** Maximum spend. */
  maxAmount: z.number().min(BUDGET_MIN_AMOUNT).max(BUDGET_MAX_AMOUNT),
  /** Current spend (must be ≤ maxAmount). */
  currentSpend: z.number().min(BUDGET_MIN_AMOUNT).max(BUDGET_MAX_AMOUNT).default(0),
  /** Optional alert threshold. */
  alertAt: z.number().min(BUDGET_MIN_AMOUNT).max(BUDGET_MAX_AMOUNT).optional(),
  resetAt: z.number().int().nonnegative().optional(),
}).refine(
  (b) => b.currentSpend <= b.maxAmount,
  { message: "budget: currentSpend must be ≤ maxAmount" },
)
export type Budget = z.infer<typeof BudgetSchema>

export function parseBudget(input: unknown): Budget {
  return BudgetSchema.parse(input)
}
