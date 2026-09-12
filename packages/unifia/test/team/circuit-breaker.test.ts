import { describe, expect, test } from "bun:test";
import {
  CircuitBreakerInputError,
  CircuitBreakerRegistry,
  DEFAULT_CIRCUIT_POLICY,
  type CircuitBreakerPolicy,
} from "../../src/team/circuit-breaker";

const POLICY: CircuitBreakerPolicy = { failureThreshold: 3, cooldownMs: 1_000, successThreshold: 2 };
const KEY = "anthropic::sonnet";

function registry(policy = POLICY) {
  return new CircuitBreakerRegistry(policy);
}

/** Drive a circuit to OPEN with the minimum number of retryable failures. */
function open(reg: CircuitBreakerRegistry, at = 0) {
  for (let i = 0; i < POLICY.failureThreshold; i++) reg.recordFailure(KEY, "TIMEOUT", at);
  return reg;
}

describe("CircuitBreakerRegistry — opening", () => {
  test("stays closed below the failure threshold", () => {
    const reg = registry();
    reg.recordFailure(KEY, "TIMEOUT", 0);
    reg.recordFailure(KEY, "TIMEOUT", 0);

    expect(reg.stateOf(KEY, 0)).toBe("CLOSED");
    expect(reg.admit(KEY, 0).allowed).toBe(true);
  });

  test("opens on the threshold failure", () => {
    const reg = open(registry());

    expect(reg.stateOf(KEY, 0)).toBe("OPEN");
    expect(reg.admit(KEY, 0).allowed).toBe(false);
  });

  test("a success resets the failure count", () => {
    const reg = registry();
    reg.recordFailure(KEY, "TIMEOUT", 0);
    reg.recordFailure(KEY, "TIMEOUT", 0);
    reg.recordSuccess(KEY, 0);
    reg.recordFailure(KEY, "TIMEOUT", 0);

    expect(reg.stateOf(KEY, 0)).toBe("CLOSED");
  });

  test("only retryable failures count toward opening", () => {
    // A cooldown does not fix a bad key or an exhausted quota, so counting
    // them would open a circuit that closing again cannot help.
    const reg = registry();
    for (const category of ["AUTH", "QUOTA_EXCEEDED", "INVALID_REQUEST", "CONTENT_POLICY"] as const) {
      reg.recordFailure(KEY, category, 0);
      reg.recordFailure(KEY, category, 0);
      reg.recordFailure(KEY, category, 0);
    }

    expect(reg.stateOf(KEY, 0)).toBe("CLOSED");
  });

  test("tracks circuits independently per endpoint", () => {
    const reg = open(registry());

    expect(reg.stateOf(KEY, 0)).toBe("OPEN");
    expect(reg.stateOf("openai::gpt", 0)).toBe("CLOSED");
  });
});

