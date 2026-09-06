/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0 fake external effect provider (substrate-neutral).
 *
 * Per pack gelé §10, FC-04 demands a real, separately recorded
 * authority for "what happened externally". This module is that
 * authority for M0 qualification. It is **not** a mock: it persists
 * its own journal on disk, simulates provider-side idempotency, and
 * supports ACK loss to the candidate (FC-04 critical).
 *
 * The harness injects resolutions into the provider; the provider
 * records them durably; the candidate's driveAttempt() reads the
 * recorded resolution and either commits it or refuses to (depending
 * on the FC).
 *
 * The provider's store is NEVER the candidate's store — that's the
 * point: external effect results are an oracle the candidate does
 * not control.
 */

import { Database } from "bun:sqlite"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import {
  type UnifiaValue,
  canonicalEquals,
} from "@unifia/automate-m0-contract"
import type { ProviderResolution } from "../contract.ts"

/* ------------------------------------------------------------------ */
/* Provider record                                                     */
/* ------------------------------------------------------------------ */

interface ProviderRecord {
  readonly effectKey: string
  readonly idempotencyKey: string
  readonly outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN"
  readonly canonicalResult: UnifiaValue | null
  readonly providerCommittedAtEpochMs: number
  /** First call at this idempotency key (provider-side dedup). */
  readonly firstCall: boolean
}

/* ------------------------------------------------------------------ */
/* FakeExternalEffectProvider                                          */
/* ------------------------------------------------------------------ */

export interface FakeExternalProviderOptions {
  /** Directory where the provider journal is stored. */
  readonly storeDir: string
  /**
   * Whether to drop the ACK to the candidate. Used by FC-04.
   * If true, the provider records the resolution durably but
   * simulates a network failure to the candidate.
   */
  readonly dropAckToCandidate: boolean
  /**
   * Forced delay before the provider returns, in milliseconds.
   * Used to test timer behavior on the candidate.
   */
  readonly responseDelayMs?: number
}

export class FakeExternalEffectProvider {
  private db: Database | null = null
  private storeDir: string
  private options: FakeExternalProviderOptions
  /** Provider's own call log, separate from the durable record. */
  private callLog: { effectKey: string; idempotencyKey: string; wallClockEpochMs: number; ackDelivered: boolean }[] = []

  constructor(options: FakeExternalProviderOptions) {
    this.options = options
    this.storeDir = options.storeDir
  }

  async initialize(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true })
    this.db = new Database(join(this.storeDir, "fake-provider.sqlite"), { create: true })
    // bun:sqlite sets journal_mode=WAL and synchronous=FULL by default.
    // We make the intent explicit via PRAGMA for documentation.
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec("PRAGMA synchronous = FULL;")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_records (
        effect_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL PRIMARY KEY,
        outcome TEXT NOT NULL,
        canonical_result TEXT NOT NULL,
        provider_committed_at INTEGER NOT NULL
      )
    `)
  }

  async shutdown(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  /**
   * The candidate calls this. The provider records the resolution,
   * applies provider-side idempotency, and either delivers or drops
   * the ACK depending on `options.dropAckToCandidate`.
   */
  async resolve(effectKey: string, idempotencyKey: string, outcome: "SUCCEEDED" | "FAILED" | "UNKNOWN", canonicalResult: UnifiaValue | null, providerCommittedAtEpochMs: number): Promise<{ ackDelivered: boolean; record: ProviderRecord }> {
    if (!this.db) throw new Error("provider not initialized")

    // Provider-side idempotency: same idempotencyKey returns the same record.
    const existing = this.db
      .prepare(`SELECT effect_key, idempotency_key, outcome, canonical_result, provider_committed_at FROM provider_records WHERE idempotency_key = ?`)
      .get(idempotencyKey) as { effect_key: string; idempotency_key: string; outcome: string; canonical_result: string; provider_committed_at: number } | undefined
    if (existing) {
      this.callLog.push({ effectKey, idempotencyKey, wallClockEpochMs: Date.now(), ackDelivered: !this.options.dropAckToCandidate })
      return {
        ackDelivered: !this.options.dropAckToCandidate,
        record: {
          effectKey: existing.effect_key,
          idempotencyKey: existing.idempotency_key,
          outcome: existing.outcome as ProviderRecord["outcome"],
          canonicalResult: existing.canonical_result ? JSON.parse(existing.canonical_result) : null,
          providerCommittedAtEpochMs: existing.provider_committed_at,
          firstCall: false,
        },
      }
    }

    if (this.options.responseDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.responseDelayMs))
    }

    const canonicalResultStr = canonicalResult !== null ? JSON.stringify(canonicalResult) : ""

    this.db
      .prepare(
        `INSERT INTO provider_records (effect_key, idempotency_key, outcome, canonical_result, provider_committed_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(effectKey, idempotencyKey, outcome, canonicalResultStr, providerCommittedAtEpochMs)

    const ackDelivered = !this.options.dropAckToCandidate
    this.callLog.push({ effectKey, idempotencyKey, wallClockEpochMs: Date.now(), ackDelivered })

    return {
      ackDelivered,
      record: {
        effectKey,
        idempotencyKey,
        outcome,
        canonicalResult,
        providerCommittedAtEpochMs,
        firstCall: true,
      },
    }
  }

  /** Replay oracle: what does the provider say happened? */
  query(effectKey: string): ProviderRecord[] {
    if (!this.db) throw new Error("provider not initialized")
    const rows = this.db
      .prepare(`SELECT effect_key, idempotency_key, outcome, canonical_result, provider_committed_at FROM provider_records WHERE effect_key = ?`)
      .all(effectKey) as { effect_key: string; idempotency_key: string; outcome: string; canonical_result: string; provider_committed_at: number }[]
    return rows.map((r) => ({
      effectKey: r.effect_key,
      idempotencyKey: r.idempotency_key,
      outcome: r.outcome as ProviderRecord["outcome"],
      canonicalResult: r.canonical_result ? JSON.parse(r.canonical_result) : null,
      providerCommittedAtEpochMs: r.provider_committed_at,
      firstCall: true,
    }))
  }

  /**
   * Force the provider to return a particular resolution for the next
   * call. The harness uses this to inject FAIL or UNKNOWN at specific
   * logical invocations.
   */
  setNextResolution(resolution: ProviderResolution): void {
    this.nextResolution = resolution
  }
  private nextResolution: ProviderResolution | null = null
  consumeNextResolution(): ProviderResolution | null {
    const r = this.nextResolution
    this.nextResolution = null
    return r
  }

  get callHistory(): readonly { effectKey: string; idempotencyKey: string; wallClockEpochMs: number; ackDelivered: boolean }[] {
    return this.callLog
  }

  async destroy(): Promise<void> {
    await this.shutdown()
    await rm(this.storeDir, { recursive: true, force: true })
  }

  /** Helper: compare provider's persisted record to the candidate's observation. */
  static recordsMatch(observed: { canonicalOutput: UnifiaValue | null; status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "CANCELLED" | "RUNNING" }, provider: ProviderRecord): boolean {
    if (observed.status !== provider.outcome && !(observed.status === "RUNNING")) return false
    if (observed.canonicalOutput === null && provider.canonicalResult === null) return true
    if (observed.canonicalOutput === null || provider.canonicalResult === null) return false
    return canonicalEquals(observed.canonicalOutput, provider.canonicalResult as UnifiaValue)
  }
}
