/**
 * types.ts — TEAM-D01
 *
 * Canonical, versioned Zod contracts for the core "Team" domain data model:
 * TeamConfig, Task, Plan, Attempt, Handoff, Gate, RoutingDecision, Report.
 *
 * These types describe the data this program's own multi-agent orchestration
 * already produces informally (cards, leases, fencing tokens, worktrees,
 * scope manifests, E2 review verdicts, reviewer-rotation decisions, handoff
 * .md files) but has never had a single, checked, versioned schema for. No
 * existing module in packages/unifia/src/team/ imports this file yet
 * (verified by grep before writing this module) — it is a foundation module,
 * not an integration.
 *
 * Design notes (see docs/team/scope-manifest/TEAM-D01.yaml + the D01 handoff
 * for the full rationale):
 *
 *  - Branded IDs: we brand every entity id with Zod's own `.brand<Tag>()`
 *    mechanism (a first-class Zod feature, not a custom wrapper). We do NOT
 *    reuse provider/schema.ts's ProviderID/ModelID pattern: that pattern is
 *    built on `effect`'s `Schema.brand` + a `withStatics` helper designed for
 *    modules that are Effect-Schema-first and only expose a Zod shim for
 *    interop. Nothing in packages/unifia/src/team/** depends on `effect`
 *    today, and model-intelligence/schema.ts (this program's other
 *    "canonical contracts" card, and the file this card was explicitly
 *    pointed at for versioning/error conventions) does not brand its ids
 *    either (plain `z.string().min(1)`). Introducing `effect` into team/ for
 *    branding alone would add a cross-cutting dependency with no other
 *    caller in this domain. Using Zod's native `.brand()` gives the same
 *    nominal-typing guarantee (two branded string types are not mutually
 *    assignable) with zero new dependencies and zero new abstraction to
 *    maintain — the smallest change that satisfies "don't reinvent, don't
 *    duplicate".
 *
 *  - Schema versioning: mirrors model-intelligence/schema-version.ts's shape
 *    (an explicit semver `SCHEMA_VERSION` constant + a documented N-1
 *    compatibility window) and model-intelligence/snapshot.ts's
 *    load-time dispatch (major-version compare; same-or-N-1 major loads,
 *    older major throws a typed "unsupported version" error). We do not
 *    import model-intelligence directly (forbidden cross-domain import,
 *    also enforced by this program's own CI linter per schema.ts's own
 *    comment) — we re-derive the same pattern locally for the team domain,
 *    which is the correct owner of team schema-version facts.
 *
 *  - Errors: NamedError.create from "@unifia/util/error", the same
 *    convention used throughout model-intelligence/errors.ts.
 *
 *  - superRefine invariants are added only where a wrong-but-schema-valid
 *    shape would be a real bug this program has actually hit (e.g. an
 *    Attempt marked "success" with no commit, a Gate verdict of
 *    CHANGES_REQUESTED with zero findings, a Task both PENDING and
 *    assigned). Invariants that would just restate business rules with no
 *    real inconsistency risk are deliberately omitted to avoid
 *    over-engineering.
 */

import { NamedError } from "@unifia/util/error";
import { z } from "zod";

// ============================================================================
// Schema versioning
// ============================================================================

/**
 * Current schema version for every entity in this module. Semver: a MAJOR
 * bump means "N-2, no automatic migration" (see loadAttempt() below for the
 * one migration path this card implements end-to-end); a MINOR/PATCH bump
 * means "additive, old data still parses under the current schema".
 */
export const TEAM_SCHEMA_VERSION = "2.0.0" as const;

/** Previous major version this module can still migrate FROM (N-1). */
export const TEAM_SCHEMA_VERSION_N_MINUS_1 = "1.0.0" as const;

export const TEAM_GENERATOR_VERSION = "team/types@2.0.0" as const;

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.]+)?$/;

/** Zod schema for a semver-shaped schema version string. */
export const SchemaVersion = z.string().regex(SEMVER, "schemaVersion must be semver");
export type SchemaVersion = z.infer<typeof SchemaVersion>;

