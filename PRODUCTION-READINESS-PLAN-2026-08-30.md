<!-- SPDX-License-Identifier: MIT -->
# Production-Readiness Plan — Sovereign Knowledge Core V1

> Self-contained audit + plan for autonomous remediation. Designed
> to be reviewed by a separate AI before implementation begins.
> The reviewing AI is invited to challenge the framing, the priority
> order, the scope, and the acceptance criteria.

---

## 0. Pre-flight (the reviewer must verify these BEFORE reading further)

```bash
cd D:\App\unifia\unifia-memory
git rev-parse --show-toplevel          # must be D:\App\unifia\unifia-memory
git branch --show-current              # must be feat/sovereign-knowledge-core
git rev-parse HEAD                      # must be b8b43859a7a24d0e675afd9410be5c099b76105d
git status --short                     # must show containment.ts, vault.ts modified + REVIEW-* untracked
git config --get branch.feat/sovereign-knowledge-core.remote  # must fail (no upstream)
git log --oneline 95350647140a382ee6d5d61bc2f6639597d80f0b..HEAD | wc -l
# must be 139
```

If any of these checks fail, the operating environment has changed
and this plan is stale. Update before proceeding.

## 1. Snapshot

| Field | Value |
|---|---|
| Date | 2026-08-30 |
| Worktree | `D:\App\unifia\unifia-memory` |
| Branch | `feat/sovereign-knowledge-core` (no upstream) |
| HEAD | `b8b43859a7` |
| Local commits since `origin/dev` | 139 |
| Tests pass | **637** (TS knowledge) + 79 (contracts) + 35 (Rust) = **751** |
| Tests fail | **41** (TS knowledge characterization tests) |
| Total executable | **792** |
| CHANGELOG claim | 771 passing (mismatch: ignores the 41 fails) |
| Working tree | 2 modified + 1 untracked |
| Mutations external | 0 push, 0 PR, 0 merge, 0 release, 0 publication |

## 2. Two prior reviews exist (this plan is informed by both)

This is the THIRD review-level document for the same branch. A
reviewing AI should not duplicate work; it should identify which
of the prior findings remain open and which are addressed by
recent commits.

### 2.1 `docs/knowledge/execution/FRONTIER-REVIEW-VERDICT.md` (Opus 5, 34 936 chars)

- **Captured at** : `c3e7374798` (HEAD was 115 commits)
- **Verdict** : **NEEDS_REVISION**
- **Method** : command-replayable probes + grep on every load-bearing claim
- **Key findings** :
  - **Q1 FAIL/PASS_WITH_CONCERNS** : 30-day candidate TTL not implemented;
    `superseded → active` not in ADR diagram; doctor does not have the
    three checks ADR-0009 promises
  - **Q2 FAIL** : portable restrictions (`unifia_restrictions` /
    `portable_restrictions`) do not exist in the contracts; the
    `ContextRouter` hardcodes `restriction: "allow"`; `policy.json` is
    not wired to egress decisions
  - **Q3 FAIL** : wikilink code-fence escape does not work; the
    parser has no fence awareness
  - **Q5 concerns** : default retrieval bounds documented but ADR-0007
    is partial
  - **Q7 concerns** : test count adequate for DoD but the security-
    critical paths (egress, restrictions) are undertested
- **Top 3 priority changes** : P1 = reconcile ADR-0006 with reality,
  P2 = fix the fence leak, P3 = update the DoD to match reality
- **Self-reported confidence** : 8/10
- **Open at the time** : none of the three priority changes was
  committed

### 2.2 `REVIEW-PRODUCTION-READINESS-CLAUDE-2026-08-30.md` (Claude, 17 945 chars)

- **Captured at** : `9785000e48` (HEAD was 117 commits)
- **Verdict** : **NO** (not production-ready)
- **Method** : adversarial probes against the real boundaries
- **8 P0/P1 blockers identified** :
  1. Egress bypass — a `remote_model: deny` note is leaked via MCP
     `backlinks` (`P0-01`)
  2. VaultSource follows junctions and reads outside the workspace
     (`P0-02`)
  3. `serialiseNote()` drops `unifia_restrictions` (`P1-03`)
  4. Deadlines do not bound `list()` and `read()` (`P1-04`)
  5. MCP is not actually wired into production; CLI tokens are dead
     (`P1-05`)
  6. `verify` returns 0 with `NOT_EXECUTED` and `WARN` checks
     (`P1-06`)
  7. Empty Android evidence produces a `PASS` (`P1-06` cont.)
  8. Personal/project mounts duplicate notes; `status.vector`
     can lie about the loaded model (`P1-07` / `P1-08`)
