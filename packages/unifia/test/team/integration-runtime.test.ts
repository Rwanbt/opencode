import { describe, expect, test } from "bun:test";
import {
  IntegrationInputError,
  IntegrationRuntime,
  PROTECTED_BRANCHES,
  ProtectedBranchError,
  type IntegrationCandidate,
  type IntegrationRequest,
} from "../../src/team/integration-runtime";

function candidate(cardId: string, overrides: Partial<IntegrationCandidate> = {}): IntegrationCandidate {
  const commit = overrides.commit ?? `sha-${cardId}`;
  return {
    cardId,
    commit,
    dependsOn: [],
    verdict: "APPROVED",
    reviewedCommit: commit,
    changedPaths: [`src/${cardId}.ts`],
    ...overrides,
  };
}

function request(overrides: Partial<IntegrationRequest> = {}): IntegrationRequest {
  return {
    targetBranch: "Team",
    baseSha: "base-sha",
    candidates: [candidate("A")],
    ...overrides,
  };
}

const runtime = new IntegrationRuntime();

describe("IntegrationRuntime — acceptance: primary branches untouched", () => {
  test("refuses every protected branch", () => {
    for (const branch of PROTECTED_BRANCHES) {
      expect(() => runtime.plan(request({ targetBranch: branch }))).toThrow(ProtectedBranchError);
    }
  });

  test("refuses regardless of case, since checkouts are case-insensitive on Windows and macOS", () => {
    for (const branch of ["Main", "MAIN", "Dev", "OPTI-UI"]) {
      expect(() => runtime.plan(request({ targetBranch: branch }))).toThrow(ProtectedBranchError);
    }
  });

  test("refuses a protected branch padded with whitespace", () => {
    expect(() => runtime.plan(request({ targetBranch: "  main  " }))).toThrow(ProtectedBranchError);
  });

  test("honours additional protected branches supplied by the caller", () => {
    expect(() =>
      runtime.plan(request({ targetBranch: "release", additionalProtectedBranches: ["release"] })),
    ).toThrow(ProtectedBranchError);
  });

  test("checks the target before validating anything else", () => {
    // Malformed candidates AND a protected target: the branch guard must win,
    // because every later step assumes it is safe to write somewhere.
    expect(() =>
      runtime.plan(request({ targetBranch: "main", candidates: [candidate("", { commit: "" })] })),
    ).toThrow(ProtectedBranchError);
  });

  test("allows the integration branch itself", () => {
    expect(() => runtime.plan(request({ targetBranch: "Team" }))).not.toThrow();
  });
});

describe("IntegrationRuntime — acceptance: no unverified commit", () => {
  test("excludes anything that is not approved", () => {
    const plan = runtime.plan(
      request({
        candidates: [
          candidate("A"),
          candidate("B", { verdict: "CHANGES_REQUESTED" }),
          candidate("C", { verdict: "BLOCKED" }),
        ],
      }),
    );

    expect(plan.order.map((item) => item.cardId)).toEqual(["A"]);
    expect(plan.excluded.map((item) => item.reason)).toEqual(["NOT_APPROVED", "NOT_APPROVED"]);
  });

  test("accepts an approved-with-followup verdict", () => {
    const plan = runtime.plan(request({ candidates: [candidate("A", { verdict: "APPROVED_WITH_FOLLOWUP" })] }));

    expect(plan.order.map((item) => item.cardId)).toEqual(["A"]);
  });

  test("excludes a commit whose review examined a different sha", () => {
    // A review that approved another sha is not approval of this one; that
    // mismatch is how a reviewed change and an integrated change drift apart.
    const plan = runtime.plan(
      request({ candidates: [candidate("A", { commit: "sha-new", reviewedCommit: "sha-old" })] }),
    );

    expect(plan.order).toHaveLength(0);
    expect(plan.excluded[0]!.reason).toBe("REVIEW_SHA_MISMATCH");
    expect(plan.excluded[0]!.detail).toContain("sha-old");
  });
});

