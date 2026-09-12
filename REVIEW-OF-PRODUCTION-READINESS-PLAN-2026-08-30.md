<!-- SPDX-License-Identifier: MIT -->
# REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30

> Consolidated review of `PRODUCTION-READINESS-PLAN-2026-08-30.md`
> by 6 specialised reviewers. Each reviewer had a distinct lens
> and produced an independent findings report. This document
> aggregates the findings, ranks them, and proposes specific
> corrections to apply to the plan before any implementation.

---

## 0. Method

Six reviewers were spawned in parallel against the same input:

1. **Adversarial** (devil's advocate) — find contradictions, false confidence, hidden assumptions
2. **Security** — C18-C24 coverage, threat model, adversarial probe sufficiency
3. **Conventions** — AGENTS.md, runbook V2, ADR format, 500-LOC rule, commit conventions
4. **Test strategy** — classification framework, gate sufficiency, probe replayability
5. **Implementation feasibility** — phase ordering, time estimates, hidden dependencies
6. **Documentation consistency** — Opus 5 vs Claude vs plan reconciliation, CHANGELOG, RISKS, DECISIONS, ADRs

Each reviewer was given a focused prompt, the 3 source files
(the plan + 2 prior reviews), and a structured output format.
Reviews ran in parallel; results were aggregated by the owner.

## 1. Headline findings (across all 6 reviewers)

| Theme | Verdict | Source reviewers |
|---|---|---|
| **Plan is built against a stale snapshot** | BLOCKER | adversarial, conventions, doc-consistency, implementation |
| **Plan is 80% stale** (R-0012, ADR-0006, DoD, fence, commands-report already done) | BLOCKER | doc-consistency, conventions |
| **Uncommitted C19 fix is BROKEN** (`vault.ts:26` missing imports) | BLOCKER | security |
| **Phase ordering inversion** (Phase 0 reverts CHANGELOG before Phase 1 classifies) | BLOCKER | adversarial |
| **Q4 unresolved** (portable restrictions: implement or document?) | BLOCKER | adversarial, security |
| **C18 cannot pass without portable restrictions** (root cause not addressed) | BLOCKER | security |
| **C25 and C30 not in C18-C24 sequence** (16 of 41 fails invisible) | MAJOR | security, test-strategy |
| **8 VaultSource fails are not C19** (regressions from uncommitted vault.ts) | MAJOR | test-strategy |
| **commands-report.ts no longer 891 LOC** (already split) | MAJOR | conventions, implementation |
| **R-0012 already exists** (plan to "add" it is a duplicate) | MAJOR | conventions, doc-consistency, implementation |
| **R-0013 is already CLOSED** (plan to "mark PARTIAL" conflicts with reality) | MAJOR | doc-consistency, implementation |
| **Probe count is 15, not 14** | MINOR | implementation |
| **8 gates are hygiene, not readiness** | MAJOR | test-strategy |
| **Phase 6 is theater without scripts** | MAJOR | test-strategy, implementation |
| **Test pyramid imbalance unaddressed** (3 egress tests vs 60 hardening) | MAJOR | test-strategy |
| **Phase 2 budget silent** | MAJOR | implementation |
| **Decomposition target wrong** (1048 not 1100; not commands-report) | MINOR | conventions, implementation |
| **Pre-flight check fails immediately** (HEAD moved past the cited SHA) | MINOR | adversarial, conventions, implementation |
| **CHANGELOG "revert" is technically wrong** (Keep a Changelog says amend) | MINOR | doc-consistency, conventions |

## 2. Aggregated verdict per reviewer

| Reviewer | Verdict | Self-confidence | Most important finding |
|---|---|---:|---|
| Adversarial | NEEDS_REVISION | 4/10 | Phase 0 / Phase 1 ordering inversion; Q4 (portable restrictions) is undecided |
| Security | NEEDS_HARDENING | 5/10 | Uncommitted C19 fix is broken (`vault.ts:26` missing imports → ReferenceError → regresses 9 tests) |
| Conventions | SIGNIFICANT_GAPS | 5/10 | Plan is 80% stale against current working tree (R-0012, ADR-0006, DoD, fence, commands-report already done) |
| Test strategy | INSUFFICIENT | 5/10 | 3-bucket classification misses 8 VaultSource regressions; 8 gates are hygiene not readiness |
| Implementation feasibility | FEASIBLE_WITH_RISKS | 6/10 | Phase 3 (corrective cards) budget is silent; total 22-40h across 3-5 sessions |
| Documentation consistency | NEEDS_ALIGNMENT | 2/10 (operational) | 3 of 9 "what's not done" rows are already done; only CHANGELOG honesty is a real task |

**Consensus**: 4 of 6 reviewers (adversarial, security, conventions, doc-consistency) rate the plan below the 6/10 self-rating. The plan needs correction before any implementation.

## 3. Consolidated findings (by severity, deduped)

### BLOCKER — must fix before any implementation

**B-1** [Adversarial, Conventions, Doc-consistency, Implementation]. The plan's pre-flight expects `HEAD = b8b43859a7` and "139 commits". Actual is `HEAD = 824ed92b1e` (140 commits — the plan's own commit moved HEAD forward). The pre-flight fails on the first check. **Fix**: drop the specific SHA from the pre-flight, replace with "the working tree contains the plan and the two prior reviews".

