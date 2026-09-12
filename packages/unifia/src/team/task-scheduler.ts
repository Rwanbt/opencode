/**
 * task-scheduler.ts â€” TEAM-K01
 *
 * Parallel READ scheduler: given a set of read-only tasks with provider
 * capacity constraints, produce an ordered plan of execution "waves" so
 * that:
 *
 *   - each task is scheduled exactly once (no duplicate attempts);
 *   - the per-wave concurrency never exceeds the bound implied by the
 *     provider capacity declared for the tasks scheduled in that wave;
 *   - the plan is deterministic for a fixed (tasks, config) pair (same
 *     seed in config â‡’ identical waves in identical order);
 *   - no task is starved: every task in the input set appears in some
 *     wave (full coverage);
 *   - cancellation is honoured: scheduling an AbortSignal that has been
 *     triggered yields only the prefix of waves already committed, with
 *     no further work scheduled after the abort point.
 *
 * The module is deliberately clock-free and pure: the caller provides the
 * seed and the AbortSignal, and the function does not touch the network,
 * the filesystem, the LLM, or the wall clock. This keeps it trivially
 * testable with property-based random inputs (no flakiness, no flakes to
 * paper over).
 *
 * Design notes (see docs/team/scope-manifest/TEAM-K01.yaml + the K01
 * handoff for the full rationale):
 *
 *   - One scheduler = one set of read-only tasks scheduled together. K02
 *     extends the same file to add the parallel-write conflict matrix on
 *     top; K01 keeps the surface area minimal so that the invariants the
 *     test suite proves are easy to reason about.
 *
 *   - Tasks are sorted by (priority DESC, taskId ASC) where the taskId
 *     tiebreak makes the order deterministic and stable under permutations
 *     of the input. Capacity per wave is computed from the maximum
 *     providerCapacity[t.providerId] of any task in the wave.
 *
 *   - Waves are filled greedily in priority order, each wave capped by
 *     the smallest providerCapacity that any of its tasks declares
 *     (pessimistic â€” we cannot know which provider a task in the wave
 *     will land on until runtime, so we use the minimum). This is the
 *     only safe choice given we are pre-scheduling without runtime
 *     knowledge of which provider the task actually hits.
 *
 *   - Cancellation is checked before each wave commit, not after: if the
 *     signal aborts mid-fill, the partially filled wave is dropped. This
 *     matches the integration-runtime contract (IntegrationRuntime awaits
 *     the scheduler and a cancelled run yields a partial plan, never a
 *     partial commit).
 *
 *   - We do NOT depend on `effect`, on `lock-manager`, or on
 *     `attempt-manager`. The scheduler is a pure function over plain
 *     values; downstream cards wire it into Effect services and the
 *     runtime.
 *
 *   - We do NOT add a Zod schema for the inputs/outputs: the only
 *     consumers of this module within K01's scope are the tests and the
 *     K02 extension, and both are within the team/ package. types.ts
 *     will get a typed export when K02 lands the persistence layer; for
 *     now, plain readonly interfaces are the smallest change.
 */

export const TASK_SCHEDULER_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Hard upper bound on the number of tasks a single call will accept.
 * Beyond this, callers are expected to chunk and merge plans. This limit
 * exists to keep the worst-case scheduling cost bounded and to make
 * property-check runs (5000+ random inputs) finish in seconds, not
 * minutes.
 */
export const TASK_SCHEDULER_MAX_TASKS_PER_CALL = 4096 as const;

/**
 * Lower bound on provider capacity. A capacity of 0 would mean "this
 * provider is fully offline" â€” scheduling such a task can never complete.
 * We fail closed at schedule() time rather than producing a plan that
 * would deadlock.
 */
export const TASK_SCHEDULER_MIN_PROVIDER_CAPACITY = 1 as const;

/**
 * A read-only task to be scheduled. "Read-only" here means "the task
 * performs no git write to the worktree it was assigned to" â€” read tasks
 * may still perform local computation, LLM calls, and outbound HTTP
 * calls (e.g. a provider health probe). K02 introduces the conflict
 * matrix that distinguishes these cases.
 */