function majorOf(version: string): number | null {
  const match = /^(\d+)\./.exec(version);
  return match ? Number(match[1]) : null;
}

/**
 * Compare a persisted schemaVersion against the module's current version by
 * MAJOR only (mirrors model-intelligence/snapshot.ts's compareVersions).
 * Returns "unparseable" if either string isn't semver-shaped.
 */
export function compareTeamSchemaVersion(
  found: string,
  current: string = TEAM_SCHEMA_VERSION,
): "equal" | "newer-major" | "older-major" | "unparseable" {
  const foundMajor = majorOf(found);
  const currentMajor = majorOf(current);
  if (foundMajor === null || currentMajor === null) return "unparseable";
  if (foundMajor === currentMajor) return "equal";
  return foundMajor > currentMajor ? "newer-major" : "older-major";
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Precise, stable validation error — replaces raw ZodError noise at every
 * public parse boundary in this module. `issues` is a flattened, JSON-safe
 * projection of the underlying ZodError (path joined with ".", the Zod issue
 * code, and the human message), so callers never need to know Zod's error
 * shape to inspect a validation failure.
 */
export const TeamValidationError = NamedError.create(
  "TeamValidationError",
  z.object({
    entity: z.string(),
    issues: z.array(
      z.object({
        path: z.string(),
        code: z.string(),
        message: z.string(),
      }),
    ),
  }),
);

/**
 * Thrown when a persisted payload's schemaVersion is older than the N-1
 * compatibility window (i.e. N-2 or older major) and therefore cannot be
 * migrated automatically.
 */
export const TeamSchemaVersionError = NamedError.create(
  "TeamSchemaVersionError",
  z.object({
    entity: z.string(),
    found: z.string(),
    current: z.string(),
    message: z.string(),
  }),
);

function parseEntity<Schema extends z.ZodTypeAny>(
  schema: Schema,
  entity: string,
  raw: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new TeamValidationError({
      entity,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
        message: issue.message,
      })),
    });
  }
  return result.data;
}

// ============================================================================
// Branded IDs
// ============================================================================
//
// Consistent with the real fields already produced by lock-manager.ts /
// worktree-manager.ts / hooks.ts: card_id, lease_id, worker_id, branch,
// worktree, base_sha, fencing_token, scope_manifest_hash. We brand the ids
// that flow between the NEW entity types defined here; we do not re-brand
// lock-manager's own plain-string fields (out of scope, frozen file).

export const TaskID = z.string().min(1).brand<"TaskID">();
export type TaskID = z.infer<typeof TaskID>;

export const PlanID = z.string().min(1).brand<"PlanID">();
export type PlanID = z.infer<typeof PlanID>;

export const AttemptID = z.string().min(1).brand<"AttemptID">();
export type AttemptID = z.infer<typeof AttemptID>;

export const HandoffID = z.string().min(1).brand<"HandoffID">();
export type HandoffID = z.infer<typeof HandoffID>;

export const GateID = z.string().min(1).brand<"GateID">();
export type GateID = z.infer<typeof GateID>;

export const RoutingDecisionID = z.string().min(1).brand<"RoutingDecisionID">();
export type RoutingDecisionID = z.infer<typeof RoutingDecisionID>;

export const ReportID = z.string().min(1).brand<"ReportID">();
export type ReportID = z.infer<typeof ReportID>;

export const TeamConfigID = z.string().min(1).brand<"TeamConfigID">();
export type TeamConfigID = z.infer<typeof TeamConfigID>;

/**
 * Worker id, e.g. "MM11" or "MM2-IMPLEMENTATION-LANE-A" — matches
 * lock-manager.ts's LeaseSpec.worker_id in shape but branded here so the
 * new entity types can't accidentally accept a TaskID where a WorkerID is
 * expected.
 */
export const WorkerID = z.string().min(1).brand<"WorkerID">();
export type WorkerID = z.infer<typeof WorkerID>;

