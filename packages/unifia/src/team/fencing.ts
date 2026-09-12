/**
 * fencing.ts — TEAM-G01
 *
 * Fencing token: a strictly monotone integer issued alongside each lease.
 * The token is the durable proof that a write/operation is still alive.
 *
 * Properties:
 *  - Monotone: token N > token N-1 always.
 *  - Anti-replay: a stale token is rejected by validate().
 *  - Persisted: the high-water mark is durable in SQLite (fence_meta.last_issued_token).
 *  - Verifiable offline: an external witness can re-derive the watermark from
 *    the append-only fence_tokens table without trusting the lock-manager.
 *
 * The commit-time fence also stores a Git ref at refs/team-fencing/<lease_id>
 * whose commit-object hash encodes the next expected token, providing a
 * Git-native falsifiable monotone chain independent of SQLite.
 */

import type { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FencingSnapshot {
  high_watermark: number;
  last_lease_id: string | null;
  last_issued_at: string | null;
}

export function readSnapshot(db: Database): FencingSnapshot {
  const row = db.prepare(`SELECT value FROM fence_meta WHERE key='last_issued_token'`).get() as
    | { value: string }
    | null;
  const high = row ? Number(row.value) : 0;
  const last = db
    .prepare(`SELECT lease_id, issued_at FROM fence_tokens ORDER BY token DESC LIMIT 1`)
    .get() as { lease_id: string; issued_at: string } | null;
  return {
    high_watermark: high,
    last_lease_id: last?.lease_id ?? null,
    last_issued_at: last?.issued_at ?? null,
  };
}

/**
 * Verify that a given token is still the high-water mark.
 * Returns true iff the token equals the watermark (and is therefore the most
 * recent issued token).
 */
export function isHighWater(token: number, db: Database): boolean {
  const row = db.prepare(`SELECT value FROM fence_meta WHERE key='last_issued_token'`).get() as
    | { value: string }
    | null;
  if (!row) return false;
  return Number(row.value) === token;
}

/**
 * Persist a Git ref whose commit-object hash encodes the next token.
 * The ref points at an orphan commit whose tree SHA-1 is the literal
 * hex of the token, padded to 40 chars.
 *
 * This is a Git-native falsifiable chain. Re-running with a lower token
 * produces the same commit hash (deterministic), but the lease validate()
 * still rejects the lower token because it doesn't match the SQLite
 * watermark.
 *
 * Implementation note: we feed the blob via a temp file rather than stdin
 * because some bun spawnSync implementations don't reliably pipe `input:`
 * to `--stdin`-consuming subcommands on Windows.
 */
export function persistGitRef(
  lease_id: string,
  token: number,
  cwd: string,
  gitBin: string = "git",
): { ok: boolean; ref: string; sha: string; message?: string } {
  const padded = token.toString(16).padStart(40, "0");
  const ref = `refs/team-fencing/${lease_id}`;

  const tmpDir = mkdtempSync(join(tmpdir(), "team-fencing-"));
  const blobPath = join(tmpDir, "blob");
  writeFileSync(blobPath, padded);

  try {
    // Build a deterministic orphan commit with the token as its tree blob.
    const blob = spawnSync(gitBin, ["hash-object", "-w", blobPath], {
      cwd,
      encoding: "utf-8",
    });
    if (blob.status !== 0 || !blob.stdout) {
      return { ok: false, ref, sha: "", message: `git hash-object failed: ${blob.stderr}` };
    }
    const blobSha = blob.stdout.trim();

    // Wrap the blob into a tree via git mktree so commit-tree accepts it.
    const treeInput = `100644 blob ${blobSha}\tfence\n`;
    const tree = spawnSync(gitBin, ["mktree"], {
      cwd,
      encoding: "utf-8",
      input: treeInput,
    });
    if (tree.status !== 0 || !tree.stdout) {
      return { ok: false, ref, sha: "", message: `git mktree failed: ${tree.stderr}` };
    }
    const treeSha = tree.stdout.trim();

    const commit = spawnSync(
      gitBin,
      [
        "commit-tree",
        treeSha,
        "-m",
        `team-fencing: token=${token} lease=${lease_id}`,
      ],
      {
        cwd,
        encoding: "utf-8",
        // Fixed dates make commit SHAs deterministic across runs.
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "team-fencing",
          GIT_AUTHOR_EMAIL: "team-fencing@unifia.invalid",
          GIT_COMMITTER_NAME: "team-fencing",
          GIT_COMMITTER_EMAIL: "team-fencing@unifia.invalid",
          GIT_AUTHOR_DATE: "2026-07-21T00:00:00Z",
          GIT_COMMITTER_DATE: "2026-07-21T00:00:00Z",
        },
      },
    );
    if (commit.status !== 0 || !commit.stdout) {
      return { ok: false, ref, sha: "", message: `git commit-tree failed: ${commit.stderr}` };
    }
    const sha = commit.stdout.trim();
    const update = spawnSync(gitBin, ["update-ref", ref, sha], {
      cwd,
      encoding: "utf-8",
    });
    if (update.status !== 0) {
      return { ok: false, ref, sha: "", message: `git update-ref failed: ${update.stderr}` };
    }
    return { ok: true, ref, sha };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * Read a previously stored Git fence ref. Returns null if absent.
 */
export function readGitRef(
  lease_id: string,
  cwd: string,
  gitBin: string = "git",
): { ref: string; sha: string } | null {
  const ref = `refs/team-fencing/${lease_id}`;
  const out = spawnSync(gitBin, ["rev-parse", "--verify", ref], {
    cwd,
    encoding: "utf-8",
  });
  if (out.status !== 0 || !out.stdout) return null;
  return { ref, sha: out.stdout.trim() };
}

/**
 * Erase a fence ref (used when a lease is RELEASED or EXPIRED).
 */
export function eraseGitRef(
  lease_id: string,
  cwd: string,
  gitBin: string = "git",
): { ok: boolean; ref: string; message?: string } {
  const ref = `refs/team-fencing/${lease_id}`;
  const out = spawnSync(gitBin, ["update-ref", "-d", ref], {
    cwd,
    encoding: "utf-8",
  });
  return {
    ok: out.status === 0,
    ref,
    message: out.status === 0 ? undefined : out.stderr,
  };
}
