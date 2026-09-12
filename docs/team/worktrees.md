# Worktrees — TEAM-G02

This document describes the WorktreeManager component implemented by
**TEAM-G02** (Locking Git/worktrees — plan directeur §26 ligne 3207).

## Overview

The WorktreeManager builds on TEAM-G01's lock-manager + fencing + scope-monitor
to provide atomic creation, attachment, detachment, scope validation, listing
and inspection of per-card worktrees.

It is invoked through the team CLI surface (subcommands `team wt-create`,
`team wt-attach`, `team wt-detach`, `team wt-validate`, `team wt-list`,
`team wt-inspect`) or programmatically through
`packages/unifia/src/team/worktree-manager.ts`.

## Public API

```typescript
import {
  createWorktree,
  attachWorktree,
  detachWorktree,
  validateWorktreeScope,
  listWorktrees,
  inspectWorktree,
} from "packages/unifia/src/team/worktree-manager";

import {
  hookPreCommit,
  hookPrePush,
  hookPostCommit,
} from "packages/unifia/src/team/hooks";
```

### createWorktree(opts)

Creates a new worktree at `worktree_path` branched from `base_sha`, atomically
claims a lease via the lock-manager, and verifies Husky bootstrap.

**Fails closed if:**
- `base_sha` is not 40-hex or doesn't resolve in the repo
- `worktree_path` is non-absolute, is a symlink, or already exists
- `repo_root` is non-absolute or doesn't exist
- The branch name contains forbidden characters, exceeds 80 chars, or is a
  protected branch (main, dev, Team, opti-ui, Team-build-opti-ui)
- A mid-operation sentinel (`CHERRY_PICK_HEAD`, `MERGE_HEAD`, `REBASE_HEAD`)
  exists in the repo
- The lease claim fails (branch/worktree already taken)

On failure after partial work, the lease is released and the worktree is
removed (rollback path).

### attachWorktree(opts)

Attaches a lease to a worktree that was created externally (manually or by
another worker). Verifies that `worktree_path` exists, that `HEAD` equals
`base_sha`, and that the current branch matches `branch`.

**Fails closed if:**
- `worktree_path` does not exist, is a symlink, or is not a directory
- `HEAD` does not match `base_sha`
- The current branch does not match `branch`
- The lease claim fails

### detachWorktree(opts)

Releases the lease and optionally removes the worktree directory.

**Fails closed if:**
- The lease does not exist or is not owned by `worker_id`
- The worktree is dirty AND `force` is not `true`
- `git worktree remove` fails AND fallback `rmSync` fails

### validateWorktreeScope(opts)

Reads `git status --porcelain` in the lease's worktree, validates the diff
against the supplied manifest via the scope-monitor. Returns the verdict
(ok/violations/warnings).

**Fails closed if:**
- The lease is not found
- The lease is no longer active or the fencing token doesn't match
- `git status` fails

### listWorktrees(repoRoot)

Enumerates all worktrees via `git worktree list --porcelain`. Returns an
array of `WorktreeView` objects with branch, HEAD, dirty state, husky status.

### inspectWorktree(worktreePath)

Returns a `WorktreeView` for a single worktree (without cross-referencing a
lease).

## Worktree-level hooks

The hooks module provides fail-closed Git hook handlers for installation in
`.husky/pre-commit`, `.husky/pre-push`, `.husky/post-commit`:

| Hook | Behaviour |
|---|---|
| `hookPreCommit` | Block on mid-operation sentinel. Refresh lease heartbeat. Validate scope. |
| `hookPrePush` | Refuse push to protected branches. Block on sentinel. Validate scope. |
| `hookPostCommit` | Refresh lease heartbeat. Never blocks. |

If no active lease exists for the worktree (legacy worktrees), hooks return
OK with a warning rather than blocking.

## Cross-platform

The WorktreeManager uses `node:fs` (POSIX-portable subset) and `node:child_process`
to invoke `git`. Windows + Linux + macOS are all supported. The Bun runtime
is the only runtime dependency.

## Fail-closed posture

- Path canonicalisation via `realpathSync` rejects symlinks and junctions.
- Branch name validation rejects names exceeding 80 chars or containing
  forbidden characters (anything outside `[a-zA-Z0-9._/-]`).
- Protected branches (main, dev, Team, opti-ui, Team-build-opti-ui) are
  blocked at worktree creation time.
- Mid-operation sentinels (`CHERRY_PICK_HEAD`, `MERGE_HEAD`, `REBASE_HEAD`,
  `REVERT_HEAD`) cause any create/attach/hook to fail closed.
- `base_sha` is validated via `git rev-parse` against the repo before any
  worktree is created.

## Rollback

If `createWorktree` succeeds the lease claim but fails the `git worktree add`,
the manager:
1. Releases the lease (`release()` with reason `ROLLBACK_AFTER_WORKTREE_ADD_FAIL`).
2. Removes the partially-created branch via `git branch -D`.
3. Removes the partially-created worktree via `git worktree remove --force`.

The rollback path NEVER leaves a worktree without a corresponding release.
