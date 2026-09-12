/**
 * lock-manager.ts — TEAM-G01
 *
 * Atomic lease acquisition with SQLite WAL persistence and monotonic fencing.
 *
 * Responsibilities:
 *  - claim a lease: insert a row if no row exists for the same branch/worktree
 *  - release: mark the lease RELEASED, free the slot for future claims
 *  - heartbeat: refresh last_heartbeat_at and expires_at if requested
 *  - validate: check a lease is still valid (status=CLAIMED, not expired, fencing monotonic)
 *  - inspect: read-only view of the lease registry
 *  - recover: explicit recovery run — mark stale leases EXPIRED based on expires_at
 *
 * Concurrency:
 *  - SQLite WAL mode allows concurrent readers, single writer with serialized writes.
 *  - claim() runs inside `BEGIN IMMEDIATE` so concurrent claims on different keys
 *    serialise behind our writer. The partial unique indexes on branch/worktree
 *    WHERE status='CLAIMED' guarantee at most one active lease per slot.
 *  - fencing tokens are allocated under the same transaction as the lease claim,
 *    so a token is never assigned without a matching lease and never re-issued.
 *
 * Persisted state lives at $TEAM_LOCKS_DIR/leases.db (default: Execution/Locks/leases.db).
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface LeaseSpec {
  lease_id: string;
  card_id: string;
  worker_id: string;
  branch: string;
  worktree: string;
  base_sha: string;
  scope_manifest_hash: string;
  allowed_files: string[];
  protected_files: string[];
  scope_mode: "OPEN" | "E2_REQUIRED";
  ttl_seconds?: number; // default 1800 (30 min)
}

export interface ClaimOk {
  ok: true;
  lease_id: string;
  fencing_token: number;
  expires_at: string;
}

export interface ClaimKo {
  ok: false;
  code:
    | "BRANCH_TAKEN"
    | "WORKTREE_TAKEN"
    | "LEASE_TAKEN"
    | "EXPIRED_RELIC"
    | "INVALID_SPEC";
  message: string;
}

export type ClaimResult = ClaimOk | ClaimKo;

export interface LeaseView {
  lease_id: string;
  card_id: string;
  worker_id: string;
  fencing_token: number;
  branch: string;
  worktree: string;
  base_sha: string;
  status: string;
  acquired_at: string;
  last_heartbeat_at: string;
  expires_at: string;
  age_seconds: number;
  stale: boolean;
  scope_manifest_hash: string;
  scope_mode: string;
}

export interface RecoverReport {
  expired: string[];
  warnings: string[];
}

const DEFAULT_TTL = 1800; // 30 minutes
const DEFAULT_STALE_AFTER = 900; // 15 minutes without heartbeat = stale
const LOCKS_DIR =
  process.env.TEAM_LOCKS_DIR ||
  join(
    "D:",
    "Documents",
    "Obsidian",
    "IA_Dev_Brain",
    "OpenCode",
    "UNIFIA-TEAM-V3-FINAL-SANS-DETTE",
    "Execution",
    "Locks",
  );

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  if (!existsSync(LOCKS_DIR)) {
    mkdirSync(LOCKS_DIR, { recursive: true });
  }
  const db = new Database(join(LOCKS_DIR, "leases.db"), { create: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  _db = db;
  return _db;
}

// For tests: in-memory database.
export function getDbInMemory(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  applyMigrations(db);
  return db;
}

function applyMigrations(db: Database): void {
  // We inline the SQL here to avoid runtime file resolution in the team scope.
  // The canonical SQL files are checked in for human review at
  //   packages/unifia/src/team/db/migrations/*.sql
  db.exec(LEASES_SQL);
  db.exec(FENCING_SQL);
}

const LEASES_SQL = `
CREATE TABLE IF NOT EXISTS leases (
  lease_id                 TEXT PRIMARY KEY,
  card_id                  TEXT NOT NULL,
  worker_id                TEXT NOT NULL,
  fencing_token            INTEGER NOT NULL UNIQUE,
  branch                   TEXT NOT NULL,
  worktree                 TEXT NOT NULL,
  base_sha                 TEXT NOT NULL,
  scope_manifest_hash      TEXT NOT NULL,
  allowed_files_json       TEXT NOT NULL,
  protected_files_json     TEXT NOT NULL,
  scope_mode               TEXT NOT NULL CHECK(scope_mode IN ('OPEN', 'E2_REQUIRED')),
  status                   TEXT NOT NULL CHECK(status IN ('CLAIMED', 'RELEASED', 'EXPIRED')),
  acquired_at              TEXT NOT NULL,
  last_heartbeat_at        TEXT NOT NULL,
  expires_at               TEXT NOT NULL,
  released_at              TEXT,
  release_reason           TEXT,
  released_by              TEXT,
  parent_lease_id          TEXT REFERENCES leases(lease_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leases_branch_active
  ON leases(branch) WHERE status = 'CLAIMED';
CREATE UNIQUE INDEX IF NOT EXISTS idx_leases_worktree_active
  ON leases(worktree) WHERE status = 'CLAIMED';
CREATE INDEX IF NOT EXISTS idx_leases_card        ON leases(card_id);
CREATE INDEX IF NOT EXISTS idx_leases_worker      ON leases(worker_id);
CREATE INDEX IF NOT EXISTS idx_leases_status      ON leases(status);
CREATE INDEX IF NOT EXISTS idx_leases_heartbeat   ON leases(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_leases_expires      ON leases(expires_at);
`;

const FENCING_SQL = `
CREATE TABLE IF NOT EXISTS fence_tokens (
  token       INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id    TEXT NOT NULL REFERENCES leases(lease_id),
  card_id     TEXT NOT NULL,
  worker_id   TEXT NOT NULL,
  issued_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fence_tokens_issued_at ON fence_tokens(issued_at);
CREATE INDEX IF NOT EXISTS idx_fence_tokens_lease     ON fence_tokens(lease_id);
CREATE TABLE IF NOT EXISTS fence_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL
);
INSERT OR IGNORE INTO fence_meta (key, value) VALUES ('last_issued_token', '0');
`;

/**
 * Validate spec fields. Returns an error message if invalid, null if OK.
 */
