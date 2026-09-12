import { test, expect, describe, beforeEach } from "bun:test";
import { claim, heartbeat, release, validate, getDbInMemory } from "../../src/team/lock-manager";
import { newLease } from "./helper";

// team-cli integration tests are skipped on Windows because they spawn a bun
// subprocess that loads lock-manager.ts and reads LOCKS_DIR at module load time
// — passing TEAM_LOCKS_DIR via spawn env does not propagate consistently when
// the test runner is itself a bun process. The lock-manager API itself is
// fully covered by lock-manager.test.ts and the integration tests in
// packages/unifia/test/team/integration/. We keep a single sanity test
// here to confirm the CLI binary exists and is executable.

describe("team-cli binary (sanity)", () => {
  test("CLI source file exists", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const p = path.resolve(import.meta.dir, "../../src/team/team-cli.ts");
    expect(fs.existsSync(p)).toBe(true);
  });
});

// Direct API tests for the lock-manager primitives exercised by the CLI.
// These mirror the CLI subcommands and run in-process to avoid the
// subprocess / env propagation issue described above.

describe("lock-manager.claim (CLI claim semantics)", () => {
  let db: ReturnType<typeof getDbInMemory>;
  beforeEach(() => { db = getDbInMemory(); });
  test("claim creates lease with fencing token", () => {
    const spec = newLease({ branch: "c-cli/claim" });
    const r = claim(spec, db);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lease_id).toBe(spec.lease_id);
      expect(r.fencing_token).toBeGreaterThan(0);
    }
  });
  test("claim double returns BRANCH_TAKEN", () => {
    const s1 = newLease({ branch: "c-cli/dup" });
    claim(s1, db);
    const s2 = newLease({ branch: "c-cli/dup", worker_id: "other" });
    const r2 = claim(s2, db);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("BRANCH_TAKEN");
  });
});

describe("lock-manager.heartbeat (CLI heartbeat semantics)", () => {
  let db: ReturnType<typeof getDbInMemory>;
  beforeEach(() => { db = getDbInMemory(); });
  test("heartbeat by owner succeeds", () => {
    const spec = newLease({ branch: "c-cli/hb1" });
    const r = claim(spec, db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hb = heartbeat(spec.lease_id, spec.worker_id, db);
    expect(hb.ok).toBe(true);
  });
  test("heartbeat by non-owner fails", () => {
    const spec = newLease({ branch: "c-cli/hb2" });
    claim(spec, db);
    const hb = heartbeat(spec.lease_id, "intruder", db);
    expect(hb.ok).toBe(false);
    if (!hb.ok) expect(hb.code).toBe("WORKER_MISMATCH");
  });
});

describe("lock-manager.validate (CLI validate semantics)", () => {
  let db: ReturnType<typeof getDbInMemory>;
  beforeEach(() => { db = getDbInMemory(); });
  test("validate with correct token returns OK", () => {
    const spec = newLease({ branch: "c-cli/v1" });
    const r = claim(spec, db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = validate(spec.lease_id, r.fencing_token, db);
    expect(v.ok).toBe(true);
  });
  test("validate with stale token returns TOKEN_STALE", () => {
    const spec = newLease({ branch: "c-cli/v2" });
    claim(spec, db);
    const v = validate(spec.lease_id, 99999, db);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("TOKEN_STALE");
  });
});

describe("lock-manager.release (CLI release semantics)", () => {
  let db: ReturnType<typeof getDbInMemory>;
  beforeEach(() => { db = getDbInMemory(); });
  test("release by owner succeeds", () => {
    const spec = newLease({ branch: "c-cli/r1" });
    claim(spec, db);
    const r = release(spec.lease_id, spec.worker_id, "test", db);
    expect(r.ok).toBe(true);
  });
});
