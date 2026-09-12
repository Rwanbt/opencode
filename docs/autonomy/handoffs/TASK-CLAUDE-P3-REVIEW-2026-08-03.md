# Task card Claude — UNIFIA-P3-REVIEW-2026-08-03

Role: independent security/architecture reviewer. Do not edit or commit files.

Repository: D:\App\OpenCode\unifia-execution-clean
Branch: recovery/unifia-audit-correction-20260803
Authority: docs/autonomy/PLAN-DIRECTEUR-V3.md
Evidence: docs/autonomy/M1-BEHAVIOR-EVIDENCE-2026-08-03.md

Objective
Review whether P3 security foundation can start without violating Unifia Core authority.

Read only
- docs/autonomy/PLAN-DIRECTEUR-V3.md (sections security, contracts, phases P3-P5)
- docs/autonomy/M1-BEHAVIOR-EVIDENCE-2026-08-03.md
- docs/autonomy/SECURITY-GAP-MATRIX.md
- docs/autonomy/IMPORT-CANDIDATES.md
- OpenWork snapshot 2c558bcffb5b686148c30bbf3dd2af7ade99492a:
  apps/server/src/approvals.ts, apps/server/src/server.ts
- Open Cowork snapshot ec5bd270861fd4531bda44554766b8b5bd009242:
  src/main/remote/gateway.ts, src/main/sandbox/path-guard.ts,
  src/main/skills/plugin-runtime-service.ts

Required output
Return exactly:
1. three highest-risk blockers with file/path and behavioral evidence;
2. the minimum P3 contract set that must exist before implementation;
3. one recommendation: START_P3_CONTRACTS or BLOCK_P3;
4. tests required for approval auto-mode, remote open-mode, sandbox containment,
   plugin materialization and licence/provenance.

STOP
Do not propose copying upstream code. Do not approve any `open` or unrestricted
`auto` mode. Do not change the branch.