describe("IntegrationRuntime — acceptance: topological order", () => {
  test("places a dependency before its dependent", () => {
    const plan = runtime.plan(
      request({
        candidates: [candidate("C", { dependsOn: ["B"] }), candidate("B", { dependsOn: ["A"] }), candidate("A")],
      }),
    );

    expect(plan.order.map((item) => item.cardId)).toEqual(["A", "B", "C"]);
  });

  test("is independent of input order", () => {
    const cards = [candidate("C", { dependsOn: ["B"] }), candidate("B", { dependsOn: ["A"] }), candidate("A")];
    const forward = runtime.plan(request({ candidates: cards }));
    const reversed = runtime.plan(request({ candidates: [...cards].reverse() }));

    expect(reversed.order.map((item) => item.cardId)).toEqual(forward.order.map((item) => item.cardId));
  });

  test("orders independent cards deterministically by card id", () => {
    const plan = runtime.plan(request({ candidates: [candidate("Z"), candidate("A"), candidate("M")] }));

    expect(plan.order.map((item) => item.cardId)).toEqual(["A", "M", "Z"]);
  });

  test("refuses a dependency cycle instead of breaking it arbitrarily", () => {
    const plan = runtime.plan(
      request({ candidates: [candidate("A", { dependsOn: ["B"] }), candidate("B", { dependsOn: ["A"] })] }),
    );

    expect(plan.order).toHaveLength(0);
    expect(plan.excluded.map((item) => item.reason)).toEqual(["DEPENDENCY_CYCLE", "DEPENDENCY_CYCLE"]);
  });

  test("excludes a card whose dependency is absent from the candidates", () => {
    const plan = runtime.plan(request({ candidates: [candidate("B", { dependsOn: ["A"] })] }));

    expect(plan.order).toHaveLength(0);
    expect(plan.excluded[0]!.reason).toBe("MISSING_DEPENDENCY");
  });

  test("cascades exclusion through a dependency chain", () => {
    // A is rejected, so B cannot land, so neither can C. Landing B on a
    // commit that never arrived is the failure this cascade prevents.
    const plan = runtime.plan(
      request({
        candidates: [
          candidate("A", { verdict: "BLOCKED" }),
          candidate("B", { dependsOn: ["A"] }),
          candidate("C", { dependsOn: ["B"] }),
        ],
      }),
    );

    expect(plan.order).toHaveLength(0);
    const reasons = new Map(plan.excluded.map((item) => [item.cardId, item.reason]));
    expect(reasons.get("A")).toBe("NOT_APPROVED");
    expect(reasons.get("B")).toBe("DEPENDENCY_EXCLUDED");
    expect(reasons.get("C")).toBe("DEPENDENCY_EXCLUDED");
  });

  test("keeps an unrelated card when a sibling chain is excluded", () => {
    const plan = runtime.plan(
      request({
        candidates: [
          candidate("A", { verdict: "BLOCKED" }),
          candidate("B", { dependsOn: ["A"] }),
          candidate("Solo"),
        ],
      }),
    );

    expect(plan.order.map((item) => item.cardId)).toEqual(["Solo"]);
  });
});