/** Lease id, e.g. "LEASE-D01-20260725170000-team-d01-contracts-v1". */
export const LeaseID = z.string().min(1).brand<"LeaseID">();
export type LeaseID = z.infer<typeof LeaseID>;

// ============================================================================
// Shared value types
// ============================================================================

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
export const IsoDateTime = z.string().regex(ISO_8601, "must be ISO 8601 UTC");
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** 40-hex Git commit SHA. Matches lock-manager.ts's own base_sha validation. */
export const CommitSha = z.string().regex(/^[0-9a-f]{40}$/, "must be 40-hex git sha");
export type CommitSha = z.infer<typeof CommitSha>;

/** Scope mode, matches lock-manager.ts LeaseSpec.scope_mode literally. */
export const ScopeMode = z.enum(["OPEN", "E2_REQUIRED"]);
export type ScopeMode = z.infer<typeof ScopeMode>;

/** Risk tier, matches this program's own AGENTS.md triage tiers. */
export const RiskLevel = z.enum(["TRIVIAL", "STANDARD", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export function isoUtcNow(): IsoDateTime {
  return new Date().toISOString() as IsoDateTime;
}

// ============================================================================
// TeamConfig
// ============================================================================

const TeamParticipant = z.object({
  workerId: WorkerID,
  role: z.enum(["implementer", "reviewer", "orchestrator", "auditor"]),
  /** e.g. "claude-sonnet", "minimax", "glm" — the model family, not a specific id. */
  modelFamily: z.string().min(1),
});
export type TeamParticipant = z.infer<typeof TeamParticipant>;

const TeamConfigLimits = z.object({
  maxConcurrentLeases: z.number().int().positive(),
  defaultLeaseTtlSeconds: z.number().int().positive(),
  maxAttemptsPerTask: z.number().int().positive(),
});
export type TeamConfigLimits = z.infer<typeof TeamConfigLimits>;

const TeamConfigPolicies = z.object({
  /** D-010 §6: rotate reviewers across attempts on the same card. */
  reviewerRotation: z.boolean(),
  protectedBranches: z.array(z.string().min(1)).min(1),
  scopeMode: ScopeMode,
});
export type TeamConfigPolicies = z.infer<typeof TeamConfigPolicies>;

export const TeamConfig = z
  .object({
    schemaVersion: z.literal(TEAM_SCHEMA_VERSION),
    teamConfigId: TeamConfigID,
    teamId: z.string().min(1),
    sessionId: z.string().min(1),
    participants: z.array(TeamParticipant).min(1),
    limits: TeamConfigLimits,
    policies: TeamConfigPolicies,
    createdAt: IsoDateTime,
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < config.participants.length; i++) {
      const workerId = config.participants[i].workerId;
      if (seen.has(workerId)) {
        ctx.addIssue({
          code: "custom",
          path: ["participants", i, "workerId"],
          message: `duplicate participant workerId ${workerId}`,
        });
      }
      seen.add(workerId);
    }
    if (config.policies.reviewerRotation) {
      const reviewerCount = config.participants.filter((p) => p.role === "reviewer").length;
      if (reviewerCount === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["participants"],
          message: "policies.reviewerRotation is true but no participant has role=reviewer",
        });
      }
    }
  });
export type TeamConfig = z.infer<typeof TeamConfig>;

export function parseTeamConfig(raw: unknown): TeamConfig {
  return parseEntity(TeamConfig, "TeamConfig", raw);
}

// ============================================================================
// Task
// ============================================================================

const TaskScope = z.object({
  allowedFiles: z.array(z.string().min(1)),
  protectedFiles: z.array(z.string().min(1)),
  scopeMode: ScopeMode,
});
export type TaskScope = z.infer<typeof TaskScope>;

