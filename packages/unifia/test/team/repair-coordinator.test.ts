import { describe, expect, test } from "bun:test";
import {
  accumulateUsage,
  DEFAULT_MAX_ATTEMPTS,
  isArchitectureConflict,
  RepairCoordinator,
  RepairInputError,
  type AttemptRecord,
  type RepairRequest,
} from "../../src/team/repair-coordinator";
import type { ReviewFinding, ReviewResult, ReviewVerdict } from "../../src/team/review-runtime";

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: "P1",
    title: "Missing boundary validation",
    evidence: "src/team/x.ts:42 accepts a negative count",
    remediation: "Reject negative counts at the boundary",
    ...overrides,
  };
}

function review(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    schemaVersion: "1.0.0",
    cardId: "TEAM-I02",
    reviewerModelId: "reviewer-model",
    verdict: "CHANGES_REQUESTED",
    findings: [finding()],
    evidence: ["bun test test/team"],
    ...overrides,
  };
}

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    attemptNumber: 1,
    commit: "aaaaaaa",
    workerModelId: "worker-a",
    fencingToken: 10,
    verdict: "CHANGES_REQUESTED" as ReviewVerdict,
    usage: { inputTokens: 1_000, outputTokens: 200, costUsd: 0.05 },
    ...overrides,
  };
}

function request(overrides: Partial<RepairRequest> = {}): RepairRequest {
  return {
    cardId: "TEAM-I02",
    review: review(),
    attempts: [attempt()],
    approvedPaths: ["src/team/frozen.ts"],
    nextFencingToken: 11,
    ...overrides,
  };
}

const coordinator = new RepairCoordinator();

describe("RepairCoordinator — acceptance: never mutates a reviewed attempt", () => {
  test("carries the reviewed commit forward as an immutable parent", () => {
    const decision = coordinator.plan(request({ attempts: [attempt({ commit: "reviewed-sha" })] }));

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    // The repair starts FROM the reviewed commit; it never rewrites it.
    expect(decision.plan.parentCommit).toBe("reviewed-sha");
    expect(decision.plan.attemptNumber).toBe(2);
  });

  test("allocates a strictly higher fencing token to the new attempt", () => {
    const decision = coordinator.plan(
      request({ attempts: [attempt({ fencingToken: 40 })], nextFencingToken: 41 }),
    );

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    expect(decision.plan.fencingToken).toBe(41);
  });

  test("refuses a token that could be mistaken for the attempt it replaces", () => {
    for (const nextFencingToken of [10, 9, 0]) {
      expect(() => coordinator.plan(request({ attempts: [attempt({ fencingToken: 10 })], nextFencingToken }))).toThrow(
        RepairInputError,
      );
    }
  });

  test("freezes the approved paths, in a stable order", () => {
    const decision = coordinator.plan(request({ approvedPaths: ["src/z.ts", "src/a.ts", "src/m.ts"] }));

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    expect(decision.plan.frozenPaths).toEqual(["src/a.ts", "src/m.ts", "src/z.ts"]);
  });

  test("does not mutate the caller's input arrays", () => {
    const approvedPaths = ["src/z.ts", "src/a.ts"];
    const attempts = [attempt()];
    coordinator.plan(request({ approvedPaths, attempts }));

    expect(approvedPaths).toEqual(["src/z.ts", "src/a.ts"]);
    expect(attempts).toHaveLength(1);
  });
});

describe("RepairCoordinator — acceptance: stops on architecture conflict", () => {
  test("stops instead of spending another attempt", () => {
    const decision = coordinator.plan(
      request({
        review: review({
          findings: [finding({ title: "Architecture conflict with the frozen DAG contract" })],
        }),
      }),
    );

    expect(decision.outcome).toBe("STOP");
    if (decision.outcome !== "STOP") return;
    expect(decision.report.refusal).toBe("ARCHITECTURE_CONFLICT");
    expect(decision.report.blockingFindings).toHaveLength(1);
  });

  test("detects the conflict from the remediation as well as the title", () => {
    const decision = coordinator.plan(
      request({
        review: review({
          findings: [finding({ title: "Wrong owner", remediation: "This requires an ADR before proceeding" })],
        }),
      }),
    );

    expect(decision.outcome).toBe("STOP");
    if (decision.outcome !== "STOP") return;
    expect(decision.report.refusal).toBe("ARCHITECTURE_CONFLICT");
  });

  test("stops even when the conflicting finding is low severity", () => {
    // Severity says how bad; an architectural conflict says the card's
    // premise is wrong. A P3 conflict is still not locally repairable.
    const decision = coordinator.plan(
      request({
        review: review({
          findings: [finding({ severity: "P3", title: "Scope expansion required to satisfy this" })],
        }),
      }),
    );

    expect(decision.outcome).toBe("STOP");
    if (decision.outcome !== "STOP") return;
    expect(decision.report.refusal).toBe("ARCHITECTURE_CONFLICT");
  });

  test("classifies ordinary findings as repairable", () => {
    expect(isArchitectureConflict(finding())).toBe(false);
    expect(isArchitectureConflict(finding({ severity: "P0", title: "Null dereference" }))).toBe(false);
  });

  test("reports the conflicting findings, not merely a count", () => {
    const conflict = finding({ title: "Architectural conflict in ownership" });
    const decision = coordinator.plan(
      request({ review: review({ findings: [finding(), conflict, finding({ severity: "P2" })] }) }),
    );

    expect(decision.outcome).toBe("STOP");
    if (decision.outcome !== "STOP") return;
    expect(decision.report.blockingFindings).toEqual([conflict]);
  });
});

