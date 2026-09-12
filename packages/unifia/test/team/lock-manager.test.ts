import { test, expect, describe, beforeEach } from "bun:test";
import { getDbInMemory, claim, release, heartbeat, validate, recover, forceRelease } from "../../src/team/lock-manager";
import { newLease } from "./helper";

describe("lock-manager.claim — basic invariants", () => {
  let db: ReturnType<typeof getDbInMemory>;
  beforeEach(() => { db = getDbInMemory(); });

  test("claim succeeds with a fresh slot", () => {
    const spec = newLease();
    const r = claim(spec, db);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lease_id).toBe(spec.lease_id);
      expect(r.fencing_token).toBeGreaterThan(0);
      expect(typeof r.expires_at).toBe("string");
    }
  });

  test("first claim assigns token 1", () => {
    const r = claim(newLease({ branch: "c-A/test1" }), db);
    expect(r.ok && r.fencing_token).toBe(1);
  });

  test("subsequent claims assign strictly monotone tokens", () => {
    const r1 = claim(newLease({ branch: "c-A/t1" }), db);
    const r2 = claim(newLease({ branch: "c-A/t2" }), db);
    const r3 = claim(newLease({ branch: "c-A/t3" }), db);
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    if (r1.ok && r2.ok && r3.ok) {
      expect(r2.fencing_token).toBeGreaterThan(r1.fencing_token);
      expect(r3.fencing_token).toBeGreaterThan(r2.fencing_token);
    }
  });

  test("second claim with same branch is rejected", () => {
    const r1 = claim(newLease({ branch: "c-A/same" }), db);
    const r2 = claim(newLease({ branch: "c-A/same" }), db);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("BRANCH_TAKEN");
  });

  test("second claim with same worktree is rejected", () => {
    const r1 = claim(newLease({ worktree: "D:/wt/same" }), db);
    const r2 = claim(newLease({ worktree: "D:/wt/same" }), db);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("WORKTREE_TAKEN");
  });

  test("second claim with same lease_id is rejected", () => {
    const r1 = claim(newLease({ lease_id: "LEASE-X" }), db);
    const r2 = claim(newLease({ lease_id: "LEASE-X" }), db);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("LEASE_TAKEN");
  });

  test("released branch can be re-claimed", () => {
    const spec = newLease({ branch: "c-A/yoyo" });
    const r1 = claim(spec, db);
    expect(r1.ok).toBe(true);
    const rel = release(spec.lease_id, spec.worker_id, "test", db);
    expect(rel.ok).toBe(true);
    const r2 = claim(newLease({ branch: "c-A/yoyo", worker_id: "worker-2" }), db);
    expect(r2.ok).toBe(true);
  });
});

describe("lock-manager.heartbeat", () => {
  let db: ReturnType<typeof getDbInMemory>;
  beforeEach(() => { db = getDbInMemory(); });

  test("heartbeat by owner extends expires_at", async () => {
    const spec = newLease();
    const r = claim(spec, db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expiresBefore = r.expires_at;
    // Wait 50ms then heartbeat.
    await new Promise((r) => setTimeout(r, 50));
    const hb = heartbeat(spec.lease_id, spec.worker_id, db);
    expect(hb.ok).toBe(true);
    if (hb.ok) {
      expect(Date.parse(hb.expires_at)).toBeGreaterThanOrEqual(Date.parse(expiresBefore));
    }
  });

  test("heartbeat by non-owner is rejected", () => {
    const spec = newLease();
    const r = claim(spec, db);
    expect(r.ok).toBe(true);
    const hb = heartbeat(spec.lease_id, "intruder", db);
    expect(hb.ok).toBe(false);
    if (!hb.ok) expect(hb.code).toBe("WORKER_MISMATCH");
  });
});

describe("lock-manager.release", () => {
  let db: ReturnType<typeof getDbInMemory>;
  beforeEach(() => { db = getDbInMemory(); });

  test("release by owner marks RELEASED", () => {
    const spec = newLease();
    const r = claim(spec, db);
    expect(r.ok).toBe(true);
    const rel = release(spec.lease_id, spec.worker_id, "done", db);
    expect(rel.ok).toBe(true);
  });

  test("release by non-owner is rejected", () => {
    const spec = newLease();
    claim(spec, db);
    const rel = release(spec.lease_id, "intruder", "test", db);
    expect(rel.ok).toBe(false);
    if (!rel.ok) expect(rel.code).toBe("WORKER_MISMATCH");
  });

  test("double release is rejected", () => {
    const spec = newLease();
    claim(spec, db);
    release(spec.lease_id, spec.worker_id, "test", db);
    const r2 = release(spec.lease_id, spec.worker_id, "test", db);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("NOT_CLAIMED");
  });
});

describe("lock-manager.validate", () => {
  let db: ReturnType<typeof getDbInMemory>;
  beforeEach(() => { db = getDbInMemory(); });

  test("validate ok for owner with correct token", () => {
    const spec = newLease();
    const r = claim(spec, db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = validate(spec.lease_id, r.fencing_token, db);
    expect(v.ok).toBe(true);
  });

  test("validate rejects stale token", () => {
    const r1 = claim(newLease({ branch: "c-A/v1" }), db);
    const r2 = claim(newLease({ branch: "c-A/v2" }), db);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    const v = validate(newLease({ branch: "c-A/v1" }).lease_id, r1.fencing_token, db);
    // Validate with the stale lease_id but token 1, against a DB with newer leases.
    // The validate call uses lease_id from spec, but the test conflates — re-do:
    // Use r1's lease_id but query with r2's token. Should be TOKEN_STALE.
    const v2 = validate(r1.lease_id, r2.fencing_token - 1, db);
    // The correct staleness case is below.
    void v;
    void v2;
    // Specifically: claim fresh spec1, get token 1. Validate same lease with token 999.
    const spec3 = newLease({ branch: "c-A/v3" });
    const r3 = claim(spec3, db);
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    const stale = validate(spec3.lease_id, 999, db);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("TOKEN_STALE");
  });
});

describe("lock-manager.recover and forceRelease", () => {
  let db: ReturnType<typeof getDbInMemory>;
  beforeEach(() => { db = getDbInMemory(); });

  test("expired leases are swept on recover", () => {
    const spec = newLease({ ttl_seconds: 1 });
    const r = claim(spec, db);
    expect(r.ok).toBe(true);
    // Wait for TTL to elapse.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const rep = recover(db);
        expect(rep.expired).toContain(spec.lease_id);
        resolve();
      }, 1100);
    });
  });

  test("forceRelease requires CLAIMED status", () => {
    const spec = newLease();
    claim(spec, db);
    release(spec.lease_id, spec.worker_id, "test", db);
    const fr = forceRelease(spec.lease_id, "test", "test", db);
    expect(fr.ok).toBe(false);
  });
});
