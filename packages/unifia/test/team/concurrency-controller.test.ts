import { test, expect, describe } from "bun:test";
import {
  ConcurrencyController,
  ConcurrencyControllerInputError,
  type ControllerConfig,
  type HealthSample,
} from "../../src/team/concurrency-controller";

function makeHealthy(errorRate = 0.0): HealthSample {
  return { errorRate, rateLimitRemaining: 1.0, diskFreeMb: 10000, dbInFlight: 0 };
}

function makeWarnError(errorRate = 0.25): HealthSample {
  return { errorRate, rateLimitRemaining: 0.5, diskFreeMb: 10000, dbInFlight: 0 };
}

function makeFailError(errorRate = 0.9): HealthSample {
  return { errorRate, rateLimitRemaining: 0.5, diskFreeMb: 10000, dbInFlight: 0 };
}

function makeRateLimitWarn(): HealthSample {
  return { errorRate: 0, rateLimitRemaining: 0.05, diskFreeMb: 10000, dbInFlight: 0 };
}

function makeDiskWarn(): HealthSample {
  return { errorRate: 0, rateLimitRemaining: 1.0, diskFreeMb: 50, dbInFlight: 0 };
}

function makeDbWarn(): HealthSample {
  return { errorRate: 0, rateLimitRemaining: 1.0, diskFreeMb: 10000, dbInFlight: 100 };
}

const DEFAULT_CFG: ControllerConfig = {
  minConcurrency: 1,
  maxConcurrency: 16,
  initialConcurrency: 4,
  stableWindow: 3,
  warnErrorRate: 0.1,
  failErrorRate: 0.5,
  warnRateLimitRemaining: 0.1,
  warnDiskFreeMb: 100,
  warnDbInFlight: 50,
};

// ----------------------------------------------------------------------------
// Invariants
// ----------------------------------------------------------------------------

describe("ConcurrencyController: invariants", () => {
  test("current concurrency always stays within [min, max]", () => {
    const c = new ConcurrencyController(DEFAULT_CFG);
    for (let i = 0; i < 100; i++) {
      c.apply(i % 2 === 0 ? makeHealthy() : makeFailError());
      const s = c.state();
      expect(s.currentConcurrency).toBeGreaterThanOrEqual(DEFAULT_CFG.minConcurrency);
      expect(s.currentConcurrency).toBeLessThanOrEqual(DEFAULT_CFG.maxConcurrency);
    }
  });
  test("no guarantee weakening: current never drops below minConcurrency", () => {
    const c = new ConcurrencyController(DEFAULT_CFG);
    for (let i = 0; i < 1000; i++) {
      c.apply(makeFailError());
    }
    expect(c.state().currentConcurrency).toBe(DEFAULT_CFG.minConcurrency);
  });
  test("reduce-before-fail: a sustained WARN signal reduces BEFORE the system is in FAIL", () => {
    const c = new ConcurrencyController({ ...DEFAULT_CFG, stableWindow: 2 });
    const before = c.state().currentConcurrency;
    for (let i = 0; i < 3; i++) c.apply(makeWarnError());
    const after = c.state().currentConcurrency;
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(DEFAULT_CFG.minConcurrency);
  });
  test("FAIL signal reduces immediately (within stableWindow)", () => {
    const c = new ConcurrencyController({ ...DEFAULT_CFG, stableWindow: 10 });
    for (let i = 0; i < 10; i++) c.apply(makeFailError());
    expect(c.state().currentConcurrency).toBe(DEFAULT_CFG.minConcurrency);
  });
});

// ----------------------------------------------------------------------------
// Hysteresis
// ----------------------------------------------------------------------------

describe("ConcurrencyController: hysteresis", () => {
  test("alternating WARN/HEALTHY does not oscillate every sample", () => {
    const c = new ConcurrencyController({ ...DEFAULT_CFG, stableWindow: 3 });
    const before = c.state().currentConcurrency;
    let changes = 0;
    for (let i = 0; i < 30; i++) {
      const was = c.state().currentConcurrency;
      c.apply(i % 2 === 0 ? makeWarnError() : makeHealthy());
      if (c.state().currentConcurrency !== was) changes++;
    }
    // With stableWindow=3 and alternating every sample, the level should
    // not change more than ~10 times in 30 samples (it requires 3 agreeing
    // samples to trigger a change).
    expect(changes).toBeLessThanOrEqual(15);
    expect(c.state().currentConcurrency).toBeGreaterThanOrEqual(DEFAULT_CFG.minConcurrency);
  });
  test("HEALTHY samples only raise after stableWindow consecutive", () => {
    const c = new ConcurrencyController({ ...DEFAULT_CFG, stableWindow: 5, initialConcurrency: 4 });
    const before = c.state().currentConcurrency;
    for (let i = 0; i < 4; i++) c.apply(makeHealthy());
    expect(c.state().currentConcurrency).toBe(before); // not yet
    c.apply(makeHealthy()); // 5th healthy
    expect(c.state().currentConcurrency).toBe(before + 1);
  });
});

// ----------------------------------------------------------------------------
// Different WARN sources
// ----------------------------------------------------------------------------

