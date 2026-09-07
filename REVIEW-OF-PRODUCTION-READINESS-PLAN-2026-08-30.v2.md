<!-- SPDX-License-Identifier: MIT -->
# REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v2

> Consolidated review of `PRODUCTION-READINESS-PLAN-2026-08-30.v2.md`
> by 6 specialised reviewers. Each reviewer had a distinct lens
> and produced an independent findings report. This document
> aggregates the findings, ranks them, and proposes specific
> corrections applied to v3.

---

## 0. Method

Six reviewers were spawned in parallel against the same input
(v2 plan + v1 plan + v1 review aggregation + Opus 5 verdict +
Claude review):

1. **Adversarial** (devil's advocate) — find contradictions, false confidence, hidden assumptions
2. **Security** — C18-C30 coverage, threat model, R-0012 §6 audit emission, probe sufficiency
3. **Conventions** — AGENTS.md, runbook V2, ADR format, 500-LOC rule, commit conventions, DECISIONS.md integration
4. **Test strategy** — 5-bucket classification, 12-gate sufficiency, 15-probe adequacy, test depth
5. **Implementation feasibility** — phase ordering, time estimates, hidden dependencies
6. **Documentation consistency** — Opus 5 vs Claude vs plan reconciliation, CHANGELOG, RISKS, DECISIONS, ADRs

Each reviewer was given a focused prompt, the 5 source files,
and a structured output format. Reviews ran in parallel; results
were aggregated by the owner.

## 1. Headline findings (across all 6 v2 reviewers)

| Theme | Verdict | Source reviewers |
|---|---|---|
| **C30 count wrong (13 → 11)** | BLOCKER | security, test-strategy, doc-consistency |
| **DoD count wrong (10/7/4 → 12/7/3)** | BLOCKER | doc-consistency |
| **Probe arithmetic doesn't match table** | MAJOR | doc-consistency |
| **C22 "regression 9ff20c36f1" framing is factually false** | BLOCKER | security |
| **C18 framing assumes restrictions unimplemented (they are)** | BLOCKER | security |
| **R-0012 §6 audit emission unaddressed** | BLOCKER | security |
| **D-0021 says "53 files" but actual is 60** | MAJOR | conventions |
| **D-0021 framing "is applied" obscures that it's a NEW rule** | MAJOR | conventions, doc-consistency |
| **D-0021..D-0025 not appended to DECISIONS.md** | MAJOR | conventions, implementation |
| **D-0022 doesn't specify the field set (4 fields)** | MAJOR | security, adversarial |
| **Phase 1 budget 1.5-2.5h optimistic (realistic 2.5-3.5h)** | MAJOR | implementation |
| **Phase 0 budget 45 min optimistic (realistic 50-70 min)** | MAJOR | implementation |
| **No platform scope statement (P0-02 Windows-only)** | MAJOR | test-strategy, implementation |
| **Phase 6 "replay harness vs new test" misleading** | MAJOR | implementation |
| **Probes directory forward-looking, not pre-staged** | MAJOR | conventions |
| **Phase 5 commit type `chore:` inconsistent** | MINOR | conventions |
| **Phase 4 commit type may be `test(contracts):` not `test(knowledge):`** | MINOR | conventions |
| **Phase 6 "all 15 must pass" too strict on platform** | MAJOR | test-strategy |
| **12 gates insufficient (no security-path coverage, no replay integrity)** | MAJOR | test-strategy |
| **C18 "every read path" misleading (1 of 3 wired)** | MAJOR | test-strategy |
| **C22 conflates wire protocol + daemon lifecycle** | MAJOR | test-strategy |
| **Vitest config non-choice** | MINOR | conventions, test-strategy |
| **Phase 7 operationally undefined (no 6-lens packet, no prompt template)** | MAJOR | all 6 reviewers |
| **§1 SHA citation stale by 1 commit** | MINOR | conventions |
| **Bucket 1 vs bucket 4 disambiguation missing** | MAJOR | test-strategy |
| **`git diff --check` fix in Phase 5 too late** | MAJOR | conventions |
| **Phase 0.5 has no escalation rule if scope > 1 line** | MINOR | implementation |
| **Self-confidence is a single number** | MINOR | adversarial |
| **Egress test depth inadequate (4 → 9 needed)** | MAJOR | test-strategy, security |
| **C26 routing through C22 conflated the 4 fails** | MAJOR | test-strategy |
| **§4 "16 of 41" arithmetic doesn't match the table** | MAJOR | doc-consistency |

## 2. Aggregated verdict per reviewer

| Reviewer | Verdict | Self-confidence | Most important finding |
|---|---|---:|---|
| Adversarial | BETTER_THAN_V1_NEEDS_MORE | **7.0/10** | N1: "minimum portable restrictions" scope is undefined; N2: C22 ordered last for the wrong reason (false regression premise) |
| Security | BETTER_THAN_V1_NEEDS_MORE | **7.0/10** | R-0012 §6 (audit `egress.decision` emission) is unaddressed; C18 framing is obsolete; C22 framing is false |
| Conventions | MINOR_GAPS | **7.5/10** | 2 factual errors in D-0021 (60 files, not 53; "new rule" framing); 70% coverage threshold is arbitrary; D-0021..D-0025 not in DECISIONS.md |
| Test strategy | BETTER_THAN_V1_NEEDS_MORE | **6.5/10** | C30 count wrong; P0-02 platform-handling gap; 12 gates insufficient (no security-path coverage); 3+ missing probes; egress test depth inadequate |
| Implementation feasibility | FEASIBLE_WITH_RISKS | **7.0/10** | Phase 1 budget optimistic (2.5-3.5h vs 1.5-2.5h); 15-probe sequencing paradox partially resolved; D-0021..D-0025 don't reference DECISIONS.md format |
| Documentation consistency | BETTER_THAN_V1_NEEDS_MORE | **7.5/10** | 4 stale numbers (C30, DoD, probe arithmetic, file LOCs); D-0021 framing; CHANGELOG strategy is correct direction but the exact text needs to be written |

**Consensus**: 5 of 6 reviewers (adversarial, security, conventions,
test-strategy, doc-consistency) rate v2 between 6.5/10 and 7.5/10 —
**above** the v1 ratings (4-5/10) but **below** v2's self-rating
of 7.5/10. The implementation-feasibility reviewer is the most
generous at 7.0/10 (matching v2's self-rating).

## 3. Consolidated findings (by severity, deduped)

### BLOCKER — must fix before any implementation

**B-2.1** [security, test-strategy, doc-consistency]. C30 fail count
is 11, not 13. v2's claim of 13 was inherited from v1's "4 defects
× ~3 cases = 13" estimate. Actual at HEAD: 2 archive + 6 supersede +
2 move + 1 CAS = 11 fail. The aggregate "16 of 41 in C25+C30" is
correct (5+11=16), but the per-card count must be fixed. **Fix**:
update §4 C30 row to 11 fail; recompute the C25+C30 total.

**B-2.2** [security]. C22's "regression introduced by 9ff20c36f1"
framing is factually false. `git log 9ff20c36f1..HEAD --oneline` shows
no commits touching the MCP path. The 4 C22 tests are
**characterisations of unfinished work**, not a regression. **Fix**:
reframe C22 as "first implementation, not regression restoration";
remove the bisection premise.

**B-2.3** [security]. C18's framing assumes portable restrictions
are unimplemented. They are implemented
(`context/router.ts:212,309-312`, `policy/egress.ts:48-90`); the
actual gap is **integration** (search and backlinks paths don't
yet call the guard). **Fix**: reframe C18 as "wire the egress
guard into `service.search()` and `service.backlinks()`"; the
restrictions are not the blocker.

**B-2.4** [security]. R-0012 §6 (audit `egress.decision` emission)
is unaddressed. `decideEgress` is called by `policy/egress.ts` but
**no caller emits the event** (`grep "emit.*egress\|emitDecision"
packages/unifia/src/knowledge` returns 0). This leaves the
invariant "every egress is traced" unenforced, even after C18
closes. **Fix**: extend C18 to include audit emission; add
probe 16 to assert the event; add gate 14 to test the function.

**B-2.5** [doc-consistency]. DoD count is 12/7/3, not 10/7/4.
U-11 was upgraded to PASS on 2026-08-30. The DoD's own "Décompte"
line is internally inconsistent. **Fix**: update §1 snapshot, §2
"DoD status table" row, and the DoD file itself.

### MAJOR — should fix before Phase 3

**M-2.1** [conventions, doc-consistency]. D-0021 says "53 files"
but actual is **60 files** > 500 LOC in `packages/unifia/src/`
(verified). **Fix**: update to 60.

**M-2.2** [conventions, doc-consistency]. D-0021's framing "is
applied project-wide" obscures that **CLAUDE.md:58 scopes the
rule to `packages/app/`**. D-0021 is creating a new rule, not
documenting an existing project-wide application. **Fix**: reword
to "is **extended to apply** project-wide".

**M-2.3** [conventions, implementation]. D-0021..D-0025 are in
the v2 plan but **not in `docs/knowledge/execution/DECISIONS.md`**
(which ends at D-0020). **Fix**: add a Phase 0.B that appends
the 5 (now 6 with D-0026) decisions to DECISIONS.md following
the established format.

**M-2.4** [security, adversarial]. D-0022 picks a name
(`unifia_restrictions`) but does not pick a **field set**. Three
field sets exist (ADR-0002, PERMISSIONS.md, contracts). **Fix**:
extend D-0022 to specify 4 fields (`remoteModel`/`localModel`/
`embeddable`/`exportable` from contracts) and to distinguish
in-memory vs on-disk vs retired surfaces.

**M-2.5** [implementation]. Phase 1 budget 1.5-2.5h is optimistic;
realistic is 2.5-3.5h (bisection cost 8 × 8 min = 64 min, source
reading 13 × 4 min = 52 min, other ~11 × 3 min = 33 min, total
~150-200 min). **Fix**: update §3 to 2.5-3.5h.

**M-2.6** [implementation]. Phase 0 budget 45 min is optimistic;
realistic is 50-70 min (Q4 ADR amendment is 20-30 min alone;
CHANGELOG amendment is 10-15 min; R-0012/13 verify is 10-20 min).
**Fix**: update §3 to 50-70 min.

**M-2.7** [test-strategy, implementation]. No platform scope
statement. P0-02 (junction `vault/escape`) is Windows-only; on
non-Windows runtimes the existing test silently returns. v2's
"all 15 must pass" rule is too strict on this point. **Fix**:
add §0.1 Platform assumptions; specify P0-02 exits 77
(platform-not-applicable) on non-Windows.

**M-2.8** [implementation]. Phase 6 wording "Probes are committed
as scripts... before Phase 6 starts" is misleading — the C-card
tests land in Phase 3, not before Phase 6. The replay scripts
can be written before Phase 6 (they just call `bun test ...` and
assert on output) but the underlying tests are committed in
Phase 3. **Fix**: clarify "replay harness, not new test".

**M-2.9** [conventions]. Probes directory `docs/knowledge/
execution/probes/` is forward-looking (does not exist at HEAD).
**Fix**: pre-stage in **Phase 0.E** as a sub-deliverable so the
precondition is committed before Phase 6 starts.

**M-2.10** [test-strategy]. Phase 6 "all 15 must pass" is too
strict on platform (P0-02) and not strict enough on scope
(writer and CLI probes are missing). **Fix**: add probes 16
(audit emission), 17 (writer contract), 18 (MCP daemon lifecycle).

**M-2.11** [test-strategy]. 12 gates are insufficient — no
security-critical path coverage, no negative-path coverage, no
replay integrity. **Fix**: add gates 13 (≥ 90% line coverage on
4 security paths), 14 (9 egress tests), 15 (replay integrity
JSON file).

**M-2.12** [test-strategy]. C18 "every read path" is misleading
— the test data shows the guard is on 1 of 3 paths. **Fix**:
explicit "wire the guard into `service.search()` and
`service.backlinks()`".

**M-2.13** [test-strategy]. C22 conflates wire protocol and
daemon lifecycle. **Fix**: split into C22a (wire) and C22b
(daemon).

**M-2.14** [all 6]. Phase 7 is structurally required but
operationally undefined. **Fix**: add §7.1 specifying the 6-lens
packet composition + prompt template + fresh-agent rule.

**M-2.15** [test-strategy]. Bucket 1 vs bucket 4 disambiguation
is the most likely misclassification. **Fix**: add the
disambiguation rule (bucket 1 = merged commit, bucket 4 =
uncommitted working tree).

**M-2.16** [conventions]. `git diff --check` fix was first
action of Phase 5 (too late — every subsequent commit
re-introduces the blank line). **Fix**: move to **Phase 0.A'**.

**M-2.17** [test-strategy, security]. Egress test depth (4
tests) is inadequate for a security-critical function. **Fix**:
add 5 more tests (1 positive + 1 negative per ADR-0006 rule ×
6 rules, minus 3 trivially-passing).

**M-2.18** [test-strategy]. C26 routing through C22 conflated
the 4 fails. **Fix**: route through C22b (daemon lifecycle).

**M-2.19** [doc-consistency]. §4 "16 of 41" arithmetic doesn't
match the table. **Fix**: 5+11=16 (correct after B-2.1).

### MINOR

**m-2.1** [conventions]. Phase 5 commit type `chore:` (no
scope) is inconsistent with the rest. **Fix**: `chore(knowledge):`.

**m-2.2** [conventions]. Phase 4 commit type may be
`test(contracts):` (decideEgress lives in contracts) not
`test(knowledge):`. **Fix**: disjunction `test(contracts):` or
`test(knowledge):` depending on test location; + `fix(knowledge):`
for audit emission.

**m-2.3** [conventions]. Vitest config is a non-choice. **Fix**:
D-0026 commits to Opus 5's "move to `test/legacy/` + exclude glob".

**m-2.4** [conventions]. §1 cites SHA `1d9e3b4650` (one commit
behind actual HEAD `c330f98886`). **Fix**: drop SHA; annotate
"(illustrative — D-0024 uses file presence, not SHA)".

**m-2.5** [implementation]. Phase 0.5 has no escalation rule
if scope > 1 line. **Fix**: "abort and re-plan if scope > 1 line".

**m-2.6** [adversarial]. Self-confidence is a single number.
**Fix**: split into 3 sub-scores (coverage, ordering, interpretation).

## 4. Critical-path corrections (applied to v3)

These 32 corrections are integrated in
`PRODUCTION-READINESS-PLAN-2026-08-30.v3.md` (see §14 of v3 for
the explicit change list):

1. C30 count → 11 (was 13)
2. DoD count → 12/7/3 (was 10/7/4)
3. Probe arithmetic → 4+11+1+2=18 (was 4+9+2=15; v3 has 18 probes)
4. D-0021 wording → "extended to apply" (was "is applied")
5. D-0021 file count → 60 (was 53)
6. D-0021..D-0025 + D-0026 → committed to DECISIONS.md in Phase 0.B
7. D-0022 field set → 4 fields named, surfaces distinguished
8. C18 reframed → integration + audit emission (was: restrictions unimplemented)
9. C22 reframed → first implementation, not regression (was: regression 9ff20c36f1)
10. C22 split → C22a (wire) + C22b (daemon lifecycle)
11. Phase 1 budget → 2.5-3.5h (was 1.5-2.5h)
12. Phase 0 budget → 50-70 min (was 45 min)
13. §0.1 Platform assumptions added (P0-02 exits 77 on non-Windows)
14. Phase 6 wording → "replay harness, not new test"
15. Probes pre-staged in Phase 0.E (was: forward-looking)
16. Phase 5 commit type → `chore(knowledge):` (was `chore:`)
17. Phase 4 commit type → `test(contracts):` or `test(knowledge):` + `fix(knowledge):`
18. P0-02 → exit 77 platform-not-applicable (was: hard fail)
19. R-0012 §6 → C18 includes audit emission; probe 16 asserts the event
20. Gates 13, 14, 15 added (security-path coverage, egress depth, replay integrity)
21. C18 scope → "wire the guard into `service.search()` and `service.backlinks()`"
22. C22 split into C22a + C22b
23. Vitest config → D-0026 commits to "move to `test/legacy/`"
24. §7.1 added (6-lens packet, prompt template, fresh-agent rule)
25. §1 SHA citation dropped
26. C26 routes through C22b
27. Bucket 1 vs 4 disambiguation rule added
28. `git diff --check` fix moved to Phase 0.A'
29. Phase 0.5 escalation rule added
30. Self-confidence → 3 sub-scores
31. Egress test depth → 9 tests (was 4)
32. §4 "16 of 41" arithmetic reconciled (5+11=16)

## 5. Recommended re-authoring approach

Given the volume of corrections (5 BLOCKER + 14 MAJOR + 6 MINOR =
25 critical changes), a full rewrite of the plan is more efficient
than 25 patch edits. The v3 plan applies all 32 corrections; see
v3 §14 for the explicit change list.

## 6. Self-confidence

**v2's actual rating (averaged across 6 reviewers): 7.1/10**
(v2's self-rating of 7.5/10 was slightly generous; the average
of the 6 reviewer ratings is 7.083, rounded to 7.1).

**v3's expected rating (after corrections): 8.0-8.5/10**.

The 0.9-1.4 point gain comes from:
- B-2.1..B-2.5: factual corrections to C30, DoD, C22, C18, R-0012 §6
- M-2.1..M-2.19: structural improvements to D-0021/22, budget,
  platform, gates, probes, bucket 1 vs 4, C22 split, Phase 7

The remaining 1.5-2.0 points are bounded by:
- Phase 1 bucket distribution (unknown until Phase 1 runs)
- C22b implementation risk (until the 4 daemon tests turn green)
- Q4 test-location answer (split or unified?)

---

*Aggregated 2026-08-30 from 6 parallel reviewers. Each reviewer
was given an independent prompt and the 5 source files. Findings
are sorted by severity and deduped. v3 applies all 32 corrections
(see `PRODUCTION-READINESS-PLAN-2026-08-30.v3.md` §14 for the
explicit change list).*
