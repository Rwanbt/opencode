import { isRetryable, type FailureCategory } from "./failure-classifier";

// =============================================================================
// circuit-breaker.ts — TEAM-J02
//
// Stops calling an endpoint that keeps failing, and controls how it is let
// back in.
//
// A breaker is easy to open and hard to close correctly. Three properties
// carry the weight here:
//
//   It survives a crash. State lives in a snapshot the caller persists, not
//   in process memory, so a restart does not resurrect a dead provider at
//   full traffic. A breaker whose memory dies with the process protects
//   nothing across exactly the failure it exists for.
//
//   It admits one probe, not a herd. HALF_OPEN grants a single probe token
//   at a time. Letting every waiting caller through at the moment the cooldown
//   expires is how a struggling provider is knocked over a second time — and
//   the retry storm then reads as a fresh outage rather than as self-inflicted
//   load.
//
//   A manual reset is recorded. Forcing a breaker closed is an override of a
//   safety mechanism, so it is auditable: who, when, why. An unlogged manual
//   reset makes the next outage impossible to explain.
//
// Only retryable failures count toward opening. A permanent failure — a bad
// key, an exhausted quota — is not something a cooldown fixes, and counting
// it would open a breaker that closing again cannot help.
//
// Clock-free: the caller supplies `now`, so the same sequence of events always
// produces the same state and tests need no timer.
// =============================================================================

export const CIRCUIT_BREAKER_SCHEMA_VERSION = "1.0.0" as const;

export class CircuitBreakerInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CircuitBreakerInputError";
  }
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerPolicy {
  /** Consecutive retryable failures that open the circuit. */
  readonly failureThreshold: number;
  /** Milliseconds a circuit stays OPEN before a probe is allowed. */
  readonly cooldownMs: number;
  /** Consecutive probe successes required to close again. */
  readonly successThreshold: number;
}

export const DEFAULT_CIRCUIT_POLICY: CircuitBreakerPolicy = Object.freeze({
  failureThreshold: 5,
  cooldownMs: 30_000,
  successThreshold: 2,
});

export interface ManualResetRecord {
  readonly actor: string;
  readonly reason: string;
  readonly atMs: number;
  readonly previousState: CircuitState;
}

/** Serialisable circuit state — the unit of crash persistence. */
export interface CircuitSnapshot {
  readonly endpointKey: string;
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly consecutiveProbeSuccesses: number;
  /** When the circuit opened; `null` unless OPEN or HALF_OPEN. */
  readonly openedAtMs: number | null;
  /** True while a HALF_OPEN probe is outstanding — the anti-herd token. */
  readonly probeInFlight: boolean;
  readonly manualResets: readonly ManualResetRecord[];
}

export interface RegistrySnapshot {
  readonly schemaVersion: typeof CIRCUIT_BREAKER_SCHEMA_VERSION;
  readonly circuits: readonly CircuitSnapshot[];
}

export type AdmissionDecision =
  | { readonly allowed: true; readonly asProbe: boolean; readonly state: CircuitState }
  | { readonly allowed: false; readonly state: CircuitState; readonly reason: string };

function freshCircuit(endpointKey: string): CircuitSnapshot {
  return {
    endpointKey,
    state: "CLOSED",
    consecutiveFailures: 0,
    consecutiveProbeSuccesses: 0,
    openedAtMs: null,
    probeInFlight: false,
    manualResets: [],
  };
}

export class CircuitBreakerRegistry {
  private readonly circuits = new Map<string, CircuitSnapshot>();

  constructor(
    private readonly policy: CircuitBreakerPolicy = DEFAULT_CIRCUIT_POLICY,
    restoreFrom?: RegistrySnapshot,
  ) {
    if (policy.failureThreshold < 1 || policy.successThreshold < 1 || policy.cooldownMs < 0) {
      throw new CircuitBreakerInputError("thresholds must be >= 1 and cooldownMs >= 0");
    }
    if (restoreFrom) this.restore(restoreFrom);
  }

  /**
   * Rebuild from a persisted snapshot.
   *
   * A restored OPEN circuit stays OPEN with its original `openedAtMs`, so the
   * cooldown continues from when the outage started rather than restarting at
   * process boot. Otherwise a crash-loop would reset the cooldown on every
   * restart and hammer a provider that is already down.
   */
  restore(snapshot: RegistrySnapshot): void {
    this.circuits.clear();
    for (const circuit of snapshot.circuits) {
      // A probe cannot be in flight across a restart: whatever process held
      // it is gone. Clearing it prevents a circuit being stuck permanently
      // half-open with a token nobody will ever return.
      this.circuits.set(circuit.endpointKey, { ...circuit, probeInFlight: false });
    }
  }

  export(): RegistrySnapshot {
    return {
      schemaVersion: CIRCUIT_BREAKER_SCHEMA_VERSION,
      circuits: [...this.circuits.values()].sort((a, b) => a.endpointKey.localeCompare(b.endpointKey)),
    };
  }

  stateOf(endpointKey: string, nowMs: number): CircuitState {
    return this.effective(endpointKey, nowMs).state;
  }

