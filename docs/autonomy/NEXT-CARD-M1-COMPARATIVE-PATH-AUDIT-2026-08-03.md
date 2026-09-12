# Next Card M1 — Comparative Path Audit

**Status**: READY
**Date**: 2026-08-03
**Branch**: `recovery/unifia-audit-correction-20260803`
**Authority**: `Plan-directeur-V3-Unifia-WorkBench-OpenWork-OpenCowork.md`

## Objective

Replace the remaining probable or inferred claims in the comparative matrices with
path-level evidence from the pinned upstream snapshots. This card is audit-only:
it must not import, copy, rename, or modify runtime code.

## Inputs and immutable evidence

| Source | Snapshot | Evidence |
|---|---|---|
| OpenWork | `2c558bcffb5b686148c30bbf3dd2af7ade99492a` (`dev`) | `apps/server`, `apps/desktop`; 3,364 tracked paths at audit time |
| Open Cowork | `HEAD` recorded in `UPSTREAM-SOURCES.lock.json` | `src`, `.claude/skills`; 596 tracked paths at audit time |
| OpenWork licence boundary | same snapshot | root `LICENSE` MIT; `ee/LICENSE` Fair Source FSL-1.1-MIT; 1,067 `/ee` paths |
| Open Cowork licence boundary | same snapshot | root `LICENSE` MIT; `.claude/skills/skill-creator/LICENSE.txt` Apache notice |

## Allowed scope

Audit these candidate capabilities only:

1. server/session/runtime/provider/tool authority;
2. desktop shell and workspace integration;
3. skills/plugins and provenance-bearing assets;
4. sandbox/path containment;
5. remote channels/gateway;
6. computer-use and file-session handling;
7. i18n/user overlay (remain blocked if the source is unavailable).

## Required method

For each candidate, record all of the following in the matrices:

- repository and immutable commit;
- exact path or path set;
- tracked-file count for the path set;
- licence/provenance boundary;
- decision: `ADOPT`, `ADAPT`, `REWRITE`, `EXCLUDE`, `DEFER`, or
  `BLOCKED_MISSING_SOURCE`;
- rationale tied to the Unifia Core authority contract.

Use `git ls-tree -r --name-only` against the bare upstreams. A claim without a
path-level result must be written as `UNVERIFIED`, not `probable`.

## Hard exclusions

- Never inspect or import OpenWork `/ee` as implementation material.
- Exclude enterprise/commercial/private paths and any file whose licence cannot
  be established before provenance review.
- Do not treat a path count, filename, or upstream similarity as proof of
  behavioural compatibility.
- Do not alter `D:\App\OpenCode\opencode` or the Hermes preservation archive.

## Deliverables

1. Corrected `FEATURE-OWNERSHIP-MATRIX.md`.
2. Corrected `DUPLICATION-MATRIX.md`.
3. Corrected `PORTABILITY-ASSESSMENT.md`.
4. Corrected `SECURITY-GAP-MATRIX.md`.
5. Corrected `IMPORT-CANDIDATES.md` and `DO-NOT-IMPORT.md`.
6. A short evidence report listing command, snapshot, counts, and unresolved
   items.

## Gate / proof of completion

- all seven candidates have a repository, commit, exact path set, licence state,
  decision, and rationale;
- no decision is justified only by `probable` or by a filename;
- `/ee` remains explicitly excluded and no imported file is added;
- i18n remains `BLOCKED_MISSING_SOURCE` until the declared source is available;
- `git diff --check` passes;
- `git status --short` contains only the audit deliverables;
- the reviewer can reproduce every count from the pinned bare repositories.

## STOP conditions

Stop and record `BLOCKED` if a path is absent, a licence boundary is ambiguous,
or the evidence would require importing code before the Unifia contracts are
validated. Prepare exactly one follow-up card; do not broaden scope.
