// =============================================================================
// human-gate-manager.ts — TEAM-J05
//
// Holds a run at a decision only a human may make, and releases the resources
// it was holding while it waits.
//
// A human gate can wait for hours or days, so the tempting shortcut is a
// timeout that approves on expiry — it keeps the pipeline moving and it is
// how an unattended system ends up performing the exact action the gate
// existed to prevent. The rule here is therefore asymmetric:
//
//   A timeout may never approve. Expiry can only deny or keep waiting,
//   depending on the gate's declared policy, and for a critical gate the
//   policy cannot be anything but "keep waiting". Silence is not consent,
//   and for an irreversible action it is not even a tiebreaker.
//
//   Resources are released while waiting. A gate that keeps its lease and
//   worktree held for three days blocks every other card for a decision
//   nobody has looked at yet. Opening a gate returns what it held; resuming
//   re-acquires. That is also why a gate must be resumable from its record
//   rather than from a live process.
//
//   Every transition emits an event. A gate nobody is told about is a hang.
//   Events are the contract the UI and API render, so they are emitted for
//   opening, deciding, expiring and cancelling alike.
//
// Clock-free and pure: the caller supplies time and drains the events.
// =============================================================================

export const HUMAN_GATE_SCHEMA_VERSION = "1.0.0" as const;

export class HumanGateInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "HumanGateInputError";
  }
}

export type GateRisk = "low" | "medium" | "high" | "critical";

/**
 * What expiry does. `AUTO_APPROVE` deliberately does not exist: a gate that
 * approves itself is not a gate.
 */
export type TimeoutPolicy = "DENY_ON_TIMEOUT" | "WAIT_FOREVER";

export type GateState = "OPEN" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED";

export interface GateRequest {
  readonly gateId: string;
  readonly runId: string;
  readonly question: string;
  readonly risk: GateRisk;
  readonly timeoutPolicy: TimeoutPolicy;
  /** Milliseconds before expiry. Ignored when the policy is WAIT_FOREVER. */
  readonly timeoutMs: number | null;
  /** Leases and worktrees the run holds, released while the gate is open. */
  readonly heldResources: readonly string[];
}

export interface GateRecord {
  readonly schemaVersion: typeof HUMAN_GATE_SCHEMA_VERSION;
  readonly gateId: string;
  readonly runId: string;
  readonly question: string;
  readonly risk: GateRisk;
  readonly timeoutPolicy: TimeoutPolicy;
  readonly timeoutMs: number | null;
  readonly openedAtMs: number;
  readonly state: GateState;
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  readonly decidedAtMs: number | null;
  /** Released on open; a resume must re-acquire these. */
  readonly releasedResources: readonly string[];
}

export type GateEventKind = "OPENED" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED";

export interface GateEvent {
  readonly kind: GateEventKind;
  readonly gateId: string;
  readonly runId: string;
  readonly atMs: number;
  readonly detail: string;
}

export class HumanGateManager {
  private readonly gates = new Map<string, GateRecord>();
  private readonly events: GateEvent[] = [];

  /**
   * Open a gate, releasing what the run was holding.
   *
   * A critical gate may not carry a deny-on-timeout policy either: denying an
   * irreversible decision automatically is a decision too, and it is not one
   * silence should make.
   */
  open(request: GateRequest, nowMs: number): GateRecord {
    assertText(request.gateId, "gateId");
    assertText(request.runId, "runId");
    assertText(request.question, "question");
    if (this.gates.has(request.gateId)) {
      throw new HumanGateInputError(`gate ${request.gateId} already exists`);
    }
    if (request.timeoutPolicy === "DENY_ON_TIMEOUT") {
      if (request.risk === "critical") {
        throw new HumanGateInputError(
          "a critical gate cannot expire automatically; silence must not decide an irreversible action",
        );
      }
      if (request.timeoutMs === null || request.timeoutMs <= 0) {
        throw new HumanGateInputError("DENY_ON_TIMEOUT requires a positive timeoutMs");
      }
    }

    const record: GateRecord = {
      schemaVersion: HUMAN_GATE_SCHEMA_VERSION,
      gateId: request.gateId,
      runId: request.runId,
      question: request.question,
      risk: request.risk,
      timeoutPolicy: request.timeoutPolicy,
      timeoutMs: request.timeoutPolicy === "WAIT_FOREVER" ? null : request.timeoutMs,
      openedAtMs: nowMs,
      state: "OPEN",
      decidedBy: null,
      decisionReason: null,
      decidedAtMs: null,
      releasedResources: [...new Set(request.heldResources)].sort(),
    };
    this.gates.set(record.gateId, record);
    this.emit("OPENED", record, nowMs, `gate opened; released ${record.releasedResources.length} resource(s)`);
    return record;
  }

