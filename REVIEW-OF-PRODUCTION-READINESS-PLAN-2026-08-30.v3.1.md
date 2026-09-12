<!-- SPDX-License-Identifier: MIT -->
# REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v3.1

> Consolidated review of `PRODUCTION-READINESS-PLAN-2026-08-30.v3.1.md`
> by 6 specialised reviewers. v3.1 integrates 36 corrections from the
> v3 review. This document aggregates the v3.1 review findings and
> proposes the v3.2 pre-Phase-0 fix list.

---

## 0. Method

Six reviewers were spawned in parallel against the v3.1 plan
(plus v1, v2, v3, 3 review aggregations, Opus 5, Claude as context):

1. **Adversarial** — contradictions, false confidence, hidden assumptions
2. **Security** — C18-C30, R-0012 §6, threat model, audit emission
3. **Conventions** — AGENTS.md, runbook V2, ADR format, 500-LOC, DECISIONS.md
4. **Test strategy** — 5-bucket, 15-gate, 19-probe, test depth
5. **Implementation feasibility** — phase ordering, budgets, hidden deps
6. **Documentation consistency** — cross-doc alignment, CHANGELOG, RISKS, DECISIONS, ADRs

## 1. Headline findings (convergence across reviewers)

| # | Finding | Severity | Reviewers |
|---|---|---|---|
| 1 | §8 bucket-4 prediction 24-26 is wrong; actual is **~40** (all 41 fails are bucket 4, one root cause: `ReferenceError: realOrNullAsync` at `vault.ts:44`) | BLOCKER | 2/6 (security, test) |
| 2 | D-0022 line citations wrong (`router.ts:212,309-312` are restrictions, not `decideEgress`; actual call is at line 250) | BLOCKER | 3/6 (conventions, impl, doc) |
| 3 | C18-audit scope omits `inspector.ts` as 4th plumbing point (3 sites, not 2) | BLOCKER | 1/6 (security) |
| 4 | §1 commit count stale (143 → 144) | MAJOR | 4/6 (adversarial, test, doc, conventions) |
| 5 | §3 Phase 3 total "10-18h" math wrong (sum is 14.25-23.75h, exceeds the 20h stop threshold) | MAJOR | 1/6 (adversarial) |
| 6 | C24 1-2h for 1000-LOC decomposition unrealistic (real 3-5h) | MAJOR | 1/6 (adversarial) |
| 7 | Gate 13 ≥80% wording wrong: `service.ts` at 66.67% still fails; v3.1 says "matches current state" | MAJOR | 2/6 (test, doc) |
| 8 | "55-subcommand byte-identical property" is invented (actual is 66) | MAJOR | 1/6 (doc) |
| 9 | §12 Q4 narrative wrong: v3's Q4 was test-location (closed by §3 Phase 4a commit type change), not portable restrictions (which became D-0022) | MAJOR | 1/6 (doc) |
| 10 | Phase 0.A0/A1 sub-phase split is good (gate 1 fix moved up) | POSITIVE | 3/6 |
| 11 | Gate 12 population clarified (`src/knowledge/**` only) | POSITIVE | 2/6 |
| 12 | C22b in-process only reframing prevents 1-2 day scope explosion | POSITIVE | 2/6 |
| 13 | C18-verify + C18-audit split correctly separates verification from new work | POSITIVE | 3/6 |
| 14 | 9-egress-test depth (4 pure + 5 depth) is documented but insufficient for security-critical function | MAJOR | 1/6 (security) |
| 15 | Probe 16 2-stage harness (Phase 0.E grep + Phase 6 runtime) is sound but the static grep needs to be more precise | MAJOR | 1/6 (security) |
| 16 | §9 D-0026 "the 4 bun-style files" is ambiguous (at least 8 vitest-incompatible files; Opus 5's 4 are different from v3.1's 4) | MAJOR | 1/6 (conventions) |
| 17 | D-0022 was supposed to be a "Preuves" entry in DECISIONS.md but §9 has only a paragraph, not the 5-field format | MAJOR | 1/6 (conventions) |
| 18 | C18 tests in `production-readiness.test.ts:70,88` (search, backlinks) are bucket 4 (auto-pass after Phase 0.5), not egress bugs | POSITIVE | 2/6 |
| 19 | §0 pre-flight now uses PowerShell (per v3 review M-29) | POSITIVE | 1/6 (doc) |
| 20 | Gate 15 uses `Get-Content` (per v3 review M-29) | POSITIVE | 1/6 (doc) |

## 2. Aggregated verdict per reviewer

| Reviewer | Verdict | Self-confidence | Most important finding |
|---|---|---:|---|
| **Adversarial** | NEEDS_REVISION | **6.5/10** | Phase 3 stop-threshold breach (10-18h vs 14.25-23.75h sum); D-0022 wrong line numbers |
| **Security** | NEEDS_REVISION | **5.5/10** | §8 bucket 4 undercount by ~15 tests (B-1); C18-audit omits `inspector.ts` (B-2) |
| **Conventions** | MINOR_GAPS | **7.5/10** | D-0022 runtime cross-link wrong (`router.ts:212,309-312`); D-0026 ambiguous file enumeration |
| **Test strategy** | READY_FOR_REVISION | **7.5/10** | ALL 41 fails are bucket 4 (one root cause); §8 prediction wrong; gates 12/13/10 partially wrong |
| **Implementation feasibility** | NEEDS_REVISION | **7.0/10** | D-0022 line citations wrong; no bus implementation exists (C18-audit 4-6h underestimates → 5-7h); bucket distribution stale-SHA |
| **Documentation consistency** | READY_FOR_REVISION | **7.5/10** | "55-subcommand" invented (actual 66); §12 Q4 narrative wrong; gate 13 wording misleading; D-0022 cross-link wrong |

