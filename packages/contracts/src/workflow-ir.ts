/* SPDX-License-Identifier: MIT */
/**
 * Workflow IR (intermediate representation) — Plan V2.3.1 §55, ADR-002.
 *
 * The IR is the canonical, content-addressed form a workflow is
 * serialized into for storage, transport, and canonicalization
 * (Plan V2.3.1 §64, ADR-001). A WorkflowDefinition is what an author
 * edits; the runtime promotes it to one or more immutable
 * WorkflowVersion snapshots, each identified by a content digest
 * over the canonical JCS-v1 bytes.
 *
 * First target (ADR-002 Option A) is six node families — three
 * triggers, two effectors, one control. The IR is *intentionally*
 * closed: extending it requires a new family, a new version, and an
 * ADR. We do not let users bolt on ad-hoc node kinds.
 *
 * DigestDomainSchema lives in `digest.ts` to avoid a circular import
 * (this file re-exports it for callers that import from here).
 */
import { z } from "zod"
import { OwnershipScopeSchema, DeploymentScopeSchema } from "./scope.js"
import {
  DigestDomainSchema,
  WorkflowVersionDigestSchema,
  type DigestDomain,
} from "./digest.js"
import { OverlapPolicySchema, CatchUpPolicySchema } from "./timer.js"

// Re-export so callers that import from this file still see DigestDomainSchema
// next to WorkflowIRSchema. The authoritative definition lives in digest.ts.
export { DigestDomainSchema }
export type { DigestDomain }

/* ------------------------------------------------------------------ */
/* Node families (ADR-002 Option A)                                    */
/* ------------------------------------------------------------------ */

/**
 * The node families in this IR version. The dotted form
 * (`family.verb`) is preserved as a literal string so the IR is
 * self-describing in logs and on the wire.
 *
 * The list grows additively with each M2 GREEN card (ADR-002
 * Option A): a new family, a new version, and an ADR. We do not
 * let users bolt on ad-hoc node kinds. The order is stable:
 * triggers first, then control flow, then effectors, then
 * orchestration. Within the control-flow block, the canonical
 * M2 ordering is `if → switch → parallel → merge → map → repeat`
 * (each value added by its respective M2 card: M2-01, M2-02,
 * M2-03, M2-04, M2-05, M2-06). `control.map` iterates over a
 * collection with stable keys for replay-safety (ADR-005);
 * `control.repeat` is the strictly-bounded loop primitive
 * (ADR-002 §6). M2-07 (`while`), M2-08 (`child`) and M2-09
 * (`wait` refine) are RED and do not appear here yet.
 *
 * M3 Round 2 (M3-04 retry, M3-05 reconciliation, M3-06
 * UNKNOWN_EXTERNAL_STATE, M3-07 compensation, M3-08 wait
 * contract) does NOT add new families — these are *config
 * extensions* layered on the existing `tool.http`, `human.approval`
 * and `wait` effector families. A new family is reserved for
 * genuinely new node kinds, per ADR-002.
 */
export const NodeFamilySchema = z.enum([
  "trigger.manual",
  "trigger.schedule",
  "control.if",
  "control.switch",
  "control.parallel",
  "control.merge",
  "control.map",
  "control.repeat",
  "control.while",
  "control.child",
  "tool.http",
  "tool.transform",
  "human.approval",
  "wait",
])

export type NodeFamily = z.infer<typeof NodeFamilySchema>

/* ------------------------------------------------------------------ */
/* Policies (failure, concurrency, requirements)                       */
/* ------------------------------------------------------------------ */

/**
 * How a node reacts to an exception. `propagate` re-raises to the
 * workflow level (the workflow's policy applies). `retry` re-runs
 * the node up to `maxAttempts` times with `backoffMs` between
 * attempts; on final failure the workflow's policy applies.
 * `ignore` treats the node as having produced an undefined output
 * and continues.
 */
export const FailurePolicySchema = z.object({
  kind: z.enum(["propagate", "retry", "ignore"]),
  maxAttempts: z.number().int().positive().optional(),
  backoffMs: z.number().int().nonnegative().optional(),
})

export type FailurePolicy = z.infer<typeof FailurePolicySchema>

/**
 * How the workflow scheduler constrains concurrent executions of
 * the same workflow version.
 *
 * - `none`     : no limit; every firing runs in parallel.
 * - `single`   : at most one run at a time; further runs queue.
 * - `group`    : at most N runs in parallel; further runs queue.
 */
export const ConcurrencyPolicySchema = z.object({
  kind: z.enum(["none", "single", "group"]),
  maxConcurrent: z.number().int().positive().optional(),
})

export type ConcurrencyPolicy = z.infer<typeof ConcurrencyPolicySchema>

/**
 * Capabilities a worker must possess to execute a node. The
 * scheduler uses this to pick a compatible worker; a workflow whose
 * nodes all require `gpu` will not start on a worker whose
 * WorkerId does not list `gpu`.
 */
export const ExecutionRequirementsSchema = z.object({
  capabilities: z.array(z.string()).readonly().optional(),
  resourceClass: z.string().optional(),
  executionProfile: z.string().optional(),
})

export type ExecutionRequirements = z.infer<typeof ExecutionRequirementsSchema>

/* ------------------------------------------------------------------ */
/* Edge + node graph                                                   */
/* ------------------------------------------------------------------ */