  /**
   * Apply elapsed time.
   *
   * Expiry can only deny. A gate whose policy is WAIT_FOREVER stays open for
   * as long as it takes, which is the correct behaviour for a decision that
   * has no safe default.
   */
  tick(nowMs: number): readonly GateRecord[] {
    const expired: GateRecord[] = [];
    for (const record of this.gates.values()) {
      if (record.state !== "OPEN") continue;
      if (record.timeoutPolicy !== "DENY_ON_TIMEOUT" || record.timeoutMs === null) continue;
      if (nowMs - record.openedAtMs < record.timeoutMs) continue;

      const next: GateRecord = {
        ...record,
        state: "EXPIRED",
        decidedAtMs: nowMs,
        decisionReason: `no answer within ${record.timeoutMs}ms; expired as denied because silence is not approval`,
      };
      this.gates.set(next.gateId, next);
      this.emit("EXPIRED", next, nowMs, next.decisionReason!);
      expired.push(next);
    }
    return expired;
  }

  approve(gateId: string, decidedBy: string, reason: string, nowMs: number): GateRecord {
    return this.decide(gateId, "APPROVED", decidedBy, reason, nowMs);
  }

  deny(gateId: string, decidedBy: string, reason: string, nowMs: number): GateRecord {
    return this.decide(gateId, "DENIED", decidedBy, reason, nowMs);
  }

  /** Cancel a gate whose run was abandoned, so it is not left waiting forever. */
  cancel(gateId: string, reason: string, nowMs: number): GateRecord {
    const record = this.require(gateId);
    if (record.state !== "OPEN") {
      throw new HumanGateInputError(`gate ${gateId} is already ${record.state}`);
    }
    const next: GateRecord = { ...record, state: "CANCELLED", decidedAtMs: nowMs, decisionReason: reason };
    this.gates.set(gateId, next);
    this.emit("CANCELLED", next, nowMs, reason);
    return next;
  }

  get(gateId: string): GateRecord | null {
    return this.gates.get(gateId) ?? null;
  }

  /** Resources a resume must re-acquire before continuing past this gate. */
  resourcesToReacquire(gateId: string): readonly string[] {
    return this.require(gateId).releasedResources;
  }

  /** Drain emitted events. The UI and API render exactly this stream. */
  drainEvents(): readonly GateEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private decide(
    gateId: string,
    state: "APPROVED" | "DENIED",
    decidedBy: string,
    reason: string,
    nowMs: number,
  ): GateRecord {
    assertText(decidedBy, "decidedBy");
    assertText(reason, "reason");
    const record = this.require(gateId);
    if (record.state !== "OPEN") {
      // An expired or cancelled gate must not be revived by a late answer:
      // the run has already moved on under the assumption it was refused.
      throw new HumanGateInputError(`gate ${gateId} is already ${record.state} and cannot be decided`);
    }
    const next: GateRecord = {
      ...record,
      state,
      decidedBy,
      decisionReason: reason,
      decidedAtMs: nowMs,
    };
    this.gates.set(gateId, next);
    this.emit(state, next, nowMs, `${decidedBy}: ${reason}`);
    return next;
  }

  private require(gateId: string): GateRecord {
    const record = this.gates.get(gateId);
    if (!record) throw new HumanGateInputError(`unknown gate ${gateId}`);
    return record;
  }

  private emit(kind: GateEventKind, record: GateRecord, atMs: number, detail: string): void {
    this.events.push({ kind, gateId: record.gateId, runId: record.runId, atMs, detail });
  }
}

function assertText(value: string, name: string): void {
  if (!value.trim()) throw new HumanGateInputError(`${name} must not be empty`);
}