describe("IntegrationRuntime — acceptance: conflict cards", () => {
  test("reports an overlap rather than resolving or skipping it", () => {
    const plan = runtime.plan(
      request({
        candidates: [
          candidate("A", { changedPaths: ["src/shared.ts", "src/a.ts"] }),
          candidate("B", { changedPaths: ["src/shared.ts"] }),
        ],
      }),
    );

    // Both still land: the conflict is a card for a human, not a skip.
    expect(plan.order.map((item) => item.cardId)).toEqual(["A", "B"]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]!.cardIds).toEqual(["A", "B"]);
    expect(plan.conflicts[0]!.overlappingPaths).toEqual(["src/shared.ts"]);
  });

  test("names every overlapping path, sorted", () => {
    const plan = runtime.plan(
      request({
        candidates: [
          candidate("A", { changedPaths: ["src/z.ts", "src/a.ts"] }),
          candidate("B", { changedPaths: ["src/a.ts", "src/z.ts"] }),
        ],
      }),
    );

    expect(plan.conflicts[0]!.overlappingPaths).toEqual(["src/a.ts", "src/z.ts"]);
  });

  test("reports no conflict when paths are disjoint", () => {
    const plan = runtime.plan(request({ candidates: [candidate("A"), candidate("B")] }));

    expect(plan.conflicts).toEqual([]);
  });

  test("does not report a conflict against an excluded candidate", () => {
    const plan = runtime.plan(
      request({
        candidates: [
          candidate("A", { changedPaths: ["src/shared.ts"] }),
          candidate("B", { verdict: "BLOCKED", changedPaths: ["src/shared.ts"] }),
        ],
      }),
    );

    expect(plan.conflicts).toEqual([]);
  });

  test("reports each pair once for a three-way overlap", () => {
    const plan = runtime.plan(
      request({
        candidates: [
          candidate("A", { changedPaths: ["src/shared.ts"] }),
          candidate("B", { changedPaths: ["src/shared.ts"] }),
          candidate("C", { changedPaths: ["src/shared.ts"] }),
        ],
      }),
    );

    expect(plan.conflicts.map((item) => item.cardIds)).toEqual([
      ["A", "B"],
      ["A", "C"],
      ["B", "C"],
    ]);
  });
});

describe("IntegrationRuntime — rollback batch", () => {
  test("undoes in reverse, so a dependent is removed before what it depends on", () => {
    const plan = runtime.plan(
      request({
        candidates: [candidate("A"), candidate("B", { dependsOn: ["A"] }), candidate("C", { dependsOn: ["B"] })],
      }),
    );

    expect(plan.order.map((item) => item.cardId)).toEqual(["A", "B", "C"]);
    expect(plan.rollbackOrder).toEqual(["sha-C", "sha-B", "sha-A"]);
  });

  test("is empty when nothing is integrable", () => {
    const plan = runtime.plan(request({ candidates: [candidate("A", { verdict: "BLOCKED" })] }));

    expect(plan.rollbackOrder).toEqual([]);
  });
});

describe("IntegrationRuntime — input integrity", () => {
  test("rejects duplicate candidates for the same card", () => {
    expect(() => runtime.plan(request({ candidates: [candidate("A"), candidate("A")] }))).toThrow(
      IntegrationInputError,
    );
  });

  test("rejects a self-dependency", () => {
    expect(() => runtime.plan(request({ candidates: [candidate("A", { dependsOn: ["A"] })] }))).toThrow(
      IntegrationInputError,
    );
  });

  test("rejects an empty commit, card id, target or base", () => {
    expect(() => runtime.plan(request({ candidates: [candidate("A", { commit: "  " })] }))).toThrow(
      IntegrationInputError,
    );
    expect(() => runtime.plan(request({ baseSha: "  " }))).toThrow(IntegrationInputError);
    expect(() => runtime.plan(request({ targetBranch: "  " }))).toThrow(IntegrationInputError);
  });

  test("accepts an empty candidate set as an empty plan", () => {
    const plan = runtime.plan(request({ candidates: [] }));

    expect(plan.order).toEqual([]);
    expect(plan.excluded).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });
});

describe("IntegrationRuntime — determinism", () => {
  test("produces an identical plan for identical input", () => {
    const input = request({
      candidates: [candidate("B", { dependsOn: ["A"] }), candidate("A"), candidate("X", { verdict: "BLOCKED" })],
    });

    expect(runtime.plan(input)).toEqual(runtime.plan(input));
  });

  test("sorts exclusions by card id so the report diffs cleanly", () => {
    const plan = runtime.plan(
      request({
        candidates: [
          candidate("Z", { verdict: "BLOCKED" }),
          candidate("A", { verdict: "BLOCKED" }),
          candidate("M", { verdict: "BLOCKED" }),
        ],
      }),
    );

    expect(plan.excluded.map((item) => item.cardId)).toEqual(["A", "M", "Z"]);
  });
});