/**
 * A directed edge from one node to another. `from` and `to` are node
 * ids within the same WorkflowDefinition. `kind` discriminates the
 * meaningful cases:
 * - `flow`: normal data/control flow.
 * - `branch-true` / `branch-false`: the two branches of a
 *   `control.if` family (M1, M2-01).
 * - `case-value`: a per-case branch edge out of a `control.switch`
 *   family (M2-02). Each declared `SwitchCase` produces one
 *   `case-value` edge from the switch node to the case's
 *   `target`. Like `branch-N` for parallel, the literal is a
 *   single token because Zod enums cannot be parameterized by
 *   string payloads; the `SwitchCase.value` is the per-edge
 *   disambiguator the runtime matches against the discriminator
 *   expression's evaluated result.
 * - `branch-N`: a branch edge out of a `control.parallel` family
 *   (M2-03). Zod enums cannot be parameterized by an integer
 *   range, so the literal `branch-N` is used (not `branch-0`,
 *   `branch-1`, …). At runtime, the *target node's branch id*
 *   (from `ControlParallelBranch.branchId`) disambiguates which
 *   branch the edge belongs to — each target node of a fan-out
 *   receives exactly one incoming `branch-N` edge. M2-TEST
 *   validates this convention.
 * - `on-failure`: the unconditional failure branch used by failure
 *   policies.
 */
export const EdgeKindSchema = z.enum([
  "flow",
  "branch-true",
  "branch-false",
  "case-value",
  "branch-N",
  "on-failure",
])

export type EdgeKind = z.infer<typeof EdgeKindSchema>

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: EdgeKindSchema,
})

export type Edge = z.infer<typeof EdgeSchema>

/**
 * The shared shape every node carries. Family-specific options live
 * in `config` as an opaque record; the runtime validates `config`
 * against the family's own schema at execution time. Keeping it
 * opaque here lets the IR stay version-stable when a family's
 * options evolve (the family is versioned separately).
 */
export const NodeSchema = z.object({
  /** Stable id within the workflow. */
  id: z.string(),
  family: NodeFamilySchema,
  /** Family-specific configuration. Opaque to the IR. */
  config: z.record(z.string(), z.unknown()),
  /**
   * Per-node timeout in milliseconds. If unset, the workflow's
   * default applies. A value of 0 means "no timeout".
   */
  timeoutMs: z.number().int().nonnegative().optional(),
  /** Per-node failure policy override. */
  failurePolicy: FailurePolicySchema.optional(),
  /** Per-node execution requirements (e.g. min resource class). */
  requirements: ExecutionRequirementsSchema.optional(),
})

export type Node = z.infer<typeof NodeSchema>

/* ------------------------------------------------------------------ */
/* Control node config (M2-01, ADR-002 + ADR-003)                      */
/* ------------------------------------------------------------------ */

/**
 * Maximum length of a `condition` expression. The expression language
 * is bounded (ADR-003): any control-flow predicate lives in a fixed
 * surface so the platform can sandbox it, type-check it, and
 * deterministically evaluate it. 1024 chars is far above the realistic
 * upper bound (~80 chars for a real-world `if` predicate) and well
 * below the adversarial length at which a string-based payload could
 * bloat a content digest.
 */
export const CONTROL_IF_CONDITION_MAX_CHARS = 1024

/**
 * Maximum length of a free-form `description` on a control node. Kept
 * short (280 chars) because the description is metadata for an
 * inspector UI, not a documentation field — the workflow's own
 * `description` is the durable place for prose.
 */
export const CONTROL_IF_DESCRIPTION_MAX_CHARS = 280

/**
 * Configuration of a `control.if` family node (Plan V2.3.1 §198,
 * M2-01, ADR-002 Option A + ADR-003 expression language).
 *
 * The IR keeps `Node.config` opaque (see NodeSchema); this Zod schema
 * is the family's own validator. The runtime calls
 * `parseControlIfConfig(node.config)` after the IR has parsed
 * successfully, so any `Node` with `family: "control.if"` whose
 * `config` does not match this schema is rejected at the trust
 * boundary — never silently passed to a worker.
 *
 * Branch selection is dual-channel:
 * - If `trueBranch` / `falseBranch` is set to a non-empty node id,
 *   the runtime takes that edge (a hard, declared branch).
 * - If it is omitted (or explicitly null), the runtime falls back to
 *   the corresponding `EdgeKind` (`branch-true` / `branch-false`)
 *   leaving the graph topology to drive the routing.
 *
 * The two channels are NOT mutually exclusive: a workflow may declare
 * a `trueBranch` AND have a `branch-true` edge — the declared branch
 * wins, the edge is a documentary default the editor renders when
 * `trueBranch` is null. Validating both at parse time is the
 * contract's job; deciding which one to follow at run time is the
 * kernel's job (ADR-000).
 */
export const ControlIfConfigSchema = z.object({
  /**
   * Expression-language predicate (ADR-003). The schema does not
   * parse the expression itself — it is a non-empty string bounded
   * by `CONTROL_IF_CONDITION_MAX_CHARS`. The expression is evaluated
   * at runtime by the kernel's expression evaluator; the IR only
   * validates its shape and length.
   */
  condition: z
    .string()
    .min(1, "control.if: condition must be non-empty")
    .max(
      CONTROL_IF_CONDITION_MAX_CHARS,
      `control.if: condition must be ≤ ${CONTROL_IF_CONDITION_MAX_CHARS} chars`,
    ),
  /**
   * Optional hard-coded target node id for the true branch. When
   * nullish (null or undefined), the runtime falls back to the
   * `branch-true` edge. When set, the value is a non-empty node id
   * within the same `WorkflowDefinition`.
   */
  trueBranch: z
    .string()
    .min(1, "control.if: trueBranch must be a non-empty node id when set")
    .nullish(),
  /**
   * Optional hard-coded target node id for the false branch.
   * Same semantics as `trueBranch`, but routed to `branch-false` when
   * nullish.
   */
  falseBranch: z
    .string()
    .min(1, "control.if: falseBranch must be a non-empty node id when set")
    .nullish(),
  /**
   * Free-form human description. Display-only — never interpreted.
   * Capped at `CONTROL_IF_DESCRIPTION_MAX_CHARS` so a noisy editor
   * does not push the content digest of a `WorkflowVersion` toward
   * the limits of practical canonicalization.
   */
  description: z
    .string()
    .max(
      CONTROL_IF_DESCRIPTION_MAX_CHARS,
      `control.if: description must be ≤ ${CONTROL_IF_DESCRIPTION_MAX_CHARS} chars`,
    )
    .optional(),
})

