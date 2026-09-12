import { test, expect, describe, beforeEach } from "bun:test";
import { getDbInMemory } from "../../src/team/lock-manager";
import { readSnapshot, isHighWater, persistGitRef, readGitRef, eraseGitRef } from "../../src/team/fencing";
import { claim } from "../../src/team/lock-manager";
import { newLease, createTempGitRepo } from "./helper";
import { existsSync } from "node:fs";

describe("fencing.readSnapshot", () => {
  test("snapshot starts empty for fresh DB", () => {
    const db = getDbInMemory();
    const s = readSnapshot(db);
    expect(s.high_watermark).toBe(0);
    expect(s.last_lease_id).toBeNull();
  });

  test("snapshot tracks the most recent lease", () => {
    const db = getDbInMemory();
    const r = claim(newLease({ branch: "c-A/f1" }), db);
    expect(r.ok).toBe(true);
    const s = readSnapshot(db);
    expect(s.high_watermark).toBeGreaterThan(0);
    expect(s.last_lease_id).toBeTruthy();
  });
});

describe("fencing.isHighWater", () => {
  test("returns false for a stale token", () => {
    const db = getDbInMemory();
    expect(isHighWater(99, db)).toBe(false);
  });

  test("returns true for the watermark after a claim", () => {
    const db = getDbInMemory();
    const r = claim(newLease({ branch: "c-A/wh" }), db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isHighWater(r.fencing_token, db)).toBe(true);
    expect(isHighWater(r.fencing_token - 1, db)).toBe(false);
  });
});

describe("fencing Git ref (integration with real git)", () => {
  let repo: ReturnType<typeof createTempGitRepo>;
  beforeEach(() => { repo = createTempGitRepo(); });
  test("persistGitRef creates refs/team-fencing/<lease_id>", () => {
    const lease_id = "LEASE-TEST-1";
    const r = persistGitRef(lease_id, 1, repo.path);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ref).toBe(`refs/team-fencing/${lease_id}`);
      expect(r.sha).toMatch(/^[0-9a-f]{40}$/);
    }
    expect(existsSync(`${repo.path}/.git/refs/team-fencing/${lease_id}`)).toBe(true);
  });

  test("eraseGitRef removes the ref", () => {
    const lease_id = "LEASE-TEST-erase";
    persistGitRef(lease_id, 1, repo.path);
    const e = eraseGitRef(lease_id, repo.path);
    expect(e.ok).toBe(true);
    expect(existsSync(`${repo.path}/.git/refs/team-fencing/${lease_id}`)).toBe(false);
  });

  test("readGitRef returns null when absent", () => {
    const r = readGitRef("LEASE-absent", repo.path);
    expect(r).toBeNull();
  });

  test("persistGitRef is deterministic for same token", () => {
    const r1 = persistGitRef("LEASE-d", 42, repo.path);
    const r2 = persistGitRef("LEASE-d", 42, repo.path);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.sha).toBe(r2.sha);
  });

  test("cleanup after each test", () => { repo.cleanup(); });
});

describe("fencing.validate rejects stale token", () => {
  test("issued token is not the high-water after a newer claim", () => {
    const db = getDbInMemory();
    const r1 = claim(newLease({ branch: "c-A/t1" }), db);
    const r2 = claim(newLease({ branch: "c-A/t2" }), db);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(isHighWater(r2.fencing_token, db)).toBe(true);
    expect(isHighWater(r1.fencing_token, db)).toBe(false);
  });
});