export const TaskStatus = z.enum([
  "PENDING",
  "ASSIGNED",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z
  .object({
    schemaVersion: z.literal(TEAM_SCHEMA_VERSION),
    taskId: TaskID,
    /** e.g. "TEAM-D01" — this program's own card id, a real-world Task instance. */
    cardId: z.string().min(1),
    title: z.string().min(1),
    riskLevel: RiskLevel,
    scope: TaskScope,
    dependsOn: z.array(TaskID).default([]),
    assignedWorkerId: WorkerID.nullable().default(null),
    status: TaskStatus,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((task, ctx) => {
    if (task.dependsOn.includes(task.taskId)) {
      ctx.addIssue({
        code: "custom",
        path: ["dependsOn"],
        message: `task ${task.taskId} cannot depend on itself`,
      });
    }
    const needsWorker = task.status === "ASSIGNED" || task.status === "IN_PROGRESS";
    if (needsWorker && task.assignedWorkerId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["assignedWorkerId"],
        message: `status ${task.status} requires a non-null assignedWorkerId`,
      });
    }
    if (task.status === "PENDING" && task.assignedWorkerId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["assignedWorkerId"],
        message: "status PENDING must not have an assignedWorkerId yet",
      });
    }
  });
export type Task = z.infer<typeof Task>;

export function parseTask(raw: unknown): Task {
  return parseEntity(Task, "Task", raw);
}

// ============================================================================
// Plan
// ============================================================================

const PlanAssignment = z.object({
  taskId: TaskID,
  workerId: WorkerID,
});
export type PlanAssignment = z.infer<typeof PlanAssignment>;

export const Plan = z
  .object({
    schemaVersion: z.literal(TEAM_SCHEMA_VERSION),
    planId: PlanID,
    taskIds: z.array(TaskID).min(1),
    /** Topological execution order — must be a permutation of taskIds. */
    ordering: z.array(TaskID).min(1),
    assignments: z.array(PlanAssignment).default([]),
    createdBy: WorkerID,
    createdAt: IsoDateTime,
  })
  .strict()
  .superRefine((plan, ctx) => {
    const taskIdSet = new Set(plan.taskIds);
    if (plan.taskIds.length !== taskIdSet.size) {
      ctx.addIssue({ code: "custom", path: ["taskIds"], message: "taskIds must not contain duplicates" });
    }
    const orderingSet = new Set(plan.ordering);
    if (plan.ordering.length !== orderingSet.size) {
      ctx.addIssue({ code: "custom", path: ["ordering"], message: "ordering must not contain duplicates" });
    }
    if (taskIdSet.size === orderingSet.size) {
      for (const id of taskIdSet) {
        if (!orderingSet.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["ordering"],
            message: `ordering is missing taskId ${id} present in taskIds`,
          });
        }
      }
      for (const id of orderingSet) {
        if (!taskIdSet.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["ordering"],
            message: `ordering references taskId ${id} not present in taskIds`,
          });
        }
      }
    } else {
      ctx.addIssue({
        code: "custom",
        path: ["ordering"],
        message: "ordering must be a permutation of taskIds (size mismatch)",
      });
    }
    for (let i = 0; i < plan.assignments.length; i++) {
      const assignment = plan.assignments[i];
      if (!taskIdSet.has(assignment.taskId)) {
        ctx.addIssue({
          code: "custom",
          path: ["assignments", i, "taskId"],
          message: `assignment references taskId ${assignment.taskId} not present in taskIds`,
        });
      }
    }
  });
export type Plan = z.infer<typeof Plan>;

export function parsePlan(raw: unknown): Plan {
  return parseEntity(Plan, "Plan", raw);
}

// ============================================================================
// Attempt (+ N-1 migration: TEAM_SCHEMA_VERSION 1.0.0 -> 2.0.0)
// ============================================================================
//
// Migration scenario for this card's "migration strategy" requirement:
// under schemaVersion "1.0.0", an attempt's outcome lived under the field
// name `result`. Under "2.0.0" it was renamed to `outcome` (clearer, matches
// this program's own vocabulary for attempt outcomes). A rename cannot be
// bridged by a Zod `.default()` — it needs an explicit migration step. See
// migrateAttemptV1ToV2() / loadAttempt() below.