describe("CircuitBreakerRegistry — acceptance: no thundering herd", () => {
  test("moves to HALF_OPEN once the cooldown elapses", () => {
    const reg = open(registry());

    expect(reg.stateOf(KEY, POLICY.cooldownMs - 1)).toBe("OPEN");
    expect(reg.stateOf(KEY, POLICY.cooldownMs)).toBe("HALF_OPEN");
  });

  test("admits exactly one probe and refuses every other caller", () => {
    // Letting everyone through the instant the cooldown expires is how a
    // struggling provider is knocked over a second time.
    const reg = open(registry());
    const at = POLICY.cooldownMs;

    const first = reg.admit(KEY, at);
    expect(first.allowed).toBe(true);
    expect(first.allowed && first.asProbe).toBe(true);

    for (let i = 0; i < 10; i++) {
      const other = reg.admit(KEY, at);
      expect(other.allowed).toBe(false);
      expect(other.state).toBe("HALF_OPEN");
    }
  });

  test("releases the probe token when the probe fails, without admitting a herd", () => {
    const reg = open(registry());
    const at = POLICY.cooldownMs;
    reg.admit(KEY, at);
    reg.recordFailure(KEY, "TIMEOUT", at);

    // A failed probe reopens: the endpoint just demonstrated it is still down.
    expect(reg.stateOf(KEY, at)).toBe("OPEN");
    expect(reg.admit(KEY, at).allowed).toBe(false);
  });

  test("requires successThreshold probes before closing", () => {
    const reg = open(registry());
    const at = POLICY.cooldownMs;

    reg.admit(KEY, at);
    reg.recordSuccess(KEY, at);
    expect(reg.stateOf(KEY, at)).toBe("HALF_OPEN");

    reg.admit(KEY, at);
    reg.recordSuccess(KEY, at);
    expect(reg.stateOf(KEY, at)).toBe("CLOSED");
  });

  test("a fresh probe token is available after a successful but insufficient probe", () => {
    const reg = open(registry());
    const at = POLICY.cooldownMs;
    reg.admit(KEY, at);
    reg.recordSuccess(KEY, at);

    const next = reg.admit(KEY, at);
    expect(next.allowed).toBe(true);
    expect(next.allowed && next.asProbe).toBe(true);
  });

  test("a reopened circuit serves a new cooldown from the reopen instant", () => {
    const reg = open(registry());
    const firstProbeAt = POLICY.cooldownMs;
    reg.admit(KEY, firstProbeAt);
    reg.recordFailure(KEY, "TIMEOUT", firstProbeAt);

    expect(reg.stateOf(KEY, firstProbeAt + POLICY.cooldownMs - 1)).toBe("OPEN");
    expect(reg.stateOf(KEY, firstProbeAt + POLICY.cooldownMs)).toBe("HALF_OPEN");
  });
});

describe("CircuitBreakerRegistry — acceptance: crash persistence", () => {
  test("an open circuit survives a restart", () => {
    // A breaker whose memory dies with the process protects nothing across
    // exactly the failure it exists for.
    const snapshot = open(registry()).export();
    const restored = new CircuitBreakerRegistry(POLICY, snapshot);

    expect(restored.stateOf(KEY, 0)).toBe("OPEN");
    expect(restored.admit(KEY, 0).allowed).toBe(false);
  });

  test("the cooldown continues from the original outage, not from process boot", () => {
    const reg = open(registry(), 500);
    const restored = new CircuitBreakerRegistry(POLICY, reg.export());

    // Opened at 500 with a 1000ms cooldown -> half-open at 1500, whenever the
    // process happened to restart.
    expect(restored.stateOf(KEY, 1_499)).toBe("OPEN");
    expect(restored.stateOf(KEY, 1_500)).toBe("HALF_OPEN");
  });

  test("clears an in-flight probe on restore, since the holder is gone", () => {
    const reg = open(registry());
    reg.admit(KEY, POLICY.cooldownMs);
    expect(reg.snapshotOf(KEY).probeInFlight).toBe(true);

    const restored = new CircuitBreakerRegistry(POLICY, reg.export());
    const admission = restored.admit(KEY, POLICY.cooldownMs);

    // Otherwise the circuit is stuck half-open forever holding a token
    // nobody will return.
    expect(admission.allowed).toBe(true);
    expect(admission.allowed && admission.asProbe).toBe(true);
  });

  test("round-trips every circuit deterministically, sorted by endpoint", () => {
    const reg = registry();
    reg.recordFailure("z::m", "TIMEOUT", 0);
    reg.recordFailure("a::m", "NETWORK", 0);

    const snapshot = reg.export();
    expect(snapshot.circuits.map((circuit) => circuit.endpointKey)).toEqual(["a::m", "z::m"]);
    expect(new CircuitBreakerRegistry(POLICY, snapshot).export()).toEqual(snapshot);
  });

  test("preserves the failure count across a restart, so a restart is not a free retry", () => {
    const reg = registry();
    reg.recordFailure(KEY, "TIMEOUT", 0);
    reg.recordFailure(KEY, "TIMEOUT", 0);

    const restored = new CircuitBreakerRegistry(POLICY, reg.export());
    restored.recordFailure(KEY, "TIMEOUT", 0);

    expect(restored.stateOf(KEY, 0)).toBe("OPEN");
  });
});

