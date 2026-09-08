<!-- SPDX-License-Identifier: MIT -->

# Branch Archive - 2026-09-08

The repository carried 55 local and 23 remote branches. It now carries three on
the remote (`main`, `dev`, `work-design`) and five locally. Nothing was
destroyed: every deleted branch was first written to `refs/archive/2026-09-08/`,
which is not a branch namespace and so does not appear in branch listings or in
the GitHub branch UI.

## Restoring anything here

```
git fetch origin 'refs/archive/*:refs/archive/*'
git branch <name> refs/archive/2026-09-08/<name>
```

The 20 branches that existed on `origin` have their archive ref on `origin` too,
so they are recoverable from a fresh clone. The 30 local-only branches have
their archive ref in this clone only.

## Why branch deletion could not be proved safe the usual way

The obvious test - is the branch an ancestor of the trunk - clears only 5 of 52
branches, because this repository squash-merges and because the Automate
promotion (PR #60) squashed a reconstructed A1..A5b slice stack. Ancestry was
destroyed by the workflow, not by anything missing.

Two tests were used instead:

1. **Contribution test.** `git merge-tree --write-tree <keeper> <branch>`; if the
   resulting tree equals the keeper's tree, merging the branch would change
   nothing, so it carries nothing new. This test yields false alarms when it hits
   conflicts: `merge-tree` writes conflict markers into the tree, which then read
   as added lines in a diff. Every such case here was inspected and the trunk
   side was the richer one.
2. **New-file test.** Files the branch added since its merge-base that do not
   exist in the trunk at all. A missing file cannot be a conflict artifact, so
   this is the decisive signal, and it is what found the two exceptions below.

Three classes appear in the table below. **CONTAINED** = the trunk provably
holds the content. **SUPERSEDED** = the branch adds no file the trunk lacks and
a later revision of the same slice is CONTAINED. **PRESERVED** = the branch does
add files the trunk lacks, and is an ancestor of a branch that was kept.

The pivot for the whole Automate family: `integration/automate-promotion-candidate-20260907`
and the squash commit `6ba540abf5` have the **same tree**, `1b01dfceb4`. The
squash preserved content exactly, so every ancestor of the candidate is contained
in the trunk.

## Not deleted - these carry work the trunk does not have

### `integration/rev3m-20260901/work`

17 files that do not exist in `work-design` at all - the rev3m review cycle's
Knowledge hardening:

- `test/knowledge/containment/` - W-FS TOCTOU (in-window and plain), maxdepth,
  siblings, maxnotebytes, unicode
- `test/knowledge/mutation/` - writer atomicity, lock PID, lock reentrancy,
  supersede CAS, writer stress plus its child-process helper
- `test/knowledge/mcp/` - token concurrency and token persistence
- `src/cli/knowledge/commands-{hardening,list,workspace}.ts` - the split of an
  817-line `main.ts`

The seven sibling branches (`agent/pr3m-20260831-090426/{c24,w-fs,w-mut,w-run-01}`
and `fix/rev3m-20260901/{w-fs,w-mut,w-run-01}`) are all **ancestors** of this
branch, so this one branch preserves the entire cycle. They were archived and
deleted.

This work merges cleanly into `work-design` and is a merge candidate, not archive
material. It was left as a branch so that it stays visible.

### `feat/unifia-rebrand-cli-tui`

Its committed content adds no file the trunk lacks, but its worktree -
`D:/App/unifia/unifia`, the primary checkout - holds **40 modified files,
+9885/-7130**, uncommitted: brand colors, a letter-based wordmark, favicons,
icons, and i18n across 15 languages. The trunk's `logo.ts` is the older, smaller
version, so this is real unmerged design work.

It sits on the pre-rename layout (`packages/opencode/`, which the trunk renamed
to `packages/unifia/`), so it needs porting rather than merging.

The uncommitted state was captured, without touching the worktree, at
`refs/archive/2026-09-08/wip/unifia-rebrand-cli-tui`. A second capture,
`refs/archive/2026-09-08/wip/automate-a4-workbench`, holds a one-line test edit
from a worktree that was removed.

## Deleted branches

| Branch | SHA | Last commit | Was on | Class | Evidence |
|---|---|---|---|---|---|
| `agent/automate-v2-baseline-20260901` | `5b750939bd` | 2026-09-06 | origin | PRESERVED | adds only `state.md` (review metadata); Phase B audited it as a trunk subset |
| `agent/pr3m-20260831-090426/bench` | `8ea48d99c6` | 2026-08-31 | local-only | CONTAINED | ancestor of work-design |
| `agent/pr3m-20260831-090426/c24` | `71a773fdda` | 2026-08-31 | local-only | PRESERVED | ancestor of the kept `integration/rev3m-20260901/work` |
| `agent/pr3m-20260831-090426/da-aud` | `b6a6f4ec02` | 2026-08-31 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `agent/pr3m-20260831-090426/da-cap` | `3c3ab21724` | 2026-08-31 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `agent/pr3m-20260831-090426/da-sec-01` | `caee52ba72` | 2026-08-31 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `agent/pr3m-20260831-090426/da-ui` | `643384cbea` | 2026-08-31 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `agent/pr3m-20260831-090426/mcp` | `a616785b4a` | 2026-08-31 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `agent/pr3m-20260831-090426/secrets` | `4b8bce83fc` | 2026-08-31 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `agent/pr3m-20260831-090426/w-fs` | `6e00b9ab83` | 2026-08-31 | local-only | PRESERVED | ancestor of the kept `integration/rev3m-20260901/work` |
| `agent/pr3m-20260831-090426/w-mut` | `ecdc7c8bf5` | 2026-08-31 | local-only | PRESERVED | ancestor of the kept `integration/rev3m-20260901/work` |
| `agent/pr3m-20260831-090426/w-run-01` | `a76b32b242` | 2026-08-31 | local-only | PRESERVED | ancestor of the kept `integration/rev3m-20260901/work` |
| `checkpoint/work-design-automate-knowledge` | `e6e88081fc` | 2026-09-08 | local-only | CONTAINED | ancestor of work-design |
| `feat/automate-phase1-vertical-slice` | `cff9551559` | 2026-09-07 | origin | CONTAINED | ancestor of work-design |
| `feat/npm-publish-unifia-scope` | `5bdfd82b92` | 2026-08-10 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `feat/sovereign-knowledge-core` | `b511ea44f4` | 2026-09-01 | origin | CONTAINED | ancestor of work-design |
| `feat/unifia-c8-c9` | `d8187ebe12` | 2026-08-11 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `feat/unifia-config-dir-migration` | `c1d76cf60a` | 2026-08-10 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `feat/unifia-rebrand-complete` | `d3cbcd8141` | 2026-08-10 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `fix/rev3m-20260901/da-aud` | `0ddb6fa52e` | 2026-09-01 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `fix/rev3m-20260901/da-ui` | `111ecfe46f` | 2026-09-01 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `fix/rev3m-20260901/w-fs` | `0e98de03b9` | 2026-09-01 | local-only | PRESERVED | ancestor of the kept `integration/rev3m-20260901/work` |
| `fix/rev3m-20260901/w-mut` | `2486a4ff6a` | 2026-09-01 | local-only | PRESERVED | ancestor of the kept `integration/rev3m-20260901/work` |
| `fix/rev3m-20260901/w-run-01` | `38e37dd6fe` | 2026-09-01 | local-only | PRESERVED | ancestor of the kept `integration/rev3m-20260901/work` |
| `fix/team-selector-deadlock` | `f4f7f5c7a6` | 2026-08-11 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `fix/team-selector-min-models-deadlock` | `e0fe00a975` | 2026-07-30 | local-only | CONTAINED | merges into work-design with no tree change |
| `fix/unifia-dependency-security` | `b5cb25d163` | 2026-08-11 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `fix/unifia-domain-decision` | `e5083f7402` | 2026-08-11 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `fix/unifia-production-readiness` | `9d861f3e9b` | 2026-08-11 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `fix/unifia-security-and-e2e` | `7a78070d6f` | 2026-08-11 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a1-contracts` | `ff9fa1bfd1` | 2026-09-06 | origin | CONTAINED | absorbed by promotion candidate |
| `integration/automate-a2-m0` | `0208882bfd` | 2026-09-06 | origin | CONTAINED | absorbed by promotion candidate |
| `integration/automate-a3-runtime` | `189d6a6792` | 2026-09-06 | origin | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a3-runtime-r1` | `64b92bb946` | 2026-09-06 | origin | CONTAINED | absorbed by promotion candidate |
| `integration/automate-a3-runtime-r2` | `a2e50d63ce` | 2026-09-06 | origin | CONTAINED | absorbed by promotion candidate |
| `integration/automate-a4-workbench` | `012d893d90` | 2026-09-06 | origin | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a4-workbench-r1` | `3cccb53e12` | 2026-09-06 | origin | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a4-workbench-r2` | `9bced21548` | 2026-09-06 | origin | CONTAINED | absorbed by promotion candidate |
| `integration/automate-a5-foundations` | `bcd8b8d350` | 2026-09-06 | origin | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a5-foundations-r1` | `94ce9fd176` | 2026-09-06 | origin | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a5-foundations-r2` | `9934660b7a` | 2026-09-06 | origin | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a5-foundations-r2-final` | `6e08a9b32f` | 2026-09-06 | origin | CONTAINED | absorbed by promotion candidate |
| `integration/automate-a5b-app` | `323e5e0e8c` | 2026-09-06 | origin | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a5b-app-r1` | `f1b259eb8f` | 2026-09-06 | origin | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a5b-app-r2` | `4a4c73eec2` | 2026-09-06 | origin | SUPERSEDED | adds no file the trunk lacks |
| `integration/automate-a5b-app-r2-final` | `59260459dc` | 2026-09-06 | origin | CONTAINED | absorbed by promotion candidate |
| `integration/automate-promotion-candidate-20260907` | `9f11ec41f8` | 2026-09-07 | origin | CONTAINED | tree identical to squash `6ba540abf5` |
| `integration/rev3m-20260901/design-automate` | `24b04998e2` | 2026-09-01 | local-only | SUPERSEDED | adds no file the trunk lacks |
| `integration/work-design-knowledge` | `720a9bc6b3` | 2026-09-08 | local-only | CONTAINED | ancestor of work-design |
| `recovery/unifia-audit-correction-20260803` | `a37f5115dd` | 2026-08-07 | local-only | SUPERSEDED | adds no file the trunk lacks |

## Orphaned directories on disk

`git worktree remove` unregistered 24 worktrees and freed about 4.2 GB, but
Windows kept the file trees (EBUSY). They are no longer worktrees and their
content is fully in git, so removing them is a plain directory delete:

```
D:\App\unifia\.worktrees\phase1-20260907
D:\App\unifia\.worktrees\pr3m-20260831-090426
D:\App\unifia\.worktrees\rev3m-20260901
D:\App\unifia\unifia-memory
```