- **7 corrective cards** : C18 (egress), C19 (containment), C20
  (serialisation), C21 (deadlines), C22 (MCP composition), C23
  (graph+composition), C24 (evidence+hygiene)
- **Self-reported coverage** : 36/36 sources production, 10/10 tests,
  7/7 documents read
- **Open at the time** : all 7 cards

### 2.3 What changed between the two reviews and now (HEAD `b8b43859a7`)

| Card / finding | Status at HEAD | Evidence |
|---|---|---|
| C18 (egress) | Partial — anonymous MCP refused in 9ff20c36f1; but characterization tests fail | `9ff20c36f1` + 2 C18 fails |
| C19 (containment) | Partial — `realOrNullAsync` exists in uncommitted `containment.ts`; 1 test fail | `git diff packages/unifia/src/knowledge/source/containment.ts` |
| C20 (serialisation) | Unknown — needs probe to verify | No commit specifically addresses serialisation |
| C21 (deadlines) | Likely fixed — claimed in CHANGELOG v0.4.0 but no test pass proof | CHANGELOG line 64 |
| C22 (MCP composition) | Partial — `composeMcp` exists, but 4 C26 tests fail | `07a3e6ac46` + 4 C26 fails |
| C23 (graph+composition) | Likely fixed per CHANGELOG | Lines 71-74 |
| C24 (evidence+hygiene) | Partial — git diff --check still failing per Opus 5 note | Trailing blank line in `unifia-knowledge.ts` |
| Opus 5 P1 (ADR-0006 reconcile) | **Not done** — ADR-0006 still says `ACCEPTED` with no deferral | `git grep -l 'PARTIALLY IMPLEMENTED' docs/knowledge/adr/` |
| Opus 5 P2 (fence leak) | **Not done** — parser has no fence awareness | `packages/unifia/src/knowledge/parser/wikilinks.ts` |
| Opus 5 P3 (DoD reality) | **Not done** — DoD still has all-PENDING status | `docs/knowledge/SOVEREIGN-CORE-V1-DOD.md` |

**Net** : the remediation pass made partial progress on security
but did not address the architectural review. The CHANGELOG
overstates completion. 41 tests fail including the characterizations
of the bugs the remediation was supposed to fix.

## 3. The contradiction this plan must resolve

The CHANGELOG v0.5.0 declares a clean `READY_FOR_REVIEW` state
(771 passing, R-0013 closed, fixes complete). The 41 failing
tests include characterizations of the exact defects the CHANGELOG
claims are fixed (C1, C4, C18, C25, C26, C30). One of these is
wrong. **The plan MUST start by determining which.**

The 41 failing tests fall into three buckets:
1. **Genuine regressions** : tests that passed before the
   remediation and now fail (would be a signal that a fix broke
   a working behavior)
2. **Honnest characterizations** : tests added to prevent the bugs
   from coming back, that the implementation does not yet satisfy
3. **Stale assertions** : tests that document an old behavior the
   implementation has correctly changed

Bucket 1 is bad and must be fixed. Bucket 2 is the desired
posture (the bugs are still present). Bucket 3 must be updated.