describe("CircuitBreakerRegistry — acceptance: manual reset is audited", () => {
  test("closes the circuit and records actor, reason and previous state", () => {
    // Reset while still inside the cooldown, so the recorded previous state
    // is OPEN. The record captures the *effective* state at reset time, which
    // is why a reset after the cooldown records HALF_OPEN instead.
    const reg = open(registry());
    const snapshot = reg.manualReset(KEY, "erwan", "provider confirmed healthy", 500);

    expect(snapshot.state).toBe("CLOSED");
    expect(snapshot.manualResets).toHaveLength(1);
    expect(snapshot.manualResets[0]).toEqual({
      actor: "erwan",
      reason: "provider confirmed healthy",
      atMs: 500,
      previousState: "OPEN",
    });
  });

  test("records the effective state, so a reset after the cooldown says HALF_OPEN", () => {
    const reg = open(registry());
    const snapshot = reg.manualReset(KEY, "erwan", "override", 5_000);

    expect(snapshot.manualResets[0]!.previousState).toBe("HALF_OPEN");
  });

  test("refuses a reset with no actor or no reason", () => {
    const reg = open(registry());

    expect(() => reg.manualReset(KEY, "  ", "why", 0)).toThrow(CircuitBreakerInputError);
    expect(() => reg.manualReset(KEY, "erwan", "  ", 0)).toThrow(CircuitBreakerInputError);
  });

  test("keeps the override history across later resets and successes", () => {
    // The history of overrides is what explains an outage afterwards.
    const reg = open(registry());
    reg.manualReset(KEY, "erwan", "first", 1);
    open(reg, 10);
    reg.manualReset(KEY, "erwan", "second", 20);
    reg.recordSuccess(KEY, 21);

    expect(reg.snapshotOf(KEY).manualResets.map((item) => item.reason)).toEqual(["first", "second"]);
  });

  test("the audit trail survives persistence", () => {
    const reg = open(registry());
    reg.manualReset(KEY, "erwan", "documented override", 5_000);
    const restored = new CircuitBreakerRegistry(POLICY, reg.export());

    expect(restored.snapshotOf(KEY).manualResets[0]!.actor).toBe("erwan");
  });
});

describe("CircuitBreakerRegistry — input integrity", () => {
  test("rejects a nonsensical policy", () => {
    expect(() => new CircuitBreakerRegistry({ ...POLICY, failureThreshold: 0 })).toThrow(CircuitBreakerInputError);
    expect(() => new CircuitBreakerRegistry({ ...POLICY, successThreshold: 0 })).toThrow(CircuitBreakerInputError);
    expect(() => new CircuitBreakerRegistry({ ...POLICY, cooldownMs: -1 })).toThrow(CircuitBreakerInputError);
  });

  test("rejects a non-finite clock reading", () => {
    const reg = registry();

    expect(() => reg.stateOf(KEY, Number.NaN)).toThrow(CircuitBreakerInputError);
    expect(() => reg.admit(KEY, Number.POSITIVE_INFINITY)).toThrow(CircuitBreakerInputError);
  });

  test("reports an unknown endpoint as closed without inventing state", () => {
    const reg = registry();

    expect(reg.stateOf("never::seen", 0)).toBe("CLOSED");
    expect(reg.export().circuits).toEqual([]);
  });

  test("the default policy is usable and conservative", () => {
    expect(DEFAULT_CIRCUIT_POLICY.failureThreshold).toBeGreaterThan(1);
    expect(DEFAULT_CIRCUIT_POLICY.successThreshold).toBeGreaterThan(1);
    expect(DEFAULT_CIRCUIT_POLICY.cooldownMs).toBeGreaterThan(0);
  });
});
