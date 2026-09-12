/**
 * concurrency-controller.ts — TEAM-K03
 *
 * Adaptive concurrency controller: maintains a current concurrency level
 * between `minConcurrency` and `maxConcurrency`, raising it when health
 * signals stay healthy and lowering it (BEFORE failure, not after) when
 * the signal degrades. The controller applies hysteresis so the level
 * cannot oscillate every sample — a change requires `stableWindow`
 * consecutive agreeing samples.
 *
 * Why this lives in the scheduler and not in the runtime: the runtime
 * is what owns the actual in-flight task counts; this module is the
 * pure policy function the runtime consults to decide what concurrency
 * it should AIM for next. The runtime is responsible for gracefully
 * draining excess tasks; the controller does not kill anything, it
 * only returns the new target.
 *
 * Design notes:
 *
 *   - "Reduce before failure" means: when the health signal crosses the
 *     WARN threshold (which is set strictly above the FAIL threshold),
 *     the controller lowers concurrency so the system never reaches a
 *     state where it would actually fail. This is the back-pressure
 *     contract.
 *
 *   - "No guarantee weakening" means: minConcurrency is a hard floor.
 *     The controller will never go below it, even under sustained
 *     degradation. If the system cannot operate at minConcurrency,
 *     the runtime escalates to a human gate (out of scope here).
 *
 *   - Hysteresis is computed as a counter of consecutive same-direction
 *     samples; the level only changes when the counter reaches
 *     `stableWindow`. This bounds oscillation to `1 / stableWindow` per
 *     unit time under alternating signals.
 *
 *   - The module is pure: it owns no clock, no I/O, no network. The
 *     caller supplies the health sample; the controller returns the
 *     next target concurrency.
 */

export const CONCURRENCY_CONTROLLER_SCHEMA_VERSION = "1.0.0" as const;

/**
 * The health signal observed at one sample. All fields are normalised
 * to [0, 1] (or to absolute counts in the integer fields) so the
 * thresholds can be expressed in the same units across providers.
 */
export interface HealthSample {
  /** Sustained error rate in [0, 1]. 0 = no errors, 1 = all requests fail. */
  readonly errorRate: number;
  /** Remaining rate-limit headroom in [0, 1]. 0 = saturated, 1 = idle. */
  readonly rateLimitRemaining: number;
  /** Free disk in megabytes. 0 means disk full. */
  readonly diskFreeMb: number;
  /** In-flight DB connections currently held. */
  readonly dbInFlight: number;
}

export interface ControllerConfig {
  readonly minConcurrency: number;
  readonly maxConcurrency: number;
  /** Initial concurrency at construction. Must lie in [min, max]. */
  readonly initialConcurrency: number;
  /**
   * Number of consecutive same-direction samples required to change
   * the level. Must be >= 1.
   */
  readonly stableWindow: number;
  /** Error rate above which we WARN. Strictly below the FAIL threshold. */
  readonly warnErrorRate: number;
  /** Error rate at which we treat the system as failing. */
  readonly failErrorRate: number;
  /** Rate-limit headroom below which we WARN. */
  readonly warnRateLimitRemaining: number;
  /** Disk free (MB) below which we WARN. */
  readonly warnDiskFreeMb: number;
  /** DB in-flight above which we WARN. */
  readonly warnDbInFlight: number;
}

export interface ControllerState {
  readonly currentConcurrency: number;
  readonly consecutiveDegrade: number;
  readonly consecutiveHealthy: number;
  readonly totalDegradeEvents: number;
  readonly totalIncreaseEvents: number;
  readonly lastSignal: "HEALTHY" | "WARN" | "FAIL" | null;
}

export class ConcurrencyControllerInputError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyControllerInputError";
  }
}

function classify(s: HealthSample, cfg: ControllerConfig): "HEALTHY" | "WARN" | "FAIL" {
  if (s.errorRate >= cfg.failErrorRate) return "FAIL";
  if (s.errorRate >= cfg.warnErrorRate) return "WARN";
  if (s.rateLimitRemaining <= cfg.warnRateLimitRemaining) return "WARN";
  if (s.diskFreeMb <= cfg.warnDiskFreeMb) return "WARN";
  if (s.dbInFlight >= cfg.warnDbInFlight) return "WARN";
  return "HEALTHY";
}