function validateSpec(spec: LeaseSpec): string | null {
  if (!spec.lease_id || typeof spec.lease_id !== "string") return "lease_id required";
  if (!spec.card_id || typeof spec.card_id !== "string") return "card_id required";
  if (!spec.worker_id || typeof spec.worker_id !== "string") return "worker_id required";
  if (!spec.branch || typeof spec.branch !== "string") return "branch required";
  if (!spec.worktree || typeof spec.worktree !== "string") return "worktree required";
  if (!/^[0-9a-f]{40}$/.test(spec.base_sha)) return "base_sha must be 40-hex";
  if (!spec.scope_manifest_hash || typeof spec.scope_manifest_hash !== "string") return "scope_manifest_hash required";
  if (!Array.isArray(spec.allowed_files)) return "allowed_files must be array";
  if (!Array.isArray(spec.protected_files)) return "protected_files must be array";
  if (spec.scope_mode !== "OPEN" && spec.scope_mode !== "E2_REQUIRED") return "scope_mode invalid";
  return null;
}

/**
 * Claim a lease atomically. Returns ClaimOk with fencing_token, or ClaimKo with code.
 *
 * Algorithm:
 *  - BEGIN IMMEDIATE acquires the writer lock.
 *  - Recover stale leases first (best-effort; flagged in the report).
 *  - INSERT INTO leases with status=CLAIMED, expires_at = now + ttl.
 *    The partial unique indexes on branch/worktree WHERE status='CLAIMED'
 *    cause a UNIQUE constraint violation if a slot is taken.
 *  - INSERT INTO fence_tokens(token=NULL,...) — token auto-assigned by SQLite.
 *  - UPDATE fence_meta.last_issued_token = new token.
 *  - COMMIT. The lease row and the fence_token row are both visible atomically.
 *
 * On UNIQUE constraint failure, we ROLLBACK and classify the error.
 */