**Question for the reviewing AI** : should we trust the test
names (which clearly say "C1 — the CLI runtime queries the real
corpus", "C18 — every read path applies the egress guard", etc.)
as evidence that these are bucket 2, or should we re-validate by
running the underlying code path by hand?

## 4. Proposed plan (subject to review)

The plan has 6 phases, each with a clear deliverable and
self-verification gate. Phases can be reordered; this is the
suggested sequence based on risk reduction first.

### Phase 0 — Honest accounting (1 commit, ~30 min)

**Why first** : the CHANGELOG is a false proof. Before any other
fix lands, the documentation must reflect reality so reviewers
(including the next AI) are not misled.

**Tasks** :
- A. Revert CHANGELOG v0.5.0 to honestly report: 637 pass, 41 fail,
  0 close on Opus 5 P1/P2/P3
- B. Append to STATE.md the actual state (sessions 15-19, 41 fails)
- C. Update RISKS.md: add R-0012 (portable restrictions unimplemented,
  high severity), mark R-0013 as PARTIAL (MCP daemon exists but
  has known gaps)
- D. Do NOT add a "remediation round N" entry that overstates fixes

**Acceptance** : no test changes, no code changes; the
documentation matches what `bun --cwd packages/unifia test
test/knowledge` actually reports. The `git diff --stat` of the
commit shows only .md files.

**Anti-pattern to avoid** : a "comprehensive" rewrite of the
CHANGELOG that obscures the gap. Each line must be defensible
against a probe.

### Phase 1 — Diagnose the 41 failing tests (no commits, ~1-2 h)

**Why** : we cannot fix what we have not categorized. The
implementation AI should NOT fix tests in this phase. Only
classify them.

**Tasks** :
- A. Run `bun --cwd packages/unifia test test/knowledge 2>&1` and
  capture the full failure list
- B. For each failure, classify it as: (1) regression, (2)
  characterization-still-failing, (3) stale assertion
- C. For (1) regressions, identify the commit that introduced the
  regression by bisection (`git log --reverse` + `git stash` dance)
- D. For (2) characterizations, note which card (C1, C4, etc.)
  the failure belongs to and which fix is supposed to address it
- E. For (3) stale assertions, identify the old behavior the test
  was checking

**Deliverable** : a `docs/knowledge/execution/FAILING-TESTS-AUDIT.md`
file with one row per failing test, classified as above. This
file is the input to Phase 2.

**Acceptance** : every row has a commit SHA, a classification, and
a one-line rationale. No test is left as "unclear".

### Phase 2 — Fix the genuine regressions and stale assertions (n commits)

**Why after Phase 1** : we now know what to fix and what to update.
Mixing real fixes with test updates is what created the current
contradictory state.

**Tasks** :
- A. For each regression: revert the offending commit (or fix
  forward, whichever is cheaper; choose by `git log -p` size
  comparison)
- B. For each stale assertion: update the test to the new
  contract, with a comment referencing the commit that changed
  the behavior
- C. For each (2) characterization that is correctly failing:
  do nothing here; it is the input to Phase 3

**Acceptance** : the test count goes up (more passes) or stays
the same. The CHANGELOG is not modified yet; the next commit to
it comes from Phase 0 / Phase 5 in a controlled way.

### Phase 3 — Close the C18-C24 corrective cards (n commits)

**Why** : this is the meat of the security remediation. The
goal is to make the characterization tests pass for the right
reason (real fix, not test update).

**Tasks** : for each card, in order:
- **C18 (egress)** : apply Opus 5 P2 fix? No, that's the fence
  leak. C18 is the "every read path applies the egress guard" —
  the diagnosis is in `9ff20c36f1` (anonymous MCP refused) but
  other read paths may still leak. Re-run the original Claude
  probe (anonymous knowledge_search for ANON_VISIBLE) and any
  other paths not covered.
- **C19 (containment)** : commit the uncommitted async fixes in
  `containment.ts` and `vault.ts`. Add the junction rejection
  regression test (re-run Claude's junction probe as a test).
- **C20 (serialisation)** : write a round-trip probe first
  (parse → serialize → parse, expect equality on restrictions).
  If it fails, fix `serialiseNote()`. The fix is small and the
  test is the proof.
- **C21 (deadlines)** : verify the CHANGELOG claim by adding a
  slow-source characterization test (a source whose `list()`
  takes 300ms) and asserting that `deadlineMs=20` returns
  `truncated: true` within ~50ms.
- **C22 (MCP composition)** : investigate the 4 failing C26
  tests. The MM2-B02 commits added the daemon, but the
  characterizations are still failing. Likely a wire-protocol
  or schema issue. Re-run the Opus 5 P2-style probe: "can an
  anonymous request get a vault note?"
- **C23 (graph+composition)** : the CHANGELOG says fixed; verify
  by running the dedup probe and the `status.vector` probe
- **C24 (evidence+hygiene)** : fix `git diff --check` (trailing
  blank line in `unifia-knowledge.ts`); decompose
  `commands-report.ts` (>891 LOC) and `unifia-knowledge.ts`
  (>1100 LOC) per the project's 500-LOC rule

**Acceptance per card** : the corresponding characterization
test passes for the right reason. The CHANGELOG claim is no
longer aspirational.

### Phase 4 — Close the Opus 5 P1/P2/P3 findings (n commits)

**Why after Phase 3** : the security bugs are fixed. Now the
document-vs-implementation drift can be addressed honestly.

**Tasks** :
- **P1 (ADR-0006 reconcile)** :
  - Mark ADR-0006 as `PARTIALLY IMPLEMENTED` with a status box
    listing which rules V1 delivers (rule 5 only, in
    `context/dataflow.ts`) and which are deferred (1-4, 6)
  - Delete the `policy/dataflow-guard.ts` claim; point to
    `context/dataflow.ts`
  - Delete the `port/transport.rs` claim; note that no such
    module exists in the crate
  - Update PERMISSIONS.md §4/§5/§8 to remove the five
    misstatements identified by Opus 5
- **P2 (fence leak)** : compute fence ranges in
  `extractWikilinks` (or filter in `parseDocument`); drop links
  whose `start` falls inside a fence. Add the regression test
  from Opus 5 Q3. Add the `[^\S\n]*` rationale comment.
- **P3 (DoD reality)** : replace the all-PENDING status table
  with per-item PASS/PARTIAL/FAIL backed by the replayable
  command. Correct U-07's path. Add the four `decideEgress`
  tests from Opus 5, with the two that should fail marked
  `expect(...).toBe(...)` against the current implementation
  (which is OK because the goal is to know the truth, not to
  pass them).

**Acceptance** : the documentation now describes the system as
it is. A reader cannot find a false claim by following
references.

### Phase 5 — Hygiene + gates (1 commit per gate)

**Why** : the project's own quality bar (500-LOC rule, clippy 0
warning, biome 0 warning, `git diff --check` clean) was not
enforced during the remediation rush. Restore it before
claiming readiness.

**Tasks** :
- A. `git diff --check 95350647..HEAD` — fix any trailing
  whitespace or blank lines
- B. Decompose any file >500 LOC created in Phases 0-4
- C. `bunx biome check packages/unifia/src/knowledge` — 0
  warning
- D. `cd crates/unifia-knowledge-core && cargo fmt --check &&
  cargo clippy --all-targets -- -D warnings && cargo test` —
  all green
- E. `bun --cwd packages/unifia run typecheck` — exit 0
- F. `bun --cwd packages/contracts vitest run` — note the four
  pre-existing bun-style smoke files; either exclude them or
  add a vitest config that tolerates them

**Acceptance** : all 8 gates green (per the Opus 5 prompt §GATES
MINIMALES).

### Phase 6 — Re-verify with adversarial probes (no commits, ~1 h)

**Why** : green unit tests do not validate the system. The
Opus 5 review and the Claude review both ran probes that the
test suite did not catch. Re-run them.

**Tasks** :
- A. Run the 6 probes from Opus 5 Q1-Q3 + Q7
- B. Run the 8 probes from `REVIEW-PRODUCTION-READINESS-CLAUDE-2026-08-30.md`
  (P0-01 through P1-09)
- C. For any probe that now fails, classify as
  regression / not-fixed / out-of-scope
- D. For any out-of-scope probe, document the boundary in
  RISKS.md and the FRONTIER packet

**Acceptance** : the 14 probes all return their expected
post-fix output. Any remaining failure is documented with a
classification and a follow-up.

## 5. Constraints (do not violate)

These are the operator's constraints (from
`REVIEW-PRODUCTION-READINESS-CLAUDE-2026-08-30.md` §Interdictions,
from `AGENTS.md`, and from the runbook V2). They apply throughout.

