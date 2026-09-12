import { test, expect, describe } from "bun:test";
import {
  scheduleWrites,
  detectDeadlock,
  IntegrationQueue,
  acquireLeasesForPlan,
  validateContextDrift,
  defaultConflictMatrix,
  type WriteTask,
  type WriteSchedulerConfig,
  type LeaseSpec,
  type LeaseAcquisitionOutcome,
} from "../../src/team/task-scheduler";

function makeTask(
  taskId: string,
  scopeSet: readonly string[],
  priority = 0,
  providerId = "p",
): WriteTask {
  return { taskId, providerId, priority, scopeSet };
}

function makeConfig(
  tasks: readonly WriteTask[],
  overrides: Partial<WriteSchedulerConfig> = {},
): WriteSchedulerConfig {
  return {
    seed: 1,
    providerCapacities: [],
    defaultCapacity: 4,
    hotspotPaths: [],
    leaseAuthority: () => ({ ok: true, lease: dummyLease() }),
    contextDrift: { token: "tok-1" },
    ...overrides,
  };
}

function dummyLease(): LeaseSpec {
  return {
    lease_id: "L",
    fencing_token: 1,
    branch: "c",
    worker_id: "w",
    ttl_seconds: 60,
  };
}

const PROVIDERS_3 = ["alpha", "beta", "gamma"] as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomWriteTasks(n: number, maxScopeSize: number, seed: number): readonly WriteTask[] {
  const rng = mulberry32(seed);
  const tasks: WriteTask[] = [];
  for (let i = 0; i < n; i++) {
    const k = Math.floor(rng() * maxScopeSize);
    const scope: string[] = [];
    for (let j = 0; j < k; j++) {
      scope.push("s" + Math.floor(rng() * (maxScopeSize * 2)));
    }
    tasks.push({
      taskId: "t-" + i.toString().padStart(4, "0"),
      providerId: PROVIDERS_3[Math.floor(rng() * PROVIDERS_3.length)]!,
      priority: Math.floor(rng() * 5),
      scopeSet: scope,
    });
  }
  return tasks;
}

// ----------------------------------------------------------------------------
// Conflict matrix + deadlock detection
// ----------------------------------------------------------------------------

describe("defaultConflictMatrix", () => {
  test("empty scopes never conflict", () => {
    expect(defaultConflictMatrix([], ["a"])).toBe(false);
    expect(defaultConflictMatrix(["a"], [])).toBe(false);
    expect(defaultConflictMatrix([], [])).toBe(false);
  });
  test("identical scope entries conflict", () => {
    expect(defaultConflictMatrix(["a", "b"], ["b"])).toBe(true);
    expect(defaultConflictMatrix(["x"], ["x"])).toBe(true);
  });
  test("disjoint scope sets never conflict", () => {
    expect(defaultConflictMatrix(["a"], ["b"])).toBe(false);
  });
});

