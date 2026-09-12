import { describe, expect, test } from "bun:test";
import {
  FinalValidator,
  FinalValidatorInputError,
  type AcceptanceCriterion,
  type FinalValidationRequest,
  type ValidatedTask,
} from "../../src/team/final-validator";
import { ReportBuilder, type ReportInput } from "../../src/team/report-builder";

function task(taskId: string, overrides: Partial<ValidatedTask> = {}): ValidatedTask {
  return { taskId, required: true, outcome: "PASSED", proofRef: `proof/${taskId}.log`, ...overrides };
}

function criterion(id: string, overrides: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return { id, statement: `criterion ${id}`, satisfied: true, proofRef: `proof/${id}.log`, ...overrides };
}

function request(overrides: Partial<FinalValidationRequest> = {}): FinalValidationRequest {
  return {
    runId: "run-1",
    objective: "Ship the thing",
    tasks: [task("t1")],
    rollbackStatus: "TESTED",
    acceptanceCriteria: [criterion("c1")],
    ...overrides,
  };
}

const validator = new FinalValidator();

describe("FinalValidator — acceptance: no COMPLETE claim with a missing required task", () => {
  test("reports COMPLETE only when everything required passed with proof", () => {
    const result = validator.validate(request());

    expect(result.verdict).toBe("COMPLETE");
    expect(result.blockingReasons).toEqual([]);
  });

  test("refuses COMPLETE when a required task never ran", () => {
    const result = validator.validate(
      request({ tasks: [task("t1"), task("t2", { outcome: "NOT_RUN", proofRef: null })] }),
    );

    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.notRunTaskIds).toEqual(["t2"]);
    expect(result.blockingReasons[0]!.kind).toBe("REQUIRED_TASK_NOT_RUN");
  });

  test("refuses COMPLETE when a required task was skipped, and records why", () => {
    const result = validator.validate(
      request({
        tasks: [task("t1"), task("t2", { outcome: "SKIPPED", proofRef: null, skipReason: "device unavailable" })],
      }),
    );

    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.blockingReasons[0]!.kind).toBe("REQUIRED_TASK_SKIPPED");
    expect(result.blockingReasons[0]!.detail).toContain("device unavailable");
  });

  test("a run with every optional task missing is still COMPLETE", () => {
    const result = validator.validate(
      request({
        tasks: [task("t1"), task("opt", { required: false, outcome: "NOT_RUN", proofRef: null })],
      }),
    );

    expect(result.verdict).toBe("COMPLETE");
    expect(result.requiredTaskCount).toBe(1);
  });
});

describe("FinalValidator — acceptance: a claim without proof is not a pass", () => {
  test("downgrades a PASSED claim carrying no proof to not-run", () => {
    // Between "we ran it" and "it passed" sits "someone said it passed".
    const result = validator.validate(request({ tasks: [task("t1", { proofRef: null })] }));

    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.unprovenTaskIds).toEqual(["t1"]);
    expect(result.notRunTaskIds).toEqual(["t1"]);
    expect(result.passedRequiredTaskCount).toBe(0);
    expect(result.blockingReasons[0]!.kind).toBe("REQUIRED_TASK_UNPROVEN");
  });

  test("treats a blank proof reference as no proof", () => {
    for (const proofRef of ["", "   ", "\t\n"]) {
      const result = validator.validate(request({ tasks: [task("t1", { proofRef })] }));
      expect(result.verdict).toBe("INCOMPLETE");
      expect(result.unprovenTaskIds).toEqual(["t1"]);
    }
  });

  test("refuses COMPLETE for an acceptance criterion satisfied without proof", () => {
    const result = validator.validate(request({ acceptanceCriteria: [criterion("c1", { proofRef: null })] }));

    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.blockingReasons[0]!.kind).toBe("ACCEPTANCE_CRITERION_UNPROVEN");
  });

  test("refuses COMPLETE for an unmet acceptance criterion", () => {
    const result = validator.validate(request({ acceptanceCriteria: [criterion("c1", { satisfied: false })] }));

    expect(result.verdict).toBe("INCOMPLETE");
    expect(result.blockingReasons[0]!.kind).toBe("ACCEPTANCE_CRITERION_UNMET");
  });
});

describe("FinalValidator — FAILED versus INCOMPLETE", () => {
  test("a failed required task makes the run FAILED, not merely incomplete", () => {
    const result = validator.validate(request({ tasks: [task("t1", { outcome: "FAILED" })] }));

    expect(result.verdict).toBe("FAILED");
  });

  test("a failed rollback makes the run FAILED", () => {
    const result = validator.validate(request({ rollbackStatus: "FAILED" }));

    expect(result.verdict).toBe("FAILED");
    expect(result.blockingReasons[0]!.kind).toBe("ROLLBACK_FAILED");
  });

  test("an unfinished run is INCOMPLETE, so real failures stay visible among them", () => {
    const result = validator.validate(request({ tasks: [task("t1", { outcome: "NOT_RUN", proofRef: null })] }));

    expect(result.verdict).toBe("INCOMPLETE");
  });

  test("a hard failure dominates when both kinds are present", () => {
    const result = validator.validate(
      request({
        tasks: [task("t1", { outcome: "NOT_RUN", proofRef: null }), task("t2", { outcome: "FAILED" })],
      }),
    );

    expect(result.verdict).toBe("FAILED");
  });

  test("an untested rollback does not by itself block COMPLETE, but is reported", () => {
    const result = validator.validate(request({ rollbackStatus: "UNTESTED" }));

    expect(result.verdict).toBe("COMPLETE");
    expect(result.rollbackStatus).toBe("UNTESTED");
  });
});