export type ControlIfConfig = z.infer<typeof ControlIfConfigSchema>

/**
 * Validate the opaque `config` record of a `control.if` node against
 * `ControlIfConfigSchema`. Throws `z.ZodError` on failure with the
 * field path the caller can use to point at the bad input.
 *
 * The IR's `NodeSchema` keeps `config` as `z.record(z.string(),
 * z.unknown())` so the family-specific shape does not leak into the
 * IR (a new family cannot break parsing of an existing one). This
 * helper is the bridge: every code path that *consumes* a
 * `control.if` node MUST call this before reading the config fields.
 * The runtime does so at the trust boundary; the type system cannot
 * enforce it because `config` is opaque.
 */
export function parseControlIfConfig(config: unknown): ControlIfConfig {
  return ControlIfConfigSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* Control node config — M2-02 (switch), M2-03 (parallel), M2-04 (merge) */
/* ------------------------------------------------------------------ */

/**
 * Maximum length of a `control.switch` discriminator expression
 * (ADR-003). Same bound as `control.if` for parity — the
 * expression language is bounded across all control-flow
 * predicates, the platform sandboxes and type-checks it, and the
 * digest stays far from any practical canonicalization limit.
 */
export const CONTROL_SWITCH_DISCRIMINATOR_MAX_CHARS = 1024

/**
 * Maximum length of a single `case.value` literal on a
 * `control.switch`. Kept short (256 chars) because case values
 * are equality keys, not free-form strings; longer payloads
 * almost always indicate misuse (e.g. a serialized object).
 */
export const CONTROL_SWITCH_CASE_VALUE_MAX_CHARS = 256

/**
 * Maximum number of cases a `control.switch` may declare. 64 is
 * far above any realistic dispatch table (most switches have
 * <10 cases) and well below the count at which the discriminator
 * expression's fan-out becomes a digest-bloat risk.
 */
export const CONTROL_SWITCH_MAX_CASES = 64

/**
 * Configuration of a `control.switch` family node (Plan V2.3.1
 * §198, M2-02, ADR-002 Option A + ADR-003 expression language).
 *
 * Like `control.if`, the IR keeps `Node.config` opaque; this Zod
 * schema is the family's own validator, applied at the family's
 * trust boundary via `parseControlSwitchConfig(node.config)`.
 *
 * Switch routing is dual-channel — same pattern as
 * `control.if`:
 * - If a case's `target` is a non-empty node id, the runtime
 *   takes that edge when the discriminator evaluates to the
 *   case's `value`.
 * - The graph topology (a `case-value` `EdgeKind` from the
 *   switch node to the target) is the documentary default the
 *   editor renders.
 *
 * A switch with no `default` is allowed: if no case matches, the
 * switch terminates the path (no edge is followed). This is
 * distinct from `control.if`, where the false branch is
 * structurally required.
 */
export const SwitchCaseSchema = z.object({
  /**
   * The literal value this case matches against the evaluated
   * discriminator. Compared as a string. Empty strings are
   * rejected to keep the case table unambiguous (a missing
   * case should be modeled by omitting the case, not by
   * matching the empty string).
   */
  value: z
    .string()
    .min(1, "control.switch: case.value must be non-empty")
    .max(
      CONTROL_SWITCH_CASE_VALUE_MAX_CHARS,
      `control.switch: case.value must be ≤ ${CONTROL_SWITCH_CASE_VALUE_MAX_CHARS} chars`,
    ),
  /**
   * Target node id this case routes to. Must be a non-empty
   * node id within the same `WorkflowDefinition` — the
   * runtime does a topology check at execution time, not at
   * parse time, because the IR keeps the node table
   * unindexed.
   */
  target: z
    .string()
    .min(1, "control.switch: case.target must be a non-empty node id"),
})

export type SwitchCase = z.infer<typeof SwitchCaseSchema>

export const ControlSwitchConfigSchema = z
  .object({
    /**
     * Expression-language predicate (ADR-003) whose evaluated
     * result is compared against each `case.value`. Same
     * surface as `control.if.condition` — bounded by
     * `CONTROL_SWITCH_DISCRIMINATOR_MAX_CHARS` for parity.
     */
    discriminator: z
      .string()
      .min(1, "control.switch: discriminator must be non-empty")
      .max(
        CONTROL_SWITCH_DISCRIMINATOR_MAX_CHARS,
        `control.switch: discriminator must be ≤ ${CONTROL_SWITCH_DISCRIMINATOR_MAX_CHARS} chars`,
      ),
    /**
     * Ordered list of dispatch cases. At least one is
     * required. Cases with duplicate `value` are rejected —
     * the runtime's behavior on a duplicate-key match would
     * be first-match-wins, but the contract demands
     * unambiguous dispatch tables so a typo is caught at the
     * trust boundary, not in production.
     */
    cases: z
      .array(SwitchCaseSchema)
      .min(1, "control.switch: at least 1 case is required")
      .max(
        CONTROL_SWITCH_MAX_CASES,
        `control.switch: at most ${CONTROL_SWITCH_MAX_CASES} cases`,
      )
      .refine(
        (cases) => {
          const seen = new Set<string>()
          for (const c of cases) {
            if (seen.has(c.value)) return false
            seen.add(c.value)
          }
          return true
        },
        { message: "control.switch: duplicate case.value detected" },
      ),
    /**
     * Optional target node id for the no-match case. If
     * omitted, the switch terminates the path when no case
     * matches (i.e. no edge is followed). If set, the runtime
     * takes the default edge when the discriminator does not
     * match any case.
     */
    default: z
      .string()
      .min(1, "control.switch: default must be a non-empty node id when set")
      .optional(),
  })

export type ControlSwitchConfig = z.infer<typeof ControlSwitchConfigSchema>

/**
 * Validate the opaque `config` record of a `control.switch` node
 * against `ControlSwitchConfigSchema`. Throws `z.ZodError` on
 * failure with the field path the caller can use to point at the
 * bad input. Same trust-boundary contract as
 * `parseControlIfConfig` — the type system cannot enforce it
 * because `Node.config` is opaque.
 */
export function parseControlSwitchConfig(config: unknown): ControlSwitchConfig {
  return ControlSwitchConfigSchema.parse(config)
}

/**
 * Maximum number of branches a `control.parallel` may fan out
 * to. 64 is the same upper bound used for `control.switch`'s
 * case count and `control.merge`'s branch count — a workflow
 * with more than 64 concurrent branches is a design smell (the
 * scheduler's per-workflow slot budget is far below this).
 */
export const CONTROL_PARALLEL_MAX_BRANCHES = 64

/**
 * Pattern a `control.parallel` branch id must match. Lowercase
 * alphanumeric with dashes, starting with a letter, max 64
 * chars. Anchored and explicit (no surprises around "what is
 * a valid id") so editors and runtime code share a single
 * source of truth for the surface.
 *
 * The branch id is the per-edge disambiguator used by the
 * `branch-N` `EdgeKind` to map an edge back to its branch
 * (see the `branch-N` comment on `EdgeKindSchema`).
 */
export const CONTROL_PARALLEL_BRANCH_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/

/**
 * Maximum value `maxConcurrency` may take. 64 mirrors the
 * branch-count upper bound — even with the largest branch
 * count, the scheduler cannot safely accept a
 * `maxConcurrency` claim that exceeds the substrate's slot
 * budget, so the contract caps it explicitly. The runtime
 * may further clamp to a lower number based on the worker's
 * observed capacity.
 */
export const CONTROL_PARALLEL_MAX_CONCURRENCY = 64

/**
 * Configuration of a `control.parallel` family node (Plan
 * V2.3.1 §198, M2-03, ADR-002 Option A + ADR-008 scheduler).
 *
 * Like `control.if` / `control.switch`, the IR keeps
 * `Node.config` opaque; this Zod schema is the family's own
 * validator, applied at the family's trust boundary via
 * `parseControlParallelConfig(node.config)`.
 *
 * Branch routing is dual-channel — same pattern as
 * `control.if`:
 * - If a branch's `target` is a non-empty node id, the
 *   runtime starts that target when the branch fires.
 * - The graph topology (a `branch-N` `EdgeKind` from the
 *   parallel node to the target) is the documentary default
 *   the editor renders.
 *
 * The two channels are NOT mutually exclusive: a workflow may
 * declare a branch `target` AND have a `branch-N` edge — the
 * declared target wins, the edge is a documentary default the
 * editor renders when the target is set. Validating both at
 * parse time is the contract's job; deciding which one to
 * follow at run time is the kernel's job (ADR-000).
 */
export const ControlParallelBranchSchema = z.object({
  /**
   * Stable branch id within the parallel node's scope. Must
   * match `CONTROL_PARALLEL_BRANCH_ID_PATTERN`. Used as the
   * per-edge disambiguator for the `branch-N` `EdgeKind`
   * literal — see the comment on `EdgeKindSchema`.
   */
  branchId: z
    .string()
    .regex(
      CONTROL_PARALLEL_BRANCH_ID_PATTERN,
      "control.parallel: branchId must match /^[a-z][a-z0-9-]{0,63}$/",
    ),
  /**
   * Target node id this branch starts. Must be a non-empty
   * node id within the same `WorkflowDefinition` — the
   * runtime does a topology check at execution time, not
   * at parse time, because the IR keeps the node table
   * unindexed.
   */
  target: z
    .string()
    .min(1, "control.parallel: branch.target must be a non-empty node id"),
})

export type ControlParallelBranch = z.infer<typeof ControlParallelBranchSchema>

export const ControlParallelConfigSchema = z
  .object({
    /**
     * Ordered list of branches to fan out to. At least one
     * is required. Branches with duplicate `branchId` are
     * rejected — the runtime's `branch-N` disambiguation
     * requires unique branch ids, so a duplicate is a
     * contract violation caught at the trust boundary.
     */
    branches: z
      .array(ControlParallelBranchSchema)
      .min(1, "control.parallel: at least 1 branch is required")
      .max(
        CONTROL_PARALLEL_MAX_BRANCHES,
        `control.parallel: at most ${CONTROL_PARALLEL_MAX_BRANCHES} branches`,
      )
      .refine(
        (branches) => {
          const seen = new Set<string>()
          for (const b of branches) {
            if (seen.has(b.branchId)) return false
            seen.add(b.branchId)
          }
          return true
        },
        { message: "control.parallel: duplicate branchId detected" },
      ),
    /**
     * Optional upper bound on how many branches may run
     * concurrently. If omitted, the scheduler decides based
     * on the worker's capacity. Must be a positive integer
     * and may not exceed `CONTROL_PARALLEL_MAX_CONCURRENCY`.
     */
    maxConcurrency: z
      .number()
      .int()
      .positive("control.parallel: maxConcurrency must be positive")
      .max(
        CONTROL_PARALLEL_MAX_CONCURRENCY,
        `control.parallel: maxConcurrency must be ≤ ${CONTROL_PARALLEL_MAX_CONCURRENCY}`,
      )
      .optional(),
    /**
     * When `true` (the default), the first branch failure
     * cancels the still-running siblings and propagates the
     * error up the workflow. When `false`, sibling branches
     * are allowed to finish and the first failure is reported
     * through the matching `control.merge` (if present) or
     * surfaced as the parallel node's output. The default
     * `true` matches the safe and common behavior; explicit
     * opt-in is required to deviate.
     */
    failFast: z.boolean().default(true),
  })

export type ControlParallelConfig = z.infer<typeof ControlParallelConfigSchema>

/**
 * Validate the opaque `config` record of a `control.parallel`
 * node against `ControlParallelConfigSchema`. Throws
 * `z.ZodError` on failure. Same trust-boundary contract as
 * `parseControlIfConfig` and `parseControlSwitchConfig`.
 */
export function parseControlParallelConfig(
  config: unknown,
): ControlParallelConfig {
  return ControlParallelConfigSchema.parse(config)
}

/**
 * Maximum number of branches a `control.merge` may wait on.
 * Same upper bound as `control.parallel` — the two are
 * structurally paired (a parallel's fan-out feeds a merge's
 * fan-in), so the contract caps them at the same number to
 * keep the topology analyzable.
 */
export const CONTROL_MERGE_MAX_BRANCHES = 64

/**
 * The join strategy used by a `control.merge` family node
 * (Plan V2.3.1 §198, M2-04, ADR-002 + ADR-008).
 *
 * - `all`     : wait for every declared branch to complete,
 *               then emit the union of their results. This is
 *               the canonical "fan-in" join.
 * - `any`     : emit as soon as the *first* branch completes
 *               and cancel the still-running siblings. This
 *               is the canonical "race" join. Cancellation is
 *               best-effort — sibling branches that have
 *               already begun are not aborted, they are
 *               reported as cancelled.
 * - `n-of-m`  : emit as soon as `n` of the declared branches
 *               have completed, then cancel the still-running
 *               siblings. The integer `n` is required when
 *               this strategy is selected and must satisfy
 *               `1 ≤ n ≤ branches.length`.
 *
 * `n-of-m` is the "quorum" join — useful when a partial
 * result is sufficient and the cost of waiting for every
 * branch is not worth the extra latency.
 */
export const MergeStrategySchema = z.enum(["all", "any", "n-of-m"])

export type MergeStrategy = z.infer<typeof MergeStrategySchema>

/**
 * Configuration of a `control.merge` family node (Plan V2.3.1
 * §198, M2-04, ADR-002 Option A + ADR-008 scheduler).
 *
 * Like every other control node, the IR keeps `Node.config`
 * opaque; this Zod schema is the family's own validator,
 * applied at the family's trust boundary via
 * `parseControlMergeConfig(node.config)`.
 *
 * The branch list is a flat array of node ids — the merge
 * node does not own a parallel-shaped branch table because
 * the runtime identifies the branches to wait on by the
 * upstream topology (the merge node's incoming edges),
 * not by a parallel-shaped config.
 */
export const ControlMergeConfigSchema = z
  .object({
    /**
     * The join strategy applied to the listed branches.
     * See `MergeStrategySchema` for the contract.
     */
    strategy: MergeStrategySchema,
    /**
     * Ordered list of branch node ids the merge waits on.
     * At least one is required. A merge with a single
     * branch is a degenerate "all" / "any" / "1-of-1" join
     * — the contract allows it because the runtime may
     * not know in advance whether a given workflow
     * upstream ever grew to multiple branches, and a
     * single-branch merge is structurally a no-op
     * fan-in that is still useful as a documentation
     * anchor.
     */
    branches: z
      .array(z.string().min(1, "control.merge: branch id must be non-empty"))
      .min(1, "control.merge: at least 1 branch is required")
      .max(
        CONTROL_MERGE_MAX_BRANCHES,
        `control.merge: at most ${CONTROL_MERGE_MAX_BRANCHES} branches`,
      ),
    /**
     * Required when `strategy = "n-of-m"`, forbidden for
     * `all` / `any`. The cross-field constraint is
     * expressed as a `.refine(...)` below so the violation
     * surfaces as a single ZodError rather than two
     * independent ones.
     */
    n: z.number().int().positive().optional(),
    /**
     * Optional wall-clock budget for the join. If the
     * merge has not completed by `timeoutMs` milliseconds,
     * the merge aborts and surfaces a timeout to the
     * workflow. The runtime may further clamp based on
     * the node's own `timeoutMs` (the smaller of the two
     * wins). A value of 0 means "no timeout" — the merge
     * may wait indefinitely.
     */
    timeoutMs: z.number().int().nonnegative().optional(),
  })
  .refine(
    (cfg) => {
      // n-of-m requires n in [1, branches.length]
      if (cfg.strategy === "n-of-m") {
        if (cfg.n === undefined) return false
        return cfg.n >= 1 && cfg.n <= cfg.branches.length
      }
      // all/any must NOT have n
      return cfg.n === undefined
    },
    {
      message:
        "control.merge: n-of-m requires n in [1, branches.length]; all/any must not specify n",
    },
  )

export type ControlMergeConfig = z.infer<typeof ControlMergeConfigSchema>

/**
 * Validate the opaque `config` record of a `control.merge`
 * node against `ControlMergeConfigSchema`. Throws `z.ZodError`
 * on failure. Same trust-boundary contract as the other
 * `parseControl*Config` helpers.
 */
export function parseControlMergeConfig(config: unknown): ControlMergeConfig {
  return ControlMergeConfigSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* M2-05 — `control.map` (Plan V2.3.1 §198)                            */
/* ------------------------------------------------------------------ */

/**
 * Maximum length of a `control.map` `key.field` reference. Bounded
 * at 256 chars — far above realistic field names and well below
 * the pathological-length attack surface for content digests.
 * Distinct from `CONTROL_MAP_FIELD_PATH_MAX_CHARS` (the M2-05 input
 * reference length, 1024) and `CONTROL_REPEAT_MAX_ITERATIONS` (the
 * M2-06 iteration bound).
 */
export const CONTROL_MAP_KEY_FIELD_MAX_CHARS = 256

/**
 * Strategy for extracting a stable key from each map item. The key
 * is the durable identity of an item across replays: the runtime
 * uses it to detect which items have already been processed (so
 * replays don't double-execute) and which are new. A
 * non-deterministic key would silently re-process items on every
 * replay, which is a correctness defect, not a performance one.
 *
 * - `field`: extract the value of a named field from the item. The
 *   field's value is the key. The field must exist on every item
 *   or the item is rejected at the trust boundary.
 * - `hash`: compute a content hash (BLAKE3 over JCS-canonical
 *   bytes) of the item itself. Used when items are large objects
 *   without a natural primary key.
 *
 * ADR-005 (artifact contract) requires the key to be a content
 * address; the runtime treats both `field` and `hash` as such.
 * M2-TEST validates that two parses of the same definition produce
 * the same `mapItemId` for the same item.
 */
export const MapKeyStrategySchema = z.enum(["field", "hash"])
export type MapKeyStrategy = z.infer<typeof MapKeyStrategySchema>

export const MapKeySpecSchema = z
  .object({
    strategy: MapKeyStrategySchema,
    /**
     * Required when `strategy: "field"`. The field name within each
     * item whose value is the stable key. Must be a non-empty
     * string ≤ `CONTROL_MAP_KEY_FIELD_MAX_CHARS` chars. Forbidden
     * when `strategy: "hash"`. The cross-field rule is a single
     * `.refine(...)` that surfaces as one ZodError.
     */
    field: z
      .string()
      .min(1, "control.map: key.field is required when strategy is 'field'")
      .max(
        CONTROL_MAP_KEY_FIELD_MAX_CHARS,
        `control.map: key.field must be ≤ ${CONTROL_MAP_KEY_FIELD_MAX_CHARS} chars`,
      )
      .optional(),
  })
  .refine(
    (spec) => {
      if (spec.strategy === "field") {
        return typeof spec.field === "string" && spec.field.length > 0
      }
      return spec.field === undefined
    },
    {
      message:
        "control.map: key.field is required when strategy is 'field' and forbidden when strategy is 'hash'",
    },
  )
export type MapKeySpec = z.infer<typeof MapKeySpecSchema>

/**
 * Configuration of a `control.map` family node (Plan V2.3.1 §198,
 * M2-05, ADR-002 Option A + ADR-005 artifact + ADR-003 expression).
 *
 * `input` is an expression-language reference to the collection to
 * iterate over (e.g. `input.items`, `fetch('https://...').json()`).
 * `body` is the node id that runs once per item — the runtime
 * scopes a fresh sub-run per item, identified by the `mapItemId`
 * derived from the stable key.
 *
 * Replay-safety: a re-execution of the same map with the same
 * input and same `keySpec` MUST produce the same set of
 * `mapItemId`s in the same order. This is the property M2-TEST
 * validates with the "2 parses of the same definition produce the
 * same mapItemId for the same item" property test. The runtime is
 * responsible for enforcing this — the schema only pins the
 * contract surface.
 */
export const ControlMapConfigSchema = z.object({
  /**
   * Expression yielding the collection to iterate. Non-empty,
   * ≤ 1024 chars (parity with `control.if.condition` and
   * `control.switch.discriminator`).
   */
  input: z
    .string()
    .min(1, "control.map: input must be non-empty")
    .max(1024, "control.map: input must be ≤ 1024 chars"),
  /**
   * Node id that runs once per item. Must be a non-empty node id
   * within the same `WorkflowDefinition`. The runtime does the
   * topology check at execution time, not at parse time — the
   * schema only pins the well-formedness (non-empty string).
   * M2-TEST validates the topology invariant.
   */
  body: z.string().min(1, "control.map: body must be a non-empty node id"),
  /**
   * How to extract the stable key from each item. ADR-005.
   */
  key: MapKeySpecSchema,
  /**
   * Optional upper bound on how many items may be in flight
   * concurrently. Same semantics as
   * `control.parallel.maxConcurrency` — bounded at 64 to keep the
   * resource ceiling explicit and reviewable.
   */
  maxConcurrency: z
    .number()
    .int()
    .positive("control.map: maxConcurrency must be positive")
    .max(64, "control.map: maxConcurrency must be ≤ 64")
    .optional(),
})
export type ControlMapConfig = z.infer<typeof ControlMapConfigSchema>

/**
 * Validate the opaque `config` record of a `control.map` node
 * against `ControlMapConfigSchema`. Throws `z.ZodError` on
 * failure. Same trust-boundary contract as the other
 * `parseControl*Config` helpers.
 */
export function parseControlMapConfig(config: unknown): ControlMapConfig {
  return ControlMapConfigSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* M2-06 — `control.repeat` (Plan V2.3.1 §198)                         */
/* ------------------------------------------------------------------ */

/**
 * Maximum number of iterations a `control.repeat` may execute.
 * Bounded because a non-bounded loop would defeat the contract:
 * the runtime cannot guarantee the workflow terminates without an
 * upper bound. ADR-002 §6 explicitly requires `repeat` to be
 * strictly bounded — use `while` (M2-07, BLOCKED on ADR-000) for
 * condition-driven loops that may have an unbounded best case.
 *
 * The bound is generous (1M iterations) so realistic batch /
 * retry use-cases are well under it; pathological inputs are
 * rejected at the parse boundary, not at the runtime.
 */
export const CONTROL_REPEAT_MAX_ITERATIONS = 1_000_000

export const ControlRepeatConfigSchema = z.object({
  /**
   * Hard upper bound on iterations. Required (no default) — the
   * schema rejects any repeat without a `maxIterations` because
   * a non-bounded repeat is a contract violation. The bound is
   * enforced by the runtime at execution time; M2-TEST validates
   * that a `repeat(maxIterations=CONTROL_REPEAT_MAX_ITERATIONS)`
   * is parsable and bounded.
   */
  maxIterations: z
    .number()
    .int()
    .positive("control.repeat: maxIterations must be ≥ 1")
    .max(
      CONTROL_REPEAT_MAX_ITERATIONS,
      `control.repeat: maxIterations must be ≤ ${CONTROL_REPEAT_MAX_ITERATIONS}`,
    ),
  /**
   * Optional condition expression. When present, the loop exits
   * when the condition evaluates to `false` (or before, if
   * `maxIterations` is reached first). When absent, the loop
   * runs exactly `maxIterations` times. ADR-003 — expressions
   * are part of the same expression language as `if.condition`
   * and `switch.discriminator`.
   */
  untilCondition: z
    .string()
    .min(1, "control.repeat: untilCondition must be non-empty when set")
    .max(1024, "control.repeat: untilCondition must be ≤ 1024 chars")
    .optional(),
  /**
   * Optional name of the loop index variable exposed to
   * `untilCondition` and to nodes inside the loop body. When
   * omitted, the body cannot reference the current iteration
   * index. Must be a valid identifier (`[a-zA-Z_][a-zA-Z0-9_]*`)
   * so it is referenceable from the expression language without
   * quoting.
   */
  indexVariable: z
    .string()
    .min(1, "control.repeat: indexVariable must be non-empty when set")
    .max(64, "control.repeat: indexVariable must be ≤ 64 chars")
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "control.repeat: indexVariable must be a valid identifier",
    )
    .optional(),
  /**
   * Node id that runs once per iteration. Same semantics as
   * `control.map.body`: non-empty string, runtime does the
   * topology check.
   */
  body: z
    .string()
    .min(1, "control.repeat: body must be a non-empty node id"),
})
export type ControlRepeatConfig = z.infer<typeof ControlRepeatConfigSchema>

/**
 * Validate the opaque `config` record of a `control.repeat` node
 * against `ControlRepeatConfigSchema`. Throws `z.ZodError` on
 * failure. Same trust-boundary contract as the other
 * `parseControl*Config` helpers.
 */
export function parseControlRepeatConfig(
  config: unknown,
): ControlRepeatConfig {
  return ControlRepeatConfigSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* M2-07 — `control.while` (Plan V2.3.1 §198)                           */
/* ------------------------------------------------------------------ */

/**
 * Maximum number of iterations a `control.while` may execute.
 * Like `control.repeat`, a `while` is bounded — the difference is
 * the *termination* signal: `repeat` runs exactly `maxIterations`
 * times (or until `untilCondition`); `while` runs as long as
 * `whileCondition` is true, with `maxIterations` as a safety net.
 *
 * ADR-002 §6 allows unbounded best case for `while`, but the
 * runtime MUST enforce this hard upper bound to prevent runaway
 * loops. The bound is the same as `control.repeat` (1M).
 */
export const CONTROL_WHILE_MAX_ITERATIONS = 1_000_000

export const ControlWhileConfigSchema = z.object({
  /**
   * Hard upper bound on iterations. Required (no default) — a
   * non-bounded `while` is a contract violation. The runtime
   * enforces this as a safety net; the workflow's normal
   * termination is the `whileCondition` evaluating to false.
   */
  maxIterations: z
    .number()
    .int()
    .positive("control.while: maxIterations must be ≥ 1")
    .max(
      CONTROL_WHILE_MAX_ITERATIONS,
      `control.while: maxIterations must be ≤ ${CONTROL_WHILE_MAX_ITERATIONS}`,
    ),
  /**
   * Condition expression. The loop body runs while this is true.
   * ADR-003 — same expression language as `if.condition` and
   * `switch.discriminator`. Required (the loop has no implicit
   * body if the condition is absent).
   */
  whileCondition: z
    .string()
    .min(1, "control.while: whileCondition must be non-empty")
    .max(1024, "control.while: whileCondition must be ≤ 1024 chars"),
  /**
   * Optional name of the loop index variable exposed to
   * `whileCondition` and to nodes inside the loop body.
   * Same identifier rules as `control.repeat.indexVariable`.
   */
  indexVariable: z
    .string()
    .min(1, "control.while: indexVariable must be non-empty when set")
    .max(64, "control.while: indexVariable must be ≤ 64 chars")
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "control.while: indexVariable must be a valid identifier",
    )
    .optional(),
  /**
   * Node id that runs each iteration. Same semantics as
   * `control.repeat.body`.
   */
  body: z
    .string()
    .min(1, "control.while: body must be a non-empty node id"),
})
export type ControlWhileConfig = z.infer<typeof ControlWhileConfigSchema>

/**
 * Validate the opaque `config` record of a `control.while` node.
 * Throws `z.ZodError` on failure.
 */
export function parseControlWhileConfig(
  config: unknown,
): ControlWhileConfig {
  return ControlWhileConfigSchema.parse(config)
}

/* ------------------------------------------------------------------ */
/* M2-08 — `control.child` (Plan V2.3.1 §198)                          */
/* ------------------------------------------------------------------ */

/**
 * Maximum depth of `control.child` nesting. The runtime rejects
 * any workflow that would exceed this depth at load time. The
 * bound is structural (memory + stack), not security: a workflow
 * can legitimately nest a few layers (e.g. main -> sub -> sub-sub).
 */
export const CONTROL_CHILD_MAX_DEPTH = 32

export const ControlChildConfigSchema = z.object({
  /**
   * Reference to the child workflow definition. Either a
   * `definitionId` (in-process lookup) or a `deploymentId` +
   * `version` (cross-deployment lookup). Exactly one of these
   * two modes is required.
   */
  definitionId: z
    .string()
    .min(1, "control.child: definitionId must be non-empty")
    .max(128, "control.child: definitionId must be ≤ 128 chars")
    .optional(),
  deploymentId: z
    .string()
    .min(1, "control.child: deploymentId must be non-empty")
    .max(128, "control.child: deploymentId must be ≤ 128 chars")
    .optional(),
  version: z
    .string()
    .min(1, "control.child: version must be non-empty")
    .max(32, "control.child: version must be ≤ 32 chars")
    .optional(),
  /**
   * Optional name of the variable that receives the child's
   * WorkflowRunId. Useful for cancellation or for cross-workflow
   * audit.
   */
  outputVariable: z
    .string()
    .min(1, "control.child: outputVariable must be non-empty when set")
    .max(64, "control.child: outputVariable must be ≤ 64 chars")
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "control.child: outputVariable must be a valid identifier",
    )
    .optional(),
  /**
   * Whether the parent waits for the child to complete. If false,
   * the parent continues immediately and the child runs in
   * background. Default: true.
   */
  awaitCompletion: z.boolean().default(true),
})
export type ControlChildConfig = z.infer<typeof ControlChildConfigSchema>

/**
 * Validate the opaque `config` record of a `control.child` node.
 * Throws `z.ZodError` on failure. Cross-validates that exactly one
 * of {definitionId} or {deploymentId, version} is set.
 */
export function parseControlChildConfig(
  config: unknown,
): ControlChildConfig {
  const parsed = ControlChildConfigSchema.parse(config)
  const hasDef = parsed.definitionId !== undefined
  const hasDep = parsed.deploymentId !== undefined || parsed.version !== undefined
  if (hasDef === hasDep) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["definitionId"],
        message:
          "control.child: exactly one of `definitionId` or `{deploymentId, version}` is required",
      },
    ])
  }
  if (hasDep && (parsed.deploymentId === undefined || parsed.version === undefined)) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["deploymentId"],
        message:
          "control.child: when using deployment mode, both `deploymentId` and `version` are required",
      },
    ])
  }
  return parsed
}