function validateConfig(cfg: ControllerConfig): void {
  if (!Number.isInteger(cfg.minConcurrency) || cfg.minConcurrency < 1) {
    throw new ConcurrencyControllerInputError("minConcurrency must be a positive integer");
  }
  if (!Number.isInteger(cfg.maxConcurrency) || cfg.maxConcurrency < cfg.minConcurrency) {
    throw new ConcurrencyControllerInputError(
      "maxConcurrency must be an integer >= minConcurrency",
    );
  }
  if (!Number.isInteger(cfg.initialConcurrency)) {
    throw new ConcurrencyControllerInputError("initialConcurrency must be an integer");
  }
  if (
    cfg.initialConcurrency < cfg.minConcurrency ||
    cfg.initialConcurrency > cfg.maxConcurrency
  ) {
    throw new ConcurrencyControllerInputError(
      "initialConcurrency must lie within [minConcurrency, maxConcurrency]",
    );
  }
  if (!Number.isInteger(cfg.stableWindow) || cfg.stableWindow < 1) {
    throw new ConcurrencyControllerInputError("stableWindow must be a positive integer");
  }
  for (const [name, v] of [
    ["warnErrorRate", cfg.warnErrorRate],
    ["failErrorRate", cfg.failErrorRate],
    ["warnRateLimitRemaining", cfg.warnRateLimitRemaining],
  ] as const) {
    if (!(v >= 0 && v <= 1)) {
      throw new ConcurrencyControllerInputError(name + " must lie in [0, 1]");
    }
  }
  if (cfg.warnErrorRate >= cfg.failErrorRate) {
    throw new ConcurrencyControllerInputError(
      "warnErrorRate must be strictly below failErrorRate",
    );
  }
  if (cfg.warnDiskFreeMb < 0) {
    throw new ConcurrencyControllerInputError("warnDiskFreeMb must be >= 0");
  }
  if (cfg.warnDbInFlight < 0) {
    throw new ConcurrencyControllerInputError("warnDbInFlight must be >= 0");
  }
}

function validateSample(s: HealthSample): void {
  if (!(s.errorRate >= 0 && s.errorRate <= 1)) {
    throw new ConcurrencyControllerInputError("errorRate must lie in [0, 1]");
  }
  if (!(s.rateLimitRemaining >= 0 && s.rateLimitRemaining <= 1)) {
    throw new ConcurrencyControllerInputError("rateLimitRemaining must lie in [0, 1]");
  }
  if (!Number.isFinite(s.diskFreeMb) || s.diskFreeMb < 0) {
    throw new ConcurrencyControllerInputError("diskFreeMb must be >= 0 and finite");
  }
  if (!Number.isInteger(s.dbInFlight) || s.dbInFlight < 0) {
    throw new ConcurrencyControllerInputError("dbInFlight must be a non-negative integer");
  }
}

export class ConcurrencyController {
  private current: number;
  private consecutiveDegrade = 0;
  private consecutiveHealthy = 0;
  private totalDegradeEvents = 0;
  private totalIncreaseEvents = 0;
  private lastSignal: "HEALTHY" | "WARN" | "FAIL" | null = null;

  constructor(private readonly cfg: ControllerConfig) {
    validateConfig(cfg);
    this.current = cfg.initialConcurrency;
  }

  /**
   * Apply one health sample and return the new target concurrency.
   * Pure: does not mutate the input, does not consult any clock.
   */
  apply(s: HealthSample): number {
    validateSample(s);
    const sig = classify(s, this.cfg);
    if (sig === "HEALTHY") {
      this.consecutiveHealthy++;
      this.consecutiveDegrade = 0;
      if (
        this.lastSignal !== "HEALTHY" ||
        this.consecutiveHealthy >= this.cfg.stableWindow
      ) {
        if (this.consecutiveHealthy >= this.cfg.stableWindow && this.current < this.cfg.maxConcurrency) {
          this.current++;
          this.totalIncreaseEvents++;
          this.consecutiveHealthy = 0;
        }
      }
    } else {
      this.consecutiveDegrade++;
      this.consecutiveHealthy = 0;
      if (this.consecutiveDegrade >= this.cfg.stableWindow && this.current > this.cfg.minConcurrency) {
        const step = sig === "FAIL" ? Math.max(1, this.current - this.cfg.minConcurrency) : 1;
        this.current = Math.max(this.cfg.minConcurrency, this.current - step);
        if (sig === "FAIL") {
          this.current = this.cfg.minConcurrency;
        }
        this.totalDegradeEvents++;
        this.consecutiveDegrade = 0;
      }
    }
    this.lastSignal = sig;
    return this.current;
  }

  state(): ControllerState {
    return {
      currentConcurrency: this.current,
      consecutiveDegrade: this.consecutiveDegrade,
      consecutiveHealthy: this.consecutiveHealthy,
      totalDegradeEvents: this.totalDegradeEvents,
      totalIncreaseEvents: this.totalIncreaseEvents,
      lastSignal: this.lastSignal,
    };
  }

  /**
   * Floor: the controller's monotonic lower bound. The runtime can use
   * this to decide whether escalation is needed (when current hits
   * floor under sustained degradation).
   */
  floor(): number {
    return this.cfg.minConcurrency;
  }

  ceiling(): number {
    return this.cfg.maxConcurrency;
  }
}
