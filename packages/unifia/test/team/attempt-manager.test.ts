import { describe, expect, test } from "bun:test";
import { AttemptManager, AttemptManagerInputError } from "../../src/team/attempt-manager";

const TASK = "task-1";

function manager() {
  return new AttemptManager();
}

describe("AttemptManager — acceptance: a late result is rejected", () => {
  test("rejects a result carrying the abandoned worker's token", () => {
    // The abandoned worker was not killed; it will eventually report.
    // Accepting that report alongside the replacement's is how the same
    // change gets integrated twice.
    const mgr = manager();
    const first = mgr.start(TASK, "worker-a", 0);
    mgr.reassign(TASK, "worker-b", "TIMEOUT", 10);

    const late = mgr.submitResult({
      taskId: TASK,
      fencingToken: first.fencingToken,
      workerId: "worker-a",
      succeeded: true,
      commit: "sha-from-abandoned-worker",
      failureCategory: null,
    });

    expect(late.disposition).toBe("REJECTED_STALE_TOKEN");
    expect(late.detail).toContain("reassigned away");
  });

  test("accepts the replacement's result", () => {
    const mgr = manager();
    mgr.start(TASK, "worker-a", 0);
    const decision = mgr.reassign(TASK, "worker-b", "TIMEOUT", 10);

    const accepted = mgr.submitResult({
      taskId: TASK,
      fencingToken: decision.attempt!.fencingToken,
      workerId: "worker-b",
      succeeded: true,
      commit: "sha-b",
      failureCategory: null,
    });

    expect(accepted.disposition).toBe("ACCEPTED");
    expect(accepted.attempt!.verifiedCommit).toBe("sha-b");
  });

  test("rejects by token rather than by timing", () => {
    // A late result arriving with the *current* token is still valid; a
    // prompt one with a stale token is not. Timing is a race, tokens are not.
    const mgr = manager();
    const first = mgr.start(TASK, "worker-a", 0);
    const late = mgr.submitResult({
      taskId: TASK,
      fencingToken: first.fencingToken,
      workerId: "worker-a",
      succeeded: true,
      commit: "sha-a",
      failureCategory: null,
    });

    expect(late.disposition).toBe("ACCEPTED");
  });

  test("rejects a second result for an already settled attempt", () => {
    const mgr = manager();
    const first = mgr.start(TASK, "worker-a", 0);
    const result = {
      taskId: TASK,
      fencingToken: first.fencingToken,
      workerId: "worker-a",
      succeeded: true,
      commit: "sha-a",
      failureCategory: null,
    };
    mgr.submitResult(result);

    expect(mgr.submitResult(result).disposition).toBe("REJECTED_SETTLED");
  });

  test("rejects a result for an untracked task instead of inventing an attempt", () => {
    const acceptance = manager().submitResult({
      taskId: "ghost",
      fencingToken: 1,
      workerId: "w",
      succeeded: true,
      commit: "sha",
      failureCategory: null,
    });

    expect(acceptance.disposition).toBe("REJECTED_UNKNOWN_TASK");
  });

  test("issues strictly increasing tokens across reassignments", () => {
    const mgr = manager();
    const first = mgr.start(TASK, "worker-a", 0);
    const second = mgr.reassign(TASK, "worker-b", "TIMEOUT", 1).attempt!;
    const third = mgr.reassign(TASK, "worker-c", "TIMEOUT", 2).attempt!;

    expect(second.fencingToken).toBeGreaterThan(first.fencingToken);
    expect(third.fencingToken).toBeGreaterThan(second.fencingToken);
  });

  test("does not reuse a token across different tasks", () => {
    const mgr = manager();
    const a = mgr.start("task-a", "w", 0);
    const b = mgr.start("task-b", "w", 0);

    expect(a.fencingToken).not.toBe(b.fencingToken);
  });
});

