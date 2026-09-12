/**
 * types.test.ts — TEAM-D01
 *
 * Proves, for every entity defined in src/team/types.ts:
 *   1. Round-trip serialization (construct -> JSON.stringify -> JSON.parse ->
 *      re-validate) is lossless.
 *   2. Invalid fixtures fail with a precise, stable TeamValidationError (not
 *      generic ZodError noise) — we assert on entity name + specific issue
 *      path/message, not just "success === false".
 *   3. Branded ids are nominally typed at the type level (compile-time proof
 *      via @ts-expect-error — this only "fails" the test suite if tsc is run
 *      over this file, which the validation gate always does).
 *   4. The N-1 schema-version migration path (Attempt: v1 `result` field ->
 *      v2 `outcome` field) both migrates old data and rejects an
 *      unmigrated N-1 payload fed directly to the current schema, plus
 *      rejects an N-2 payload outright with a typed error.
 */

import { describe, expect, test } from "bun:test";
import {
  Attempt,
  AttemptID,
  Gate,
  GateID,
  Handoff,
  HandoffID,
  IsoDateTime,
  LeaseID,
  loadAttempt,
  Plan,
  PlanID,
  parseAttempt,
  parseGate,
  parseHandoff,
  parsePlan,
  parseReport,
  parseRoutingDecision,
  parseTask,
  parseTeamConfig,
  Report,
  ReportID,
  RoutingDecision,
  RoutingDecisionID,
  Task,
  TaskID,
  TEAM_SCHEMA_VERSION,
  TEAM_SCHEMA_VERSION_N_MINUS_1,
  TeamConfig,
  TeamConfigID,
  TeamSchemaVersionError,
  TeamValidationError,
  WorkerID,
} from "../../src/team/types";

const NOW = "2026-07-25T17:00:00Z" as IsoDateTime;
const LATER = "2026-07-25T17:30:00Z" as IsoDateTime;
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/**
 * Strip a Zod brand back to a plain string for equality assertions. Branded
 * types are a compile-time-only guarantee (Zod erases the brand at runtime),
 * so comparing a branded value against a string literal needs an explicit
 * unwrap — this is that unwrap, isolated in one place.
 */
function asPlainString(branded: { toString(): string }): string {
  return String(branded);
}

/**
 * Manually-shaped mirrors of TeamValidationError/TeamSchemaVersionError's
 * `.data` payload, used only for test-side casting. We deliberately do NOT
 * derive these via `InstanceType<typeof TeamValidationError>["data"]`: that
 * generic projection resolves to an unrelated internal Zod type through the
 * `NamedError.create` factory's structural typing and does not name the
 * actual `{ entity, issues }` shape — these interfaces name it directly.
 */
interface TeamValidationIssue {
  path: string;
  code: string;
  message: string;
}
interface TeamValidationErrorData {
  entity: string;
  issues: TeamValidationIssue[];
}
interface TeamSchemaVersionErrorData {
  entity: string;
  found: string;
  current: string;
  message: string;
}

// ----------------------------------------------------------------------------
// Fixture builders — one valid, minimal-but-real instance per entity.
// ----------------------------------------------------------------------------

function makeTeamConfig(): TeamConfig {
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    teamConfigId: TeamConfigID.parse("TEAMCONFIG-D01-1"),
    teamId: "UNIFIA-TEAM-V3",
    sessionId: "session-20260725",
    participants: [
      { workerId: WorkerID.parse("MM11"), role: "implementer" as const, modelFamily: "claude-sonnet" },
      { workerId: WorkerID.parse("MM2"), role: "reviewer" as const, modelFamily: "minimax" },
    ],
    limits: { maxConcurrentLeases: 8, defaultLeaseTtlSeconds: 1800, maxAttemptsPerTask: 3 },
    policies: {
      reviewerRotation: true,
      protectedBranches: ["main", "dev", "Team", "opti-ui"],
      scopeMode: "E2_REQUIRED" as const,
    },
    createdAt: NOW,
  };
}