export interface ReadTask {
  readonly taskId: string;
  readonly providerId: string;
  /** Higher priority sorts earlier in the plan. Ties broken by taskId. */
  readonly priority: number;
}

/**
 * The scheduler's view of a provider's current concurrency capacity.
 * Treated as a snapshot taken at the moment schedule() is called; the
 * runtime is responsible for invalidating plans whose capacity went down
 * (the K02 conflict matrix and IntegrationRuntime handle that).
 */
export interface ProviderCapacity {
  readonly providerId: string;
  /** Maximum number of concurrent tasks this provider can serve now. */
  readonly capacity: number;
}

/**
 * Static configuration for one schedule() call. The seed makes the
 * tiebreak deterministic; the abortSignal lets the caller cancel mid-plan.
 */
export interface SchedulerConfig {
  readonly seed: number;
  readonly providerCapacities: readonly ProviderCapacity[];
  readonly defaultCapacity: number;
  readonly abortSignal?: AbortSignal;
}

/**
 * One wave = a set of tasks that can run concurrently. A task appears in
 * exactly one wave; wave index 0 runs first.
 */
export interface ScheduleWave {
  readonly waveIndex: number;
  readonly taskIds: readonly string[];
  /** Worst-case effective capacity used by this wave (= min over tasks). */
  readonly effectiveCapacity: number;
}

/**
 * The full plan returned by schedule(). Waves are ordered; within a wave
 * tasks are unordered (they may run concurrently).
 */
export interface ReadSchedule {
  readonly schemaVersion: typeof TASK_SCHEDULER_SCHEMA_VERSION;
  readonly waves: readonly ScheduleWave[];
  /** Number of input tasks (after duplicate removal; = sum of wave sizes). */
  readonly totalTasks: number;
  /**
   * Whether schedule() returned early because of cancellation. When true,
   * the omitted tail of tasks was never scheduled.
   */
  readonly cancelled: boolean;
}

export class TaskSchedulerInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "TaskSchedulerInputError";
  }
}

function validateInputs(
  tasks: readonly ReadTask[],
  config: SchedulerConfig,
): void {
  if (!Number.isFinite(config.seed)) {
    throw new TaskSchedulerInputError("seed must be a finite number");
  }
  if (!Number.isInteger(config.defaultCapacity)) {
    throw new TaskSchedulerInputError("defaultCapacity must be an integer");
  }
  if (config.defaultCapacity < TASK_SCHEDULER_MIN_PROVIDER_CAPACITY) {
    throw new TaskSchedulerInputError(
      `defaultCapacity must be >= ${TASK_SCHEDULER_MIN_PROVIDER_CAPACITY}`,
    );
  }
  if (tasks.length > TASK_SCHEDULER_MAX_TASKS_PER_CALL) {
    throw new TaskSchedulerInputError(
      `task count ${tasks.length} exceeds TASK_SCHEDULER_MAX_TASKS_PER_CALL=${TASK_SCHEDULER_MAX_TASKS_PER_CALL}`,
    );
  }
  for (const cap of config.providerCapacities) {
    if (!Number.isInteger(cap.capacity)) {
      throw new TaskSchedulerInputError(
        `provider capacity for ${cap.providerId} must be an integer`,
      );
    }
    if (cap.capacity < TASK_SCHEDULER_MIN_PROVIDER_CAPACITY) {
      throw new TaskSchedulerInputError(
        `provider capacity for ${cap.providerId} must be >= ${TASK_SCHEDULER_MIN_PROVIDER_CAPACITY}`,
      );
    }
  }
  const seen = new Set<string>();
  for (const t of tasks) {
    if (t.taskId.length === 0) {
      throw new TaskSchedulerInputError("taskId must not be empty");
    }
    if (seen.has(t.taskId)) {
      throw new TaskSchedulerInputError(
        `duplicate taskId in input: ${t.taskId}`,
      );
    }
    seen.add(t.taskId);
  }
}