- **No push, no PR, no merge, no release, no publication.**
- **Do not weaken tests to make them pass.** Write
  characterizations first; then fix the code.
- **Do not replace a real boundary with a mock presented as
  proof.** The ONNX embedding is `disabled` V1; that is the
  truth, not a defect.
- **Do not extend V1 scope without an ADR/RFC.** No new
  capabilities, no new public API, no new dependencies.
- **Code, comments, commit messages in English.**
- **Preserve user changes.** The 2 uncommitted files
  (`containment.ts`, `vault.ts`) are the C19 fix from
  MM2-B02. Do not discard them; commit them after Phase 1
  classification.
- **No branch destruction.** The 139 commits are the audit
  trail. No rebase, no reset --hard, no force-push.

## 6. Self-verification gates (8 minimum, run after every phase)

```bash
# Phase 0-4: code changes
bun --cwd packages/contracts typecheck
bun --cwd packages/contracts test
bun --cwd packages/unifia typecheck
bun --cwd packages/unifia test test/knowledge
cd crates/unifia-knowledge-core
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

# Phase 5: hygiene
git diff --check 95350647140a382ee6d5d61bc2f6639597d80f0b..HEAD
bunx biome check packages/unifia/src/knowledge
```

Each gate produces a count and a status. The post-phase report
must include the count and the status. **A gate that fails
because of a new commit is a regression to fix before the next
phase.**