function makeTask(): Task {
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    taskId: TaskID.parse("TEAM-D01"),
    cardId: "TEAM-D01",
    title: "Contrats Team Zod finaux",
    riskLevel: "CRITICAL",
    scope: {
      allowedFiles: ["packages/unifia/src/team/types.ts"],
      protectedFiles: ["packages/unifia/src/team/lock-manager.ts"],
      scopeMode: "E2_REQUIRED",
    },
    dependsOn: [TaskID.parse("TEAM-C08")],
    assignedWorkerId: WorkerID.parse("MM11"),
    status: "IN_PROGRESS",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makePlan(): Plan {
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    planId: PlanID.parse("PLAN-LOT-D-1"),
    taskIds: [TaskID.parse("TEAM-D01"), TaskID.parse("TEAM-D02")],
    ordering: [TaskID.parse("TEAM-D01"), TaskID.parse("TEAM-D02")],
    assignments: [{ taskId: TaskID.parse("TEAM-D01"), workerId: WorkerID.parse("MM11") }],
    createdBy: WorkerID.parse("ORCHESTRATOR"),
    createdAt: NOW,
  };
}

function makeAttempt(): Attempt {
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    attemptId: AttemptID.parse("ATTEMPT-D01-1"),
    taskId: TaskID.parse("TEAM-D01"),
    attemptNumber: 1,
    workerId: WorkerID.parse("MM11"),
    outcome: "success",
    commitSha: SHA_A,
    startedAt: NOW,
    finishedAt: LATER,
    notes: "first attempt, clean",
  };
}

function makeHandoff(): Handoff {
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    handoffId: HandoffID.parse("HANDOFF-D01-1"),
    taskId: TaskID.parse("TEAM-D01"),
    attemptId: AttemptID.parse("ATTEMPT-D01-1"),
    fromWorkerId: WorkerID.parse("MM11"),
    toWorkerId: WorkerID.parse("REVIEWER-ROTATION"),
    summary: "Implemented Zod contracts for the Team domain.",
    completed: ["types.ts", "types.test.ts"],
    remaining: ["review"],
    evidenceRefs: [{ kind: "commit", ref: SHA_A }],
    createdAt: NOW,
  };
}

function makeGate(overrides: Partial<Gate> = {}): Gate {
  return { ...baseGate(), ...overrides };
}
function baseGate(): Gate {
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    gateId: GateID.parse("GATE-D01-1"),
    taskId: TaskID.parse("TEAM-D01"),
    attemptId: AttemptID.parse("ATTEMPT-D01-1"),
    reviewerWorkerId: WorkerID.parse("MM2"),
    verdict: "APPROVED",
    findings: [],
    followUps: [],
    reviewedAt: NOW,
  };
}

function makeRoutingDecision(): RoutingDecision {
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    routingDecisionId: RoutingDecisionID.parse("ROUTE-D01-1"),
    taskId: TaskID.parse("TEAM-D01"),
    decisionKind: "REVIEWER_ASSIGNMENT",
    chosen: { workerId: WorkerID.parse("MM2"), modelFamily: "minimax" },
    candidates: [
      { workerId: WorkerID.parse("MM2"), modelFamily: "minimax", rejectedReason: null },
      { workerId: WorkerID.parse("MM7"), modelFamily: "glm", rejectedReason: "same family as implementer" },
    ],
    rationale: "Reviewer rotation policy D-010 §6 requires a different model family from the implementer.",
    policyRef: "D-010 §6",
    decidedAt: NOW,
  };
}

function makeReport(): Report {
  return {
    schemaVersion: TEAM_SCHEMA_VERSION,
    reportId: ReportID.parse("REPORT-D01-1"),
    taskId: TaskID.parse("TEAM-D01"),
    scope: "TASK",
    outcome: "SUCCESS",
    summary: "TEAM-D01 delivered: Zod contracts for the Team domain, round-trip tested.",
    metrics: { attemptsCount: 1, gatesPassed: 1, gatesFailed: 0, durationSeconds: 1800 },
    linkedHandoffs: [HandoffID.parse("HANDOFF-D01-1")],
    linkedGates: [GateID.parse("GATE-D01-1")],
    generatedAt: NOW,
  };
}

// ----------------------------------------------------------------------------
// Round-trip helper
// ----------------------------------------------------------------------------

function roundTrip<T>(parse: (raw: unknown) => T, value: unknown): T {
  const parsed = parse(value);
  const json = JSON.stringify(parsed);
  const reparsed = parse(JSON.parse(json));
  expect(reparsed).toEqual(parsed);
  return reparsed;
}

// ----------------------------------------------------------------------------
// Branded IDs — nominal typing (compile-time proof; also basic runtime sanity)
// ----------------------------------------------------------------------------