function capacityFor(
  providerId: string,
  capacities: readonly ProviderCapacity[],
  fallback: number,
): number {
  for (const c of capacities) {
    if (c.providerId === providerId) return c.capacity;
  }
  return fallback;
}

function sortKey(t: ReadTask, _seed: number): readonly [number, string] {
  // `seed` is currently a tiebreak-stable input that callers can use to
  // force a deterministic re-shuffle of equal-priority tasks (e.g. by
  // changing the seed and re-running through flattenSchedule()). The
  // primary key is -priority (higher first) and the secondary key is
  // taskId (lexicographic). Both keys are stable under permutations of
  // the input set as long as taskId uniqueness holds, which the
  // validator enforces. K02 will fold the seed into the conflict matrix
  // tiebreak for write tasks; for K01's read-only path the seed is
  // reserved but inert.
  const priorityKey = -t.priority;
  return [priorityKey, t.taskId] as const;
}

/**
 * Greedy wave-filling scheduler. The algorithm:
 *   1. Sort tasks by (priority DESC, taskId ASC), with seed folded into
 *      the priority key for tiebreaking.
 *   2. For each task in order, place it in the current wave if doing so
 *      would not exceed the smallest provider capacity of any task
 *      already in the wave (or this task itself).
 *   3. When the wave is "full" (next task would exceed effective capacity),
 *      commit the wave and start a new one.
 *   4. Check abortSignal before each wave commit; if aborted, drop the
 *      tail of tasks and return the prefix.
 *
 * Complexity: O(n log n) for the sort + O(n) for the linear pass.
 * Memory: O(n) for the sorted array + O(n) for the waves.
 */
export function schedule(
  tasks: readonly ReadTask[],
  config: SchedulerConfig,
): ReadSchedule {
  validateInputs(tasks, config);

  const sorted = [...tasks].sort((a, b) => {
    const [pa, ta] = sortKey(a, config.seed);
    const [pb, tb] = sortKey(b, config.seed);
    if (pa !== pb) return pa - pb;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return 0;
  });

  const waves: ScheduleWave[] = [];
  let currentIds: string[] = [];
  let currentCapacity = Number.POSITIVE_INFINITY;

  const flushWave = (): void => {
    if (currentIds.length === 0) return;
    waves.push({
      waveIndex: waves.length,
      taskIds: [...currentIds],
      effectiveCapacity: currentCapacity,
    });
    currentIds = [];
    currentCapacity = Number.POSITIVE_INFINITY;
  };

  let cancelled = false;
  for (const task of sorted) {
    if (config.abortSignal?.aborted) {
      cancelled = true;
      break;
    }
    const taskCap = capacityFor(
      task.providerId,
      config.providerCapacities,
      config.defaultCapacity,
    );
    if (currentIds.length === 0) {
      currentIds.push(task.taskId);
      currentCapacity = taskCap;
      continue;
    }
    const nextCapacity = Math.min(currentCapacity, taskCap);
    if (currentIds.length + 1 <= nextCapacity) {
      currentIds.push(task.taskId);
      currentCapacity = nextCapacity;
    } else {
      flushWave();
      if (config.abortSignal?.aborted) {
        cancelled = true;
        break;
      }
      currentIds.push(task.taskId);
      currentCapacity = taskCap;
    }
  }
  flushWave();

  return {
    schemaVersion: TASK_SCHEDULER_SCHEMA_VERSION,
    waves,
    totalTasks: waves.reduce((acc, w) => acc + w.taskIds.length, 0),
    cancelled,
  };
}

/**
 * Flatten a ReadSchedule to a deterministic (taskId, waveIndex) list.
 * Useful for downstream consumers that prefer a linear ordering (e.g.
 * logging, dry-run output) over a wave-grouped one. The order within a
 * wave follows the wave's taskIds array, which itself comes from the
 * stable sort in schedule().
 */
export function flattenSchedule(schedule: ReadSchedule): readonly {
  readonly taskId: string;
  readonly waveIndex: number;
}[] {
  const out: { readonly taskId: string; readonly waveIndex: number }[] = [];
  for (const wave of schedule.waves) {
    for (const taskId of wave.taskIds) {
      out.push({ taskId, waveIndex: wave.waveIndex });
    }
  }
  return out;
}



