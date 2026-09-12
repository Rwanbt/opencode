# Task card MiniMax — UNIFIA-P3-CONTRACT-AMEND-2026-08-03

Role: bounded documentation executor. Work only in the isolated clone.

Repository: D:\App\OpenCode\unifia-execution-clean
Branch: recovery/unifia-audit-correction-20260803
Authority: docs/autonomy/PLAN-DIRECTEUR-V3.md
Reviewer report: Claude independent review `UNIFIA-P3-REVIEW-2026-08-03`

Objective
Amend the P3 contract documentation before any runtime implementation.

Allowed files only
- docs/autonomy/P3-CONTRACTS-DRAFT-2026-08-03.md
- docs/autonomy/IMPORT-CANDIDATES.md
- docs/autonomy/THREAT-MODEL-P3-2026-08-03.md (new)

Required changes
1. Add C1-C9: CapabilityDescriptor/Request, PolicyEngine, ApprovalBroker,
   ProvenanceRecord, registered-approved-materialized lifecycle, SandboxPort,
   RemoteTransportPort, AuditRuntime, SecretStore/TaintTracker/quotas/kill-switches.
2. Correct remote contract: every transport plane authenticates on the path to
   the agent; WebSocket cannot mark clients authenticated without credentials;
   pairing requires an already authenticated out-of-band actor; `open` is invalid.
3. Correct sandbox contract: canonicalize the nearest existing parent and the
   remaining lexical suffix; reject symlinked-parent escapes, Windows paths that
   would widen the root, TOCTOU-sensitive decisions, and denylist-only commands.
4. Correct plugin lifecycle: install does not enable or materialize; identity is
   source digest, not manifest name; no overwrite; no implicit capability grant.
5. Add threat model with assets, trust boundaries, STRIDE threats, mitigations,
   residual risks and test references for B1-B7.
6. In IMPORT-CANDIDATES.md, change Open Cowork bundled docx/pdf/pptx/xlsx from
   ADOPT to EXCLUDE/BLOCKED_LICENCE because nested notices are Anthropic-restricted.

Required checks
- git diff --check
- no source/runtime file changed
- no upstream file imported
- report exact changed files and unresolved items

STOP conditions
Stop on ambiguous licence text or missing plan section. Do not implement TypeScript,
do not commit, do not push, do not modify the OpenCode main checkout.