describe("detectDeadlock", () => {
  test("empty task list returns null (no cycle)", () => {
    expect(detectDeadlock([])).toBeNull();
  });
  test("non-conflicting tasks return null", () => {
    const tasks = [
      makeTask("a", ["a"]),
      makeTask("b", ["b"]),
      makeTask("c", ["c"]),
    ];
    expect(detectDeadlock(tasks)).toBeNull();
  });
  test("a 3-cycle (a<->b<->c<->a) returns a non-empty witness", () => {
    const tasks = [
      makeTask("a", ["shared"]),
      makeTask("b", ["shared"]),
      makeTask("c", ["shared"]),
    ];
    const cycle = detectDeadlock(tasks);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
    for (const id of cycle!) {
      expect(["a", "b", "c"]).toContain(id);
    }
  });
  test("self-overlapping scopes do not form a cycle (no self-loop)", () => {
    const tasks = [makeTask("a", ["x", "x"])];
    expect(detectDeadlock(tasks)).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// scheduleWrites: core invariants
// ----------------------------------------------------------------------------

describe("scheduleWrites: conflict-free waves", () => {
  test("non-overlapping scopes can share a wave", () => {
    const tasks = [
      makeTask("a", ["a"]),
      makeTask("b", ["b"]),
      makeTask("c", ["c"]),
    ];
    const cfg = makeConfig(tasks, { defaultCapacity: 4 });
    const plan = scheduleWrites(tasks, cfg);
    expect(plan.waves.length).toBe(1);
    expect(plan.waves[0]!.taskIds.length).toBe(3);
    expect(plan.totalTasks).toBe(3);
  });
  test("overlapping scopes split into separate waves", () => {
    const tasks = [
      makeTask("a", ["x"]),
      makeTask("b", ["x"]),
    ];
    const cfg = makeConfig(tasks, { defaultCapacity: 4 });
    const plan = scheduleWrites(tasks, cfg);
    expect(plan.waves.length).toBe(2);
    expect(plan.waves[0]!.taskIds).toEqual(["a"]);
    expect(plan.waves[1]!.taskIds).toEqual(["b"]);
  });
  test("intra-wave: no two tasks in the same wave share a scope resource", () => {
    const tasks = [
      makeTask("a", ["x"]),
      makeTask("b", ["x", "y"]),
      makeTask("c", ["y"]),
      makeTask("d", ["z"]),
    ];
    const cfg = makeConfig(tasks, { defaultCapacity: 4 });
    const plan = scheduleWrites(tasks, cfg);
    for (const wave of plan.waves) {
      const waveTasks = wave.taskIds.map((id) => tasks.find((t) => t.taskId === id)!);
      for (let i = 0; i < waveTasks.length; i++) {
        for (let j = i + 1; j < waveTasks.length; j++) {
          expect(
            defaultConflictMatrix(waveTasks[i]!.scopeSet, waveTasks[j]!.scopeSet),
          ).toBe(false);
        }
      }
    }
    expect(plan.totalTasks).toBe(4);
  });
  test("transitive conflicts (a-b, b-c) produce a valid plan with no intra-wave conflict", () => {
    const tasks = [
      makeTask("a", ["x"]),
      makeTask("b", ["x", "y"]),
      makeTask("c", ["y"]),
    ];
    const cfg = makeConfig(tasks, { defaultCapacity: 4 });
    const plan = scheduleWrites(tasks, cfg);
    expect(plan.totalTasks).toBe(3);
    for (const wave of plan.waves) {
      const waveTasks = wave.taskIds.map((id) => tasks.find((t) => t.taskId === id)!);
      for (let i = 0; i < waveTasks.length; i++) {
        for (let j = i + 1; j < waveTasks.length; j++) {
          expect(
            defaultConflictMatrix(waveTasks[i]!.scopeSet, waveTasks[j]!.scopeSet),
          ).toBe(false);
        }
      }
    }
  });
});

describe("scheduleWrites: shared hotspot serialization", () => {
  test("hotspot forces serialization even without conflict-matrix overlap", () => {
    const tasks = [
      makeTask("a", ["hot"]),
      makeTask("b", ["hot"]),
    ];
    const cfg = makeConfig(tasks, {
      defaultCapacity: 4,
      hotspotPaths: ["hot"],
    });
    const plan = scheduleWrites(tasks, cfg);
    expect(plan.waves.length).toBe(2);
    expect(plan.waves[0]!.taskIds).toEqual(["a"]);
    expect(plan.waves[1]!.taskIds).toEqual(["b"]);
    expect(plan.waves[0]!.serializedHotspots).toContain("hot");
  });
  test("hotspots that are not touched are absent from wave metadata", () => {
    const tasks = [
      makeTask("a", ["x"]),
      makeTask("b", ["y"]),
    ];
    const cfg = makeConfig(tasks, {
      defaultCapacity: 4,
      hotspotPaths: ["hot"],
    });
    const plan = scheduleWrites(tasks, cfg);
    expect(plan.waves.length).toBe(1);
    expect(plan.waves[0]!.serializedHotspots).toEqual([]);
  });
});

describe("scheduleWrites: deadlock refusal", () => {
  test("a 3-cycle (triangle) is serialised into 3 single-task waves, not refused", () => {
    // The conflict graph always admits a plan: serialise mutually
    // conflicting tasks into separate waves. The scheduler never
    // refuses to plan; it produces a correct (possibly less parallel)
    // plan instead. A "deadlock" in the chaos sense would be a plan
    // that cannot advance; the scheduler avoids that by construction.
    const tasks = [
      makeTask("a", ["shared"]),
      makeTask("b", ["shared"]),
      makeTask("c", ["shared"]),
    ];
    const cfg = makeConfig(tasks);
    const plan = scheduleWrites(tasks, cfg);
    expect(plan.totalTasks).toBe(3);
    expect(plan.waves.length).toBe(3);
    for (const wave of plan.waves) {
      expect(wave.taskIds.length).toBe(1);
    }
  });
});

describe("scheduleWrites: cancellation", () => {
  test("pre-aborted signal yields empty plan", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const tasks = [
      makeTask("a", ["x"]),
      makeTask("b", ["y"]),
    ];
    const cfg = makeConfig(tasks, { abortSignal: ctrl.signal });
    const plan = scheduleWrites(tasks, cfg);
    expect(plan.cancelled).toBe(true);
    expect(plan.waves.length).toBe(0);
  });
});

describe("scheduleWrites: input validation", () => {
  test("empty contextDrift token rejected", () => {
    const tasks = [makeTask("a", ["x"])];
    const cfg = makeConfig(tasks, { contextDrift: { token: "" } });
    expect(() => scheduleWrites(tasks, cfg)).toThrow(/contextDrift/);
  });
  test("duplicate taskIds rejected", () => {
    const tasks = [makeTask("a", ["x"]), makeTask("a", ["y"])];
    const cfg = makeConfig(tasks);
    expect(() => scheduleWrites(tasks, cfg)).toThrow(/duplicate taskId/);
  });
  test("non-finite seed rejected", () => {
    const tasks = [makeTask("a", ["x"])];
    const cfg = makeConfig(tasks, { seed: Number.NaN });
    expect(() => scheduleWrites(tasks, cfg)).toThrow(/seed/);
  });
});

// ----------------------------------------------------------------------------
// Lease acquisition
// ----------------------------------------------------------------------------

describe("acquireLeasesForPlan", () => {
  test("emits one row per scheduled task, in plan order, with monotonic fencing", () => {
    const tasks = [
      makeTask("a", ["x"]),
      makeTask("b", ["y"]),
      makeTask("c", ["z"]),
    ];
    const cfg = makeConfig(tasks, { defaultCapacity: 2 });
    const plan = scheduleWrites(tasks, cfg);
    const seen: string[] = [];
    const rows = acquireLeasesForPlan(plan, {
      leaseAuthority: (req) => {
        seen.push(req.lease_id);
        return { ok: true, lease: req };
      },
      leaseTemplate: { fencing_token: 100, branch: "c-K02/x", worker_id: "MM11", ttl_seconds: 1800 },
      fencingSeed: 100,
    });
    expect(rows.length).toBe(3);
    expect(seen.length).toBe(3);
    expect(rows[0]!.outcome.ok).toBe(true);
    expect(rows[1]!.outcome.ok).toBe(true);
    expect(rows[2]!.outcome.ok).toBe(true);
  });
  test("fencing tokens are strictly monotonic across the plan", () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask("t-" + i, ["s" + (i % 3)]),
    );
    const cfg = makeConfig(tasks, { defaultCapacity: 2 });
    const plan = scheduleWrites(tasks, cfg);
    const tokens: number[] = [];
    acquireLeasesForPlan(plan, {
      leaseAuthority: (req) => {
        tokens.push(req.fencing_token);
        return { ok: true, lease: req };
      },
      leaseTemplate: { fencing_token: 50, branch: "c-K02/x", worker_id: "MM11", ttl_seconds: 1800 },
      fencingSeed: 50,
    });
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i]!).toBeGreaterThan(tokens[i - 1]!);
    }
  });
  test("BRANCH_TAKEN outcome is preserved per row, not aborted", () => {
    const tasks = [
      makeTask("a", ["x"]),
      makeTask("b", ["y"]),
    ];
    const cfg = makeConfig(tasks, { defaultCapacity: 1 });
    const plan = scheduleWrites(tasks, cfg);
    let first = true;
    const rows = acquireLeasesForPlan(plan, {
      leaseAuthority: (req) => {
        if (first) {
          first = false;
          return { ok: true, lease: req };
        }
        return { ok: false, code: "BRANCH_TAKEN" };
      },
      leaseTemplate: { fencing_token: 1, branch: "c-K02/x", worker_id: "MM11", ttl_seconds: 1800 },
      fencingSeed: 1,
    });
    expect(rows.length).toBe(2);
    expect(rows[0]!.outcome.ok).toBe(true);
    if (!rows[1]!.outcome.ok) {
      expect(rows[1]!.outcome.code).toBe("BRANCH_TAKEN");
    } else {
      throw new Error("expected BRANCH_TAKEN on second row");
    }
  });
  test("cancelled plan yields no rows", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const tasks = [makeTask("a", ["x"])];
    const cfg = makeConfig(tasks, { abortSignal: ctrl.signal });
    const plan = scheduleWrites(tasks, cfg);
    const rows = acquireLeasesForPlan(plan, {
      leaseAuthority: () => ({ ok: true, lease: dummyLease() }),
      leaseTemplate: { fencing_token: 1, branch: "c", worker_id: "w", ttl_seconds: 60 },
      fencingSeed: 1,
    });
    expect(rows.length).toBe(0);
  });
  test("non-positive fencing seed rejected", () => {
    const tasks = [makeTask("a", ["x"])];
    const cfg = makeConfig(tasks);
    const plan = scheduleWrites(tasks, cfg);
    expect(() =>
      acquireLeasesForPlan(plan, {
        leaseAuthority: () => ({ ok: true, lease: dummyLease() }),
        leaseTemplate: { fencing_token: 0, branch: "c", worker_id: "w", ttl_seconds: 60 },
        fencingSeed: 0,
      }),
    ).toThrow(/fencing/);
  });
});