describe("AttemptManager — acceptance: no verified work is lost", () => {
  test("carries a verified commit into the replacement attempt", () => {
    // Discarding verified work turns a delay into a regression.
    const mgr = manager();
    const first = mgr.start(TASK, "worker-a", 0);
    mgr.submitResult({
      taskId: TASK,
      fencingToken: first.fencingToken,
      workerId: "worker-a",
      succeeded: true,
      commit: "verified-sha",
      failureCategory: null,
    });
    // The task later needs another attempt for an unrelated reason.
    const decision = mgr.reassign(TASK, "worker-b", "TIMEOUT", 5);

    expect(decision.outcome).toBe("REFUSED");
    expect(decision.preservedCommit).toBe("verified-sha");
  });

  test("preserves a verified commit through a failed later attempt", () => {
    const mgr = manager();
    const first = mgr.start(TASK, "worker-a", 0);
    mgr.submitResult({
      taskId: TASK,
      fencingToken: first.fencingToken,
      workerId: "worker-a",
      succeeded: false,
      commit: null,
      failureCategory: "TIMEOUT",
    });
    const second = mgr.reassign(TASK, "worker-b", "TIMEOUT", 5).attempt!;
    mgr.submitResult({
      taskId: TASK,
      fencingToken: second.fencingToken,
      workerId: "worker-b",
      succeeded: true,
      commit: "verified-sha",
      failureCategory: null,
    });
    const third = mgr.reassign(TASK, "worker-c", "TIMEOUT", 9);

    expect(third.preservedCommit).toBe("verified-sha");
  });

  test("a failure never erases a commit an earlier attempt verified", () => {
    const mgr = manager();
    const first = mgr.start(TASK, "worker-a", 0);
    mgr.submitResult({
      taskId: TASK,
      fencingToken: first.fencingToken,
      workerId: "worker-a",
      succeeded: true,
      commit: "verified-sha",
      failureCategory: null,
    });

    expect(mgr.current(TASK)!.verifiedCommit).toBe("verified-sha");
  });

  test("reports the preserved commit even when it refuses to reassign", () => {
    const mgr = manager();
    const first = mgr.start(TASK, "worker-a", 0);
    mgr.submitResult({
      taskId: TASK,
      fencingToken: first.fencingToken,
      workerId: "worker-a",
      succeeded: true,
      commit: "verified-sha",
      failureCategory: null,
    });
    const decision = mgr.reassign(TASK, "worker-b", "QUOTA_EXCEEDED", 5);

    expect(decision.outcome).toBe("ESCALATED");
    expect(decision.preservedCommit).toBe("verified-sha");
  });
});

describe("AttemptManager — acceptance: quota is not reassigned", () => {
  test("escalates an exhausted quota instead of handing it to another worker", () => {
    // Another worker on the same exhausted quota fails identically, later.
    const mgr = manager();
    mgr.start(TASK, "worker-a", 0);
    const decision = mgr.reassign(TASK, "worker-b", "QUOTA_EXCEEDED", 5);

    expect(decision.outcome).toBe("ESCALATED");
    expect(decision.attempt).toBeNull();
    expect(decision.reason).toContain("follows the account");
  });

  test("escalates an auth failure for the same reason", () => {
    const mgr = manager();
    mgr.start(TASK, "worker-a", 0);

    expect(mgr.reassign(TASK, "worker-b", "AUTH", 5).outcome).toBe("ESCALATED");
  });

  test("escalates an unclassified failure rather than spending another worker", () => {
    const mgr = manager();
    mgr.start(TASK, "worker-a", 0);

    expect(mgr.reassign(TASK, "worker-b", "UNKNOWN", 5).outcome).toBe("ESCALATED");
  });

  test("does reassign a transient failure", () => {
    const mgr = manager();
    mgr.start(TASK, "worker-a", 0);
    const decision = mgr.reassign(TASK, "worker-b", "TIMEOUT", 5);

    expect(decision.outcome).toBe("REASSIGNED");
    expect(decision.attempt!.workerId).toBe("worker-b");
    expect(decision.attempt!.attemptNumber).toBe(2);
  });

  test("reassigns a provider outage, which another endpoint may survive", () => {
    const mgr = manager();
    mgr.start(TASK, "worker-a", 0);

    expect(mgr.reassign(TASK, "worker-b", "PROVIDER_UNAVAILABLE", 5).outcome).toBe("REASSIGNED");
  });

  test("refuses to reassign an untracked task", () => {
    expect(manager().reassign("ghost", "worker-b", "TIMEOUT", 0).outcome).toBe("REFUSED");
  });
});

describe("AttemptManager — input integrity", () => {
  test("rejects an empty task or worker id", () => {
    const mgr = manager();

    expect(() => mgr.start("  ", "w", 0)).toThrow(AttemptManagerInputError);
    expect(() => mgr.start(TASK, "  ", 0)).toThrow(AttemptManagerInputError);
  });

  test("refuses to start a second attempt for a task that already has one", () => {
    const mgr = manager();
    mgr.start(TASK, "worker-a", 0);

    expect(() => mgr.start(TASK, "worker-b", 1)).toThrow(AttemptManagerInputError);
  });

  test("rejects a nonsensical initial token", () => {
    expect(() => new AttemptManager(0)).toThrow(AttemptManagerInputError);
    expect(() => new AttemptManager(1.5)).toThrow(AttemptManagerInputError);
  });

  test("reports no attempt for an unknown task rather than fabricating one", () => {
    expect(manager().current("ghost")).toBeNull();
  });
});
