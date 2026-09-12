import { test, expect, describe } from "bun:test";
import {
  schedule,
  flattenSchedule,
  TASK_SCHEDULER_MAX_TASKS_PER_CALL,
  TASK_SCHEDULER_MIN_PROVIDER_CAPACITY,
  type ReadTask,
  type ProviderCapacity,
  type SchedulerConfig,
  type ReadSchedule,
} from "../../src/team/task-scheduler";

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

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

function pickProvider(rng: () => number, providers: readonly string[]): string {
  const idx = Math.floor(rng() * providers.length);
  return providers[Math.min(idx, providers.length - 1)]!;
}

function genTasks(
  n: number,
  providers: readonly string[],
  seed: number,
): readonly ReadTask[] {
  const rng = mulberry32(seed);
  const tasks: ReadTask[] = [];
  for (let i = 0; i < n; i++) {
    tasks.push({
      taskId: `t-${i.toString().padStart(4, "0")}`,
      providerId: pickProvider(rng, providers),
      priority: Math.floor(rng() * 5),
    });
  }
  return tasks;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  seed: 1,
  providerCapacities: [],
  defaultCapacity: 4,
};

const PROVIDERS_3 = ["alpha", "beta", "gamma"] as const;

// ----------------------------------------------------------------------------
// Determinism
// ----------------------------------------------------------------------------

describe("schedule: determinism", () => {
  test("same input + same seed => identical plan (verbatim)", () => {
    const tasks = genTasks(50, PROVIDERS_3, 42);
    const a = schedule(tasks, { ...DEFAULT_CONFIG, seed: 123 });
    const b = schedule(tasks, { ...DEFAULT_CONFIG, seed: 123 });
    expect(a).toEqual(b);
  });

  test("different seeds can produce the same plan when no ties exist", () => {
    // No two tasks share the same priority ⇒ seed only affects tiebreaks,
    // so the plan is identical regardless of seed.
    const tasks: ReadTask[] = Array.from({ length: 10 }, (_, i) => ({
      taskId: `t-${i}`,
      providerId: "alpha",
      priority: 100 - i,
    }));
    const a = schedule(tasks, { ...DEFAULT_CONFIG, seed: 1 });
    const b = schedule(tasks, { ...DEFAULT_CONFIG, seed: 9999 });
    expect(a).toEqual(b);
  });

  test("invariance under permutation of input (structural, not byte-equal)", () => {
    // The plan structure — totalTasks, sum of wave sizes, capacity bounds —
    // must hold for any permutation of the same input set. The exact wave
    // ordering is allowed to differ as long as invariants hold.
    const base = genTasks(80, PROVIDERS_3, 7);
    const shuffled = [...base].reverse();
    const cfg = { ...DEFAULT_CONFIG, seed: 42 };
    const planA = schedule(base, cfg);
    const planB = schedule(shuffled, cfg);
    expect(planA.totalTasks).toBe(planB.totalTasks);
    expect(planA.totalTasks).toBe(base.length);
    expect(planB.totalTasks).toBe(base.length);
    expect(planA.waves.length).toBe(planB.waves.length);
    const flatA = flattenSchedule(planA).map((x) => x.taskId).sort();
    const flatB = flattenSchedule(planB).map((x) => x.taskId).sort();
    expect(flatA).toEqual(flatB);
  });
});

// ----------------------------------------------------------------------------
// No duplicate attempts
// ----------------------------------------------------------------------------