export const AttemptOutcome = z.enum(["success", "failure", "aborted", "in_progress"]);
export type AttemptOutcome = z.infer<typeof AttemptOutcome>;

export const Attempt = z
  .object({
    schemaVersion: z.literal(TEAM_SCHEMA_VERSION),
    attemptId: AttemptID,
    taskId: TaskID,
    attemptNumber: z.number().int().positive(),
    workerId: WorkerID,
    outcome: AttemptOutcome,
    commitSha: CommitSha.nullable(),
    startedAt: IsoDateTime,
    finishedAt: IsoDateTime.nullable(),
    notes: z.string().nullable().default(null),
  })
  .strict()
  .superRefine((attempt, ctx) => {
    if (attempt.outcome === "success" && attempt.commitSha === null) {
      ctx.addIssue({
        code: "custom",
        path: ["commitSha"],
        message: 'outcome "success" requires a non-null commitSha',
      });
    }
    if (attempt.outcome === "in_progress") {
      if (attempt.finishedAt !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["finishedAt"],
          message: 'outcome "in_progress" must have a null finishedAt',
        });
      }
    } else if (attempt.finishedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: `outcome ${JSON.stringify(attempt.outcome)} requires a non-null finishedAt`,
      });
    }
    if (attempt.finishedAt !== null && attempt.finishedAt < attempt.startedAt) {
      ctx.addIssue({
        code: "custom",
        path: ["finishedAt"],
        message: "finishedAt must not be before startedAt",
      });
    }
  });
export type Attempt = z.infer<typeof Attempt>;

export function parseAttempt(raw: unknown): Attempt {
  return parseEntity(Attempt, "Attempt", raw);
}

/**
 * Legacy (N-1, schemaVersion "1.0.0") Attempt shape — kept ONLY to validate
 * and migrate old persisted data. Not exported as part of the public v2
 * surface; consumers should always end up with a current-shape Attempt via
 * loadAttempt().
 */
