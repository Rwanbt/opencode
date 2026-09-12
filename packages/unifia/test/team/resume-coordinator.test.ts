import { describe, expect, test } from "bun:test";
import {
  LeadershipRegistry,
  ResumeCoordinator,
  ResumeCoordinatorInputError,
  type LeadershipState,
  type PauseRecord,
} from "../../src/team/resume-coordinator";

const TTL = 1_000;

function leadership(overrides: Partial<LeadershipState> = {}): LeadershipState {
  return { leaderId: "lead-a", term: 1, acquiredAtMs: 0, lastHeartbeatMs: 0, ...overrides };
}

const registry = new LeadershipRegistry();
const coordinator = new ResumeCoordinator();

describe("LeadershipRegistry — acceptance: no split brain", () => {
  test("refuses a takeover while the lease is still alive", () => {
    const decision = registry.takeover({
      current: leadership(),
      standbyId: "lead-b",
      observedTerm: 1,
      leaseTtlMs: TTL,
      nowMs: TTL - 1,
    });

    expect(decision.outcome).toBe("REFUSED_LEASE_ALIVE");
    expect(decision.leadership).toBeNull();
  });

  test("promotes once the lease has expired, incrementing the term", () => {
    const decision = registry.takeover({
      current: leadership(),
      standbyId: "lead-b",
      observedTerm: 1,
      leaseTtlMs: TTL,
      nowMs: TTL,
    });

    expect(decision.outcome).toBe("PROMOTED");
    expect(decision.leadership).toEqual({
      leaderId: "lead-b",
      term: 2,
      acquiredAtMs: TTL,
      lastHeartbeatMs: TTL,
    });
  });

  test("only one of two racing standbys wins", () => {
    // Both read the same stale state and request the same term. The first is
    // applied; the second then observes a term that no longer matches.
    const current = leadership();
    const first = registry.takeover({
      current,
      standbyId: "lead-b",
      observedTerm: 1,
      leaseTtlMs: TTL,
      nowMs: TTL,
    });
    expect(first.outcome).toBe("PROMOTED");

    const second = registry.takeover({
      current: first.leadership!,
      standbyId: "lead-c",
      observedTerm: 1,
      leaseTtlMs: TTL,
      nowMs: TTL,
    });

    expect(second.outcome).toBe("REFUSED_STALE_TERM");
    expect(second.leadership).toBeNull();
  });

  test("refuses a stale term even when the lease has expired", () => {
    const decision = registry.takeover({
      current: leadership({ term: 5 }),
      standbyId: "lead-b",
      observedTerm: 3,
      leaseTtlMs: TTL,
      nowMs: 10_000,
    });

    expect(decision.outcome).toBe("REFUSED_STALE_TERM");
  });

  test("a superseded lead learns it must stand down when its action is refused", () => {
    const promoted = registry.takeover({
      current: leadership(),
      standbyId: "lead-b",
      observedTerm: 1,
      leaseTtlMs: TTL,
      nowMs: TTL,
    }).leadership!;

    expect(registry.isCurrentLeader(promoted, "lead-a", 1)).toBe(false);
    expect(registry.isCurrentLeader(promoted, "lead-b", 2)).toBe(true);
  });

  test("refuses a heartbeat from a superseded lead", () => {
    const promoted = registry.takeover({
      current: leadership(),
      standbyId: "lead-b",
      observedTerm: 1,
      leaseTtlMs: TTL,
      nowMs: TTL,
    }).leadership!;

    expect(() => registry.heartbeat(promoted, "lead-a", 1, TTL + 1)).toThrow(ResumeCoordinatorInputError);
    expect(registry.heartbeat(promoted, "lead-b", 2, TTL + 1).lastHeartbeatMs).toBe(TTL + 1);
  });

  test("a heartbeat renews the lease and postpones takeover", () => {
    const renewed = registry.heartbeat(leadership(), "lead-a", 1, 900);
    const decision = registry.takeover({
      current: renewed,
      standbyId: "lead-b",
      observedTerm: 1,
      leaseTtlMs: TTL,
      nowMs: 1_500,
    });

    expect(decision.outcome).toBe("REFUSED_LEASE_ALIVE");
  });

  test("rejects a nonsensical lease or clock", () => {
    const base = { current: leadership(), standbyId: "lead-b", observedTerm: 1, nowMs: 0 };

    expect(() => registry.takeover({ ...base, leaseTtlMs: 0 })).toThrow(ResumeCoordinatorInputError);
    expect(() => registry.takeover({ ...base, leaseTtlMs: TTL, nowMs: Number.NaN })).toThrow(
      ResumeCoordinatorInputError,
    );
    expect(() => registry.takeover({ ...base, standbyId: "  ", leaseTtlMs: TTL })).toThrow(
      ResumeCoordinatorInputError,
    );
  });
});

// ---------------------------------------------------------------------
// Pause / resume
// ---------------------------------------------------------------------

function pause(overrides: Partial<Parameters<ResumeCoordinator["pause"]>[0]> = {}): PauseRecord {
  return coordinator.pause({
    runId: "run-1",
    reason: "budget exhausted",
    baseSha: "base-1",
    completedTaskIds: ["t2", "t1"],
    leadership: leadership(),
    nowMs: 1_000,
    ...overrides,
  });
}