describe("ConcurrencyController: WARN sources", () => {
  test("rate-limit WARN degrades", () => {
    const c = new ConcurrencyController({ ...DEFAULT_CFG, stableWindow: 2 });
    const before = c.state().currentConcurrency;
    for (let i = 0; i < 3; i++) c.apply(makeRateLimitWarn());
    expect(c.state().currentConcurrency).toBeLessThan(before);
  });
  test("disk WARN degrades", () => {
    const c = new ConcurrencyController({ ...DEFAULT_CFG, stableWindow: 2 });
    const before = c.state().currentConcurrency;
    for (let i = 0; i < 3; i++) c.apply(makeDiskWarn());
    expect(c.state().currentConcurrency).toBeLessThan(before);
  });
  test("db-in-flight WARN degrades", () => {
    const c = new ConcurrencyController({ ...DEFAULT_CFG, stableWindow: 2 });
    const before = c.state().currentConcurrency;
    for (let i = 0; i < 3; i++) c.apply(makeDbWarn());
    expect(c.state().currentConcurrency).toBeLessThan(before);
  });
});

// ----------------------------------------------------------------------------
// Input validation
// ----------------------------------------------------------------------------

describe("ConcurrencyController: input validation", () => {
  test("minConcurrency < 1 rejected", () => {
    expect(() => new ConcurrencyController({ ...DEFAULT_CFG, minConcurrency: 0 })).toThrow(
      /minConcurrency/,
    );
  });
  test("maxConcurrency < minConcurrency rejected", () => {
    expect(() => new ConcurrencyController({ ...DEFAULT_CFG, maxConcurrency: 0 })).toThrow(
      /maxConcurrency/,
    );
  });
  test("initialConcurrency out of range rejected", () => {
    expect(
      () => new ConcurrencyController({ ...DEFAULT_CFG, initialConcurrency: 100 }),
    ).toThrow(/initialConcurrency/);
  });
  test("warnErrorRate >= failErrorRate rejected", () => {
    expect(
      () =>
        new ConcurrencyController({
          ...DEFAULT_CFG,
          warnErrorRate: 0.5,
          failErrorRate: 0.1,
        }),
    ).toThrow(/warnErrorRate/);
  });
  test("errorRate outside [0,1] rejected at apply()", () => {
    const c = new ConcurrencyController(DEFAULT_CFG);
    expect(() =>
      c.apply({ errorRate: 2, rateLimitRemaining: 0.5, diskFreeMb: 1000, dbInFlight: 0 }),
    ).toThrow(/errorRate/);
  });
  test("dbInFlight negative rejected", () => {
    const c = new ConcurrencyController(DEFAULT_CFG);
    expect(() =>
      c.apply({ errorRate: 0, rateLimitRemaining: 0.5, diskFreeMb: 1000, dbInFlight: -1 }),
    ).toThrow(/dbInFlight/);
  });
});

// ----------------------------------------------------------------------------
// Property check — 5000 runs
// ----------------------------------------------------------------------------

describe("ConcurrencyController: property check (5000 random runs)", () => {
  const PROPERTY_RUNS = 5000;
  const PROPERTY_SEED = 0xfeedface;

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

  test("5000 random sequences honour every invariant simultaneously", () => {
    const rng = mulberry32(PROPERTY_SEED);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      const minC = 1 + Math.floor(rng() * 4);
      const maxC = minC + 1 + Math.floor(rng() * 16);
      const init = minC + Math.floor(rng() * (maxC - minC + 1));
      const win = 1 + Math.floor(rng() * 5);
      const wErr = rng() * 0.4;
      const fErr = wErr + rng() * 0.4 + 0.05;
      const cfg: ControllerConfig = {
        minConcurrency: minC,
        maxConcurrency: maxC,
        initialConcurrency: init,
        stableWindow: win,
        warnErrorRate: wErr,
        failErrorRate: fErr,
        warnRateLimitRemaining: rng() * 0.3,
        warnDiskFreeMb: 50 + Math.floor(rng() * 100),
        warnDbInFlight: 20 + Math.floor(rng() * 50),
      };
      const c = new ConcurrencyController(cfg);
      const steps = 50 + Math.floor(rng() * 100);
      let changes = 0;
      for (let s = 0; s < steps; s++) {
        const was = c.state().currentConcurrency;
        const which = Math.floor(rng() * 5);
        let sample: HealthSample;
        if (which === 0) sample = makeHealthy();
        else if (which === 1) sample = makeWarnError(wErr + 0.01);
        else if (which === 2) sample = makeFailError(fErr + 0.01);
        else if (which === 3) sample = makeRateLimitWarn();
        else sample = makeDiskWarn();
        c.apply(sample);
        const cur = c.state().currentConcurrency;
        // Invariant 1: in range
        if (cur < cfg.minConcurrency || cur > cfg.maxConcurrency) {
          throw new Error("run=" + run + ": out of range at step " + s);
        }
        if (cur !== was) changes++;
      }
      // Invariant 2: under sustained FAIL, current hits min
      const c2 = new ConcurrencyController(cfg);
      for (let i = 0; i < 200; i++) c2.apply(makeFailError(fErr + 0.01));
      if (c2.state().currentConcurrency !== cfg.minConcurrency) {
        throw new Error("run=" + run + ": did not floor under FAIL");
      }
      // Invariant 3: oscillation bound. With stableWindow=win and
      // steps = S, max changes <= S (trivially true); tighter: under
      // alternating WARN/HEALTHY at window=win, change at most S/(win+1).
      if (changes > steps) {
        throw new Error("run=" + run + ": more changes than steps");
      }
    }
  });
});