describe("RepairCoordinator — acceptance: cost is tracked across the chain", () => {
  test("accumulates usage over every attempt", () => {
    const attempts = [
      attempt({ attemptNumber: 1, fencingToken: 1, usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.01 } }),
      attempt({ attemptNumber: 2, fencingToken: 2, usage: { inputTokens: 250, outputTokens: 40, costUsd: 0.04 } }),
    ];

    expect(accumulateUsage(attempts)).toEqual({ inputTokens: 350, outputTokens: 50, costUsd: 0.05 });
  });

  test("surfaces the cumulative cost on the repair plan", () => {
    const decision = coordinator.plan(
      request({
        attempts: [attempt({ usage: { inputTokens: 500, outputTokens: 100, costUsd: 0.2 } })],
      }),
    );

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    expect(decision.plan.cumulativeUsage.costUsd).toBeCloseTo(0.2, 10);
  });

  test("surfaces the cumulative cost on a refusal too, so a stop is never free of accounting", () => {
    const decision = coordinator.plan(
      request({
        review: review({ verdict: "APPROVED" }),
        attempts: [attempt({ verdict: "APPROVED", usage: { inputTokens: 900, outputTokens: 100, costUsd: 0.3 } })],
      }),
    );

    expect(decision.outcome).toBe("STOP");
    if (decision.outcome !== "STOP") return;
    expect(decision.report.cumulativeUsage.costUsd).toBeCloseTo(0.3, 10);
  });

  test("rejects a negative or non-finite usage figure", () => {
    for (const usage of [
      { inputTokens: -1, outputTokens: 0, costUsd: 0 },
      { inputTokens: 0, outputTokens: 0, costUsd: Number.NaN },
      { inputTokens: 0, outputTokens: Number.POSITIVE_INFINITY, costUsd: 0 },
    ]) {
      expect(() => coordinator.plan(request({ attempts: [attempt({ usage })] }))).toThrow(RepairInputError);
    }
  });
});

describe("RepairCoordinator — bounded attempts", () => {
  test("refuses once the attempt cap is reached", () => {
    const attempts = Array.from({ length: DEFAULT_MAX_ATTEMPTS }, (_, index) =>
      attempt({ attemptNumber: index + 1, fencingToken: index + 1 }),
    );
    const decision = coordinator.plan(request({ attempts, nextFencingToken: 99 }));

    expect(decision.outcome).toBe("STOP");
    if (decision.outcome !== "STOP") return;
    expect(decision.report.refusal).toBe("MAX_ATTEMPTS_REACHED");
  });

  test("counts the cap before authorising work, not after spending it", () => {
    // Two attempts under a cap of 3 leaves exactly one repair available.
    const attempts = [
      attempt({ attemptNumber: 1, fencingToken: 1 }),
      attempt({ attemptNumber: 2, fencingToken: 2 }),
    ];
    const decision = coordinator.plan(request({ attempts, nextFencingToken: 3 }));

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    expect(decision.plan.attemptsRemaining).toBe(0);
  });

  test("honours a custom cap", () => {
    const decision = coordinator.plan(request({ maxAttempts: 1 }));

    expect(decision.outcome).toBe("STOP");
    if (decision.outcome !== "STOP") return;
    expect(decision.report.refusal).toBe("MAX_ATTEMPTS_REACHED");
  });

  test("rejects a nonsensical cap", () => {
    for (const maxAttempts of [0, -1, 1.5]) {
      expect(() => coordinator.plan(request({ maxAttempts }))).toThrow(RepairInputError);
    }
  });
});

describe("RepairCoordinator — worker continuity and escalation", () => {
  test("keeps the same worker for a first repair", () => {
    const decision = coordinator.plan(request({ attempts: [attempt({ workerModelId: "worker-a" })] }));

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    expect(decision.plan.workerModelId).toBe("worker-a");
    expect(decision.plan.escalated).toBe(false);
  });

  test("escalates after the same worker has failed twice", () => {
    const attempts = [
      attempt({ attemptNumber: 1, fencingToken: 1, workerModelId: "worker-a" }),
      attempt({ attemptNumber: 2, fencingToken: 2, workerModelId: "worker-a" }),
    ];
    const decision = coordinator.plan(
      request({ attempts, nextFencingToken: 3, escalationModelId: "worker-strong", maxAttempts: 4 }),
    );

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    expect(decision.plan.workerModelId).toBe("worker-strong");
    expect(decision.plan.escalated).toBe(true);
  });

  test("does not escalate without a designated escalation model", () => {
    const attempts = [
      attempt({ attemptNumber: 1, fencingToken: 1, workerModelId: "worker-a" }),
      attempt({ attemptNumber: 2, fencingToken: 2, workerModelId: "worker-a" }),
    ];
    const decision = coordinator.plan(request({ attempts, nextFencingToken: 3, maxAttempts: 4 }));

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    expect(decision.plan.workerModelId).toBe("worker-a");
    expect(decision.plan.escalated).toBe(false);
  });

  test("does not count another worker's failures toward escalation", () => {
    const attempts = [
      attempt({ attemptNumber: 1, fencingToken: 1, workerModelId: "worker-other" }),
      attempt({ attemptNumber: 2, fencingToken: 2, workerModelId: "worker-a" }),
    ];
    const decision = coordinator.plan(
      request({ attempts, nextFencingToken: 3, escalationModelId: "worker-strong", maxAttempts: 4 }),
    );

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    expect(decision.plan.escalated).toBe(false);
  });
});