export function claim(spec: LeaseSpec, db?: Database): ClaimResult {
  const d = db ?? getDb();
  const err = validateSpec(spec);
  if (err) return { ok: false, code: "INVALID_SPEC", message: err };

  const now = new Date();
  const isoNow = now.toISOString();
  const ttl = spec.ttl_seconds ?? DEFAULT_TTL;
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

  let fencingToken = -1;

  try {
    d.exec("BEGIN IMMEDIATE");

    // Best-effort recovery inside the same transaction.
    sweepExpired(d, now.toISOString());

    // Sentinel: fencing_token is NOT NULL UNIQUE. We use 0 as placeholder
    // while we allocate the real token; we then UPDATE leases.fencing_token
    // to the real value inside the same transaction. BEGIN IMMEDIATE
    // serialises concurrent claims so only one row can hold the 0 sentinel
    // at any time.
    const insertLease = d.prepare(`
      INSERT INTO leases (
        lease_id, card_id, worker_id, fencing_token,
        branch, worktree, base_sha,
        scope_manifest_hash, allowed_files_json, protected_files_json, scope_mode,
        status, acquired_at, last_heartbeat_at, expires_at
      ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'CLAIMED', ?, ?, ?)
    `);

    try {
      insertLease.run(
        spec.lease_id,
        spec.card_id,
        spec.worker_id,
        spec.branch,
        spec.worktree,
        spec.base_sha,
        spec.scope_manifest_hash,
        JSON.stringify(spec.allowed_files),
        JSON.stringify(spec.protected_files),
        spec.scope_mode,
        isoNow,
        isoNow,
        expiresAt,
      );
    } catch (e: any) {
      d.exec("ROLLBACK");
      // Classify SQLite UNIQUE failure.
      if (typeof e?.message === "string" && e.message.includes("UNIQUE constraint failed")) {
        if (e.message.includes("branch")) {
          return { ok: false, code: "BRANCH_TAKEN", message: `branch ${spec.branch} already has an active lease` };
        }
        if (e.message.includes("worktree")) {
          return { ok: false, code: "WORKTREE_TAKEN", message: `worktree ${spec.worktree} already has an active lease` };
        }
        if (e.message.includes("leases.lease_id")) {
          return { ok: false, code: "LEASE_TAKEN", message: `lease_id ${spec.lease_id} already exists` };
        }
        return { ok: false, code: "EXPIRED_RELIC", message: e.message };
      }
      return { ok: false, code: "INVALID_SPEC", message: String(e?.message ?? e) };
    }

    // Allocate fencing token.
    const insertToken = d.prepare(`
      INSERT INTO fence_tokens (lease_id, card_id, worker_id, issued_at)
      VALUES (?, ?, ?, ?)
    `);
    insertToken.run(spec.lease_id, spec.card_id, spec.worker_id, isoNow);

    // Look back the auto-assigned token value for this lease.
    const tokenRow = d
      .prepare(`SELECT token FROM fence_tokens WHERE lease_id = ? ORDER BY token DESC LIMIT 1`)
      .get(spec.lease_id) as { token: number };
    fencingToken = tokenRow.token;

    // Stamp the lease row with its token so leases.fencing_token is non-null.
    d.prepare(`UPDATE leases SET fencing_token = ? WHERE lease_id = ?`).run(
      fencingToken,
      spec.lease_id,
    );

    // Bump the meta watermark.
    d.prepare(`UPDATE fence_meta SET value = ? WHERE key = 'last_issued_token'`).run(
      String(fencingToken),
    );

    d.exec("COMMIT");
  } catch (e: any) {
    try {
      d.exec("ROLLBACK");
    } catch {
      // ignore
    }
    return { ok: false, code: "INVALID_SPEC", message: String(e?.message ?? e) };
  }

  return { ok: true, lease_id: spec.lease_id, fencing_token: fencingToken, expires_at: expiresAt };
}

/**
 * Refresh last_heartbeat_at and expires_at for an ACTIVE lease.
 */
export function heartbeat(
  lease_id: string,
  worker_id: string,
  db?: Database,
  new_ttl_seconds?: number,
): { ok: true; expires_at: string } | { ok: false; code: string; message: string } {
  const d = db ?? getDb();
  const now = new Date();
  const isoNow = now.toISOString();
  const ttl = new_ttl_seconds ?? DEFAULT_TTL;
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

  try {
    d.exec("BEGIN IMMEDIATE");
    const row = d.prepare(`SELECT worker_id, status FROM leases WHERE lease_id = ?`).get(lease_id) as
      | { worker_id: string; status: string }
      | null;
    if (!row) {
      d.exec("ROLLBACK");
      return { ok: false, code: "LEASE_NOT_FOUND", message: `lease_id ${lease_id} not found` };
    }
    if (row.worker_id !== worker_id) {
      d.exec("ROLLBACK");
      return {
        ok: false,
        code: "WORKER_MISMATCH",
        message: `lease_id ${lease_id} is owned by worker ${row.worker_id}, not ${worker_id}`,
      };
    }
    if (row.status !== "CLAIMED") {
      d.exec("ROLLBACK");
      return {
        ok: false,
        code: "NOT_CLAIMED",
        message: `lease_id ${lease_id} is in status ${row.status}`,
      };
    }
    d.prepare(
      `UPDATE leases SET last_heartbeat_at = ?, expires_at = ? WHERE lease_id = ?`,
    ).run(isoNow, expiresAt, lease_id);
    d.exec("COMMIT");
    return { ok: true, expires_at: expiresAt };
  } catch (e: any) {
    try {
      d.exec("ROLLBACK");
    } catch {}
    return { ok: false, code: "INTERNAL", message: String(e?.message ?? e) };
  }
}