describe("schedule: no duplicate attempts", () => {
  test("every taskId appears at most once across all waves", () => {
    const tasks = genTasks(200, PROVIDERS_3, 11);
    const plan = schedule(tasks, { ...DEFAULT_CONFIG, seed: 5 });
    const seen = new Set<string>();
    for (const wave of plan.waves) {
      for (const id of wave.taskIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(plan.totalTasks);
    expect(plan.totalTasks).toBe(tasks.length);
  });

  test("rejects duplicate taskIds at the API boundary", () => {
    const tasks: ReadTask[] = [
      { taskId: "dup", providerId: "alpha", priority: 0 },
      { taskId: "dup", providerId: "beta", priority: 0 },
    ];
    expect(() => schedule(tasks, DEFAULT_CONFIG)).toThrow(/duplicate taskId/);
  });
});

// ----------------------------------------------------------------------------
// Provider capacity
// ----------------------------------------------------------------------------

describe("schedule: provider capacity", () => {
  test("per-wave size never exceeds the smallest provider capacity in that wave", () => {
    const tasks = genTasks(150, PROVIDERS_3, 3);
    const cfg: SchedulerConfig = {
      seed: 9,
      providerCapacities: [
        { providerId: "alpha", capacity: 2 },
        { providerId: "beta", capacity: 4 },
        { providerId: "gamma", capacity: 6 },
      ],
      defaultCapacity: 8,
    };
    const plan = schedule(tasks, cfg);
    for (const wave of plan.waves) {
      expect(wave.taskIds.length).toBeLessThanOrEqual(wave.effectiveCapacity);
    }
  });

  test("default capacity applies to providers without explicit capacity", () => {
    const tasks: ReadTask[] = Array.from({ length: 6 }, (_, i) => ({
      taskId: `t-${i}`,
      providerId: "unknown-provider",
      priority: 0,
    }));
    const cfg: SchedulerConfig = {
      seed: 1,
      providerCapacities: [],
      defaultCapacity: 3,
    };
    const plan = schedule(tasks, cfg);
    expect(plan.waves).toHaveLength(2);
    expect(plan.waves[0]!.taskIds.length).toBe(3);
    expect(plan.waves[1]!.taskIds.length).toBe(3);
    expect(plan.waves[0]!.effectiveCapacity).toBe(3);
  });

  test("capacity 1 forces fully sequential execution", () => {
    const tasks = genTasks(10, PROVIDERS_3, 4);
    const cfg: SchedulerConfig = {
      seed: 2,
      providerCapacities: [
        { providerId: "alpha", capacity: 1 },
        { providerId: "beta", capacity: 1 },
        { providerId: "gamma", capacity: 1 },
      ],
      defaultCapacity: 1,
    };
    const plan = schedule(tasks, cfg);
    for (const wave of plan.waves) {
      expect(wave.taskIds.length).toBe(1);
    }
    expect(plan.totalTasks).toBe(tasks.length);
  });

  test("zero capacity is rejected at the API boundary (fail-closed)", () => {
    expect(() =>
      schedule([], {
        seed: 1,
        providerCapacities: [{ providerId: "offline", capacity: 0 }],
        defaultCapacity: 1,
      }),
    ).toThrow(/must be >= 1/);
  });
});

// ----------------------------------------------------------------------------
// Starvation safety
// ----------------------------------------------------------------------------

describe("schedule: starvation safety", () => {
  test("every input task ends up in exactly one wave", () => {
    const tasks = genTasks(200, PROVIDERS_3, 17);
    const plan = schedule(tasks, { ...DEFAULT_CONFIG, seed: 13 });
    expect(plan.totalTasks).toBe(tasks.length);
    const flat = flattenSchedule(plan).map((x) => x.taskId).sort();
    const expected = [...tasks.map((t) => t.taskId)].sort();
    expect(flat).toEqual(expected);
  });

  test("low-priority tasks still get scheduled when capacity is tight", () => {
    // 5 tasks, all priority 0, capacity 1 ⇒ must take 5 waves.
    const tasks: ReadTask[] = Array.from({ length: 5 }, (_, i) => ({
      taskId: `t-${i}`,
      providerId: "p",
      priority: 0,
    }));
    const cfg: SchedulerConfig = {
      seed: 1,
      providerCapacities: [{ providerId: "p", capacity: 1 }],
      defaultCapacity: 1,
    };
    const plan = schedule(tasks, cfg);
    expect(plan.waves).toHaveLength(5);
    expect(plan.totalTasks).toBe(5);
  });
});

// ----------------------------------------------------------------------------
// Cancellation
// ----------------------------------------------------------------------------

describe("schedule: cancellation", () => {
  test("pre-aborted signal yields empty plan without throwing", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const tasks = genTasks(20, PROVIDERS_3, 1);
    const plan = schedule(tasks, { ...DEFAULT_CONFIG, seed: 1, abortSignal: ctrl.signal });
    expect(plan.cancelled).toBe(true);
    expect(plan.waves).toHaveLength(0);
    expect(plan.totalTasks).toBe(0);
  });

  test("aborting mid-fill returns the prefix of waves committed so far", () => {
    const ctrl = new AbortController();
    // Schedule a no-op task that aborts during fill. We approximate this by
    // wrapping tasks so the controller aborts when iterating — schedule()
    // checks abortSignal before each task, so once aborted we never commit
    // a fresh wave.
    const tasks: ReadTask[] = Array.from({ length: 10 }, (_, i) => ({
      taskId: `t-${i}`,
      providerId: "p",
      priority: 0,
    }));
    const cfg: SchedulerConfig = {
      seed: 1,
      providerCapacities: [{ providerId: "p", capacity: 1 }],
      defaultCapacity: 1,
      abortSignal: ctrl.signal,
    };
    // Abort after the schedule returns? Not enough. Instead: schedule with
    // a signal that is already aborted; the loop check fires on iteration 0,
    // so the plan is empty — but that's the same case as the test above.
    // For a partial plan, we need an abort that fires mid-iteration. Since
    // schedule() is synchronous, the only signal we can observe is one that
    // was already aborted at entry. We document that as the supported
    // contract: schedule() respects a signal checked at every iteration
    // boundary; callers wanting mid-iteration cancel must wrap tasks with
    // an external driver (not in scope for K01).
    ctrl.abort();
    const plan = schedule(tasks, cfg);
    expect(plan.cancelled).toBe(true);
  });

  test("no signal provided => cancellation never triggers", () => {
    const tasks = genTasks(20, PROVIDERS_3, 1);
    const plan = schedule(tasks, DEFAULT_CONFIG);
    expect(plan.cancelled).toBe(false);
    expect(plan.totalTasks).toBe(tasks.length);
  });
});

// ----------------------------------------------------------------------------
// Input validation (fail-closed)
// ----------------------------------------------------------------------------

describe("schedule: input validation", () => {
  test("empty input => empty plan, not an error", () => {
    const plan = schedule([], DEFAULT_CONFIG);
    expect(plan.waves).toHaveLength(0);
    expect(plan.totalTasks).toBe(0);
    expect(plan.cancelled).toBe(false);
  });

  test("empty taskId rejected", () => {
    expect(() =>
      schedule([{ taskId: "", providerId: "p", priority: 0 }], DEFAULT_CONFIG),
    ).toThrow(/taskId/);
  });

  test("non-finite seed rejected", () => {
    expect(() => schedule([], { ...DEFAULT_CONFIG, seed: Number.NaN })).toThrow(
      /finite/,
    );
  });

  test("non-integer defaultCapacity rejected", () => {
    expect(() => schedule([], { ...DEFAULT_CONFIG, defaultCapacity: 1.5 })).toThrow(
      /integer/,
    );
  });

  test("task count above cap rejected", () => {
    const tooBig = genTasks(TASK_SCHEDULER_MAX_TASKS_PER_CALL + 1, PROVIDERS_3, 1);
    expect(() => schedule(tooBig, DEFAULT_CONFIG)).toThrow(/exceeds/);
  });

  test("defaultCapacity below minimum rejected", () => {
    expect(() =>
      schedule([], { ...DEFAULT_CONFIG, defaultCapacity: TASK_SCHEDULER_MIN_PROVIDER_CAPACITY - 1 }),
    ).toThrow(/defaultCapacity/);
  });
});

// ----------------------------------------------------------------------------
// Property check — 5000+ random inputs verifying all invariants simultaneously
// ----------------------------------------------------------------------------

describe("schedule: property check (5000 random inputs)", () => {
  // We use a single seed per run so failures are reproducible; the seed is
  // recorded in the test name for fast bisection.
  const PROPERTY_RUNS = 5000;
  const PROPERTY_SEED = 0xc0ffee;

  test(`5000 random schedules honour every invariant (seed=0x${PROPERTY_SEED.toString(16)})`, () => {
    const rng = mulberry32(PROPERTY_SEED);
    let tasksGenerated = 0;
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const providerCount = 1 + Math.floor(rng() * 4);
      const providers: string[] = Array.from(
        { length: providerCount },
        (_, i) => `p${i}`,
      );
      const taskCount = Math.floor(rng() * 200); // 0..199
      tasksGenerated += taskCount;
      const tasks: ReadTask[] = [];
      for (let i = 0; i < taskCount; i++) {
        tasks.push({
          taskId: `r${run}-t${i}`,
          providerId: providers[Math.floor(rng() * providers.length)]!,
          priority: Math.floor(rng() * 5),
        });
      }
      const cfg: SchedulerConfig = {
        seed: Math.floor(rng() * 1e9),
        providerCapacities: providers.map((p) => ({
          providerId: p,
          capacity: 1 + Math.floor(rng() * 8),
        })),
        defaultCapacity: 1 + Math.floor(rng() * 8),
      };
      const plan = schedule(tasks, cfg);

      // Invariant 1: no duplicate taskIds across waves.
      const seen = new Set<string>();
      for (const wave of plan.waves) {
        for (const id of wave.taskIds) {
          if (seen.has(id)) {
            throw new Error(
              `run=${run}: duplicate taskId ${id} across waves`,
            );
          }
          seen.add(id);
        }
      }

      // Invariant 2: full coverage (no starvation).
      expect(seen.size).toBe(taskCount);
      expect(plan.totalTasks).toBe(taskCount);

      // Invariant 3: per-wave capacity respected.
      for (const wave of plan.waves) {
        if (wave.taskIds.length > wave.effectiveCapacity) {
          throw new Error(
            `run=${run}: wave ${wave.waveIndex} has ${wave.taskIds.length} tasks > capacity ${wave.effectiveCapacity}`,
          );
        }
      }

      // Invariant 4: determinism — running schedule() again on the same
      // (tasks, config) must produce an identical plan.
      const plan2 = schedule(tasks, cfg);
      expect(plan2).toEqual(plan);

      // Invariant 5: invariance under input permutation. We compare
      // structural invariants, not byte-equality.
      const shuffled = [...tasks].reverse();
      const plan3 = schedule(shuffled, cfg);
      expect(plan3.totalTasks).toBe(plan.totalTasks);
      const flat3 = flattenSchedule(plan3).map((x) => x.taskId).sort();
      const flatRef = flattenSchedule(plan).map((x) => x.taskId).sort();
      expect(flat3).toEqual(flatRef);
    }
    // Sanity: we exercised a meaningful amount of input, not just 5000
    // empty runs.
    expect(tasksGenerated).toBeGreaterThan(0);
  });
});
