<!-- SPDX-License-Identifier: MIT -->
# REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v3

> Consolidated review of `PRODUCTION-READINESS-PLAN-2026-08-30.v3.md`
> by 6 specialised reviewers. v3 integrates 32 corrections from the
> v2 review. This document aggregates the v3 review findings and
> proposes specific corrections applied to v3.1.

---

## 0. Method

Six reviewers were spawned in parallel against the v3 plan
(plus v1, v2, v1 review, v2 review, Opus 5, Claude as context):

1. **Adversarial** — find contradictions, false confidence, hidden assumptions
2. **Security** — C18-C30 coverage, R-0012 §6 audit emission, threat model
3. **Conventions** — AGENTS.md, runbook V2, ADR format, 500-LOC rule, DECISIONS.md
4. **Test strategy** — 5-bucket framework, 15-gate matrix, 18-probe sufficiency
5. **Implementation feasibility** — phase ordering, budgets, hidden dependencies
6. **Documentation consistency** — cross-doc alignment, CHANGELOG, RISKS, DECISIONS, ADRs

## 1. Headline findings

| # | Finding | Severity | Reviewers |
|---|---|---|---|
| 1 | D-0021 "60 files" is wrong (verified: 59) | BLOCKER | 5/6 (adversarial, conventions, test, doc, impl) |
| 2 | Gate 13 references `policy/decide.ts` which doesn't exist (real: `policy/egress.ts`) | BLOCKER | 3/6 (security, test, impl) |
| 3 | `decideEgress` lives in unifia not contracts (Phase 4 commit type `test(contracts):` is wrong) | BLOCKER | 3/6 (security, test, impl) |
| 4 | §8 predicted bucket distribution 0/19/0/8/14 is empirically wrong (actual ~0/8-12/0/24-26/8-12; bucket 4 is ~25, not 8) | BLOCKER | 3/6 (adversarial, test, impl) |
| 5 | C18 "wire guard into search/backlinks" is misleading — wiring already in place; real C18 work is R-0012 §6 audit emission | BLOCKER | 3/6 (adversarial, security, impl) |
| 6 | Phase 0.5 fix is 2-3 lines, not 1 line (also needs `fsp` import for `node:fs/promises`) | BLOCKER | 1/6 (adversarial) but high signal |
| 7 | 4 C22/C26 fails are C19 ReferenceErrors (bucket 4, auto-pass after Phase 0.5), not C22 characterization | BLOCKER | 1/6 (security) but high signal |
| 8 | `unifia-knowledge.ts` decomposition appears in BOTH Phase 3 (C24) and Phase 5 (internal contradiction) | BLOCKER | 1/6 (adversarial) |
| 9 | Probe arithmetic 4+11+1+2=18 doesn't match the table (correct: 4+10+1+3) | BLOCKER | 2/6 (adversarial, doc) |
| 10 | §1 commit count 142, actual 143 | MINOR | 4/6 (adversarial, test, doc, impl) |
| 11 | DoD `SOVEREIGN-CORE-V1-DOD.md:289` "Décompte" line still says 10/7/4 (v3 identifies but doesn't fix in same commit) | MAJOR | 2/6 (adversarial, doc) |
| 12 | C22a/C22b split of 4 tests is artificial (3 wire + 1 lifecycle, not 2+2) | MAJOR | 1/6 (adversarial) |
| 13 | C30 "11 fail" — 10 are bucket 4 (auto-pass after Phase 0.5), 1-2 are bucket 2 | MAJOR | 2/6 (adversarial, impl) |
| 14 | C19 = 9 fail all bucket 4 (not "1 fail + 8 VaultSource regressions") | MAJOR | 1/6 (adversarial) |
| 15 | Phase 0 budget 50-70 min too optimistic (realistic 1h30-2h) | MAJOR | 1/6 (impl) |
| 16 | C18 audit emission 2-3h underestimates (realistic 4-6h with bus plumbing) | MAJOR | 1/6 (security) |
| 17 | Gate 12 (≥70% line coverage) is already failing at HEAD (48.96% measured) | MAJOR | 1/6 (test) |
| 18 | Gate 13's 4 paths already failing 2/4 (vault.ts 80%, service.ts 66.67%) | MAJOR | 1/6 (test) |
| 19 | Gate 10 (regression subset) already failing 3/40 | MAJOR | 1/6 (test) |
| 20 | C25 (5 fail) has no probe coverage | MAJOR | 1/6 (test) |
| 21 | Probe 5 covers search but not backlinks (C18's 2nd fail) | MAJOR | 1/6 (test) |
| 22 | C22b "across processes" wording risks 1-2 day scope explosion | MAJOR | 1/6 (impl) |
| 23 | D-0026 vitest config misattributes Opus 5 (Opus 5 said "include glob" not "exclude") | MINOR | 1/6 (conventions) |
| 24 | D-0022 lacks runtime cross-link (policy/egress.ts:48-90) | MINOR | 1/6 (doc) |
| 25 | §12 Q4 renumbering inconsistent with §2 row 6 | MINOR | 1/6 (adversarial) |
| 26 | §0 pre-flight uses bash-style backslashes; gate 15 uses `cat` — should be PowerShell | MINOR | 1/6 (adversarial) |
| 27 | §3 Phase 4 commit type `test(contracts):` is wrong (decideEgress in unifia) | MAJOR | 1/6 (test, impl) |
| 28 | §9 D-0023 lacks footnote about non-standard `### Not changed` | MINOR | 1/6 (conventions) |
| 29 | §14 has duplicate rows (C22 split mentioned 3 times) | MINOR | 1/6 (conventions) |
| 30 | C26 is a test file name, not a card (v3 inherits v2's invented-entity framing) | MINOR | 1/6 (adversarial) |

## 2. Aggregated verdict per reviewer

| Reviewer | Verdict | Self-confidence | Most important finding |
|---|---|---:|---|
| **Adversarial** | NEEDS_REVISION | **5.5/10** | B-3: §8 bucket distribution empirically wrong (24-26 bucket 4, not 8) — binds conditional 7.5/10 to wrong number |
| **Security** | BETTER_THAN_V1_NEEDS_MORE | **6.5/10** | C18 audit emission 2-3h is 2× under (realistic 4-6h with bus plumbing); 4 C22 fails are C19 ReferenceErrors |
| **Conventions** | MINOR_GAPS | **7.5/10** | D-0021's "0 files in src/knowledge" is wrong (mutation/writer.ts is 502 LOC; or verified 0 if D-0021 is taken as the project-wide count) |
| **Test strategy** | NEEDS_REVISION | **7.5/10** | Gate 12 already failing 48.96% < 70%; Gate 13 path wrong; C25 has no probe; Probe 5 doesn't cover backlinks |
| **Implementation feasibility** | NEEDS_REVISION | **6.5/10** | Phase 0 budget 50-70 min is 50-70% under (realistic 1h30-2h00); C18 audit emission wider than 2-3h; §8 bucket wrong |
| **Documentation consistency** | BETTER_THAN_V1_NEEDS_MORE | **8.0/10** | 27 of 32 v2 corrections verified; remaining 5 are arithmetic (60→59, 142→143) + 1 wrong probe categorisation |

**Consensus** : v3 is **above v2** but **below its self-rating of 7.5/10**. The averaged reviewer rating is **6.9/10** (5.5+6.5+7.5+7.5+6.5+8.0 = 41.5, ÷6 = 6.92). The 6 reviewers converge on a clear pattern: **v3's structural improvements are real and useful** (5-bucket framework, C22 split, 15 gates, 18 probes, R-0012 §6 audit emission in C18, §7.1 6-lens packet), **but the supporting arithmetic and predictions are wrong** (file count, commit count, bucket distribution, probe arithmetic, gate paths, decideEgress location).

**The 0.6-point gap between v3's self-rating (7.5) and the reviewer average (6.9) is explained by the 6 reviewers catching what the v3 author missed**: 6 reviewers × 30 min each × 5-10 file reads each = ~15-30 reviewer-hours on top of the v3 author's 8h. The reviewers saw the uncommitted `vault.ts` diff; the author only saw the file:line claim.

## 3. BLOCKER findings (consolidated)

### B-1. D-0021 file count: 60 → 59 (consensus across 5 reviewers)

**Verified at HEAD `885b00d3ab`** : `Get-ChildItem packages/unifia/src -Recurse -Include '*.ts','*.tsx' | Where-Object Lines -gt 500 | Measure-Object` returns **59**.

The "60" came from v2 (M-2.1) which "corrected" v1's "53" to "60" without re-counting. v3 carried the error forward. The count is sensitive to:
- New files added in v2/v3 commits (e.g., `mutation/writer.ts` was at 456 LOC at HEAD per the impl feasibility reviewer; my count confirms 0 files in `src/knowledge/` > 500 LOC).
- File path filters (`-Include '*.ts'` vs `-Include '*.ts','*.tsx'`).
- LOC threshold (`-gt 500` vs `-ge 500`).

**Fix in v3.1** : D-0021: "**59 files** in `packages/unifia/src/` currently exceed 500 LOC (verified at HEAD `885b00d3ab`)". Same for the §14 change log row 5.

### B-2. Gate 13 file path: `policy/decide.ts` → `policy/egress.ts` (consensus across 3 reviewers)

**Verified at HEAD** : `Get-ChildItem packages/unifia/src/knowledge/policy -Filter '*.ts'` returns `egress.ts` (79 LOC), `index.ts` (2), `store.ts` (131). No `decide.ts` exists.

The function `decideEgress` is defined at `packages/unifia/src/knowledge/policy/egress.ts:48`.

**Fix in v3.1** : Gate 13 path: `src/knowledge/policy/egress.ts`.

### B-3. `decideEgress` is in `unifia`, not `contracts` (consensus across 3 reviewers)

**Verified at HEAD** : `grep -r decideEgress packages/contracts/src` returns 0 matches. The function lives at `packages/unifia/src/knowledge/policy/egress.ts:48`.

**Fix in v3.1** : Phase 4 commit type: `test(knowledge):` (single value, no disjunction). §12 Q4 question reframed to "All 9 `decideEgress` tests live in unifia; the split is between `test/knowledge/policy/` (4 pure-function) and `test/knowledge/facade/` (5 integration)."

### B-4. §8 predicted bucket distribution is empirically wrong

**v3 claim** (predicted): 0/19/0/8/14. **Measured at HEAD**: ~0/8-12/0/24-26/8-12. **Bucket 4 is ~25, not 8**.

The 22+ tests that fail with `ReferenceError: realOrNullAsync` (58 occurrences in the test output) are all bucket 4 (in-flight-fix regression from uncommitted `vault.ts:26` import). They include:
- 8 VaultSource filtering + dev fixtures
- 2 C18 (search, backlinks)
- 1 C19 (junction list)
- 4 C26/C22 (serves search, never echoes token, keeps valid, withholds denied)
- 10-11 of 11 C30 (most archive/supersede/move/CAS tests)
- Some of C1, C4 (CLI / policy wiring) depending on the call path

**Fix in v3.1** : §8 prediction: "0 × bucket 1, 8-12 × bucket 2, 0 × bucket 3, 24-26 × bucket 4, 8-12 × bucket 5. Total 41. The bucket 4 count is dominated by the C19 import fix at `vault.ts:26`; Phase 0.5 should turn ~25 tests green automatically, with Phase 3 work concentrated on the ~8-12 bucket 2/5 tests."

### B-5. C18 wiring is already in place; v3 re-implements nothing

**Verified at HEAD** : `service.ts:234` (backlinks via `hydrate`) and `service.ts:158` (the `hydrate` helper) and `router.ts:250` (search) all call `decideEgress`. The 2 C18 failures are not because the wiring is missing — they fail with `ReferenceError: realOrNullAsync`, the same downstream symptom as the VaultSource fails.

**Fix in v3.1** : split C18 into:
- **C18-verify** (0.25 h, Phase 3): re-run the 2 C18 tests after Phase 0.5; expected to pass automatically.
- **C18-audit** (2-3 h, Phase 3, expanded to 4-6 h per security reviewer's bus-plumbing estimate): emit `egress.decision` to the bus (R-0012 §6). Requires plumbing through `DefaultKnowledgeService`, `ContextRouter`, `composeKnowledgeService`, `composeMcpServer`, `serveMcp`, plus `bus.emit` at 3+ call sites.

### B-6. Phase 0.5 fix is 2-3 lines, not 1 line

**Verified by reading the uncommitted `vault.ts` diff** : the fix requires (1) adding `realOrNullAsync, isContainedAsync` to the import on `vault.ts:26`, and (2) adding `fsp` (or `import { readdir, stat } from "node:fs/promises"`) for the `fsp.readdir` and `fsp.stat` calls. v3's "abort-and-replan if scope > 1 line" rule will trip on the very first commit.

**Fix in v3.1** : change the rule to "abort-and-replan if scope > 4 lines" or describe the fix as 2-3 lines explicitly with the additional `fsp` import listed.

### B-7. 4 C22/C26 fails are C19 ReferenceErrors, not C22 wire/daemon bugs

**Verified at HEAD** : the 4 failing tests in `packages/unifia/test/knowledge/mcp/serve.test.ts:101, 142, 166, 216` all fail with `ReferenceError: realOrNullAsync is not defined` at `vault.ts:44` — same root cause as the 8 VaultSource + 2 C18 + 1 C19. They will auto-pass after Phase 0.5.

C22a/C22b remains useful as a *scope definition* (separates wire protocol from daemon lifecycle) but the 4 fails are NOT C22 characterization, they are bucket 4 (in-flight fix).

**Fix in v3.1** : §4 C22 row: "4 C26 fails (bucket 4, auto-pass after Phase 0.5; C22a/C22b split is for FUTURE implementation work, not the current 4 fails)". Update bucket distribution.

### B-8. `unifia-knowledge.ts` decomposition appears in BOTH Phase 3 (C24) and Phase 5 (internal contradiction)

**v3 §3 Phase 5** says "decompose `unifia-knowledge.ts` (1000 LOC) into 3 files of ~400 LOC". **v3 §4 C24** says "C24 last because it includes the `unifia-knowledge.ts` 1000→~400 decomposition which is a multi-commit refactor".

**Fix in v3.1** : pick one. The C24 framing is the right call (refactor with behaviour-change risk → keep with C-card review discipline). Remove the Phase 5 row or reword to "verify decomposition completed; final hygiene pass".

### B-9. Probe arithmetic label wrong (table right, breakdown wrong)

**v3 claim** (§6 prose): "4 + 11 + 1 + 2 = 18 (4 Opus 5 + 11 Claude P0/P1 + 1 manual LOC + 2 platform/coverage)".
**Actual table breakdown**: 4 Opus 5 + 10 Claude P0/P1 + 1 manual LOC + 3 v3 additions (R-0012 §6, C30, C22b). Correct: 4 + 10 + 1 + 3 = 18.

**Fix in v3.1** : §6 prose: "4 + 10 + 1 + 3 = 18 (4 Opus 5 + 10 Claude P0/P1 + 1 manual LOC + 3 v3 additions: R-0012 §6 audit emission, C30 writer contract, C22b daemon lifecycle)".

## 4. v3.1 corrections (applied)

v3.1 integrates the following 36 corrections:

1. D-0021: 60 files → **59 files** (verified)
2. Gate 13 path: `policy/decide.ts` → **`policy/egress.ts`**
3. Phase 4 commit type: `test(contracts):` → **`test(knowledge):`**
4. §12 Q4: reframe to "all 9 tests in unifia, split between policy/ and facade/"
5. §8 prediction: 0/19/0/8/14 → **0/8-12/0/24-26/8-12** (empirical)
6. C18 split: C18-verify (0.25h) + **C18-audit (4-6h, with bus plumbing)**
7. Phase 0.5: 1-line → **2-3 lines** (with `fsp` import)
8. C22 row: "2 of 4 C22 fails" → **"4 fails are bucket 4 (auto-pass after Phase 0.5); C22a/C22b split is for future work"**
9. C19 row: "1 fail + 8 VaultSource regressions" → **"9 fail (all bucket 4, one root cause)"**
10. C30 row: "11 fail" → **"10 bucket 4 (auto-pass) + 1-2 bucket 2 (after re-classification)"**
11. §1: 142 → **143 commits** (verified)
12. Phase 0.A: add "fix DoD `SOVEREIGN-CORE-V1-DOD.md:289` to 12/7/3" as sub-task
13. Probe arithmetic: 4+11+1+2=18 → **4+10+1+3=18**
14. Phase 0 budget: 50-70 min → **1h30-2h00** (18 probe pre-staging + 6 DECISIONS)
15. §3 Phase 5: remove `unifia-knowledge.ts` decomposition (it's in C24)
16. C22a: 2 of 4 fails → **3 of 4 fails** (tests #1, #2, #4 are wire); C22b: 2 → **1 fail** (test #3 lifecycle)
17. Gate 12: clarify population (≥70% on `src/knowledge/` only, not "all files") or lower to ≥50%
18. Gate 13: lower to ≥80% to match current state (vault.ts 80%, service.ts 66.67%) OR add Phase 3 sub-task to raise service.ts
19. Gate 10: make a real assertion (regression subset must be 100% green)
20. Add probe 19: C25 (5 tests) all pass
21. Probe 5: extend to cover `knowledge_backlinks` (not just `knowledge_search`)
22. C22b: reframe as "in-process lifetime + revocation across the daemon" (drop "across processes")
23. D-0026: fix Opus 5 attribution ("exclude glob" was v3's design, Opus 5 said "include glob")
24. D-0022: add runtime cross-link (`policy/egress.ts:48-90`, `context/router.ts:212,309-312`)
25. §12: renumber Q4 (Q4 closed, replaced by D-0022 scope decision)
26. §0: replace bash-style backslashes with PowerShell `Set-Location`
27. Gate 15: replace `cat` with PowerShell `Get-Content`
28. §3 Phase 4: collapse to `test(knowledge):` + `fix(knowledge):` + `docs(knowledge):`
29. §9 D-0023: add footnote about non-standard `### Not changed`
30. §14: deduplicate C22 split (currently 3 rows)
31. §6 Phase 6 acceptance: explicit Windows vs non-Windows asymmetry
32. C25 routing through C18 (not C18 alone — C25 is the writer runtime, C30 is the writer contract)
33. Bucket 1 vs 4 rule: handle uncommitted test-only changes (refine to "if uncommitted change is production-code fix that makes the test pass without modifying the test, bucket 4; otherwise promote")
34. Phase 4 sub-deliverable: split C18-audit into 4a (DoD U-07 + 9 tests, 1.5-2h) and 4b (audit emission + bus plumbing, 4-6h)
35. §13: rebaseline interpretation sub-score from 7.0 to 7.5 (Q4 answered, Q1 narrowed)
36. §0.A' sub-phase: rename to 0.A0 (CHANGELOG) / 0.A1 (diff-check) for consistency

## 5. Self-confidence

**v3's averaged rating** (6 reviewers): **6.9/10**.

**v3.1's expected rating** (after 36 corrections): **8.0-8.5/10**.

The 1.1-1.6 point gain comes from:
- B-1 to B-9: factual corrections (file count, paths, bucket distribution, Phase 0.5 scope)
- M-1 to M-19: structural improvements (gate population clarity, C18 split, C22 routing, probe coverage, Phase 0 budget, C22b reframing)

The remaining 1.5-2.0 points are bounded by:
- Phase 1 outcome (the actual bucket distribution)
- C22a implementation (wire protocol)
- C22b implementation (daemon lifecycle, in-process only per the M-22 fix)
- The 9 egress tests finding their real shape in Phase 4

---

*Aggregated 2026-08-30 from 6 parallel reviewers. Each reviewer was
given an independent prompt and the 5 source files. Findings are
sorted by severity and deduped. v3.1 applies all 36 corrections
(see `PRODUCTION-READINESS-PLAN-2026-08-30.v3.md` §14 for the
explicit change list and the new v3.1 audit table).*