const AttemptV1 = z.object({
  schemaVersion: z.literal(TEAM_SCHEMA_VERSION_N_MINUS_1),
  attemptId: AttemptID,
  taskId: TaskID,
  attemptNumber: z.number().int().positive(),
  workerId: WorkerID,
  result: AttemptOutcome,
  commitSha: CommitSha.nullable(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  notes: z.string().nullable().default(null),
});

function migrateAttemptV1ToV2(v1: z.infer<typeof AttemptV1>): unknown {
  const { result, ...rest } = v1;
  return {
    ...rest,
    schemaVersion: TEAM_SCHEMA_VERSION,
    outcome: result,
  };
}

/**
 * Load an Attempt from an untrusted persisted payload, applying the N-1
 * migration when needed.
 *
 * Behaviour:
 *  - schemaVersion === current ("2.0.0")            -> parse directly.
 *  - schemaVersion === N-1 ("1.0.0")                 -> validate against the
 *    legacy shape, migrate (`result` -> `outcome`), then parse against the
 *    current schema.
 *  - anything else (N-2 or older, or malformed/missing schemaVersion)
 *                                                      -> throws
 *    TeamSchemaVersionError. We do NOT silently drop data or guess.
 */
export function loadAttempt(raw: unknown): Attempt {
  const versionField =
    raw && typeof raw === "object" && "schemaVersion" in raw
      ? (raw as { schemaVersion: unknown }).schemaVersion
      : undefined;

  if (typeof versionField !== "string") {
    throw new TeamSchemaVersionError({
      entity: "Attempt",
      found: String(versionField),
      current: TEAM_SCHEMA_VERSION,
      message: "payload is missing a string schemaVersion field",
    });
  }

  const comparison = compareTeamSchemaVersion(versionField);
  if (comparison === "equal") {
    return parseEntity(Attempt, "Attempt", raw);
  }
  if (versionField === TEAM_SCHEMA_VERSION_N_MINUS_1) {
    const legacy = parseEntity(AttemptV1, "Attempt(v1)", raw);
    return parseEntity(Attempt, "Attempt", migrateAttemptV1ToV2(legacy));
  }
  throw new TeamSchemaVersionError({
    entity: "Attempt",
    found: versionField,
    current: TEAM_SCHEMA_VERSION,
    message: `Attempt schemaVersion ${versionField} is older than the supported N-1 window (${TEAM_SCHEMA_VERSION_N_MINUS_1}); migration not supported.`,
  });
}

// ============================================================================
// Handoff
// ============================================================================

const HandoffEvidence = z.object({
  kind: z.enum(["file", "command_output", "test_result", "commit", "url"]),
  ref: z.string().min(1),
});
export type HandoffEvidence = z.infer<typeof HandoffEvidence>;

export const Handoff = z
  .object({
    schemaVersion: z.literal(TEAM_SCHEMA_VERSION),
    handoffId: HandoffID,
    taskId: TaskID,
    attemptId: AttemptID.nullable(),
    fromWorkerId: WorkerID,
    /** null = handed off to the process/queue rather than a specific worker. */
    toWorkerId: WorkerID.nullable(),
    summary: z.string().min(1),
    completed: z.array(z.string().min(1)).default([]),
    remaining: z.array(z.string().min(1)).default([]),
    evidenceRefs: z.array(HandoffEvidence).default([]),
    createdAt: IsoDateTime,
  })
  .strict()
  .superRefine((handoff, ctx) => {
    if (handoff.toWorkerId !== null && handoff.toWorkerId === handoff.fromWorkerId) {
      ctx.addIssue({
        code: "custom",
        path: ["toWorkerId"],
        message: "a handoff cannot be from a worker to itself",
      });
    }
  });
export type Handoff = z.infer<typeof Handoff>;

export function parseHandoff(raw: unknown): Handoff {
  return parseEntity(Handoff, "Handoff", raw);
}

// ============================================================================
// Gate
// ============================================================================

export const GateVerdict = z.enum(["APPROVED", "APPROVED_WITH_FOLLOWUP", "CHANGES_REQUESTED"]);
export type GateVerdict = z.infer<typeof GateVerdict>;

const GateFindingSeverity = z.enum(["blocking", "major", "minor", "nit"]);
export type GateFindingSeverity = z.infer<typeof GateFindingSeverity>;

const GateFinding = z.object({
  severity: GateFindingSeverity,
  message: z.string().min(1),
  location: z.string().nullable().default(null),
});
export type GateFinding = z.infer<typeof GateFinding>;

export const Gate = z
  .object({
    schemaVersion: z.literal(TEAM_SCHEMA_VERSION),
    gateId: GateID,
    taskId: TaskID,
    attemptId: AttemptID,
    reviewerWorkerId: WorkerID,
    verdict: GateVerdict,
    findings: z.array(GateFinding).default([]),
    followUps: z.array(z.string().min(1)).default([]),
    reviewedAt: IsoDateTime,
  })
  .strict()
  .superRefine((gate, ctx) => {
    const blockingOrMajor = gate.findings.filter(
      (f) => f.severity === "blocking" || f.severity === "major",
    ).length;
    if (gate.verdict === "CHANGES_REQUESTED" && blockingOrMajor === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["findings"],
        message: 'verdict "CHANGES_REQUESTED" requires at least one blocking or major finding',
      });
    }
    if (gate.verdict === "APPROVED" && blockingOrMajor > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["verdict"],
        message: 'verdict "APPROVED" cannot coexist with a blocking or major finding',
      });
    }
    if (gate.verdict === "APPROVED_WITH_FOLLOWUP" && gate.followUps.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["followUps"],
        message: 'verdict "APPROVED_WITH_FOLLOWUP" requires at least one followUp',
      });
    }
  });
export type Gate = z.infer<typeof Gate>;

export function parseGate(raw: unknown): Gate {
  return parseEntity(Gate, "Gate", raw);
}