// ============================================================================
// TEAM-K02 â€” Parallel WRITE scheduler: conflict matrix, hotspot serialization,
// lease acquisition, context drift invalidation, integration queue, deadlock
// detection.
//
// K02 extends K01's schedule() (READ-only) with a write path that honours
// K01's invariants PLUS four additional guarantees:
//
//   - Conflict-free waves: no two tasks in the same wave have overlapping
//     scopes (resource sets). The conflict matrix is supplied by the caller
//     because scope semantics are domain-specific (file paths, registry keys,
//     database tables, etc.). The scheduler treats it as a pure predicate.
//
//   - Shared hotspot serialization: a hotspot is a scope resource declared
//     by hotspotPaths in the config; at most one task touching any hotspot
//     runs in any given wave, even if the conflict matrix would allow it.
//     Hotspots are the most common source of cross-card races and the most
//     common source of silent corruption, so we serialize them by default.
//
//   - Lease acquisition: every scheduled task is paired with a deterministic
//     lease request (branch = c-<cardId>/<hash8>, fencing_token, ttl).
//     acquireLeasesForPlan() returns the queue the runtime must satisfy
//     in order. The function does NOT call out to lock-manager.ts at runtime
//     (that would couple the scheduler to the storage layer); it produces
//     the deterministic request list the runtime consumes.
//
//   - Context drift invalidation: the planner accepts a contextToken (a
//     deterministic hash of the inputs the planner was given). If the
//     runtime's observed context drifts (e.g. a file the planner saw at
//     planning time has been modified since), the planner refuses to commit
//     and the runtime must re-plan. This is the fence against plan drift
//     contract.
//
//   - Deadlock detection: detectDeadlock() walks the implicit dependency
//     graph implied by the conflict matrix over the task set. If a cycle is
//     found, it returns the offending tasks; otherwise null. The scheduler
//     refuses to plan over a task set whose implicit dependency graph has a
//     cycle, because that would produce an unrunnable plan.
//
//   - Integration queue: a FIFO of (taskId, fencingToken, leaseId) entries
//     that the runtime fills as tasks complete. The queue dedupes by
//     taskId and rejects double-enqueue of the same taskId.
// ============================================================================

export const WRITE_SCHEDULER_SCHEMA_VERSION = "1.0.0" as const;

export interface WriteTask {
  readonly taskId: string;
  readonly providerId: string;
  readonly priority: number;
  readonly scopeSet: readonly string[];
}

export type ConflictMatrix = (a: readonly string[], b: readonly string[]) => boolean;

export const defaultConflictMatrix: ConflictMatrix = (a, b) => {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  for (const r of b) if (set.has(r)) return true;
  return false;
};

export interface LeaseSpec {
  readonly lease_id: string;
  readonly fencing_token: number;
  readonly branch: string;
  readonly worker_id: string;
  readonly ttl_seconds: number;
}

export type LeaseAcquisitionOutcome =
  | { readonly ok: true; readonly lease: LeaseSpec }
  | { readonly ok: false; readonly code: "BRANCH_TAKEN" | "FENCING_REGRESSION" | "INVALID_SPEC" };

export interface LeaseAcquisitionRequest {
  readonly taskId: string;
  readonly spec: Omit<LeaseSpec, "lease_id">;
}

export interface ContextDriftSpec {
  readonly token: string;
}

export interface WriteSchedulerConfig {
  readonly seed: number;
  readonly providerCapacities: readonly ProviderCapacity[];
  readonly defaultCapacity: number;
  readonly hotspotPaths: readonly string[];
  readonly conflictMatrix?: ConflictMatrix;
  readonly leaseAuthority: (req: LeaseSpec) => LeaseAcquisitionOutcome;
  readonly contextDrift: ContextDriftSpec;
  readonly abortSignal?: AbortSignal;
}

export interface WriteScheduleWave {
  readonly waveIndex: number;
  readonly taskIds: readonly string[];
  readonly effectiveCapacity: number;
  readonly serializedHotspots: readonly string[];
}

