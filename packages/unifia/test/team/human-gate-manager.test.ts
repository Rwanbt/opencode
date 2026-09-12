import { describe, expect, test } from "bun:test";
import {
  HumanGateInputError,
  HumanGateManager,
  type GateRequest,
} from "../../src/team/human-gate-manager";

function gateRequest(overrides: Partial<GateRequest> = {}): GateRequest {
  return {
    gateId: "gate-1",
    runId: "run-1",
    question: "Publish the release?",
    risk: "medium",
    timeoutPolicy: "WAIT_FOREVER",
    timeoutMs: null,
    heldResources: ["lease-1", "worktree-1"],
    ...overrides,
  };
}

function manager() {
  return new HumanGateManager();
}

describe("HumanGateManager — acceptance: a timeout never approves", () => {
  test("expiry denies rather than approves", () => {
    // A gate that approves itself is not a gate.
    const mgr = manager();
    mgr.open(gateRequest({ timeoutPolicy: "DENY_ON_TIMEOUT", timeoutMs: 1_000 }), 0);
    const expired = mgr.tick(1_000);

    expect(expired).toHaveLength(1);
    expect(expired[0]!.state).toBe("EXPIRED");
    expect(expired[0]!.decisionReason).toContain("silence is not approval");
  });

  test("offers no auto-approve policy at all", () => {
    // The type has two members; neither approves. This asserts the runtime
    // behaviour for both, so adding a third could not silently pass.
    const mgr = manager();
    mgr.open(gateRequest({ gateId: "a", timeoutPolicy: "WAIT_FOREVER" }), 0);
    mgr.open(gateRequest({ gateId: "b", timeoutPolicy: "DENY_ON_TIMEOUT", timeoutMs: 10 }), 0);
    mgr.tick(1_000_000);

    expect(mgr.get("a")!.state).toBe("OPEN");
    expect(mgr.get("b")!.state).toBe("EXPIRED");
  });

  test("refuses a critical gate that would expire automatically", () => {
    // Denying an irreversible decision automatically is a decision too.
    const mgr = manager();

    expect(() =>
      mgr.open(gateRequest({ risk: "critical", timeoutPolicy: "DENY_ON_TIMEOUT", timeoutMs: 1_000 }), 0),
    ).toThrow(HumanGateInputError);
  });

  test("a critical gate waits indefinitely", () => {
    const mgr = manager();
    mgr.open(gateRequest({ risk: "critical", timeoutPolicy: "WAIT_FOREVER" }), 0);
    mgr.tick(365 * 24 * 3_600_000);

    expect(mgr.get("gate-1")!.state).toBe("OPEN");
  });

  test("does not expire before the deadline", () => {
    const mgr = manager();
    mgr.open(gateRequest({ timeoutPolicy: "DENY_ON_TIMEOUT", timeoutMs: 1_000 }), 0);

    expect(mgr.tick(999)).toHaveLength(0);
    expect(mgr.get("gate-1")!.state).toBe("OPEN");
  });

  test("requires a positive timeout when the policy is to expire", () => {
    const mgr = manager();

    expect(() => mgr.open(gateRequest({ timeoutPolicy: "DENY_ON_TIMEOUT", timeoutMs: null }), 0)).toThrow(
      HumanGateInputError,
    );
    expect(() => mgr.open(gateRequest({ timeoutPolicy: "DENY_ON_TIMEOUT", timeoutMs: 0 }), 0)).toThrow(
      HumanGateInputError,
    );
  });

  test("refuses a late answer to an expired gate", () => {
    // The run already moved on assuming refusal; reviving it would act on a
    // decision the run has not seen.
    const mgr = manager();
    mgr.open(gateRequest({ timeoutPolicy: "DENY_ON_TIMEOUT", timeoutMs: 100 }), 0);
    mgr.tick(100);

    expect(() => mgr.approve("gate-1", "erwan", "late yes", 200)).toThrow(HumanGateInputError);
  });
});

describe("HumanGateManager — acceptance: resources are released while waiting", () => {
  test("releases what the run held when the gate opens", () => {
    // A gate holding a lease for three days blocks every other card for a
    // decision nobody has looked at yet.
    const mgr = manager();
    const record = mgr.open(gateRequest({ heldResources: ["worktree-1", "lease-1"] }), 0);

    expect(record.releasedResources).toEqual(["lease-1", "worktree-1"]);
  });

  test("tells a resume exactly what to re-acquire", () => {
    const mgr = manager();
    mgr.open(gateRequest(), 0);
    mgr.approve("gate-1", "erwan", "go ahead", 10);

    expect(mgr.resourcesToReacquire("gate-1")).toEqual(["lease-1", "worktree-1"]);
  });

  test("deduplicates and sorts released resources", () => {
    const mgr = manager();
    const record = mgr.open(gateRequest({ heldResources: ["b", "a", "b"] }), 0);

    expect(record.releasedResources).toEqual(["a", "b"]);
  });

  test("records the release even for a gate that later expires", () => {
    const mgr = manager();
    mgr.open(gateRequest({ timeoutPolicy: "DENY_ON_TIMEOUT", timeoutMs: 10 }), 0);
    mgr.tick(10);

    expect(mgr.resourcesToReacquire("gate-1")).toEqual(["lease-1", "worktree-1"]);
  });
});