**B-2** [Security]. The uncommitted C19 fix in `containment.ts` (which adds `realOrNullAsync` and `isContainedAsync`) is functionally broken because `vault.ts:26` imports only `isContained, realOrNull`, not the async versions. This causes a `ReferenceError: realOrNullAsync is not defined` at `walkMarkdown` runtime. Committing the working tree as-is would regress 9 tests (1 C19 + 8 VaultSource), not fix them. **Fix**: add a Phase 0.5 — "Repair the uncommitted C19 fix" — that adds the two missing imports to `vault.ts:26` before any other work.

**B-3** [Adversarial]. Phase 0 reverts the CHANGELOG to a fixed claim about the 41 fails (637 pass, 41 fail), but Phase 1 is the phase that classifies the 41 fails. If Phase 1 finds that 20 of 41 are bucket 1 (regressions), the Phase 0 CHANGELOG revert is less damning than reality and needs a second correction. **Fix**: swap Phase 0 and Phase 1 — classify first, then write the CHANGELOG to reflect the actual bucket distribution.

**B-4** [Adversarial, Security]. Q4 (portable restrictions — implement in Phase 3, or document as deferred in Phase 4?) is left open but gates the entire security path. Claude's P0-01 shows the absence causes a reproducible P0 leak. **Fix**: make Q4 a Phase 0 decision with a written ADR amendment. Default to "implement minimum portable restrictions in Phase 3" because the security review produced a reproducible leak.

**B-5** [Adversarial, Security, Doc-consistency, Conventions, Implementation]. The plan is 80% stale. Three of nine "what's not done" rows are already done at HEAD `824ed92b1e`:
- R-0012 already exists in `RISKS.md:142-175` (status `OUVERT`, dated 2026-08-29)
- ADR-0006 already carries `ACCEPTED (PARTIALLY IMPLEMENTED)` (amended 2026-08-29)
- DoD status table is filled in (10 PASS, 7 PARTIAL, 4 NOT_EXECUTED)
- PERMISSIONS.md §4/§5/§8 corrections are integrated
- Fence leak already fixed (CHANGELOG v0.3.0)
- `commands-report.ts` already split into `commands-vault.ts` (497 LOC) + `commands-graph.ts` (423 LOC)
- Opus 5 P2 (fence) is **done**, not pending
- Opus 5 P3 (DoD) is **mostly done**, only the U-07 oracle command path needs the 1-line fix
**Fix**: re-take the snapshot against current HEAD before any review is initiated; remove the already-done rows from the "what's not done" lists.

### MAJOR — should fix before Phase 3 / 4

**M-1** [Security, Test-strategy]. C25 and C30 are not in the C18-C24 sequence despite 16 of the 41 fails belonging to them. C25 (writer runtime, 5 fails) and C30 (writer contract, 13 fails) need their own Phase 3 tasks. The `b8b43859a7` commit claims 4 fixes (archive, supersede, move, CAS) but 11 of 14 C30 tests are red at HEAD. **Fix**: rename the corrective-cards phase to C18-C30, or add a Phase 3.5 dedicated to C25 + C30.

**M-2** [Test-strategy]. The 8 VaultSource filtering failures are not C19 characterizations. They are pre-existing functionality tests in `vault.test.ts` that the uncommitted `vault.ts` change appears to have broken. The 3-bucket classification framework cannot distinguish them from C19. **Fix**: add a 5th bucket ("in-flight-fix regression") and add a "verify the 6 VaultSource tests still pass after the vault.ts commit" gate.

