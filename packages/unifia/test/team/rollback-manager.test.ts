import { describe, expect, test } from "bun:test";
import {
  ROLLBACK_STEPS,
  RollbackManager,
  RollbackProtectedBranchError,
  type RollbackOperations,
  type RollbackRequest,
  type RollbackStep,
} from "../../src/team/rollback-manager";

function request(overrides: Partial<RollbackRequest> = {}): RollbackRequest {
  return { branch: "c-G04/test", reason: "failed validation", ...overrides };
}

function operations(calls: string[], failingStep?: string): RollbackOperations {
  // Built as a typed record rather than Object.fromEntries + a cast: the
  // cast silently satisfied the compiler even when a step was missing, so
  // it defeated the very check that makes a missing operation a compile
  // error instead of a runtime TypeError.
  const built = {} as { [step in RollbackStep]: (request: RollbackRequest) => void };
  for (const step of ROLLBACK_STEPS) {
    built[step] = () => {
      calls.push(step);
      if (step === failingStep) throw new Error(`${step} interrupted`);
    };
  }
  return built;
}

describe("RollbackManager", () => {
  test("rejects an operations map that is missing a step", async () => {
    // RollbackOperations was declared as an interface holding a mapped type,
    // which is illegal in TypeScript: it compiled to a type with no known
    // properties, so a missing step was neither a compile error nor caught
    // here. This locks in the runtime half of that guard.
    const calls: string[] = [];
    const complete = operations(calls);
    const { audit: _dropped, ...incomplete } = complete;

    await expect(
      new RollbackManager().execute(request(), incomplete as unknown as RollbackOperations),
    ).rejects.toThrow(/missing rollback operation audit/);
  })

  test("completes every rollback step in the declared order", async () => {
    const calls: string[] = [];
    const result = await new RollbackManager().execute(request(), operations(calls));

    expect(result).toEqual({ status: "COMPLETED", completedSteps: ROLLBACK_STEPS });
    expect(calls).toEqual([...ROLLBACK_STEPS]);
  });

  test("returns an interrupted report that can resume at the failed step", async () => {
    const calls: string[] = [];
    const first = await new RollbackManager().execute(request(), operations(calls, "restoreCheckpoint"));

    expect(first.status).toBe("INTERRUPTED");
    expect(first.completedSteps).toEqual(["discardWorktree", "revertCommits"]);
    expect(first.nextStep).toBe("restoreCheckpoint");
    expect(first.error).toContain("restoreCheckpoint");

    const resumedCalls: string[] = [];
    const resumed = await new RollbackManager().execute(
      request({ completedSteps: first.completedSteps }),
      operations(resumedCalls),
    );
    expect(resumed.status).toBe("COMPLETED");
    expect(resumedCalls).toEqual(["restoreCheckpoint", "compensateDatabase", "audit"]);
  });

  test("rejects protected branches before invoking any operation", async () => {
    const calls: string[] = [];
    await expect(new RollbackManager().execute(request({ branch: "DEV" }), operations(calls))).rejects.toBeInstanceOf(
      RollbackProtectedBranchError,
    );
    expect(calls).toEqual([]);
  });

  test("is idempotent when the checkpoint already records completed steps", async () => {
    const calls: string[] = [];
    const result = await new RollbackManager().execute(
      request({ completedSteps: ["discardWorktree", "discardWorktree", "revertCommits"] }),
      operations(calls),
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.completedSteps).toEqual([...ROLLBACK_STEPS]);
    expect(calls).toEqual(["restoreCheckpoint", "compensateDatabase", "audit"]);
  });

  test("rejects unknown checkpoint steps and invalid requests", async () => {
    const calls: string[] = [];
    expect(() => new RollbackManager().execute(request({ completedSteps: ["unknown" as never] }), operations(calls))).toThrow(
      "unknown completed rollback step",
    );
    expect(() => new RollbackManager().execute(request({ reason: " " }), operations(calls))).toThrow("reason");
  });
});