describe("RepairCoordinator — verdicts that authorise nothing", () => {
  test("does not repair an approved review", () => {
    const decision = coordinator.plan(
      request({ review: review({ verdict: "APPROVED" }), attempts: [attempt({ verdict: "APPROVED" })] }),
    );

    expect(decision.outcome).toBe("STOP");
    if (decision.outcome !== "STOP") return;
    expect(decision.report.refusal).toBe("NOTHING_TO_REPAIR");
  });

  test("does not treat a BLOCKED review as authorisation to retry", () => {
    // BLOCKED means the review itself could not be performed — nothing in it
    // says the implementation is repairable.
    const decision = coordinator.plan(
      request({ review: review({ verdict: "BLOCKED" }), attempts: [attempt({ verdict: "BLOCKED" })] }),
    );

    expect(decision.outcome).toBe("STOP");
    if (decision.outcome !== "STOP") return;
    expect(decision.report.refusal).toBe("REVIEW_BLOCKED");
  });
});

describe("RepairCoordinator — input integrity", () => {
  test("rejects an empty attempt history", () => {
    expect(() => coordinator.plan(request({ attempts: [] }))).toThrow(RepairInputError);
  });

  test("rejects a review targeting a different card", () => {
    expect(() => coordinator.plan(request({ review: review({ cardId: "TEAM-OTHER" }) }))).toThrow(RepairInputError);
  });

  test("rejects an out-of-order attempt history", () => {
    const attempts = [
      attempt({ attemptNumber: 2, fencingToken: 1 }),
      attempt({ attemptNumber: 1, fencingToken: 2 }),
    ];
    expect(() => coordinator.plan(request({ attempts, nextFencingToken: 9 }))).toThrow(RepairInputError);
  });

  test("rejects an attempt with no commit recorded", () => {
    expect(() => coordinator.plan(request({ attempts: [attempt({ commit: "  " })] }))).toThrow(RepairInputError);
  });

  test("rejects a history whose verdict contradicts the review result", () => {
    // These describe the same fact. Allowing them to disagree gave the
    // coordinator two sources of truth: it authorised the repair from the
    // review verdict while counting escalation failures from the recorded
    // attempt verdict, so a contradictory history repaired an attempt marked
    // APPROVED and silently never escalated.
    expect(() =>
      coordinator.plan(
        request({ review: review({ verdict: "CHANGES_REQUESTED" }), attempts: [attempt({ verdict: "APPROVED" })] }),
      ),
    ).toThrow(RepairInputError);
  });

  test("rejects duplicate or decreasing fencing tokens inside the history", () => {
    // A repeated token means fencing was already violated before this
    // coordinator ran; extending that history would build on a broken order.
    const duplicate = [
      attempt({ attemptNumber: 1, fencingToken: 5 }),
      attempt({ attemptNumber: 2, fencingToken: 5 }),
    ];
    const decreasing = [
      attempt({ attemptNumber: 1, fencingToken: 9 }),
      attempt({ attemptNumber: 2, fencingToken: 4 }),
    ];

    expect(() => coordinator.plan(request({ attempts: duplicate, nextFencingToken: 6 }))).toThrow(RepairInputError);
    expect(() => coordinator.plan(request({ attempts: decreasing, nextFencingToken: 10 }))).toThrow(RepairInputError);
  });

  test("rejects an empty card id", () => {
    expect(() => coordinator.plan(request({ cardId: "  ", review: review({ cardId: "  " }) }))).toThrow(
      RepairInputError,
    );
  });
});

describe("RepairCoordinator — determinism", () => {
  test("produces an identical decision for identical input", () => {
    const input = request();

    expect(coordinator.plan(input)).toEqual(coordinator.plan(input));
  });

  test("preserves reviewer order in the targeted findings", () => {
    const findings = [
      finding({ title: "first" }),
      finding({ title: "second", severity: "P0" }),
      finding({ title: "third", severity: "P2" }),
    ];
    const decision = coordinator.plan(request({ review: review({ findings }) }));

    expect(decision.outcome).toBe("REPAIR");
    if (decision.outcome !== "REPAIR") return;
    expect(decision.plan.targetedFindings.map((item) => item.title)).toEqual(["first", "second", "third"]);
  });
});
