# M1 — Path Evidence Snapshot

**Date**: 2026-08-03
**Branch**: `recovery/unifia-audit-correction-20260803`
**Purpose**: reproducible inventory baseline; no runtime import performed.

## Commands

```powershell
$ow = 'D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\openwork.git'
$oc = 'D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git'
git --git-dir $ow ls-tree -r --name-only HEAD
git --git-dir $oc ls-tree -r --name-only HEAD
```

All counts below are counts of tracked paths matching the displayed prefix or
search expression. They are inventory evidence, not behavioural equivalence.

## OpenWork

Snapshot: `2c558bcffb5b686148c30bbf3dd2af7ade99492a` (`dev`)

| Candidate | Expression | Count | Initial disposition |
|---|---|---:|---|
| Server/runtime | `^apps/server/` | 171 | `ADAPT` candidate; contract review required |
| Desktop shell | `^apps/desktop/electron/` | 60 | `ADAPT` candidate; separate shell authority |
| Desktop build scripts | `^apps/desktop/scripts/` | 7 | `DEFER` until packaging contract |
| Remote/connect/tunnel | `(remote\|connect\|tunnel)` | 241 | `ADAPT` candidate; overlaps runtime and UI |
| Sandbox/path controls | `(sandbox\|path-containment\|authorized-folders)` | 14 | `ADAPT` candidate; security review required |
| Skills/plugins | `(skill\|plugin)` | 234 | `ADAPT` candidate; provenance per file |
| Fair Source boundary | `ee/` | 1,067 verified separately | `EXCLUDE` |

The `/ee` count is the exact count recorded in the corrected provenance lock;
the broad search expression is intentionally not used as its authority because
it also depends on path matching semantics.

## Open Cowork

Snapshot: `HEAD` pinned in `UPSTREAM-SOURCES.lock.json`.

| Candidate | Expression | Count | Initial disposition |
|---|---|---:|---|
| Main runtime | `^src/main/` | 106 | `ADAPT` candidate; Unifia Core remains authoritative |
| Remote channels/gateway | `^src/main/remote/` | 16 | `ADAPT` candidate; protocol review required |
| Sandbox/path controls | `^src/main/sandbox/` | 17 | `ADAPT` candidate; security review required |
| Skills and bundled skills | `^src/main/skills/` or `^\.claude/skills/` | 143 | `ADOPT` only per approved, attributed component |
| Memory | `^src/main/memory/` | 18 | `DEFER`; no import before Core contract |
| Python helpers | `\.py$` | 37 | `REVIEW`; licence/provenance per component |
| XSD/schema assets | `\.xsd$` | 78 | `REVIEW`; attribution and necessity required |

## Current unresolved items

- Open Cowork’s user i18n overlay source remains unavailable and is therefore
  `BLOCKED_MISSING_SOURCE`.
- Counts do not prove compatibility, ownership, security, or licence coverage.
- The existing feature, duplication, portability, security, and import matrices
  still require conversion from `probable` claims to path-backed entries or
  explicit `UNVERIFIED`.

## Gate result

`M1_IN_PROGRESS`: inventory evidence is reproducible; matrix correction is not
yet complete. No source file has been imported into Unifia.