describe("HumanGateManager — acceptance: UI and API events", () => {
  test("emits an event for opening", () => {
    const mgr = manager();
    mgr.open(gateRequest(), 5);
    const events = mgr.drainEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "OPENED", gateId: "gate-1", runId: "run-1", atMs: 5 });
  });

  test("emits an event for every terminal transition", () => {
    const mgr = manager();
    mgr.open(gateRequest({ gateId: "a" }), 0);
    mgr.approve("a", "erwan", "yes", 1);
    mgr.open(gateRequest({ gateId: "b" }), 0);
    mgr.deny("b", "erwan", "no", 2);
    mgr.open(gateRequest({ gateId: "c", timeoutPolicy: "DENY_ON_TIMEOUT", timeoutMs: 5 }), 0);
    mgr.tick(5);
    mgr.open(gateRequest({ gateId: "d" }), 0);
    mgr.cancel("d", "run abandoned", 3);

    const kinds = mgr.drainEvents().map((event) => event.kind);
    expect(kinds).toEqual(["OPENED", "APPROVED", "OPENED", "DENIED", "OPENED", "EXPIRED", "OPENED", "CANCELLED"]);
  });

  test("carries the decider and reason into the event", () => {
    const mgr = manager();
    mgr.open(gateRequest(), 0);
    mgr.drainEvents();
    mgr.approve("gate-1", "erwan", "verified on device", 10);

    expect(mgr.drainEvents()[0]!.detail).toBe("erwan: verified on device");
  });

  test("draining empties the stream, so events are not replayed", () => {
    const mgr = manager();
    mgr.open(gateRequest(), 0);

    expect(mgr.drainEvents()).toHaveLength(1);
    expect(mgr.drainEvents()).toHaveLength(0);
  });
});

describe("HumanGateManager — decisions", () => {
  test("records who decided, why and when", () => {
    const mgr = manager();
    mgr.open(gateRequest(), 0);
    const record = mgr.approve("gate-1", "erwan", "checked the diff", 42);

    expect(record).toMatchObject({
      state: "APPROVED",
      decidedBy: "erwan",
      decisionReason: "checked the diff",
      decidedAtMs: 42,
    });
  });

  test("requires a decider and a reason", () => {
    const mgr = manager();
    mgr.open(gateRequest(), 0);

    expect(() => mgr.approve("gate-1", "  ", "why", 1)).toThrow(HumanGateInputError);
    expect(() => mgr.approve("gate-1", "erwan", "  ", 1)).toThrow(HumanGateInputError);
  });

  test("refuses a second decision on a settled gate", () => {
    const mgr = manager();
    mgr.open(gateRequest(), 0);
    mgr.deny("gate-1", "erwan", "no", 1);

    expect(() => mgr.approve("gate-1", "erwan", "changed my mind", 2)).toThrow(HumanGateInputError);
  });

  test("cancels an abandoned run's gate so it is not left waiting forever", () => {
    const mgr = manager();
    mgr.open(gateRequest(), 0);
    const record = mgr.cancel("gate-1", "run abandoned", 5);

    expect(record.state).toBe("CANCELLED");
    expect(() => mgr.cancel("gate-1", "again", 6)).toThrow(HumanGateInputError);
  });
});

describe("HumanGateManager — input integrity", () => {
  test("rejects empty identifiers and questions", () => {
    const mgr = manager();

    expect(() => mgr.open(gateRequest({ gateId: "  " }), 0)).toThrow(HumanGateInputError);
    expect(() => mgr.open(gateRequest({ runId: "  " }), 0)).toThrow(HumanGateInputError);
    expect(() => mgr.open(gateRequest({ question: "  " }), 0)).toThrow(HumanGateInputError);
  });

  test("rejects a duplicate gate id", () => {
    const mgr = manager();
    mgr.open(gateRequest(), 0);

    expect(() => mgr.open(gateRequest(), 1)).toThrow(HumanGateInputError);
  });

  test("rejects operations on an unknown gate", () => {
    const mgr = manager();

    expect(() => mgr.approve("ghost", "erwan", "why", 0)).toThrow(HumanGateInputError);
    expect(() => mgr.resourcesToReacquire("ghost")).toThrow(HumanGateInputError);
    expect(mgr.get("ghost")).toBeNull();
  });

  test("clears the timeout when the policy is to wait", () => {
    const mgr = manager();
    const record = mgr.open(gateRequest({ timeoutPolicy: "WAIT_FOREVER", timeoutMs: 5_000 }), 0);

    expect(record.timeoutMs).toBeNull();
  });
});