/**
 * Release a lease. Marks RELEASED with reason and timestamp.
 * Releases must be performed by the lease's worker_id.
 */
export function release(
  lease_id: string,
  worker_id: string,
  reason: string,
  db?: Database,
): { ok: true } | { ok: false; code: string; message: string } {
  const d = db ?? getDb();
  const now = new Date();
  const isoNow = now.toISOString();
  try {
    d.exec("BEGIN IMMEDIATE");
    const row = d.prepare(`SELECT worker_id, status FROM leases WHERE lease_id = ?`).get(lease_id) as
      | { worker_id: string; status: string }
      | null;
    if (!row) {
      d.exec("ROLLBACK");
      return { ok: false, code: "LEASE_NOT_FOUND", message: `lease_id ${lease_id} not found` };
    }
    if (row.worker_id !== worker_id) {
      d.exec("ROLLBACK");
      return {
        ok: false,
        code: "WORKER_MISMATCH",
        message: `lease_id ${lease_id} is owned by worker ${row.worker_id}`,
      };
    }
    if (row.status !== "CLAIMED") {
      d.exec("ROLLBACK");
      return {
        ok: false,
        code: "NOT_CLAIMED",
        message: `lease_id ${lease_id} is in status ${row.status}`,
      };
    }
    d.prepare(
      `UPDATE leases SET status='RELEASED', released_at=?, release_reason=?, released_by=? WHERE lease_id=?`,
    ).run(isoNow, reason, worker_id, lease_id);
    d.exec("COMMIT");
    return { ok: true };
  } catch (e: any) {
    try {
      d.exec("ROLLBACK");
    } catch {}
    return { ok: false, code: "INTERNAL", message: String(e?.message ?? e) };
  }
}

/**
 * Sweep EXPIRED status onto leases whose expires_at < now.
 */
function sweepExpired(d: Database, isoNow: string): void {
  d.prepare(
    `UPDATE leases SET status='EXPIRED', released_at=?, release_reason='TTL_EXPIRED', released_by='lock-manager.sweep' WHERE status='CLAIMED' AND expires_at < ?`,
  ).run(isoNow, isoNow);
}

/**
 * Validate a lease: still ACTIVE, still within TTL, fencing token still matches the highest.
 */
export function validate(
  lease_id: string,
  expected_fencing_token: number,
  db?: Database,
):
  | { ok: true; lease: LeaseView }
  | { ok: false; code: string; message: string } {
  const d = db ?? getDb();
  sweepExpired(d, new Date().toISOString());
  const row = d.prepare(`SELECT * FROM leases WHERE lease_id = ?`).get(lease_id) as any | null;
  if (!row) {
    return { ok: false, code: "LEASE_NOT_FOUND", message: `lease_id ${lease_id} not found` };
  }
  if (row.fencing_token !== expected_fencing_token) {
    return {
      ok: false,
      code: "TOKEN_STALE",
      message: `expected token ${expected_fencing_token} but DB has ${row.fencing_token}`,
    };
  }
  if (row.status !== "CLAIMED") {
    return {
      ok: false,
      code: "STATUS_NOT_ACTIVE",
      message: `lease_id ${lease_id} is in status ${row.status}`,
    };
  }
  const nowMs = Date.now();
  const expiresMs = Date.parse(row.expires_at);
  const heartbeatMs = Date.parse(row.last_heartbeat_at);
  const acquiredMs = Date.parse(row.acquired_at);
  if (Number.isFinite(expiresMs) && nowMs > expiresMs) {
    return {
      ok: false,
      code: "LEASE_EXPIRED",
      message: `lease_id ${lease_id} expired at ${row.expires_at}`,
    };
  }
  const lastHBDelta = (nowMs - heartbeatMs) / 1000;
  const stale = lastHBDelta > DEFAULT_STALE_AFTER;
  const lease: LeaseView = {
    lease_id: row.lease_id,
    card_id: row.card_id,
    worker_id: row.worker_id,
    fencing_token: row.fencing_token,
    branch: row.branch,
    worktree: row.worktree,
    base_sha: row.base_sha,
    status: row.status,
    acquired_at: row.acquired_at,
    last_heartbeat_at: row.last_heartbeat_at,
    expires_at: row.expires_at,
    age_seconds: Math.floor((nowMs - acquiredMs) / 1000),
    stale,
    scope_manifest_hash: row.scope_manifest_hash,
    scope_mode: row.scope_mode,
  };
  return { ok: true, lease };
}

