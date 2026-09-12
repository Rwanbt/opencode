# TASK-MINIMAX-P3-MICROFIX-2026-08-03

## Role

You are the executor for a docs-only P3 contract correction. Do not implement
runtime code, do not import upstream files, do not modify `D:\App\OpenCode`,
do not push, and do not commit.

## Allowed files

- `docs/autonomy/P3-CONTRACTS-DRAFT-2026-08-03.md`
- `docs/autonomy/THREAT-MODEL-P3-2026-08-03.md`
- `docs/autonomy/IMPORT-CANDIDATES.md`
- `docs/autonomy/M1-PROVENANCE-DETAIL-2026-08-03.md`

## Required corrections

Apply Claude's amendment review in
`docs/autonomy/UNIFIA-P3-AMENDMENT-REVIEW-2026-08-03.md`:

1. C6 must use the deepest existing accumulator (last existing parent), resolve
   or deny every intermediate symlink, and deny lexical traversal or rewriting.
2. C1/C2 must expose a normative complete mapping for all 14 Plan V3
   capabilities to declared effects and encode all six critical combinations as
   named rules.
3. Add the C7 pairing disclosure/OOB-auth requirements and tests.
4. Make the C5 diagram/text use exactly three lifecycle states, with `enabled`
   as a separate gate.
5. Correct the OCW-S4 totals, the i18n ADOPT/REVIEW contradiction, and track B6
   workspace-root realpath as Phase 4 debt.

## Commands and proof

Run:

```powershell
git diff --check
git diff --stat
rg -n "deepest existing|declaredEffects|desktop.control|browser.cookies|package.install|artifact.create|artifact.export|terminal.run|pairing-code-not-delivered|pairing-needs-oob|OCW-S4|realpath" docs/autonomy
```

Report the exact files and lines changed. If a requested correction is not
supported by the current documents, stop and report it.

## STOP conditions

Stop after docs and proof. No runtime, no upstream source, no commit, no push.