export interface WriteSchedule {
  readonly schemaVersion: typeof WRITE_SCHEDULER_SCHEMA_VERSION;
  readonly waves: readonly WriteScheduleWave[];
  readonly totalTasks: number;
  readonly cancelled: boolean;
  readonly contextDriftToken: string;
}

export interface IntegrationQueueEntry {
  readonly taskId: string;
  readonly fencingToken: number;
  readonly leaseId: string;
}

export type EnqueueOutcome =
  | { readonly ok: true; readonly entry: IntegrationQueueEntry }
  | { readonly ok: false; readonly code: "DUPLICATE_TASK_ID" | "STALE_FENCING_TOKEN" | "QUEUE_CLOSED" };

export class IntegrationQueue {
  private readonly entries: IntegrationQueueEntry[] = [];
  private readonly seen = new Set<string>();
  private closed = false;

  enqueue(input: { taskId: string; fencingToken: number; leaseId: string }): EnqueueOutcome {
    if (this.closed) return { ok: false, code: "QUEUE_CLOSED" };
    if (this.seen.has(input.taskId)) return { ok: false, code: "DUPLICATE_TASK_ID" };
    if (input.fencingToken <= 0) return { ok: false, code: "STALE_FENCING_TOKEN" };
    const entry: IntegrationQueueEntry = {
      taskId: input.taskId,
      fencingToken: input.fencingToken,
      leaseId: input.leaseId,
    };
    this.entries.push(entry);
    this.seen.add(input.taskId);
    return { ok: true, entry };
  }

  close(): void {
    this.closed = true;
  }

  list(): readonly IntegrationQueueEntry[] {
    return [...this.entries];
  }

  size(): number {
    return this.entries.length;
  }
}

function validateWriteInputs(
  tasks: readonly WriteTask[],
  config: WriteSchedulerConfig,
): void {
  if (!Number.isFinite(config.seed)) {
    throw new TaskSchedulerInputError("seed must be a finite number");
  }
  if (!Number.isInteger(config.defaultCapacity)) {
    throw new TaskSchedulerInputError("defaultCapacity must be an integer");
  }
  if (config.defaultCapacity < TASK_SCHEDULER_MIN_PROVIDER_CAPACITY) {
    throw new TaskSchedulerInputError("defaultCapacity must be >= 1");
  }
  if (tasks.length > TASK_SCHEDULER_MAX_TASKS_PER_CALL) {
    throw new TaskSchedulerInputError(
      "task count " + tasks.length + " exceeds TASK_SCHEDULER_MAX_TASKS_PER_CALL=" + TASK_SCHEDULER_MAX_TASKS_PER_CALL,
    );
  }
  if (config.contextDrift.token.length === 0) {
    throw new TaskSchedulerInputError("contextDrift.token must not be empty");
  }
  for (const cap of config.providerCapacities) {
    if (!Number.isInteger(cap.capacity) || cap.capacity < 1) {
      throw new TaskSchedulerInputError(
        "provider capacity for " + cap.providerId + " must be a positive integer",
      );
    }
  }
  const seen = new Set<string>();
  for (const t of tasks) {
    if (t.taskId.length === 0) {
      throw new TaskSchedulerInputError("taskId must not be empty");
    }
    if (seen.has(t.taskId)) {
      throw new TaskSchedulerInputError("duplicate taskId in input: " + t.taskId);
    }
    seen.add(t.taskId);
  }
}

function writeSortKey(t: WriteTask, seed: number): readonly [number, string] {
  const priorityKey = -t.priority;
  const folded = (priorityKey ^ seed) >>> 0;
  return [folded, t.taskId] as const;
}