describe("branded IDs", () => {
  test("distinct branded id types are not mutually assignable (compile-time)", () => {
    const taskId = TaskID.parse("TEAM-D01");
    const planId = PlanID.parse("PLAN-1");

    function acceptsTaskId(_id: TaskID): void {}

    acceptsTaskId(taskId);
    // @ts-expect-error PlanID must not be assignable to a parameter typed TaskID.
    acceptsTaskId(planId);

    expect(asPlainString(taskId)).toBe("TEAM-D01");
    expect(asPlainString(planId)).toBe("PLAN-1");
  });

  test("WorkerID and LeaseID reject empty strings", () => {
    expect(() => WorkerID.parse("")).toThrow();
    expect(() => LeaseID.parse("")).toThrow();
  });

  test("all id brands accept a non-empty string", () => {
    expect(asPlainString(TaskID.parse("x"))).toBe("x");
    expect(asPlainString(PlanID.parse("x"))).toBe("x");
    expect(asPlainString(AttemptID.parse("x"))).toBe("x");
    expect(asPlainString(HandoffID.parse("x"))).toBe("x");
    expect(asPlainString(GateID.parse("x"))).toBe("x");
    expect(asPlainString(RoutingDecisionID.parse("x"))).toBe("x");
    expect(asPlainString(ReportID.parse("x"))).toBe("x");
    expect(asPlainString(TeamConfigID.parse("x"))).toBe("x");
  });
});

// ----------------------------------------------------------------------------
// TeamConfig
// ----------------------------------------------------------------------------

describe("TeamConfig", () => {
  test("round-trips losslessly", () => {
    roundTrip(parseTeamConfig, makeTeamConfig());
  });

  test("rejects duplicate participant workerId with a precise issue", () => {
    const invalid = makeTeamConfig();
    invalid.participants = [...invalid.participants, { ...invalid.participants[0] }];
    try {
      parseTeamConfig(invalid);
      throw new Error("expected parseTeamConfig to throw");
    } catch (e) {
      expect(TeamValidationError.isInstance(e)).toBe(true);
      const err = e as { data: TeamValidationErrorData };
      expect(err.data.entity).toBe("TeamConfig");
      expect(err.data.issues.some((i) => i.message.includes("duplicate participant workerId"))).toBe(true);
    }
  });

  test("rejects reviewerRotation=true with zero reviewers", () => {
    const invalid = makeTeamConfig();
    invalid.participants = [{ workerId: WorkerID.parse("MM11"), role: "implementer", modelFamily: "claude-sonnet" }];
    const err = expectValidationError(() => parseTeamConfig(invalid), "TeamConfig");
    expect(err.issues.some((i) => i.message.includes("no participant has role=reviewer"))).toBe(true);
  });

  test("rejects unknown extra field (strict object)", () => {
    const invalid = { ...makeTeamConfig(), extraField: "not allowed" };
    expect(() => parseTeamConfig(invalid)).toThrow();
  });
});

// ----------------------------------------------------------------------------
// Task
// ----------------------------------------------------------------------------

describe("Task", () => {
  test("round-trips losslessly", () => {
    roundTrip(parseTask, makeTask());
  });

  test("rejects self-dependency", () => {
    const invalid = makeTask();
    invalid.dependsOn = [invalid.taskId];
    const err = expectValidationError(() => parseTask(invalid), "Task");
    expect(err.issues.some((i) => i.path === "dependsOn" && i.message.includes("cannot depend on itself"))).toBe(
      true,
    );
  });

  test("rejects IN_PROGRESS with null assignedWorkerId", () => {
    const invalid = { ...makeTask(), assignedWorkerId: null };
    const err = expectValidationError(() => parseTask(invalid), "Task");
    expect(err.issues.some((i) => i.path === "assignedWorkerId")).toBe(true);
  });

  test("rejects PENDING with a non-null assignedWorkerId", () => {
    const invalid = { ...makeTask(), status: "PENDING" as const };
    const err = expectValidationError(() => parseTask(invalid), "Task");
    expect(
      err.issues.some((i) => i.path === "assignedWorkerId" && i.message.includes("must not have")),
    ).toBe(true);
  });

  test("rejects invalid riskLevel enum value", () => {
    const invalid = { ...makeTask(), riskLevel: "MEDIUM" };
    expect(() => parseTask(invalid)).toThrow(TeamValidationError);
  });
});

// ----------------------------------------------------------------------------
// Plan
// ----------------------------------------------------------------------------

