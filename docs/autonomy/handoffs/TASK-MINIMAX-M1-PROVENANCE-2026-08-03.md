# Task card MiniMax — UNIFIA-M1-PROVENANCE-2026-08-03

Role: bounded evidence executor. One short session; no commit, push, release or runtime edit.

Repository: D:\App\OpenCode\unifia-execution-clean
Branch: recovery/unifia-audit-correction-20260803

Objective
Complete the missing path-level provenance inventory for Open Cowork skills and
renderer i18n, and verify nested licence notices.

Allowed files to create/update
- docs/autonomy/M1-PROVENANCE-DETAIL-2026-08-03.md only

Commands
- git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git rev-parse HEAD
- git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git ls-tree -r --name-only HEAD
- git --git-dir D:\AI-Workspace\hermes-data\work\unifia-sandbox\upstreams\open-cowork.git show HEAD:<path>

Required proof
For `.claude/skills/**`, `src/main/skills/**`, and `src/renderer/i18n/**`:
- exact commit;
- exact path sets and counts;
- root and nested licence/notice paths;
- decision per set: REVIEW_PER_COMPONENT, ADOPT, ADAPT, EXCLUDE or BLOCKED;
- explicit statement that no file was imported.

Expected checks
- git diff --check
- git status --short contains only the allowed report

STOP conditions
Stop if the commit/path cannot be reproduced, if a nested licence is unclear,
or if the requested source is absent. Return a STOP report; do not guess.