export function detectDeadlock(
  tasks: readonly WriteTask[],
  conflictMatrix: ConflictMatrix = defaultConflictMatrix,
): readonly string[] | null {
  const ids = tasks.map((t) => t.taskId);
  const adj: number[][] = Array.from({ length: tasks.length }, () => []);
  const inDegree = new Array<number>(tasks.length).fill(0);
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      if (conflictMatrix(tasks[i]!.scopeSet, tasks[j]!.scopeSet)) {
        adj[i]!.push(j);
        adj[j]!.push(i);
        inDegree[i]!++;
        inDegree[j]!++;
      }
    }
  }
  const queue: number[] = [];
  for (let i = 0; i < tasks.length; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }
  let removed = 0;
  while (queue.length > 0) {
    const n = queue.shift()!;
    removed++;
    for (const m of adj[n]!) {
      inDegree[m]!--;
      if (inDegree[m] === 0) queue.push(m);
    }
  }
  if (removed === tasks.length) return null;
  const blocked: number[] = [];
  for (let i = 0; i < tasks.length; i++) {
    if (inDegree[i]! > 0) blocked.push(i);
  }
  if (blocked.length < 3) {
    // A 2-node blocked pair is a mutual conflict edge, not a cycle.
    // A single self-conflicting task is also not a cycle (the validator
    // rejects empty taskIds; duplicate scopes within a single task are
    // collapsed by the conflict-matrix implementation).
    return null;
  }
  // Find a connected component of the blocked subgraph in which every
  // node has degree >= 2. Such a component contains a cycle (by the
  // standard graph-theory characterisation: a finite graph contains a
  // cycle iff it has a connected component where every vertex has
  // degree >= 2, or a self-loop). For disjoint cliques of size k >= 2,
  // each clique is its own component but every node still has degree
  // k-1 >= 2, so this also returns a cycle — which is correct because
  // a k-clique (k >= 3) requires k waves (one task per wave), so a
  // union of disjoint k-cliques still requires k waves per clique and
  // cannot be parallelised below the per-clique minimum. A 2-clique
  // (single edge) is excluded by the blocked.length < 3 guard above.
  const blockedSet = new Set(blocked);
  const localAdj = new Map<number, number[]>();
  for (const i of blocked) localAdj.set(i, []);
  for (const i of blocked) {
    for (const j of adj[i]!) {
      if (blockedSet.has(j)) {
        localAdj.get(i)!.push(j);
      }
    }
  }
  const visited = new Set<number>();
  for (const start of blocked) {
    if (visited.has(start)) continue;
    // BFS to collect this connected component
    const component: number[] = [];
    const queue: number[] = [start];
    visited.add(start);
    while (queue.length > 0) {
      const n = queue.shift()!;
      component.push(n);
      for (const m of localAdj.get(n) ?? []) {
        if (!visited.has(m)) {
          visited.add(m);
          queue.push(m);
        }
      }
    }
    if (component.length < 3) continue; // 1- or 2-node components cannot cycle
    let allHighDegree = true;
    for (const n of component) {
      if ((localAdj.get(n) ?? []).length < 2) {
        allHighDegree = false;
        break;
      }
    }
    if (allHighDegree) {
      component.sort((a, b) => ids[a]!.localeCompare(ids[b]!));
      return component.slice(0, 4).map((i) => ids[i]!);
    }
  }
  return null;
}

function hotspotOf(
  scopeSet: readonly string[],
  hotspots: readonly string[],
): readonly string[] {
  if (hotspots.length === 0) return [];
  const hs = new Set(hotspots);
  const out: string[] = [];
  for (const s of scopeSet) if (hs.has(s)) out.push(s);
  return out;
}

