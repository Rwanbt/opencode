/**
 * helper.ts — shared utilities for TEAM-G01 lock-manager integration tests.
 *
 * Provides:
 *   - createTempGitRepo(): a fresh temporary git repo with one initial commit
 *   - setupInMemoryDb():  an isolated SQLite for the lock manager
 *   - newLease():         factory producing valid LeaseSpec instances with
 *                         distinct ids per test
 *   - readGitPorcelain(): parse `git status --porcelain` into DiffEntry[]
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { getDbInMemory, type LeaseSpec } from "../../src/team/lock-manager";
import { execSync } from "node:child_process";

export function createTempGitRepo(opts?: { branch?: string }): {
  path: string;
  commit: (msg: string, files?: Record<string, string>) => string;
  writeFile: (rel: string, content: string) => void;
  cleanup: () => void;
  setBranch: (name: string) => void;
  exec: (cmd: string, args?: string[]) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), "team-g01-"));
  // --initial-branch keeps newer git from complaining on Windows.
  const branch = opts?.branch ?? "main";
  execSync("git init -q -b " + branch, { cwd: dir });
  execSync(`git config user.email "mm2@unifia.invalid"`, { cwd: dir });
  execSync(`git config user.name "MM2-IMPLEMENTATION-LANE-A"`, { cwd: dir });
  execSync(`git config commit.gpgsign false`, { cwd: dir });
  // Make Windows tolerant.
  execSync("git config core.longpaths true", { cwd: dir });
  execSync("git config core.autocrlf false", { cwd: dir });

  // Initial commit on a "main" branch with one README.
  writeFileSync(join(dir, "README.md"), "initial\n");
  execSync("git add README.md", { cwd: dir });
  execSync(`git commit -q -m "chore: initial commit"`, { cwd: dir });
  const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();

  return {
    path: dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
    writeFile: (rel: string, content: string) => {
      const full = join(dir, rel);
      const parent = dirname(full);
      if (parent && parent !== full) mkdirSync(parent, { recursive: true });
      writeFileSync(full, content);
    },
    commit: (msg: string, files: Record<string, string> = {}) => {
      for (const [rel, content] of Object.entries(files)) {
        const full = join(dir, rel);
        const parent = dirname(full);
        if (parent && parent !== full) mkdirSync(parent, { recursive: true });
        writeFileSync(full, content);
      }
      if (Object.keys(files).length > 0) {
        execSync("git add -A", { cwd: dir });
      }
      execSync(`git commit -q -m "${msg.replaceAll('"', '')}"`, { cwd: dir });
      return execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    },
    setBranch: (name: string) => {
      try {
        execSync(`git checkout -q -B ${name}`, { cwd: dir });
      } catch {
        execSync(`git checkout -q ${name}`, { cwd: dir });
      }
    },
    exec: (cmd: string, args: string[] = []) => {
      return execSync([cmd, ...args].join(" "), { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }).toString();
    },
  };
}

let _counter = 0;
export function newLease(overrides: Partial<LeaseSpec> = {}): LeaseSpec {
  _counter++;
  const card = overrides.card_id ?? "TEAM-TEST";
  const lease = `LEASE-${card}-${Date.now()}-${_counter}`;
  return {
    lease_id: overrides.lease_id ?? lease,
    card_id: card,
    worker_id: overrides.worker_id ?? `worker-${_counter}`,
    branch: overrides.branch ?? `c-${card}/test${_counter}`,
    worktree: overrides.worktree ?? `D:/team/worktrees/test${_counter}`,
    base_sha: overrides.base_sha ?? "0000000000000000000000000000000000000000",
    scope_manifest_hash: overrides.scope_manifest_hash ?? "deadbeef".repeat(8),
    allowed_files: overrides.allowed_files ?? ["src/**/*.ts"],
    protected_files: overrides.protected_files ?? ["src/forbidden.ts"],
    scope_mode: overrides.scope_mode ?? "OPEN",
    ttl_seconds: overrides.ttl_seconds ?? 1800,
  };
}

export function setupInMemoryDb(): Database {
  return getDbInMemory();
}