describe("FinalValidator — input integrity", () => {
  test("rejects duplicate task ids and duplicate criteria", () => {
    expect(() => validator.validate(request({ tasks: [task("t1"), task("t1")] }))).toThrow(FinalValidatorInputError);
    expect(() => validator.validate(request({ acceptanceCriteria: [criterion("c1"), criterion("c1")] }))).toThrow(
      FinalValidatorInputError,
    );
  });

  test("rejects an empty run id or objective", () => {
    expect(() => validator.validate(request({ runId: " " }))).toThrow(FinalValidatorInputError);
    expect(() => validator.validate(request({ objective: " " }))).toThrow(FinalValidatorInputError);
  });

  test("is deterministic and reports every blocker, not just the first", () => {
    const input = request({
      tasks: [
        task("b", { outcome: "NOT_RUN", proofRef: null }),
        task("a", { outcome: "FAILED" }),
        task("c", { proofRef: null }),
      ],
      acceptanceCriteria: [criterion("c1", { satisfied: false })],
    });

    const first = validator.validate(input);
    expect(validator.validate(input)).toEqual(first);
    expect(first.blockingReasons.length).toBe(4);
    expect(first.notRunTaskIds).toEqual(["b", "c"]);
  });
});

// ---------------------------------------------------------------------
// ReportBuilder
// ---------------------------------------------------------------------

function reportInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    validation: validator.validate(request()),
    objective: "Ship the thing",
    cost: { totalCostUsd: 1.2345, inputTokens: 1000, outputTokens: 200 },
    fallbacks: [],
    openRisks: [],
    proofRefs: ["bun test test/team -> 521 pass"],
    ...overrides,
  };
}

const builder = new ReportBuilder();

describe("ReportBuilder — cannot launder an incomplete run", () => {
  test("uses a fixed headline per verdict, so no wording path invents success", () => {
    const incomplete = validator.validate(request({ tasks: [task("t1", { outcome: "NOT_RUN", proofRef: null })] }));
    const report = builder.build(reportInput({ validation: incomplete }));

    expect(report.verdict).toBe("INCOMPLETE");
    expect(report.headline).toContain("NOT achieved");
    expect(report.markdown).toContain("INCOMPLETE");
  });

  test("cannot report a verdict better than the validator's", () => {
    const failed = validator.validate(request({ tasks: [task("t1", { outcome: "FAILED" })] }));
    const report = builder.build(reportInput({ validation: failed }));

    expect(report.verdict).toBe("FAILED");
    expect(report.headline).toContain("NOT achieved");
    // The COMPLETE headline is the only one that may claim achievement.
    expect(report.headline).not.toContain("Objective achieved");
  });

  test("renders what is missing before anything positive", () => {
    const incomplete = validator.validate(request({ tasks: [task("t1", { outcome: "NOT_RUN", proofRef: null })] }));
    const report = builder.build(reportInput({ validation: incomplete }));

    const blockersAt = report.markdown.indexOf("Why this run is not complete");
    const costAt = report.markdown.indexOf("## Cost");
    expect(blockersAt).toBeGreaterThan(-1);
    expect(blockersAt).toBeLessThan(costAt);
  });

  test("always names the not-run tasks individually", () => {
    const incomplete = validator.validate(
      request({
        tasks: [task("alpha", { outcome: "NOT_RUN", proofRef: null }), task("beta", { outcome: "SKIPPED", proofRef: null })],
      }),
    );
    const report = builder.build(reportInput({ validation: incomplete }));

    expect(report.markdown).toContain("alpha");
    expect(report.markdown).toContain("beta");
    expect(report.notRunTaskIds).toEqual(["alpha", "beta"]);
  });

  test("calls out an unproven pass rather than counting it as one", () => {
    const unproven = validator.validate(request({ tasks: [task("t1", { proofRef: null })] }));
    const report = builder.build(reportInput({ validation: unproven }));

    expect(report.markdown).toContain("claimed passed without proof");
    expect(report.markdown).toContain("counted as not run");
  });

  test("always states the rollback status, and flags an untested one", () => {
    const untested = validator.validate(request({ rollbackStatus: "UNTESTED" }));
    const report = builder.build(reportInput({ validation: untested }));

    expect(report.rollbackStatus).toBe("UNTESTED");
    expect(report.markdown).toContain("unverified, not proven working");
  });

  test("renders proof, cost, fallbacks and risks", () => {
    const report = builder.build(
      reportInput({
        fallbacks: [{ from: "model-a", to: "model-b", reason: "rate limited" }],
        openRisks: [{ id: "R-1", description: "flaky device test", severity: "high" }],
      }),
    );

    expect(report.markdown).toContain("bun test test/team -> 521 pass");
    expect(report.markdown).toContain("1.2345 USD");
    expect(report.markdown).toContain("model-a → model-b");
    expect(report.markdown).toContain("R-1");
    expect(report.openRiskCount).toBe(1);
  });

  test("renders an explicit none rather than an empty section", () => {
    const report = builder.build(reportInput({ fallbacks: [], openRisks: [], proofRefs: [] }));

    expect(report.markdown).toContain("_none_");
  });

  test("is deterministic for the same run", () => {
    const input = reportInput();

    expect(builder.build(input)).toEqual(builder.build(input));
  });
});