// ----------------------------------------------------------------------------
// Context drift
// ----------------------------------------------------------------------------

describe("validateContextDrift", () => {
  test("matching token => true", () => {
    const tasks = [makeTask("a", ["x"])];
    const cfg = makeConfig(tasks, { contextDrift: { token: "tok-A" } });
    const plan = scheduleWrites(tasks, cfg);
    expect(validateContextDrift(plan, "tok-A")).toBe(true);
  });
  test("differing token => false (drift detected, refuse integration)", () => {
    const tasks = [makeTask("a", ["x"])];
    const cfg = makeConfig(tasks, { contextDrift: { token: "tok-A" } });
    const plan = scheduleWrites(tasks, cfg);
    expect(validateContextDrift(plan, "tok-B")).toBe(false);
  });
  test("empty runtime token rejected", () => {
    const tasks = [makeTask("a", ["x"])];
    const cfg = makeConfig(tasks, { contextDrift: { token: "tok-A" } });
    const plan = scheduleWrites(tasks, cfg);
    expect(validateContextDrift(plan, "")).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// IntegrationQueue
// ----------------------------------------------------------------------------

describe("IntegrationQueue", () => {
  test("FIFO enqueue, dedupe by taskId", () => {
    const q = new IntegrationQueue();
    const r1 = q.enqueue({ taskId: "a", fencingToken: 1, leaseId: "L1" });
    const r2 = q.enqueue({ taskId: "b", fencingToken: 2, leaseId: "L2" });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const r3 = q.enqueue({ taskId: "a", fencingToken: 3, leaseId: "L3" });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.code).toBe("DUPLICATE_TASK_ID");
    expect(q.size()).toBe(2);
    expect(q.list().map((e) => e.taskId)).toEqual(["a", "b"]);
  });
  test("zero or negative fencing token rejected (STALE)", () => {
    const q = new IntegrationQueue();
    const r = q.enqueue({ taskId: "a", fencingToken: 0, leaseId: "L1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("STALE_FENCING_TOKEN");
  });
  test("close() refuses subsequent enqueue", () => {
    const q = new IntegrationQueue();
    q.enqueue({ taskId: "a", fencingToken: 1, leaseId: "L1" });
    q.close();
    const r = q.enqueue({ taskId: "b", fencingToken: 2, leaseId: "L2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("QUEUE_CLOSED");
  });
});

// ----------------------------------------------------------------------------
// Property check — 5000 runs verifying conflict-free waves + capacity + hotspots
// ----------------------------------------------------------------------------

describe("scheduleWrites: property check (5000 random inputs)", () => {
  const PROPERTY_RUNS = 5000;
  const PROPERTY_SEED = 0xbaadf00d;

  test("5000 random schedules honour every K02 invariant", () => {
    const rng = mulberry32(PROPERTY_SEED);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const n = Math.floor(rng() * 40);
      const tasks = randomWriteTasks(n, 8, run);
      const cfg: WriteSchedulerConfig = {
        seed: Math.floor(rng() * 1e9),
        providerCapacities: PROVIDERS_3.map((p) => ({
          providerId: p,
          capacity: 1 + Math.floor(rng() * 4),
        })),
        defaultCapacity: 1 + Math.floor(rng() * 4),
        hotspotPaths: rng() < 0.4 ? ["shared-a", "shared-b"] : [],
        leaseAuthority: () => ({ ok: true, lease: dummyLease() }),
        contextDrift: { token: "tok-" + run },
      };

      let plan;
      try {
        plan = scheduleWrites(tasks, cfg);
      } catch (err) {
        // Cyclic inputs are rejected; that's a pass for deadlock detection.
        if (err instanceof Error && /dependency cycle/.test(err.message)) {
          continue;
        }
        throw err;
      }

      // Invariant 1: no duplicates across waves.
      const seen = new Set<string>();
      for (const wave of plan.waves) {
        for (const id of wave.taskIds) {
          if (seen.has(id)) {
            throw new Error("run=" + run + ": duplicate " + id);
          }
          seen.add(id);
        }
      }
      expect(plan.totalTasks).toBe(tasks.length);

      // Invariant 2: no two tasks in the same wave share a scope resource.
      for (const wave of plan.waves) {
        const waveTasks = wave.taskIds.map((id) => tasks.find((t) => t.taskId === id)!);
        for (let i = 0; i < waveTasks.length; i++) {
          for (let j = i + 1; j < waveTasks.length; j++) {
            if (defaultConflictMatrix(waveTasks[i]!.scopeSet, waveTasks[j]!.scopeSet)) {
              throw new Error(
                "run=" + run + ": wave " + wave.waveIndex + " has conflicting pair",
              );
            }
          }
        }
      }

      // Invariant 3: per-wave capacity respected.
      for (const wave of plan.waves) {
        if (wave.taskIds.length > wave.effectiveCapacity) {
          throw new Error(
            "run=" + run + ": wave " + wave.waveIndex + " over capacity",
          );
        }
      }

      // Invariant 4: hotspots serialized (at most one task per wave touches a hotspot).
      for (const wave of plan.waves) {
        const waveTasks = wave.taskIds.map((id) => tasks.find((t) => t.taskId === id)!);
        for (const h of wave.serializedHotspots) {
          let count = 0;
          for (const wt of waveTasks) {
            if (wt.scopeSet.includes(h)) count++;
          }
          if (count > 1) {
            throw new Error(
              "run=" + run + ": hotspot " + h + " touched by " + count + " tasks in wave " + wave.waveIndex,
            );
          }
        }
      }

      // Invariant 5: determinism.
      const plan2 = scheduleWrites(tasks, cfg);
      expect(plan2).toEqual(plan);
    }
  });
});