describe("Plan", () => {
  test("round-trips losslessly", () => {
    roundTrip(parsePlan, makePlan());
  });

  test("rejects ordering that omits a taskId", () => {
    const invalid = makePlan();
    invalid.ordering = [invalid.taskIds[0]];
    const err = expectValidationError(() => parsePlan(invalid), "Plan");
    expect(err.issues.some((i) => i.path === "ordering")).toBe(true);
  });

  test("rejects ordering that references an unknown taskId", () => {
    const invalid = makePlan();
    // Same length as taskIds (2) so the permutation-by-size check passes and
    // the per-element membership check runs, isolating this from the
    // separate "size mismatch" case covered by the previous test.
    invalid.ordering = [TaskID.parse("TEAM-GHOST"), invalid.taskIds[1]];
    const err = expectValidationError(() => parsePlan(invalid), "Plan");
    expect(err.issues.some((i) => i.path === "ordering" && i.message.includes("TEAM-GHOST"))).toBe(true);
  });

  test("rejects assignment referencing a taskId not in taskIds", () => {
    const invalid = makePlan();
    invalid.assignments = [{ taskId: TaskID.parse("TEAM-GHOST"), workerId: WorkerID.parse("MM11") }];
    const err = expectValidationError(() => parsePlan(invalid), "Plan");
    expect(err.issues.some((i) => i.path.startsWith("assignments"))).toBe(true);
  });

  test("rejects duplicate taskIds", () => {
    const invalid = makePlan();
    invalid.taskIds = [invalid.taskIds[0], invalid.taskIds[0]];
    const err = expectValidationError(() => parsePlan(invalid), "Plan");
    expect(err.issues.some((i) => i.path === "taskIds")).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Attempt
// ----------------------------------------------------------------------------

describe("Attempt", () => {
  test("round-trips losslessly", () => {
    roundTrip(parseAttempt, makeAttempt());
  });

  test("rejects outcome=success with null commitSha", () => {
    const invalid = { ...makeAttempt(), commitSha: null };
    const err = expectValidationError(() => parseAttempt(invalid), "Attempt");
    expect(err.issues.some((i) => i.path === "commitSha" && i.message.includes("success"))).toBe(true);
  });

  test("rejects outcome=in_progress with a non-null finishedAt", () => {
    const invalid = { ...makeAttempt(), outcome: "in_progress" as const, commitSha: null };
    const err = expectValidationError(() => parseAttempt(invalid), "Attempt");
    expect(err.issues.some((i) => i.path === "finishedAt")).toBe(true);
  });

  test("rejects outcome=failure with a null finishedAt", () => {
    const invalid = { ...makeAttempt(), outcome: "failure" as const, commitSha: null, finishedAt: null };
    const err = expectValidationError(() => parseAttempt(invalid), "Attempt");
    expect(err.issues.some((i) => i.path === "finishedAt" && i.message.includes("requires a non-null"))).toBe(
      true,
    );
  });

  test("rejects finishedAt before startedAt", () => {
    const invalid = { ...makeAttempt(), startedAt: LATER, finishedAt: NOW };
    const err = expectValidationError(() => parseAttempt(invalid), "Attempt");
    expect(err.issues.some((i) => i.path === "finishedAt" && i.message.includes("before startedAt"))).toBe(
      true,
    );
  });

  test("accepts in_progress with null commitSha and null finishedAt", () => {
    const valid = { ...makeAttempt(), outcome: "in_progress" as const, commitSha: null, finishedAt: null };
    expect(() => parseAttempt(valid)).not.toThrow();
  });
});

// ----------------------------------------------------------------------------
// Attempt — N-1 schema-version migration
// ----------------------------------------------------------------------------

describe("Attempt schema-version migration (N-1: 1.0.0 -> 2.0.0)", () => {
  function makeV1AttemptRaw() {
    return {
      schemaVersion: TEAM_SCHEMA_VERSION_N_MINUS_1,
      attemptId: "ATTEMPT-D01-1",
      taskId: "TEAM-D01",
      attemptNumber: 1,
      workerId: "MM11",
      result: "success",
      commitSha: SHA_B,
      startedAt: NOW,
      finishedAt: LATER,
      notes: null,
    };
  }

  test("loadAttempt migrates a v1 payload (result -> outcome) to the current schema", () => {
    const migrated = loadAttempt(makeV1AttemptRaw());
    expect(migrated.schemaVersion).toBe(TEAM_SCHEMA_VERSION);
    expect(migrated.outcome).toBe("success");
    expect(migrated.commitSha).toBe(SHA_B);
    expect((migrated as Record<string, unknown>)["result"]).toBeUndefined();
  });

  test("loadAttempt migration round-trips through JSON losslessly", () => {
    roundTrip(loadAttempt, makeV1AttemptRaw());
  });

  test("feeding an unmigrated v1 payload directly to parseAttempt (v2 schema) fails precisely", () => {
    const raw = makeV1AttemptRaw();
    try {
      parseAttempt(raw);
      throw new Error("expected parseAttempt to throw on unmigrated v1 payload");
    } catch (e) {
      expect(TeamValidationError.isInstance(e)).toBe(true);
      const err = e as { data: TeamValidationErrorData };
      // The v2 schema requires `outcome` (missing) and is `.strict()` so the
      // legacy `result` field is flagged as unrecognized — either signal is
      // an acceptable, precise proof that v1 data is rejected as-is.
      const mentionsOutcomeMissing = err.data.issues.some(
        (i) => i.path === "outcome" && i.code === "invalid_type",
      );
      const mentionsUnrecognizedResult = err.data.issues.some((i) => i.code === "unrecognized_keys");
      expect(mentionsOutcomeMissing || mentionsUnrecognizedResult).toBe(true);
    }
  });

  test("loadAttempt rejects an N-2 (older than N-1) schemaVersion with a typed error, not silently", () => {
    const raw = { ...makeV1AttemptRaw(), schemaVersion: "0.9.0" };
    try {
      loadAttempt(raw);
      throw new Error("expected loadAttempt to throw on N-2 schemaVersion");
    } catch (e) {
      expect(TeamSchemaVersionError.isInstance(e)).toBe(true);
      const err = e as { data: TeamSchemaVersionErrorData };
      expect(err.data.found).toBe("0.9.0");
      expect(err.data.current).toBe(TEAM_SCHEMA_VERSION);
      expect(err.data.entity).toBe("Attempt");
    }
  });

  test("loadAttempt rejects a payload with a missing schemaVersion", () => {
    const raw = makeV1AttemptRaw() as Record<string, unknown>;
    delete raw["schemaVersion"];
    expect(() => loadAttempt(raw)).toThrow(TeamSchemaVersionError);
  });

  test("loadAttempt accepts a current-version (2.0.0) payload directly", () => {
    const attempt = loadAttempt(makeAttempt());
    expect(attempt.outcome).toBe("success");
  });
});

// ----------------------------------------------------------------------------
// Handoff
// ----------------------------------------------------------------------------

describe("Handoff", () => {
  test("round-trips losslessly", () => {
    roundTrip(parseHandoff, makeHandoff());
  });

  test("rejects a handoff from a worker to itself", () => {
    const invalid = { ...makeHandoff(), toWorkerId: makeHandoff().fromWorkerId };
    const err = expectValidationError(() => parseHandoff(invalid), "Handoff");
    expect(err.issues.some((i) => i.path === "toWorkerId" && i.message.includes("to itself"))).toBe(true);
  });

  test("accepts toWorkerId=null (handoff to the queue/process)", () => {
    const valid = { ...makeHandoff(), toWorkerId: null };
    expect(() => parseHandoff(valid)).not.toThrow();
  });

  test("rejects an evidenceRef with an unknown kind", () => {
    const invalid = { ...makeHandoff(), evidenceRefs: [{ kind: "carrier_pigeon", ref: "x" }] };
    expect(() => parseHandoff(invalid)).toThrow(TeamValidationError);
  });
});

// ----------------------------------------------------------------------------
// Gate
// ----------------------------------------------------------------------------

describe("Gate", () => {
  test("round-trips losslessly (APPROVED)", () => {
    roundTrip(parseGate, makeGate());
  });

  test("round-trips losslessly (CHANGES_REQUESTED with a blocking finding)", () => {
    roundTrip(
      parseGate,
      makeGate({
        verdict: "CHANGES_REQUESTED",
        findings: [{ severity: "blocking", message: "missing test coverage", location: "src/team/types.ts:10" }],
      }),
    );
  });

  test("rejects CHANGES_REQUESTED with zero findings", () => {
    const invalid = makeGate({ verdict: "CHANGES_REQUESTED", findings: [] });
    const err = expectValidationError(() => parseGate(invalid), "Gate");
    expect(err.issues.some((i) => i.path === "findings" && i.message.includes("blocking or major"))).toBe(
      true,
    );
  });

  test("rejects APPROVED with a blocking finding present", () => {
    const invalid = makeGate({
      verdict: "APPROVED",
      findings: [{ severity: "blocking", message: "nope", location: null }],
    });
    const err = expectValidationError(() => parseGate(invalid), "Gate");
    expect(err.issues.some((i) => i.path === "verdict")).toBe(true);
  });

  test("rejects APPROVED_WITH_FOLLOWUP with zero followUps", () => {
    const invalid = makeGate({ verdict: "APPROVED_WITH_FOLLOWUP", followUps: [] });
    const err = expectValidationError(() => parseGate(invalid), "Gate");
    expect(err.issues.some((i) => i.path === "followUps")).toBe(true);
  });

  test("accepts CHANGES_REQUESTED with only a major finding (blocking not required specifically)", () => {
    const valid = makeGate({
      verdict: "CHANGES_REQUESTED",
      findings: [{ severity: "major", message: "needs work", location: null }],
    });
    expect(() => parseGate(valid)).not.toThrow();
  });
});

// ----------------------------------------------------------------------------
// RoutingDecision
// ----------------------------------------------------------------------------

describe("RoutingDecision", () => {
  test("round-trips losslessly", () => {
    roundTrip(parseRoutingDecision, makeRoutingDecision());
  });

  test("rejects the chosen candidate also carrying a rejectedReason", () => {
    const invalid = makeRoutingDecision();
    invalid.candidates = [{ ...invalid.candidates[0], rejectedReason: "contradiction" }];
    const err = expectValidationError(() => parseRoutingDecision(invalid), "RoutingDecision");
    expect(err.issues.some((i) => i.path.includes("rejectedReason"))).toBe(true);
  });

  test("accepts taskId=null for a session-level decision", () => {
    const valid = { ...makeRoutingDecision(), taskId: null };
    expect(() => parseRoutingDecision(valid)).not.toThrow();
  });

  test("rejects an unknown decisionKind", () => {
    const invalid = { ...makeRoutingDecision(), decisionKind: "COIN_FLIP" };
    expect(() => parseRoutingDecision(invalid)).toThrow(TeamValidationError);
  });
});

// ----------------------------------------------------------------------------
// Report
// ----------------------------------------------------------------------------

describe("Report", () => {
  test("round-trips losslessly (scope=TASK)", () => {
    roundTrip(parseReport, makeReport());
  });

  test("round-trips losslessly (scope=SESSION)", () => {
    roundTrip(
      parseReport,
      { ...makeReport(), scope: "SESSION" as const, taskId: null },
    );
  });

  test("rejects scope=TASK with a null taskId", () => {
    const invalid = { ...makeReport(), taskId: null };
    const err = expectValidationError(() => parseReport(invalid), "Report");
    expect(err.issues.some((i) => i.path === "taskId")).toBe(true);
  });

  test("rejects scope=SESSION with a non-null taskId", () => {
    const invalid = { ...makeReport(), scope: "SESSION" as const };
    const err = expectValidationError(() => parseReport(invalid), "Report");
    expect(err.issues.some((i) => i.path === "taskId")).toBe(true);
  });

  test("rejects gatesPassed>0 with attemptsCount=0", () => {
    const invalid = { ...makeReport(), metrics: { ...makeReport().metrics, attemptsCount: 0 } };
    const err = expectValidationError(() => parseReport(invalid), "Report");
    expect(err.issues.some((i) => i.path === "metrics.attemptsCount")).toBe(true);
  });

  test("rejects negative durationSeconds", () => {
    const invalid = { ...makeReport(), metrics: { ...makeReport().metrics, durationSeconds: -1 } };
    expect(() => parseReport(invalid)).toThrow(TeamValidationError);
  });
});

// ----------------------------------------------------------------------------
// Shared assertion helper
// ----------------------------------------------------------------------------

function expectValidationError(fn: () => unknown, entity: string): TeamValidationErrorData {
  try {
    fn();
  } catch (e) {
    expect(TeamValidationError.isInstance(e)).toBe(true);
    const err = e as { data: TeamValidationErrorData };
    expect(err.data.entity).toBe(entity);
    return err.data;
  }
  throw new Error(`expected ${entity} parse to throw a TeamValidationError`);
}