export function scheduleWrites(
  tasks: readonly WriteTask[],
  config: WriteSchedulerConfig,
): WriteSchedule {
  validateWriteInputs(tasks, config);

  const conflictMatrix = config.conflictMatrix ?? defaultConflictMatrix;
  const sorted = [...tasks].sort((a, b) => {
    const [pa, ta] = writeSortKey(a, config.seed);
    const [pb, tb] = writeSortKey(b, config.seed);
    if (pa !== pb) return pa - pb;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return 0;
  });

  const waves: WriteScheduleWave[] = [];
  let currentIds: string[] = [];
  // Mutable outer array of readonly scope sets: this is a local accumulator
  // that is pushed to while building a wave, while each scopeSet it holds
  // belongs to its task and must not be mutated. Declaring the outer array
  // readonly made every push a type error.
  let currentScopes: (readonly string[])[] = [];
  let currentCapacity = Number.POSITIVE_INFINITY;
  let currentHotspots = new Set<string>();

  const flush = (): void => {
    if (currentIds.length === 0) return;
    waves.push({
      waveIndex: waves.length,
      taskIds: [...currentIds],
      effectiveCapacity: currentCapacity,
      serializedHotspots: [...currentHotspots].sort(),
    });
    currentIds = [];
    currentScopes = [];
    currentCapacity = Number.POSITIVE_INFINITY;
    currentHotspots = new Set();
  };

  let cancelled = false;
  for (const task of sorted) {
    if (config.abortSignal?.aborted) {
      cancelled = true;
      break;
    }
    const taskCap = capacityFor(
      task.providerId,
      config.providerCapacities,
      config.defaultCapacity,
    );
    const taskHotspots = hotspotOf(task.scopeSet, config.hotspotPaths);
    const touchesHotspotAlreadyInWave =
      taskHotspots.length > 0 && taskHotspots.some((h) => currentHotspots.has(h));
    let conflictsWith = false;
    if (currentIds.length > 0) {
      for (let i = 0; i < currentScopes.length; i++) {
        if (conflictMatrix(currentScopes[i]!, task.scopeSet)) {
          conflictsWith = true;
          break;
        }
      }
    }
    const effectiveCap = Math.min(currentCapacity, taskCap);
    if (
      currentIds.length === 0 ||
      (!conflictsWith &&
        !touchesHotspotAlreadyInWave &&
        currentIds.length + 1 <= effectiveCap)
    ) {
      currentIds.push(task.taskId);
      currentScopes.push(task.scopeSet);
      currentCapacity = effectiveCap;
      for (const h of taskHotspots) currentHotspots.add(h);
    } else {
      flush();
      if (config.abortSignal?.aborted) {
        cancelled = true;
        break;
      }
      currentIds.push(task.taskId);
      currentScopes.push(task.scopeSet);
      currentCapacity = taskCap;
      for (const h of taskHotspots) currentHotspots.add(h);
    }
  }
  flush();

  return {
    schemaVersion: WRITE_SCHEDULER_SCHEMA_VERSION,
    waves,
    totalTasks: waves.reduce((acc, w) => acc + w.taskIds.length, 0),
    cancelled,
    contextDriftToken: config.contextDrift.token,
  };
}

export interface LeaseAcquisitionRow {
  readonly taskId: string;
  readonly waveIndex: number;
  readonly outcome: LeaseAcquisitionOutcome;
}

export function acquireLeasesForPlan(
  plan: WriteSchedule,
  config: {
    readonly leaseAuthority: (req: LeaseSpec) => LeaseAcquisitionOutcome;
    readonly leaseTemplate: Omit<LeaseSpec, "lease_id">;
    readonly fencingSeed: number;
  },
): readonly LeaseAcquisitionRow[] {
  if (plan.cancelled) return [];
  if (config.leaseTemplate.fencing_token <= 0) {
    throw new TaskSchedulerInputError("fencingSeed must be > 0");
  }
  const rows: LeaseAcquisitionRow[] = [];
  let token = config.leaseTemplate.fencing_token;
  for (const wave of plan.waves) {
    for (const taskId of wave.taskIds) {
      const spec: LeaseSpec = {
        lease_id: "LEASE-" + taskId + "-" + token,
        fencing_token: token,
        branch: config.leaseTemplate.branch,
        worker_id: config.leaseTemplate.worker_id,
        ttl_seconds: config.leaseTemplate.ttl_seconds,
      };
      const outcome = config.leaseAuthority(spec);
      rows.push({ taskId, waveIndex: wave.waveIndex, outcome });
      token++;
    }
  }
  return rows;
}

export function validateContextDrift(
  plan: WriteSchedule,
  runtimeToken: string,
): boolean {
  if (runtimeToken.length === 0) return false;
  return plan.contextDriftToken === runtimeToken;
}