**M-3** [Security]. C18 cannot pass without portable restrictions (Opus 5 P1), but the plan defers P1 to Phase 4 as documentation. C18 is structurally unfixable until portable restrictions exist. **Fix**: address portable restrictions in Phase 3 (or document C18 as a Phase 3 card that cannot close).

**M-4** [Test-strategy, Implementation]. The 8 "self-verification gates" are hygiene, not readiness. They verify code compiles and unit tests pass. They do not verify the wire-protocol surface, the real-junction probe, the deadline-vs-slow-source race, or the policy-wiring round-trip. **Fix**: add 4 missing gates — coverage (line-coverage minimum), adversarial-replay (probes scripted and runnable), integration (regression subset pass-rate), policy-round-trip (fixture policy.json → egress decision).

**M-5** [Test-strategy, Implementation]. Phase 6 ("re-run the 14 probes") is theater without scripts. The probes are in prose in the review docs; a fresh agent cannot re-run them reliably in the budgeted 1 hour. **Fix**: commit each probe as a small script under `docs/knowledge/execution/probes/` before Phase 6 starts, so the re-run is one `for f in probes/*.sh; do bash "$f"; done` rather than copy-paste.

**M-6** [Implementation]. Phase 3 (corrective cards) budget is silent. The 7 cards have varying complexity (C19 0.5-1h, C22 2-4h, total 8-15h). The plan is silent. **Fix**: add explicit Phase 3 budget (target 10h, alarm at 14h, stop and re-plan at 18h). Move the `unifia-knowledge.ts` decomposition out of C24 into its own Phase 5 sub-step.

**M-7** [Test-strategy]. The test pyramid imbalance (60 hardening, 22 parser, 3 egress) is named but not addressed. The 4 `decideEgress` tests Opus 5 enumerated in Q7 are not in the work plan. **Fix**: add a Phase 3 sub-task "Egress test depth" that adds the 4 tests, runs them, and marks the 2 that should fail as R-0012 tracking tests.

**M-8** [Adversarial]. Phase 6 acceptance allows "documented P0 leak" as a PASS. Claude's review concludes: "Tant que les cartes correctives … ne sont pas fermées avec les tests de caractérisation demandés, la décision reste NO-GO." **Fix**: Phase 6 acceptance must require **all 14 probes pass**, period. Anything else is BLOCKED.

**M-9** [Adversarial]. Q8 defaulted to "self-declare" but Opus 5 explicitly said "I would re-review". **Fix**: Phase 6 must end with a "second external review required" gate. The implementer does not self-declare.

**M-10** [Implementation]. Phase 2 budget is silent. "If Phase 1 reports zero regressions and zero stale assertions, Phase 2 is a no-op" — otherwise 0.5-4h. **Fix**: add explicit Phase 2 exit criterion.

### MINOR — nice to have

**m-1** [Conventions, Doc-consistency]. The 500-LOC rule per `CLAUDE.md` is scoped to `packages/app/`. The plan extends it to `packages/unifia/bin/` without a documented precedent. **Fix**: add a new decision (e.g., D-0021) recording the project-wide scope.

**m-2** [Conventions]. `commands-report.ts` no longer exists at 891 LOC (already split). `unifia-knowledge.ts` is 1048 LOC, not 1100. **Fix**: update Phase 5 A with the correct target.

**m-3** [Doc-consistency, Conventions]. The CHANGELOG v0.5.0 "revert" is technically wrong per Keep a Changelog. The right move is an in-place amendment, not a deletion. **Fix**: Phase 0.A rewords to "Append corrections to v0.5.0 (do not delete the entry)".

**m-4** [Conventions, Implementation]. R-0012 is already in `RISKS.md`. The plan's Phase 0.C says "add R-0012" — this is a duplicate. **Fix**: rephrase to "verify R-0012 still matches reality, refresh if needed".

**m-5** [Conventions, Implementation]. R-0013 is `CLOSS` at `RISKS.md:180`, not PARTIAL as the plan claims. The closure text already documents the residual gaps. **Fix**: rephrase to "verify the closure text still matches the implementation".

**m-6** [Implementation]. Probe count is 15 (6 Opus 5 + 9 Claude), not 14 as the plan claims. **Fix**: update Phase 6 to "15 probes".

**m-7** [Conventions]. Plan does not specify the per-phase commit type. **Fix**: add a one-line per-phase commit-type table.