export * from "./workflow-effect.js"
export * from "./workflow-recovery.js"


/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

/**
 * A trigger source attached to a workflow. The kind discriminates
 * the payload; only the relevant fields are required for each kind.
 * Other families (cron, webhook, queue) will be added in later
 * versions of the IR.
 */
export const TriggerDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("manual"),
  }),
  z.object({
    kind: z.literal("schedule"),
    /** Cron expression in the standard 5-field form. */
    cron: z.string(),
    timezone: z.string().optional(),
    overlapPolicy: OverlapPolicySchema,
    catchUpPolicy: CatchUpPolicySchema,
  }),
])

export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>

/**
 * The binding from a trigger to the workflow that fires on it,
 * plus the runtime-side configuration (overlap, catch-up). A
 * TriggerBinding is durable: deleting the binding is the only way
 * to stop a scheduled workflow firing.
 */
export const TriggerBindingSchema = z.object({
  bindingId: z.string(),
  workflowVersionId: z.string(),
  trigger: TriggerDefinitionSchema,
  createdAt: z.number().int(),
})

export type TriggerBinding = z.infer<typeof TriggerBindingSchema>

/**
 * Runtime-only state of a trigger binding. Stored in the control
 * plane's hot path, not in the canonical IR. `lastFiredAt` and
 * `nextFireAt` are the scheduler's view, not the durable contract.
 */
