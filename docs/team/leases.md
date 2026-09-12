# Leases (TEAM-G01) — User Manual

This document is the canonical user-facing manual for the team lock-manager
introduced by TEAM-G01 (commit [PROVISIONAL][UNREVIEWED][TEAM-G01]).

## What is a lease?

A **lease** is the right to mutate a single `(branch, worktree)` slot
atomically. Each lease has:

- a `lease_id` (string, unique)
- a `card_id` (e.g., `TEAM-G01`)
- a `worker_id` (the agent holding the right)
- a `branch` (the branch this lease covers)
- a `worktree` (the working tree)
- a `fencing_token` (strictly monotone integer — anti-replay guard)
- a `scope_manifest_hash` (SHA-256 of the declared scope manifest)
- `allowed_files` / `protected_files` (scope)
- lifecycle: `CLAIMED → RELEASED | EXPIRED`

Leases are stored in a SQLite database under
`Execution/Locks/leases.db` (overridable via `TEAM_LOCKS_DIR`).

## Lifecycle

```
  CLAIM ────────► CLAIMED ───heartbeat──► CLAIMED ───release──► RELEASED
                    │                          │
                    │                          ├──ttl expires──► EXPIRED
                    │                          └──crash────────► EXPIRED
                    │
                    └──heartbeat missing 15min──► STALE (within ttl, no proof)
```

## Commands

```sh
# Claim a lease
bun run team claim \
  --lease-id LEASE-G01-20260721030000-team-g01-locking \
  --card TEAM-G01 \
  --worker MM2-IMPLEMENTATION-LANE-A \
  --branch c-G01/bbf637be \
  --worktree D:/App/OpenCode/.team-worktrees/G01-bbf637be \
  --base ef48e5d5c5cc0aff802a519950e15aeb3786e1c6 \
  --manifest-hash <sha256 of manifest> \
  --allowed-files "packages/unifia/src/team/*.ts,packages/unifia/test/team/*.test.ts,..." \
  --protected-files "Execution/00-EXECUTION-STATE.md,Execution/01-TASK-BOARD.md,..." \
  --scope-mode E2_REQUIRED \
  --ttl 1800

# Heartbeat (refresh expiry)
bun run team heartbeat --lease-id <LID> --worker <WID>

# Validate (check still ACTIVE + token matches)
bun run team validate --lease-id <LID> --fencing-token <N>

# Release
bun run team release --lease-id <LID> --worker <WID> --reason "card done"

# Inspect (debug)
bun run team inspect

# Recover (sweep TTL-expired leases + correct watermark)
bun run team recover

# Precommit check (scope only)
bun run team precommit-check --lease-id <LID> --git-root $(pwd)

# Preintegrate check (scope + patch-id stability)
bun run team preintegrate-check --lease-id <LID> --base <BASE_SHA> --git-root $(pwd)
```

## Scope monitor

The scope monitor enforces:

- `allowed_files` : writes are restricted to these paths.
- `protected_files` : these must NOT be touched (unless `exclusions` cover them).
- `reserved_paths` : any descendant of a reserved path is rejected (e.g.,
  `Execution/NightShift/...` is reserved for the orchestrator).
- `symlink_policy` : `REJECT` rejects any symlink in the diff.
- `case_policy` : `REJECT_DUPLICATE_CASE` rejects paths that have a case-
  insensitive sibling on a Windows-style filesystem.
- `long_path_policy` : `FAIL_OVER_260` rejects full-paths ≥ 260 chars.
- `eol_policy` : `LF_NORMALIZED` rejects files containing CRLF.

The scope monitor runs at `precommit-check` (light) and at
`preintegrate-check` (full: scope + patch-id stability check).

## Fencing tokens

Each lease is issued a strictly monotone `fencing_token` integer.
Tokens are persisted in SQLite (`fence_tokens` table) and an additional
Git ref is created at `refs/team-fencing/<lease_id>` whose commit-object
hash encodes the token. Re-running the same token produces the same hash
(deterministic), but the lease's `validate()` rejects any token that
isn't the current high-water mark.

## Crash semantics

If a worker crashes mid-commit, the lease will eventually expire
(TTL-based) and be auto-recovered on the next `claim` operation.
The scope monitor never trusts implicit state — it only trusts on-disk
manifests and `git status --porcelain` at the moment of the check.

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| `BRANCH_TAKEN` | another worker holds an active lease on this branch | wait until release, or pick a different branch |
| `WORKTREE_TAKEN` | another worker holds the same worktree | pick a different worktree |
| `OUT_OF_SCOPE` | file not in `allowed_files` | update manifest + rehash, or move file off scope |
| `PROTECTED_FILE_MODIFIED` | file in `protected_files` | abort; reroute through MM1 |
| `RESERVED_PATH_MODIFIED` | file under a reserved path | abort; the path is owned by MM1 |
| `TOKEN_STALE` | the lease was reclaimed by another worker | stop, refresh manifest, claim again |

## Authoritative references

- `packages/unifia/src/team/lock-manager.ts` — atomic claim/release/heartbeat
- `packages/unifia/src/team/fencing.ts` — monotone token + Git ref
- `packages/unifia/src/team/scope-monitor.ts` — scope validator
- `packages/unifia/src/team/team-cli.ts` — CLI entry points
- `docs/team/scope-manifest/TEAM-G01.yaml` — manifest for TEAM-G01
- `Execution/Locks/leases.db` — runtime DB
- `refs/team-fencing/<lease_id>` — Git-native fence chain