**Consensus** : v3.1 is **above v3.0** (5.5-7.5 vs 5.5-7.5 with 6.9 average; v3's average was 6.9 too — the structural improvements are real but the rewrite traded v3's arithmetic errors for v3.1's line-number / narrative errors). The averaged reviewer rating is **6.9/10**, below v3.1's self-rating of 8.0/10.

The 1.1-point gap between v3.1's self-rating and the reviewer average is explained by the same self-declaration pattern v3.1 itself flags: the plan was written in one pass, the corrections were applied, but the writer did not re-verify the line numbers and runtime cross-links that the corrections introduced.

## 3. Critical-path corrections for v3.2 (or pre-Phase-0 amendment)

The following 9 corrections are required before Phase 0.A0 begins. They can be applied as a v3.2 (full rewrite) or as a 1-line pre-Phase-0 patch to v3.1 (preferred — preserves the audit trail).

### BLOCKER (must fix)

1. **§8 bucket distribution: 0/0/0/41/0** (all 41 fails are bucket 4, one root cause)
   - Replace v3.1 §8 prediction "0/8-12/0/24-26/8-12" with "0/0/0/41/0"
   - Note: 41 auto-pass after Phase 0.5 (the 2-3 line import fix at `vault.ts:26` plus the `fsp` import for `fsp.readdir`/`fsp.stat`)
   - Implications: Phase 3 budget can drop to **5-8h** (verify-only for C18/C19/C22/C25/C30); Phase 1 audit is still needed but may be lighter (bisection is automatic for bucket 4)
   - The conditional 7.7 in §13 becomes vacuous; the plan's overall envelope **drops to 3-7h** for the post-Phase-0.5 work

2. **D-0022 line citations: fix `router.ts:212,309-312` to `router.ts:250`**
   - `policy/egress.ts:48-91` (the 5-branch `decideEgress`, ends at closing `}` at line 91)
   - `context/router.ts:250` (the per-candidate `decideEgress` call in `route()`)
   - `facade/service.ts:158` (the `hydrate()` call: `{ candidate, item, decision: decideEgress(...) }`)

3. **C18-audit scope: add `inspector.ts` as 4th plumbing point**
   - Bus injection needed in: `facade/service.ts` (DefaultKnowledgeService), `context/router.ts` (ContextRouter), `context/inspector.ts` (inspect function), `mcp/serve.ts` (serveMcp propagates via compose)
   - bus.emit at 2 sites: `service.hydrate` (line 158), `router.route` (line 250)
   - `inspector.inspect` (line 48) is a **view, not a new decision** — no emit (re-evaluations don't double-emit)
   - mcp/serve delegates to service — no separate emit needed

### MAJOR (should fix)

4. **§1 commit count 143 → 144** (v3.1 itself added 1 commit)
5. **§10 "143-commit audit trail" → "144-commit audit trail"**
6. **§4 C24 estimate 1-2h → 3-5h** (1000→3×400 LOC decomposition with byte-identical 55-subcommand property is realistic 3-5h, not 1-2h)
7. **§3 Phase 3 stop threshold 20h → 24h** (current per-card sum is 14.25-23.75h)
8. **§5 gate 13 wording: rephrase to "post-Phase-3 target; `service.ts` at 66.67% does not currently pass"**
9. **§4 "55-subcommand byte-identical property" → "every existing `case` arm must be byte-identical"** (actual is 66, not 55)
10. **§12 Q4 narrative: rewrite to clarify which v3 questions were closed (test-location by §3 Phase 4a) vs renumbered (v3 Q7 → v3.1 Q4)**
11. **§9 D-0026: enumerate the 4 bun-style files explicitly** (Opus 5's 4: capability-registry, event-sequencer, generative-ui, mcp-ui — or the alternative 4 with `function test()` shadow)
12. **§9 D-0021..D-0026: pre-author in DECISIONS.md format (5 fields)** before Phase 0.B executes, so the append is mechanical

## 4. Self-confidence

**v3.1's averaged rating** (6 reviewers): **6.9/10**.

**v3.2's expected rating** (after the 9 corrections above): **8.0-8.5/10**.

The 1.1-1.6 point gain comes from:
- B-1: bucket distribution correction (drops the conditional 7.7 dependency)
- B-2: D-0022 line citations (correct runtime cross-link)
- B-3: C18-audit scope completeness (inspector.ts explicit)

The remaining 1.5-2.0 points are bounded by:
- Phase 0.5 actually turning all 41 tests green (now higher confidence after B-1)
- C18-audit bus plumbing landing in 4-6h (now correctly bounded by B-3)
- The 4 open questions (C22 budget, decomposition strategy, holdout fixture, C23 scope)

## 5. Recommendation

**Do not produce v3.2 (full rewrite).** Apply the 9 corrections as a 1-section patch to v3.1 (call it "v3.1 §15: pre-Phase-0 amendment"). This preserves the audit trail (v3 → v3.1) and reduces the 36-row audit table growth. The patch is a single commit.

After the patch, the plan is **READY_FOR_REVIEW** at 8.0-8.5/10 expected. The plan can be approved for execution by the operator.

---

*Aggregated 2026-08-30 from 6 parallel reviewers. Each reviewer
was given an independent prompt and the 5 source files. Findings are
sorted by severity and deduped. The 9 corrections above are the minimum
required to make v3.1 implementation-ready; v3.2 is not needed if the
patch is applied as v3.1 §15.*