export const TriggerRuntimeStateSchema = z.object({
  bindingId: z.string(),
  lastFiredAt: z.number().int().nullable(),
  nextFireAt: z.number().int().nullable(),
  inFlightRunId: z.string().nullable(),
  missedFirings: z.number().int().nonnegative(),
})

export type TriggerRuntimeState = z.infer<typeof TriggerRuntimeStateSchema>

/* ------------------------------------------------------------------ */
/* Workflow definition / version / deployment / IR                     */
/* ------------------------------------------------------------------ */

/**
 * The editable form of a workflow. A definition has no
 * content-address; the same definition may produce many versions
 * over its lifetime. The `ownershipScope` is the durable owner
 * (Plan V2.3.1 §44, ADR-020).
 */
export const WorkflowDefinitionSchema = z.object({
  definitionId: z.string(),
  ownershipScope: OwnershipScopeSchema,
  displayName: z.string(),
  description: z.string().optional(),
  nodes: z.array(NodeSchema).readonly(),
  edges: z.array(EdgeSchema).readonly(),
  concurrency: ConcurrencyPolicySchema,
  defaultFailurePolicy: FailurePolicySchema,
  defaultTimeoutMs: z.number().int().nonnegative(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>

/**
 * The immutable, content-addressed snapshot of a workflow at a
 * point in time. The content digest of a version is computed over
 * the JCS-v1 canonicalization of this exact shape; the resulting
 * digest becomes the version's id on the wire.
 *
 * `versionDigest` is the *self-reported* digest, set by the
 * canonicalization step. The control plane MUST verify it matches
 * the recomputed digest before accepting the version. A missing
 * `versionDigest` is rejected at the validation boundary.
 */
export const WorkflowVersionSchema = z.object({
  versionId: z.string(),
  definitionId: z.string(),
  versionNumber: z.number().int().positive(),
  definition: WorkflowDefinitionSchema,
  // ADR-026: `versionDigest` is typed by domain. A Zod parse of a
  // `WorkflowVersion` rejects any envelope whose `domain` literal is
  // not `"workflow-version"` — the cross-domain guard lives at the
  // parsing boundary, not only at the runtime `asDomainDigest()` call.
  versionDigest: WorkflowVersionDigestSchema,
  createdAt: z.number().int(),
  createdBy: z.string(),
})

export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>

/**
 * The act of pinning a workflow version to an environment. A
 * deployment is the durable handle used by triggers, schedulers,
 * and the control plane to look up "what runs in prod right now".
 */
export const WorkflowDeploymentSchema = z.object({
  deploymentId: z.string(),
  deploymentScope: DeploymentScopeSchema,
  workflowVersionId: z.string(),
  pinnedAt: z.number().int(),
  pinnedBy: z.string(),
  active: z.boolean(),
})

export type WorkflowDeployment = z.infer<typeof WorkflowDeploymentSchema>

/**
 * The IR is the union of everything a workflow runtime needs to
 * load a workflow's behavior and lifecycle. The control plane
 * serializes a single IR document per workflow per environment.
 */
export const WorkflowIRSchema = z.object({
  definition: WorkflowDefinitionSchema,
  version: WorkflowVersionSchema,
  deployment: WorkflowDeploymentSchema,
  triggers: z.array(TriggerBindingSchema).readonly(),
})

export type WorkflowIR = z.infer<typeof WorkflowIRSchema>