**m-8** [Test-strategy]. C20, C21, C24 characterizations all pass at HEAD — they are not in the failing-test count. The plan implies they may be failing; they are not. **Fix**: remove the implication from the plan text.

**m-9** [Doc-consistency]. `git diff --check` failure is exactly one error at `unifia-knowledge.ts:1047: new blank line at EOF.` The plan says "fix any trailing whitespace or blank lines" (broader). **Fix**: specify the exact error.

**m-10** [Adversarial, Conventions, Implementation]. The plan's pre-flight expects to find `containment.ts, vault.ts modified + REVIEW-* untracked` but the working tree now also includes the plan file. **Fix**: pre-flight should be a list of expected files, not a description of state.

### NIT

**n-1** [Adversarial]. The plan's confidence calc mixes three uncertainty classes (coverage, ordering, interpretation). **Fix**: split into three sub-scores.

**n-2** [Conventions]. Phase 0 timing estimate (~30 min) is optimistic given 3 file edits (CHANGELOG, STATE, RISKS) plus coherence check. **Fix**: update to ~45 min.

**n-3** [Conventions]. The vitest config fix (4 bun-style files) is a real choice with two valid answers. **Fix**: commit to one (e.g., move to `test/legacy/` and add a `vitest.config.ts` exclude glob).

## 4. Critical-path corrections (minimum to make the plan executable)

These 7 corrections, in order, would raise the plan from "4/10" to "7/10":

1. **Add Phase 0.5: Repair the uncommitted C19 fix** (1-line import fix in `vault.ts:26`). This is the single most important correction — without it, the plan's "preserve user changes" instruction is unsafe.

2. **Update pre-flight**: drop the specific SHA; check that the working tree contains the plan and the two prior reviews.

3. **Swap Phase 0 and Phase 1**: classify the 41 fails first, then write the CHANGELOG to reflect the bucket distribution. Avoids the order-inversion that re-locks the CHANGELOG.

4. **Make Q4 a Phase 0 decision**: portable restrictions are V1 (Phase 3) or deferred to V1.1 (documented in R-0012). Write the answer in an ADR amendment before any other work.

5. **Re-take the snapshot against current HEAD `824ed92b1e`**: remove the 3 already-done rows from the "what's not done" lists. R-0012 already exists; ADR-0006 is already amended; DoD is already updated; fence is already fixed; `commands-report.ts` is already split.

6. **Add C25 and C30 to the corrective cards**: rename "C18-C24" to "C18-C30" in the plan, or add a Phase 3.5. The 16 of 41 fails in C25 + C30 are invisible to the plan as written.

7. **Replace 3-bucket with 5-bucket classification**: add "in-flight-fix regression" (for the 8 VaultSource filtering fails) and "test-infrastructure rot" (for the C25 cases where the writer's contract evolved). Without these, Phase 1's classification is wrong.

## 5. Recommended re-authoring approach

Given the volume of corrections (1 BLOCKER + 1 BLOCKER + 4 MAJOR + 4 MAJOR = ~10 critical changes), a full rewrite of the plan is more efficient than 10 patch edits. Recommended approach:

1. **Re-author the plan as `PRODUCTION-READINESS-PLAN-2026-08-30.v2.md`** with the corrections integrated.
2. **Keep v1 in history** for the audit trail.
3. **Update the 8 open questions** to reflect what the reviewers answered.
4. **Add the missing gates** to the gate list.
5. **Commit the v2 plan** with a clear note: "supersedes v1, integrates 6-reviewer feedback".

## 6. Self-confidence

**6/10 → 7.5/10 after the critical-path corrections above.**

The 4-5 of 6 reviewers rating the plan below 6/10 reflects that the plan is **operationally stale** even where internally coherent. After the corrections, the plan would be both internally coherent and operationally current. The remaining 2.5 points of confidence are bounded by:

- Unknown bucket distribution of the 41 fails (until Phase 1 runs)
- C22 wire-protocol risk (until the failing C26 tests are diagnosed)
- Cross-platform test coverage (the plan is silent on macOS/Linux)

---

*Aggregated 2026-08-30 from 6 parallel reviewers. Each reviewer was
given an independent prompt and the 3 source files. Findings are
sorted by severity and deduped. Source: REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.md
in the worktree + D:\Documents\Obsidian\IA_Dev_Brain\Unifia\*.
6 reviewers: adversarial, security, conventions, test-strategy, implementation-feasibility, doc-consistency.*