// ============================================================================
// RoutingDecision
// ============================================================================

export const RoutingDecisionKind = z.enum([
  "MODEL_SELECTION",
  "REVIEWER_ASSIGNMENT",
  "FAMILY_FALLBACK",
  "WORKER_ASSIGNMENT",
]);
export type RoutingDecisionKind = z.infer<typeof RoutingDecisionKind>;

const RoutingCandidate = z.object({
  workerId: WorkerID.nullable(),
  modelFamily: z.string().min(1).nullable(),
  rejectedReason: z.string().nullable(),
});
export type RoutingCandidate = z.infer<typeof RoutingCandidate>;

const RoutingChoice = z.object({
  workerId: WorkerID.nullable(),
  modelFamily: z.string().min(1).nullable(),
});
export type RoutingChoice = z.infer<typeof RoutingChoice>;

export const RoutingDecision = z
  .object({
    schemaVersion: z.literal(TEAM_SCHEMA_VERSION),
    routingDecisionId: RoutingDecisionID,
    /** null = a session-level decision not tied to a single task. */
    taskId: TaskID.nullable(),
    decisionKind: RoutingDecisionKind,
    chosen: RoutingChoice,
    candidates: z.array(RoutingCandidate).default([]),
    rationale: z.string().min(1),
    /** e.g. "D-010 §6" — the policy document this decision implements. */
    policyRef: z.string().nullable().default(null),
    decidedAt: IsoDateTime,
  })
  .strict()
  .superRefine((decision, ctx) => {
    for (let i = 0; i < decision.candidates.length; i++) {
      const candidate = decision.candidates[i];
      const isChosenOne =
        candidate.workerId === decision.chosen.workerId &&
        candidate.modelFamily === decision.chosen.modelFamily;
      if (isChosenOne && candidate.rejectedReason !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["candidates", i, "rejectedReason"],
          message: "the chosen candidate cannot also carry a rejectedReason",
        });
      }
    }
  });
export type RoutingDecision = z.infer<typeof RoutingDecision>;

export function parseRoutingDecision(raw: unknown): RoutingDecision {
  return parseEntity(RoutingDecision, "RoutingDecision", raw);
}

// ============================================================================
// Report
// ============================================================================

export const ReportScope = z.enum(["TASK", "SESSION"]);
export type ReportScope = z.infer<typeof ReportScope>;

export const ReportOutcome = z.enum(["SUCCESS", "PARTIAL", "FAILURE", "BLOCKED"]);
export type ReportOutcome = z.infer<typeof ReportOutcome>;

const ReportMetrics = z.object({
  attemptsCount: z.number().int().nonnegative(),
  gatesPassed: z.number().int().nonnegative(),
  gatesFailed: z.number().int().nonnegative(),
  durationSeconds: z.number().nonnegative().nullable(),
});
export type ReportMetrics = z.infer<typeof ReportMetrics>;

export const Report = z
  .object({
    schemaVersion: z.literal(TEAM_SCHEMA_VERSION),
    reportId: ReportID,
    taskId: TaskID.nullable(),
    scope: ReportScope,
    outcome: ReportOutcome,
    summary: z.string().min(1),
    metrics: ReportMetrics,
    linkedHandoffs: z.array(HandoffID).default([]),
    linkedGates: z.array(GateID).default([]),
    generatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.scope === "TASK" && report.taskId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["taskId"],
        message: 'scope "TASK" requires a non-null taskId',
      });
    }
    if (report.scope === "SESSION" && report.taskId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["taskId"],
        message: 'scope "SESSION" must not have a taskId',
      });
    }
    if (report.metrics.gatesPassed + report.metrics.gatesFailed > 0 && report.metrics.attemptsCount === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["metrics", "attemptsCount"],
        message: "attemptsCount must be > 0 when at least one gate was recorded",
      });
    }
  });
export type Report = z.infer<typeof Report>;

export function parseReport(raw: unknown): Report {
  return parseEntity(Report, "Report", raw);
}