describe("ResumeCoordinator — acceptance: days-later resume", () => {
  test("resumes cleanly after an arbitrary delay when the base is unchanged", () => {
    // A pause is a durable record, not a sleeping process.
    const record = pause();
    const decision = coordinator.resume({
      pause: record,
      observedBaseSha: "base-1",
      resumingLeaderId: "lead-a",
      resumingTerm: 1,
      nowMs: 1_000 + 30 * 24 * 3_600_000,
    });

    expect(decision.outcome).toBe("RESUMED");
    expect(decision.revalidateTaskIds).toEqual([]);
    expect(decision.baseDrifted).toBe(false);
  });

  test("does not expire by age alone", () => {
    // Refusing because it "took too long" would discard completed work for
    // no safety gain.
    const record = pause();
    for (const nowMs of [1_001, 1_000 + 3_600_000, 1_000 + 365 * 24 * 3_600_000]) {
      expect(
        coordinator.resume({
          pause: record,
          observedBaseSha: "base-1",
          resumingLeaderId: "lead-a",
          resumingTerm: 1,
          nowMs,
        }).outcome,
      ).toBe("RESUMED");
    }
  });

  test("records completed tasks deduplicated and sorted", () => {
    const record = pause({ completedTaskIds: ["t2", "t1", "t2"] });

    expect(record.completedTaskIds).toEqual(["t1", "t2"]);
  });
});

describe("ResumeCoordinator — acceptance: base drift handled", () => {
  test("resumes but demands revalidation when the base moved", () => {
    // The work is not wrong, it is unverified against this tree.
    const record = pause();
    const decision = coordinator.resume({
      pause: record,
      observedBaseSha: "base-2",
      resumingLeaderId: "lead-a",
      resumingTerm: 1,
      nowMs: 2_000,
    });

    expect(decision.outcome).toBe("RESUMED_WITH_REVALIDATION");
    expect(decision.baseDrifted).toBe(true);
    expect(decision.revalidateTaskIds).toEqual(["t1", "t2"]);
    expect(decision.reason).toContain("base-2");
  });

  test("does not silently accept drifted work as verified", () => {
    const decision = coordinator.resume({
      pause: pause(),
      observedBaseSha: "base-moved",
      resumingLeaderId: "lead-a",
      resumingTerm: 1,
      nowMs: 2_000,
    });

    expect(decision.outcome).not.toBe("RESUMED");
    expect(decision.revalidateTaskIds.length).toBeGreaterThan(0);
  });

  test("reports no drift when the base is unchanged", () => {
    const decision = coordinator.resume({
      pause: pause(),
      observedBaseSha: "base-1",
      resumingLeaderId: "lead-a",
      resumingTerm: 1,
      nowMs: 2_000,
    });

    expect(decision.baseDrifted).toBe(false);
  });
});

describe("ResumeCoordinator — leadership gates the resume", () => {
  test("refuses a resume driven by a superseded lead", () => {
    // Checked before the base: nothing about the tree matters if the wrong
    // process is asking.
    const record = pause({ leadership: leadership({ term: 4 }) });
    const decision = coordinator.resume({
      pause: record,
      observedBaseSha: "base-1",
      resumingLeaderId: "lead-old",
      resumingTerm: 3,
      nowMs: 2_000,
    });

    expect(decision.outcome).toBe("REFUSED");
    expect(decision.leadership).toBeNull();
  });

  test("accepts a resume from a newly promoted lead at a higher term", () => {
    const record = pause({ leadership: leadership({ term: 2 }) });
    const decision = coordinator.resume({
      pause: record,
      observedBaseSha: "base-1",
      resumingLeaderId: "lead-b",
      resumingTerm: 3,
      nowMs: 2_000,
    });

    expect(decision.outcome).toBe("RESUMED");
    expect(decision.leadership).toMatchObject({ leaderId: "lead-b", term: 3 });
  });

  test("checks leadership before base drift", () => {
    const record = pause({ leadership: leadership({ term: 4 }) });
    const decision = coordinator.resume({
      pause: record,
      observedBaseSha: "base-moved",
      resumingLeaderId: "lead-old",
      resumingTerm: 1,
      nowMs: 2_000,
    });

    expect(decision.outcome).toBe("REFUSED");
    expect(decision.baseDrifted).toBe(false);
  });
});

describe("ResumeCoordinator — input integrity", () => {
  test("rejects an empty run id, reason or base", () => {
    expect(() => pause({ runId: "  " })).toThrow(ResumeCoordinatorInputError);
    expect(() => pause({ reason: "  " })).toThrow(ResumeCoordinatorInputError);
    expect(() => pause({ baseSha: "  " })).toThrow(ResumeCoordinatorInputError);
  });

  test("rejects an empty observed base or resuming leader", () => {
    const record = pause();

    expect(() =>
      coordinator.resume({
        pause: record,
        observedBaseSha: "  ",
        resumingLeaderId: "lead-a",
        resumingTerm: 1,
        nowMs: 0,
      }),
    ).toThrow(ResumeCoordinatorInputError);
    expect(() =>
      coordinator.resume({
        pause: record,
        observedBaseSha: "base-1",
        resumingLeaderId: "  ",
        resumingTerm: 1,
        nowMs: 0,
      }),
    ).toThrow(ResumeCoordinatorInputError);
  });

  test("is deterministic", () => {
    const record = pause();
    const input = {
      pause: record,
      observedBaseSha: "base-2",
      resumingLeaderId: "lead-a",
      resumingTerm: 1,
      nowMs: 5_000,
    };

    expect(coordinator.resume(input)).toEqual(coordinator.resume(input));
  });
});