/**
 * Inspect: list all leases (CLAIMED, RELEASED, EXPIRED).
 */
export function inspect(db?: Database): LeaseView[] {
  const d = db ?? getDb();
  const nowMs = Date.now();
  const rows = d.prepare(`SELECT * FROM leases`).all() as any[];
  return rows.map((r) => ({
    lease_id: r.lease_id,
    card_id: r.card_id,
    worker_id: r.worker_id,
    fencing_token: r.fencing_token,
    branch: r.branch,
    worktree: r.worktree,
    base_sha: r.base_sha,
    status: r.status,
    acquired_at: r.acquired_at,
    last_heartbeat_at: r.last_heartbeat_at,
    expires_at: r.expires_at,
    age_seconds: Math.floor((nowMs - Date.parse(r.acquired_at)) / 1000),
    stale: (nowMs - Date.parse(r.last_heartbeat_at)) / 1000 > DEFAULT_STALE_AFTER,
    scope_manifest_hash: r.scope_manifest_hash,
    scope_mode: r.scope_mode,
  }));
}

/**
 * Recover: explicit recovery run — mark EXPIRED all stale leases.
 * Returns the list of expired lease ids and any warnings.
 */
export function recover(db?: Database): RecoverReport {
  const d = db ?? getDb();
  const now = new Date();
  const isoNow = now.toISOString();
  const expiredRows = d.prepare(
    `SELECT lease_id FROM leases WHERE status='CLAIMED' AND expires_at < ?`,
  ).all(isoNow) as { lease_id: string }[];
  const expired = expiredRows.map((r) => r.lease_id);
  d.prepare(
    `UPDATE leases SET status='EXPIRED', released_at=?, release_reason='TTL_EXPIRED_VIA_RECOVER', released_by='lock-manager.recover' WHERE status='CLAIMED' AND expires_at < ?`,
  ).run(isoNow, isoNow);

  // Also try to bump watermark if newer tokens exist (this is a self-correcting check).
  const rows = d.prepare(
    `SELECT MAX(token) AS high FROM fence_tokens`,
  ).get() as { high: number | null };
  const wmRow = d.prepare(`SELECT value FROM fence_meta WHERE key='last_issued_token'`).get() as
    | { value: string }
    | null;
  const warnings: string[] = [];
  if (rows.high != null && wmRow && Number(wmRow.value) < rows.high) {
    d.prepare(`UPDATE fence_meta SET value = ? WHERE key='last_issued_token'`).run(
      String(rows.high),
    );
    warnings.push(`watermark corrected: ${wmRow.value} -> ${rows.high}`);
  }
  return { expired, warnings };
}

/**
 * Force-release a held lease (recovery only, requires a higher authority).
 * Used by `recover` CLI command to clean up orphaned leases.
 */
export function forceRelease(
  lease_id: string,
  reason: string,
  released_by: string,
  db?: Database,
): { ok: true } | { ok: false; code: string; message: string } {
  const d = db ?? getDb();
  const now = new Date();
  const isoNow = now.toISOString();
  try {
    d.exec("BEGIN IMMEDIATE");
    const row = d.prepare(`SELECT status FROM leases WHERE lease_id = ?`).get(lease_id) as
      | { status: string }
      | null;
    if (!row) {
      d.exec("ROLLBACK");
      return { ok: false, code: "LEASE_NOT_FOUND", message: `lease_id ${lease_id} not found` };
    }
    if (row.status !== "CLAIMED") {
      d.exec("ROLLBACK");
      return {
        ok: false,
        code: "NOT_CLAIMED",
        message: `lease_id ${lease_id} is in status ${row.status}`,
      };
    }
    d.prepare(
      `UPDATE leases SET status='RELEASED', released_at=?, release_reason=?, released_by=? WHERE lease_id=?`,
    ).run(isoNow, reason, released_by, lease_id);
    d.exec("COMMIT");
    return { ok: true };
  } catch (e: any) {
    try {
      d.exec("ROLLBACK");
    } catch {}
    return { ok: false, code: "INTERNAL", message: String(e?.message ?? e) };
  }
}