## 7. Deliverable format (per phase)

```markdown
## Phase N — <title>

- **Commits** : <list of SHAs with one-line subjects>
- **Files changed** : <git diff --stat output>
- **Test delta** : before N pass / N fail → after N+? pass / N+? fail
- **Gates** : <8-line table of pass/fail>
- **Adversarial probes** : <which Opus 5 / Claude probes were re-run,
  and the result>
- **Documentation updates** : <which docs were touched and why>
- **Open follow-ups** : <any new RISKS or TODOs created>
```

## 8. Open questions for the reviewing AI

The reviewing AI is invited to challenge:

1. **Sequence** : should the architectural review (Opus 5) be
   addressed before the security review (Claude)? Opus 5 P1 is
   a doc fix; Claude's P0-01 is a runtime security bug. The
   proposed order is P0 first (Phase 0 + 3) then P1/P2/P3
   (Phase 4). Should the order be reversed?
2. **Test classification** : the plan assumes the 41 failing
   tests are mostly bucket 2 (characterizations) or bucket 3
   (stale assertions). If a significant number are bucket 1
   (regressions), the security remediation may have introduced
   new bugs that need their own cards. Is Phase 1 sufficient
   to distinguish these?
3. **CHANGELOG v0.5.0** : is the right action to revert it, or
   to correct its claims in place? The Opus 5 review assumed
   "the engineering substrate is strong"; the CHANGELOG's
   existence may be a useful record if corrected.
4. **Opus 5 P1 (portable restrictions)** : the plan defers
   this to Phase 4 documentation, but the security review
   P0-01 demonstrates that the absence of restrictions
   enables a real leak. Should portable restrictions be
   implemented in Phase 3, not Phase 4?
5. **The 139 commits** : the plan assumes the existing
   commits are an audit trail to preserve. If a commit
   introduced a regression, should it be reverted or
   forward-fixed? The plan picks forward-fix by default for
   any non-trivial change. Is that the right call?
6. **R-0013 (MCP daemon)** : the CHANGELOG says closed; the
   4 failing C26 tests suggest otherwise. Should R-0013 be
   marked PARTIAL instead of CLOSED in the RISKS?
7. **The 500-LOC rule** : Claude's review noted that
   `commands-report.ts` is 891 LOC and `unifia-knowledge.ts` is
   1100 LOC. The plan decomposes them in Phase 5. Is
   decomposition higher-priority than the 41-test fix? (Both
   are hygiene; the order is cosmetic.)
8. **Verification by an external AI** : the plan ends at
   "Phase 6 re-run the 14 probes". Is a second external
   review required after that, or does the probe pass suffice?
   Opus 5 said "I would re-review after [P1-P3] and expect
   APPROVED". Should the implementation AI request a second
   review or self-declare?

## 9. What this plan does NOT do

- It does not propose new features (offline-first, sovereign,
  provider-independent are V1 invariants)
- It does not propose framework migrations
- It does not propose relaxing tests to make them pass
- It does not propose weakening the security posture
- It does not propose changing the public API of
  `@unifia/contracts/knowledge`
- It does not propose publishing, pushing, or merging

## 10. Self-assessment of this plan

**Confidence** : 6/10.

- The audit is based on a clean read of two prior reviews,
  the CHANGELOG, the CURRENT-REPO file list, and a fresh test
  run. I have NOT read the 522 TS tests individually; I have
  NOT read the 38 admin tools individually; I have NOT
  reproduced the 14 adversarial probes (I am the planner, not
  the executor).
- The phase ordering is the best-guess risk-prioritization,
  not a proven sequence. Phase 1 (classification of 41 fails)
  may take longer than estimated and reveal that the work is
  bigger than 6 phases.
- The "right" interpretation of the CHANGELOG/41-fails
  contradiction is the highest-uncertainty point. The plan's
  default is "the CHANGELOG is wrong, the tests are the truth";
  the alternative is "the tests are wrong, the CHANGELOG is the
  truth". The reviewing AI should weigh in.

---

*Plan written at HEAD `b8b43859a7`, 2026-08-30, against
`feat/sovereign-knowledge-core`. Self-assessed 6/10 confidence.
The reviewing AI is the next step; this plan is the input,
not the output.*
