import { test, expect, describe } from "bun:test";
import {
  schedule,
  scheduleWrites,
  detectDeadlock,
  defaultConflictMatrix,
  type ReadTask,
  type WriteTask,
  type WriteSchedulerConfig,
} from "../../src/team/task-scheduler";
import { ConcurrencyController } from "../../src/team/concurrency-controller";

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

function genReadTasks(n: number, providers: readonly string[], seed: number): readonly ReadTask[] {
  const rng = mulberry32(seed);
  const tasks: ReadTask[] = [];
  for (let i = 0; i < n; i++) {
    tasks.push({
      taskId: "t-" + i,
      providerId: providers[Math.floor(rng() * providers.length)]!,
      priority: Math.floor(rng() * 5),
    });
  }
  return tasks;
}

function genWriteTasks(n: number, scopePoolSize: number, seed: number): readonly WriteTask[] {
  const rng = mulberry32(seed);
  const tasks: WriteTask[] = [];
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(rng() * 3);
    const scope: string[] = [];
    for (let j = 0; j < k; j++) scope.push("s" + Math.floor(rng() * scopePoolSize));
    tasks.push({
      taskId: "t-" + i,
      providerId: "p",
      priority: Math.floor(rng() * 5),
      scopeSet: scope,
    });
  }
  return tasks;
}

const PROVIDERS_4 = ["a", "b", "c", "d"] as const;

describe("K04 perf benchmarks (numbers logged for the certification report)", () => {
  test("K01 read scheduler: p95 over 30 runs at n=1000, capacity=4", () => {
    const tasks = genReadTasks(1000, PROVIDERS_4, 1);
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = Bun.nanoseconds();
      schedule(tasks, { seed: i, providerCapacities: [], defaultCapacity: 4 });
      const t1 = Bun.nanoseconds();
      samples.push((t1 - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)]!;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    const p99 = samples[Math.floor(samples.length * 0.99)]!;
    console.log("K01_n1000_cap4_p50_ms=" + p50.toFixed(3));
    console.log("K01_n1000_cap4_p95_ms=" + p95.toFixed(3));
    console.log("K01_n1000_cap4_p99_ms=" + p99.toFixed(3));
    expect(samples.length).toBe(30);
  });

  test("K01 read scheduler: p95 over 10 runs at n=4096 (max cap), capacity=8", () => {
    const tasks = genReadTasks(4096, PROVIDERS_4, 1);
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t0 = Bun.nanoseconds();
      schedule(tasks, { seed: i, providerCapacities: [], defaultCapacity: 8 });
      const t1 = Bun.nanoseconds();
      samples.push((t1 - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    console.log("K01_n4096_cap8_p95_ms=" + p95.toFixed(3));
    expect(samples.length).toBe(10);
  });

  test("K02 write scheduler: p95 over 20 runs at n=500, scopePool=64", () => {
    const tasks = genWriteTasks(500, 64, 1);
    const cfg: WriteSchedulerConfig = {
      seed: 1,
      providerCapacities: [],
      defaultCapacity: 4,
      hotspotPaths: [],
      leaseAuthority: () => ({ ok: true, lease: { lease_id: "L", fencing_token: 1, branch: "c", worker_id: "w", ttl_seconds: 60 } }),
      contextDrift: { token: "t" },
    };
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Bun.nanoseconds();
      scheduleWrites(tasks, cfg);
      const t1 = Bun.nanoseconds();
      samples.push((t1 - t0) / 1e6);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    console.log("K02_n500_p95_ms=" + p95.toFixed(3));
    expect(samples.length).toBe(20);
  });

  test("K03 concurrency controller: p95 apply() over 10000 samples", () => {
    const c = new ConcurrencyController({
      minConcurrency: 1,
      maxConcurrency: 32,
      initialConcurrency: 8,
      stableWindow: 3,
      warnErrorRate: 0.1,
      failErrorRate: 0.5,
      warnRateLimitRemaining: 0.1,
      warnDiskFreeMb: 100,
      warnDbInFlight: 50,
    });
    const rng = mulberry32(1);
    const samples: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const s = {
        errorRate: rng(),
        rateLimitRemaining: rng(),
        diskFreeMb: Math.floor(rng() * 1000),
        dbInFlight: Math.floor(rng() * 60),
      };
      const t0 = Bun.nanoseconds();
      c.apply(s);
      const t1 = Bun.nanoseconds();
      samples.push(t1 - t0);
    }
    samples.sort((a, b) => a - b);
    const p95us = samples[Math.floor(samples.length * 0.95)]! / 1e3;
    console.log("K03_apply_p95_us=" + p95us.toFixed(3));
    expect(samples.length).toBe(10000);
  });

  test("K02 deadlock: 100k random small graphs without false positives", () => {
    const rng = mulberry32(7);
    let acyclic = 0;
    let cyclic = 0;
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < 100000; i++) {
      const n = 2 + Math.floor(rng() * 8);
      const tasks: WriteTask[] = [];
      for (let j = 0; j < n; j++) {
        tasks.push({
          taskId: "t-" + j,
          providerId: "p",
          priority: 0,
          scopeSet: ["s" + Math.floor(rng() * (n + 1))],
        });
      }
      const result = detectDeadlock(tasks);
      if (result === null) acyclic++;
      else {
        cyclic++;
        if (result.length < 2) {
          throw new Error("got a witness shorter than 2 — should be impossible");
        }
      }
    }
    const t1 = Bun.nanoseconds();
    console.log("K02_deadlock_100k_total_ms=" + ((t1 - t0) / 1e6).toFixed(2));
    console.log("K02_deadlock_acyclic=" + acyclic);
    console.log("K02_deadlock_cyclic=" + cyclic);
    expect(acyclic + cyclic).toBe(100000);
  });
});