  snapshotOf(endpointKey: string): CircuitSnapshot {
    return this.circuits.get(endpointKey) ?? freshCircuit(endpointKey);
  }

  /**
   * Ask whether a call may proceed.
   *
   * In HALF_OPEN exactly one caller receives `asProbe: true`; every other is
   * refused until that probe reports back. That single token is what keeps a
   * herd from arriving the instant the cooldown expires.
   */
  admit(endpointKey: string, nowMs: number): AdmissionDecision {
    const circuit = this.effective(endpointKey, nowMs);

    if (circuit.state === "CLOSED") {
      this.circuits.set(endpointKey, circuit);
      return { allowed: true, asProbe: false, state: "CLOSED" };
    }

    if (circuit.state === "OPEN") {
      this.circuits.set(endpointKey, circuit);
      return {
        allowed: false,
        state: "OPEN",
        reason: `circuit open for ${endpointKey}; cooling down until ${(circuit.openedAtMs ?? 0) + this.policy.cooldownMs}`,
      };
    }

    if (circuit.probeInFlight) {
      this.circuits.set(endpointKey, circuit);
      return { allowed: false, state: "HALF_OPEN", reason: "a probe is already in flight for this endpoint" };
    }

    this.circuits.set(endpointKey, { ...circuit, probeInFlight: true });
    return { allowed: true, asProbe: true, state: "HALF_OPEN" };
  }

  /** Record a success. Closes the circuit once enough probes have succeeded. */
  recordSuccess(endpointKey: string, nowMs: number): CircuitSnapshot {
    const circuit = this.effective(endpointKey, nowMs);

    if (circuit.state !== "HALF_OPEN") {
      const closed = { ...freshCircuit(endpointKey), manualResets: circuit.manualResets };
      this.circuits.set(endpointKey, closed);
      return closed;
    }

    const successes = circuit.consecutiveProbeSuccesses + 1;
    const next: CircuitSnapshot =
      successes >= this.policy.successThreshold
        ? { ...freshCircuit(endpointKey), manualResets: circuit.manualResets }
        : { ...circuit, consecutiveProbeSuccesses: successes, probeInFlight: false };
    this.circuits.set(endpointKey, next);
    return next;
  }

  /**
   * Record a failure.
   *
   * Only retryable categories count toward opening: a cooldown does not fix a
   * bad key or an exhausted quota, so counting them would open a circuit that
   * closing again cannot help. A failed probe reopens immediately — the
   * endpoint has just demonstrated it is still down.
   */
  recordFailure(endpointKey: string, category: FailureCategory, nowMs: number): CircuitSnapshot {
    const circuit = this.effective(endpointKey, nowMs);

    if (!isRetryable(category)) {
      const unchanged = { ...circuit, probeInFlight: false };
      this.circuits.set(endpointKey, unchanged);
      return unchanged;
    }

    if (circuit.state === "HALF_OPEN") {
      const reopened: CircuitSnapshot = {
        ...circuit,
        state: "OPEN",
        openedAtMs: nowMs,
        consecutiveProbeSuccesses: 0,
        probeInFlight: false,
      };
      this.circuits.set(endpointKey, reopened);
      return reopened;
    }

    const failures = circuit.consecutiveFailures + 1;
    const next: CircuitSnapshot =
      failures >= this.policy.failureThreshold
        ? { ...circuit, state: "OPEN", consecutiveFailures: failures, openedAtMs: nowMs, probeInFlight: false }
        : { ...circuit, consecutiveFailures: failures };
    this.circuits.set(endpointKey, next);
    return next;
  }

  /**
   * Force a circuit closed.
   *
   * Overriding a safety mechanism has to leave a trace, so actor and reason
   * are required and the record is kept with the circuit — including across
   * a later reset, since the history of overrides is what explains an outage
   * afterwards.
   */
  manualReset(endpointKey: string, actor: string, reason: string, nowMs: number): CircuitSnapshot {
    if (!actor.trim()) throw new CircuitBreakerInputError("manual reset requires an actor");
    if (!reason.trim()) throw new CircuitBreakerInputError("manual reset requires a reason");

    const circuit = this.effective(endpointKey, nowMs);
    const reset: CircuitSnapshot = {
      ...freshCircuit(endpointKey),
      manualResets: [
        ...circuit.manualResets,
        { actor, reason, atMs: nowMs, previousState: circuit.state },
      ],
    };
    this.circuits.set(endpointKey, reset);
    return reset;
  }

  /** Apply elapsed time: an OPEN circuit past its cooldown becomes HALF_OPEN. */
  private effective(endpointKey: string, nowMs: number): CircuitSnapshot {
    if (!Number.isFinite(nowMs)) throw new CircuitBreakerInputError("nowMs must be a finite number");
    const circuit = this.circuits.get(endpointKey) ?? freshCircuit(endpointKey);
    if (circuit.state !== "OPEN" || circuit.openedAtMs === null) return circuit;
    if (nowMs - circuit.openedAtMs < this.policy.cooldownMs) return circuit;
    return { ...circuit, state: "HALF_OPEN", consecutiveProbeSuccesses: 0, probeInFlight: false };
  }
}
