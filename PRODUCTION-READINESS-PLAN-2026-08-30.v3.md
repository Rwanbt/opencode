<!-- SPDX-License-Identifier: MIT -->
# Production-Readiness Plan — Sovereign Knowledge Core V1 (v3)

> v3 supersedes v2 (`PRODUCTION-READINESS-PLAN-2026-08-30.v2.md`) and v1.
> v3 integrates feedback from 6 specialised reviewers who reviewed v2 in
> parallel (the v2 reviews, 2026-08-30). v2 is preserved in the worktree
> as the audit trail.
>
> **The reviewing AI is invited to challenge v3 on the same axes**:
> adversarial, security, conventions, test strategy, implementation
> feasibility, doc consistency. v3's self-rating is 7.5/10 (conditional).
> The 4 open questions in §12 are the only decision points left.

---

## 0. Pre-flight (must pass before reading further)

```bash
cd D:\App\unifia\unifia-memory
git rev-parse --show-toplevel          # must be D:\App\unifia\unifia-memory
git branch --show-current              # must be feat/sovereign-knowledge-core
git config --get branch.feat/sovereign-knowledge-core.remote
# must exit 1 (no value — no upstream)
```

The plan asserts the **presence of these files** (D-0024) instead of a
specific SHA — HEAD has moved 3 times across the v1/v2/v3 reviews and
asserting a SHA makes the pre-flight fail immediately:

- `PRODUCTION-READINESS-PLAN-2026-08-30.md` (v1, audit trail)
- `PRODUCTION-READINESS-PLAN-2026-08-30.v2.md` (v2, audit trail)
- `PRODUCTION-READINESS-PLAN-2026-08-30.v3.md` (this file)
- `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.md` (v1 review)
- `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v2.md` (v2 review, the 6-lens aggregation against v2)
- `REVIEW-PRODUCTION-READINESS-CLAUDE-2026-08-30.md` (Claude review)
- `docs/knowledge/execution/FRONTIER-REVIEW-VERDICT.md` (Opus 5 review)
- `docs/knowledge/execution/RISKS.md` (with R-0012 already present)
- `docs/knowledge/CHANGELOG.md` (with v0.5.0 honesty corrections applied in Phase 0.A)

## 0.1. Platform assumptions

**The plan runs on Windows only** (verified operator platform: Windows
11, PowerShell, the worktree at `D:\App\unifia\unifia-memory`).

- **Probe 6 (junction `vault/escape`)** is Windows-only (`mklink /J`).
  On non-Windows runtimes the probe script detects the platform and
  exits with `77` (platform-not-applicable, per GNU autotools
  convention). It does NOT pass-by-skip on Linux/macOS.
- **macOS/Linux** equivalents (symlinks, `readlink -f`) are **deferred
  to V1.1**. They are out of scope for the V1 production-readiness
  plan. This decision is not under review.

## 1. Snapshot (illustrative — D-0024 uses file presence, not SHA)

| Field | Value (at v3 authoring time) |
|---|---|
| Branch | `feat/sovereign-knowledge-core` (no upstream) |
| Local commits | 142 since `origin/dev` (HEAD moves per commit) |
| Tests pass | 637 (TS knowledge) + 79 (contracts) + 35 (Rust) = **751** |
| Tests fail | **41** (TS knowledge) |
| CHANGELOG v0.5.0 claim | 771 passing (still inflated; corrected in Phase 0.A) |
| Working tree | 2 modified (`containment.ts`, `vault.ts`) + 1 untracked (`REVIEW-CLAUDE`) |
| DoD status | 12 PASS, 7 PARTIAL, 3 NOT_EXECUTED (U-11 upgraded 2026-08-30) |
| Mutations external | 0 push, 0 PR, 0 merge, 0 release, 0 publication |

**Critical uncommitted bug (B-2 from v1 review)** : `vault.ts:26`
imports only the synchronous functions `isContained, realOrNull` from
`./containment.js`. The uncommitted C19 fix at lines 44, 71, 78 calls
the async versions `realOrNullAsync, isContainedAsync` which are
**not imported**. Committing the working tree as-is would trigger
`ReferenceError: realOrNullAsync is not defined` at runtime and
regress 9 tests (1 C19 + 8 VaultSource). **Phase 0.5 fixes this.**

## 2. Already-done in working tree (DO NOT re-do)

The v1 plan listed 9 "what's not done" rows. **Six of them are
already done at HEAD.** v3 does not re-do them.

| Row | Status at HEAD | Evidence |
|---|---|---|
| R-0012 (portable restrictions) | **EXISTS, OPEN** | `RISKS.md:142-175` already has the entry; severity high, dated 2026-08-29 |
| ADR-0006 marked `PARTIALLY IMPLEMENTED` | **DONE** | `adr/0006-knowledge-egress.md:113` already carries the marker; the 2026-08-29 amendment lists V1 vs deferred |
| DoD status table filled | **DONE** | `SOVEREIGN-CORE-V1-DOD.md:264-287` shows **12 PASS, 7 PARTIAL, 3 NOT_EXECUTED** (U-11 upgraded 2026-08-30) |
| PERMISSIONS.md §4/§5/§8 corrections | **DONE** | the corrections Opus 5 listed are integrated in the current file |
| Opus 5 P2 (wikilink fence leak) | **DONE** | CHANGELOG v0.3.0 records the fix; `parser/code-mask.ts` exists; the C9 characterisation passes |
| `commands-report.ts` decomposed | **DONE** | replaced by `commands-vault.ts` (497 LOC), `commands-graph.ts` (423 LOC), `commands-mcp.ts` (128 LOC), `runtime.ts` (141 LOC), `shared.ts` (51 LOC), `usage.ts` (86 LOC) |

**Remaining real work** (the only things v3 actually has to do) :

| # | Item | Where it lives in v3 |
|---|---|---|
| 1 | **Fix the `git diff --check` trailing blank line** at `unifia-knowledge.ts:1047` (1-line delete) | Phase 0.A' (moved here from Phase 5 per m-9/gate-1-immediate-fail) |
| 2 | **Repair the uncommitted C19 fix** (1-line import in `vault.ts:26`) | Phase 0.5 |
| 3 | **Correct CHANGELOG v0.5.0 in place** (do not delete; add `### Fixed` + `### Not changed`) | Phase 0.A |
| 4 | **Append D-0021..D-0025** to `docs/knowledge/execution/DECISIONS.md` (D-0026 vitest config added) | Phase 0 |
| 5 | **Verify R-0012 / R-0013 text matches reality** (refresh if needed) | Phase 0.C |
| 6 | **Decide Q4** (portable restrictions: already implemented; scope decision) | Phase 0.D (decision, ADR amendment) |
| 7 | **Pre-stage the 18 probe scripts** under `docs/knowledge/execution/probes/` (thin wrappers; no new tests) | Phase 0.E (forward-loaded) |
| 8 | **Classify the 41 failing tests** into 5 buckets | Phase 1 |
| 9 | **Fix the genuine regressions and stale assertions** | Phase 2 |
| 10 | **Close the 10 corrective cards C18-C30** (C22 split into C22a + C22b) | Phase 3 |
| 11 | **Close Opus 5 P3 + R-0012 §6 audit emission** (DoD U-07 oracle, 9 egress tests, audit `egress.decision` event) | Phase 4 |
| 12 | **Hygiene + 15 gates** | Phase 5 |
| 13 | **Re-verify with 18 scripted adversarial probes** (15 + 3 new) | Phase 6 |
| 14 | **Request a second external review** (not self-declare) | Phase 7 |

## 3. Phase plan (sequenced; no parallel work)

| # | Phase | What | Budget | Commit type |
|---|---|---|---:|---|
| 0 | Honest accounting | CHANGELOG correction (0.A) + `git diff --check` fix (0.A') + D-0021..D-0026 append to DECISIONS.md (0.B) + R-0012 verify (0.C) + Q4 decision (0.D) + probe pre-staging (0.E) | **50-70 min** | `docs(knowledge):` |
| 0.5 | **Repair the uncommitted C19 fix** | add `realOrNullAsync, isContainedAsync` to the import at `vault.ts:26` | **5-30 min** (abort-and-replan if scope > 1 line) | `fix(knowledge):` |
| 1 | Classify the 41 failing tests | 5-bucket classification + per-test SHA + bisection rule (bucket 1 vs 4) | **2.5-3.5 h** | `docs(knowledge):` (audit file) |
| 2 | Fix regressions + stale assertions | depends on Phase 1 output; budget 0.5-2 h; may be no-op | **0.5-2 h** | `fix(knowledge):` or `test(knowledge):` |
| 3 | Close the 10 corrective cards C18-C30 (C22 → C22a + C22b) | see §4 for per-card scope | **10-18 h** (target 12h, alarm 16h, stop 20h) | `fix(knowledge):` |
| 4 | Close Opus 5 P3 + R-0012 §6 | DoD U-07 oracle command (1-line fix) + 9 egress tests (4 `decideEgress` + 5 depth) + audit `egress.decision` emission | **3-4 h** | `docs(knowledge):` + `test(contracts):` (or `test(knowledge):`) + `fix(knowledge):` |
| 5 | Hygiene + 15 gates | see §5; decompose `unifia-knowledge.ts` (1000 LOC) into 3 files of ~400 LOC | **3-4 h** | `refactor(knowledge):` + `chore(knowledge):` |
| 6 | Re-verify with 18 scripted probes | all 18 must pass; otherwise BLOCKED. P0-02 platform-not-applicable exit 77 on non-Windows | **2-3 h** | `test(knowledge):` + `docs(knowledge):` |
| 7 | Request second external review | 6-lens re-review against implementation; do not self-declare | — | `docs(knowledge):` |

**Total**: ~25-35 h of focused work, across **4-6 sessions** (the
v1/v2 3-session scenario is unrealistic at 10h/session with a 50k
token context budget). The v1 plan's "1.5 engineer-days" estimate
was for Opus 5 P1-P3 only; v3 is ~2× that because it includes the
10 corrective cards + the audit emission + the 9 egress tests.

**Ordering rationale** :

- **Phase 0 before Phase 0.5** (CHANGELOG honesty first, code fix second).
  Phase 0.5's commit is the precondition for any test run, but the
  CHANGELOG is the foundation that other documentation references.
- **Phase 0.5 before Phase 1** (test isolation). Without the import
  fix, the 8 VaultSource regressions collapse into "ReferenceError"
  and the bucket framework cannot distinguish them from C19.
- **Phase 1 before Phase 2/3** (data before action). Phase 2 and 3
  consume the bucket distribution.
- **C22b (MCP daemon lifecycle) ordered last in Phase 3** because
  its 4 characterisation tests have **never been green** — it is
  unfinished work, not a regression. v2's framing of "may be a
  regression introduced by 9ff20c36f1" was factually wrong:
  `git log 9ff20c36f1..HEAD` shows no commits touching the MCP path.
  v3 drops the false bisection premise.

## 4. Phase 3 — the 10 corrective cards C18-C30

v2's plan listed 9 cards (C18-C30) inherited from the v1 expansion.
v3 splits C22 into C22a (wire protocol) and C22b (daemon lifecycle),
because C22 conflated two different layers (wire format vs HTTP/stdio
daemon). v3 also reformulates C18 to reflect that portable restrictions
are **already implemented** (Opus 5 P1 is closed at HEAD; R-0012
remains OPEN only because R-0012 §6 — audit emission — is still
ungated). C18 = "wire the egress guard into `service.search()` and
`service.backlinks()`, and emit `egress.decision` to the event bus".

The "16 of 41 fails in C25+C30" figure is verified: **C25 = 5 fail
+ C30 = 11 fail = 16** (C30 count was 13 in v1/v2 by estimate; the
actual at HEAD is 11 — see §14 v3 changes).

| Card | Scope | Tests | Estimate |
|---|---|---:|---:|
| **C18** | Egress guard integration + audit emission: wire `decideEgress` into `service.search()` and `service.backlinks()`; emit `egress.decision` event on every read-path decision (R-0012 §6 closure) | 2 fail | 2-3 h |
| C19 | Filesystem containment (real paths, junction reject) | 1 fail + 8 VaultSource regressions (auto-pass after Phase 0.5) | 0.5-1 h |
| C20 | Round-trip of `unifia_restrictions` (parse → serialise → parse) | 0 fail (verify) | 0.5-1 h |
| C21 | Deadline bound on `list()` and `read()` (slow-source characterisation) | 0 fail (verify) | 1-2 h |
| **C22a** | MCP wire protocol (token threaded, not echoed, valid across calls) | 2 of 4 C22 fails | 1.5-2.5 h |
| **C22b** | MCP daemon lifecycle (HTTP/stdio daemon answers over transport; token issued in one process valid in another within TTL) | 2 of 4 C22 fails | 1.5-2.5 h |
| C23 | Graph + composition (dedup, real supersedes lineage, `status.vector` honesty) — covers C1 + C4 + C26 (CLI / policy / composition) | covered by C1/C4/C26 fails; verify | 1.5-2.5 h |
| C24 | Evidence + hygiene (Android `isUsableEvidence`, `verify` exit code, real SHA-256, `git diff --check` from Phase 0.A') | 0 fail (verify) | 1-2 h |
| **C25** | VaultMutationWriter behaviour (CAS, lifecycle, propose via facade) | 5 fail | 1-2 h |
| **C30** | Writer contract (archive A, supersede B, move C, CAS D — 4 defects × ~3 cases each, 11 failing) | 11 fail | 2-4 h |
| | | **Total** | **10-18 h** |

**Order within Phase 3** : C18 → C19 → C20 → C21 → C23 → C25 →
C30 → C22a → C22b → C24.

- C18 first because the guard + audit emission is the security
  foundation; every read path depends on it.
- C19 second because the containment check is the precondition for
  C25/C30 (the writer must refuse to write outside the vault).
- C25 before C30 (writer behaviour before writer contract).
- **C22a before C22b** (wire protocol before daemon lifecycle).
- C24 last because it includes the `unifia-knowledge.ts` 1000→~400
  decomposition which is a multi-commit refactor with regression risk.

**Cross-cuts to be aware of** :

- C18 and C22b are linked. C18 closes the egress leak; C22b wires
  the daemon. If C18 changes the `backlinks()` return shape, C22b
  must follow.
- C23 depends on C19. Personal/project dedup is easier once
  containment is correct.
- C18's audit emission closes R-0012 §6. The R-0012 entry must
  be updated to `PARTIELLEMENT CLOS` after the audit event is
  emitted, with the residual gap (declassification grant
  inheritance) noted.
- C24's `verify` exit-code change (return non-zero on WARN) is a
  behaviour change. **Audit `.github/workflows/`, `runbook V2`,
  and `STATE.md` for any `verify` invocation that expects exit 0
  with WARN**; the audit's output is the migration list.

## 5. Phase 5 — the 15 self-verification gates

v2 listed 12 gates. v3 adds 3 (gates 13-15) because line coverage is
a blunt instrument for security-critical paths, and replay integrity
is the only way to know the 18 probes actually ran.

| # | Gate | Currently | Time |
|---|---|---|---|
| 1 | `git diff --check origin/dev..HEAD` | **FAIL** (1 error: `unifia-knowledge.ts:1047`) — **fixed in Phase 0.A'** | 5 s |
| 2 | `bunx biome check packages/unifia/src/knowledge` | 0 warning | 30 s |
| 3 | `bun --cwd packages/contracts typecheck` | exit 0 | 5 s |
| 4 | `bun --cwd packages/contracts test` | 79 pass, 0 fail | 5 s |
| 5 | `bun --cwd packages/unifia run typecheck` | exit 0 | 30 s |
| 6 | `bun --cwd packages/unifia test test/knowledge` | 637 pass, **41 fail** (target 678 pass) | 30 s |
| 7 | `cd crates/unifia-knowledge-core && cargo fmt --check` | exit 0 | 5 s |
| 8 | `cd crates/unifia-knowledge-core && cargo clippy --all-targets --all-features -- -D warnings` | exit 0 | 60 s |
| 9 | `cd crates/unifia-knowledge-core && cargo test` | 35 pass, 0 fail | 30 s |
| 10 | `bun --cwd packages/unifia test test/knowledge/regression` (subset counter) | covered by gate 6 but tracked separately | 10 s |
| 11 | `! grep -rE 'fetch\(|http://|https://|undici\|net\.' packages/unifia/src/knowledge crates/unifia-knowledge-core/src` | 0 matches (offline-first by absence) | 10 s |
| 12 | `bun --cwd packages/unifia test --coverage --coverage-reporter=text` | **≥ 70%** line coverage on `src/knowledge/` | 60 s |
| **13** | `bun --cwd packages/unifia test --coverage --coverage-reporter=text --coverage-include=src/knowledge/policy/decide.ts,src/knowledge/source/vault.ts,src/knowledge/mutation/writer.ts,src/knowledge/facade/service.ts` | **≥ 90%** line coverage on the 4 security-critical paths | 60 s |
| **14** | `bun --cwd packages/unifia test test/knowledge/policy/decide-egress.negative.test.ts` (new) | **9 of 9 `decideEgress` tests** (1 positive + 1 negative per rule × 6 rules minus 3 trivially-passing) | 30 s |
| **15** | `cat docs/knowledge/execution/probes/last-run.json` | **`{ "ran_at": "<ISO8601>", "all_green": true, "failures": [] }`** — the probe replay is recorded | 5 s |

Each gate produces a count and a status. The post-phase report
must include the count and the status. **A gate that fails because
of a new commit is a regression to fix before the next phase.**

Gate 1 (the `git diff --check` fix) is moved from Phase 5 to
**Phase 0.A'** so the implementation can start from a clean
hygiene baseline; otherwise, every subsequent commit re-introduces
the blank line and gate 1 fails immediately.

## 6. Phase 6 — the 18 scripted adversarial probes

v2 listed 15 probes. v3 adds 3 (probes 16, 17, 18) to cover the
audit emission (R-0012 §6), the writer contract, and the MCP daemon
lifecycle. The arithmetic is **4 + 11 + 1 + 2 = 18** (4 Opus 5 + 11
Claude P0/P1 + 1 manual LOC + 2 platform/coverage).

**Probes are pre-staged in Phase 0.E** as thin wrapper scripts
under `docs/knowledge/execution/probes/`. They are **replay
harnesses**, not new tests — they invoke the C-card tests added in
Phase 3 and the oracle command fixed in Phase 4. The re-run is:

```bash
for f in docs/knowledge/execution/probes/*.sh; do
  bash "$f" || { echo "PROBE_FAILED: $f"; exit 1; }
done
```

| # | Probe | Source | Test in repo? | Platform |
|---|---|---|---|---|
| 1 | `decideEgress` with `trust: "unverified"`, default `allow` → deny external | Opus 5 Q2 | yes (Phase 4) | any |
| 2 | `unifia_restrictions` in frontmatter → parses, round-trips | Opus 5 Q2 | yes (C20) | any |
| 3 | Wikilink in fenced code block → not extracted | Opus 5 Q3 | yes (C9 passes) | any |
| 4 | DoD U-07 oracle command exits 0 with all green | Opus 5 Q7 | command path fix in Phase 4 | any |
| 5 | MCP `knowledge_search` for `remote_model: deny` note → returns no body | Claude P0-01 | covered by C18 (failing) | any |
| 6 | Junction `vault/escape` → `..` → not listed | Claude P0-02 | covered by C19 | **Windows** (exit 77 elsewhere) |
| 7 | `serialiseNote` round-trip preserves restrictions | Claude P1-03 | covered by C20 | any |
| 8 | 300ms slow source + 20ms deadline → `truncated: true` | Claude P1-04 | covered by C21 | any |
| 9 | MCP token across calls → valid + not echoed | Claude P1-05 | covered by C22a | any |
| 10 | `verify` with WARN + NOT_EXECUTED → exit 1 | Claude P1-06 | covered by C24 | any |
| 11 | Empty `ProbeEvidence` → NOT `PASS` | Claude P1-06 cont. | yes (C24) | any |
| 12 | `memory/note.md` mounted under project → appears once | Claude P1-07 | covered by C23 | any |
| 13 | `status.vector` reports loaded model, not flag | Claude P1-08 | covered by C23 | any |
| 14 | `trace` follows real `unifia_supersedes`, not backlinks | Claude P1-09 | covered by C23 | any |
| 15 | `< 800 LOC` for all new files (the 500-LOC rule) | Claude P2-11 | manual check | any |
| **16** | **After a `deny` egress decision, the events bus contains an `egress.decision` entry with `decision: "deny"` and non-empty `reason`** | v3 / R-0012 §6 | covered by C18 audit emission | any |
| **17** | **Writer `archive` on an active note → succeeds and rewrites the file; writer `supersede` validates `successorId` and writes the new file; writer `move` rejects targets escaping the vault** | v3 / C30 | covered by C30 | any |
| **18** | **MCP daemon lifecycle: token issued in one process is valid in another within TTL; revocation is immediate across the daemon** | v3 / C22b | covered by C22b | any |

**Phase 6 acceptance** : **all 18 probes must pass** (or exit 77
for platform-not-applicable). Any other failure is a **BLOCKED**
verdict, not a "documented gap". The plan does not allow P0 leaks
to ship as documented (per Claude's explicit verdict language:
"Tant que les cartes correctives … ne sont pas fermées avec les
tests de caractérisation demandés, la décision reste NO-GO.").

**Phase 6 must end with a "second external review required"
gate.** The implementer does not self-declare.

## 7. Phase 7 — second external review (required)

Phase 6 ends with a hand-off, not a verdict. The implementer
must:

1. Compose the review packet (see §7.1).
2. Spawn 6 fresh reviewers in parallel (worker agents) against
   the packet.
3. Wait for the 6 verdicts.
4. **Aggregate** the verdicts into a single `REVIEW-OF-...v3.md`.
5. Only then declare `READY_FOR_REVIEW`.

**The reason** : the existing failure mode (CHANGELOG v0.5.0
claiming 771 verts when reality is 637 + 41 fail) was produced
by self-declaration. The 6-reviewer pattern catches this because
the doc-consistency reviewer and the test-strategy reviewer both
check the plan's claims against reality.

### 7.1. Review packet composition

The packet given to each of the 6 reviewers contains:

- **Source files** (read these): the 3 plan versions (v1, v2, v3)
  + the 2 prior review aggregations + the Opus 5 verdict + the
  Claude review.
- **Implementation artefacts** (verify these): the worktree at
  HEAD with the post-Phase-0/0.5/1/2/3/4/5/6 commits; the
  `docs/knowledge/execution/FAILING-TESTS-AUDIT.md` (Phase 1
  output); the `docs/knowledge/execution/probes/last-run.json`
  (Phase 6 output); the 18 probe scripts.
- **Lens** (one per reviewer):
  1. **Adversarial** — find contradictions, false confidence,
     hidden assumptions. Read the 3 plans, the 3 reviews, the
     current HEAD. Compare claims to reality.
  2. **Security** — C18-C30 coverage, threat model, R-0012 §6
     audit emission verified, probe 16 passes.
  3. **Conventions** — AGENTS.md, runbook V2, ADR format,
     500-LOC rule scope, commit conventions, DECISIONS.md
     integration of D-0021..D-0026.
  4. **Test strategy** — 5-bucket distribution, 15-gate
     coverage, 18-probe sufficiency, 9-egress-test depth.
  5. **Implementation feasibility** — phase ordering, time
     estimates vs reality, hidden dependencies.
  6. **Documentation consistency** — Opus 5 vs Claude vs plan
     reconciliation, CHANGELOG honesty, RISKS, DECISIONS, ADRs.

**Prompt template (per lens)** :

```
You are reviewing `PRODUCTION-READINESS-PLAN-2026-08-30.v3.md` in
worktree `D:\App\unifia\unifia-memory` at HEAD <SHA>. Your lens is
<LENS>. The implementation is at <post-Phase-6 SHA>. Source files:
<list>. Produce a findings report in the same format as the v2
review for your lens (severity-ranked findings with file:line
evidence). End with a self-rating (X/10) and a 1-paragraph verdict.
```

The reviewers are spawned as **fresh worker agents** (not the same
agents that reviewed v1 or v2 — independence is the point).

## 8. Self-classification framework (Phase 1)

v2's 5-bucket framework. v3 adds a **bucket 1 vs bucket 4
disambiguation rule** because the boundary is the failure mode
the framework is most likely to misclassify.

| # | Bucket | Definition | Action |
|---|---|---|---|
| 1 | **Regression** | test passed at `95350647`, fails at HEAD; no doc change in between | bisect; fix forward or revert |
| 2 | **Characterization** | test was written red to pin a bug; the bug is not yet fixed | leave red; counts toward Phase 3 closure |
| 3 | **Stale assertion** | test asserted an old behaviour that has correctly changed | update test with a comment naming the commit |
| 4 | **In-flight-fix regression** | test depends on the OLD behaviour; the uncommitted C19 fix in `vault.ts` or `containment.ts` changed it | **auto-pass after Phase 0.5** (no Phase 3 work) |
| 5 | **Test-infrastructure rot** | the writer's contract evolved and the test was never re-aligned; not a regression but not a clean characterization either | decide per test: re-align or recharacterize |

**Bucket 1 vs bucket 4 rule** : both require bisection to a specific
commit. The disambiguation is:

- **Bucket 1** : the offending commit is a merged commit (in
  `git log origin/dev..HEAD`).
- **Bucket 4** : the offending commit is the uncommitted working
  tree (the `vault.ts` / `containment.ts` change) — i.e., the
  bucket is created by the *current working tree*, not by a
  prior merge.

This rule prevents the implementer from misclassifying a true
regression as "in-flight-fix" to avoid the "fix forward or revert"
action that bucket 1 requires.

**Predicted distribution** (test-strategy v2 reviewer): 0 ×
bucket 1, 19 × bucket 2, 0 × bucket 3, 8 × bucket 4, 14 ×
bucket 5. Total 41. **Predicted** because Phase 1 is the
authoritative source; the audit file's actual distribution
overrides this estimate.

For each of the 41 failing tests, Phase 1 records:

- test name and file:line
- bucket (1-5)
- offending commit (SHA, estimated by bisection if needed)
- one-line rationale
- proposed action (Phase 2 if 1 or 3; Phase 3 if 2; Phase 0.5
  fallback if 4; per-test decision if 5)

The output is `docs/knowledge/execution/FAILING-TESTS-AUDIT.md`,
a single table, 41 rows. The format is fixed (the audit file
must be machine-readable for later gates).

## 9. Decisions to record (Phase 0 and Phase 3)

The v2 plan listed D-0021..D-0025 in the plan text only. **v3
commits to appending them to `docs/knowledge/execution/DECISIONS.md`**
in the existing format (date · carte · décision · preuves ·
alternative rejetée · rollback). v3 also adds D-0026 for the
vitest config choice (Opus 5's recommendation: move the 4
bun-style files to `test/legacy/` and add a `vitest.config.ts`
exclude glob).

| # | Decision | When | What (canonical text) |
|---|---|---|---|
| **D-0021** | 500-LOC rule scope extension | Phase 0 | the 500-LOC rule per `CLAUDE.md:58` (originally scoped to `packages/app/`) is **extended to apply project-wide** for `feat/sovereign-knowledge-core`. New files in any package must not exceed 500 LOC without an exception documented in the commit message. **60 files in `packages/unifia/src/` currently exceed 500 LOC**; these are documented technical debt. **0 files in `packages/unifia/src/knowledge/` exceed 500 LOC** (verified at HEAD). The CLAUDE.md exception clause ("coordinateurs" with named ADR reference) is preserved. |
| **D-0022** | Portable restrictions canonical surfaces | Phase 0.D (Q4) | portable restrictions have **one name per surface, not one name overall**. In-memory: `PortableRestrictions` (camelCase, 4 fields `remoteModel`/`localModel`/`embeddable`/`exportable`, per `packages/contracts/src/knowledge/restrictions.ts`). On-disk: `unifia_restrictions` (snake_case, optional fields with fail-closed defaults, per `RESTRICTIONS_FRONTMATTER_KEY` in the same file). **Retired**: `portable_restrictions` (PERMISSIONS.md §4 used this name pre-amendment; no remaining references in code). The conversion passes through `portableRestrictionsFromFrontmatter()` and `portableRestrictionsToFrontmatter()`. |
| **D-0023** | CHANGELOG honesty over face-saving | Phase 0.A | a CHANGELOG that overstates test count or declares a risk CLOSED while characterisations remain red is a false proof. v0.5.0 is corrected in place (not deleted) to preserve the audit trail while making the test count honest. The `### Not changed in this release` subsection is non-standard but explicit. |
| **D-0024** | Plan pre-flight uses file presence, not specific SHA | Phase 0 | HEAD moves across reviews; asserting a specific SHA causes pre-flight to fail immediately. The plan asserts the presence of source files instead. |
| **D-0025** | Self-declare is forbidden; second external review is required | Phase 7 | the existing failure mode (CHANGELOG inflation) was produced by self-declaration. The 6-reviewer pattern catches this; Phase 7 is not optional. |
| **D-0026** | Vitest config — exclude bun-style files via glob | Phase 5 | the 4 bun-style files in `packages/contracts/test/` use top-level `await` and lack a `test()` from `bun:test`, so vitest rejects them. The fix is to add a `vitest.config.ts` with `test.exclude: ['**/test/legacy/**']` and **move the 4 files into `packages/contracts/test/legacy/`** (Opus 5's recommendation). Alternative rejected: keep the files in place and patch vitest config to allow top-level `await` (false-positive trap). |

The 6 decisions are appended to DECISIONS.md in Phase 0.B as a
**single commit** (`docs(knowledge): DECISIONS D-0021..D-0026`),
following the established D-0001..D-0020 format.

## 10. Constraints (do not violate)

These are the operator's standing interdictions. They apply
throughout.

- **No push, no PR, no merge, no release, no publication.**
- **Do not weaken tests to make them pass.** Write characterisations
  first; then fix the code.
- **Do not replace a real boundary with a mock presented as
  proof.** The ONNX embedding is `disabled` V1; that is the
  truth, not a defect.
- **Do not extend V1 scope without an ADR/RFC.** No new
  capabilities, no new public API, no new dependencies.
- **Code, comments, commit messages in English.** Prior
  French-language findings are translated to English in commit
  messages and ADR amendments, with the original French line
  cited as a blockquote.
- **No branch destruction.** The 142-commit audit trail is
  preserved. No rebase, no reset --hard, no force-push.

## 11. What this plan does NOT do

- It does not propose new features (offline-first, sovereign,
  provider-independent are V1 invariants).
- It does not propose framework migrations.
- It does not propose weakening tests.
- It does not propose weakening security.
- It does not propose changing the public API of
  `@unifia/contracts/knowledge`.
- It does not propose publishing, pushing, or merging.
- It does not propose cross-platform probes (deferred to V1.1).

## 12. Open questions for the reviewing AI

v2 left 5 open questions. v3 answers 2 (Q3 CHANGELOG strategy is
decided; Q5 gate-1 timing is decided — moved to Phase 0.A'). 3
remain, plus 4 new ones surfaced by the v2 reviews:

1. **C22 budget with revert fallback** — the C22a + C22b work is
   estimated 3-5 h but C22b (daemon lifecycle) has the highest
   implementation risk. v3 does not set a hard stop. **Q**: should
   the plan set a hard stop at 5 h with a "rewrite the daemon
   scaffold" fallback, or trust the implementer to manage risk?
2. **Decomposition strategy for `unifia-knowledge.ts` (1000 LOC)** —
   v3 sets a ~400-LOC target per file. **Q**: extract by
   responsibility (read/write/MCP), by command group
   (vault/graph/mcp), or by lifecycle (init/run/shutdown)?
3. **Holdout vs dev fixture for Phase 6 probes** — the plan uses
   `tests/knowledge/eval/dev/`. **Q**: should the holdout fixture
   be reserved for the second external review (Phase 7) only?
4. **Phase 4 location of `decideEgress` tests** — v3 says
   `test(contracts):` (the function lives in `packages/contracts`),
   but the runtime integration lives in `packages/unifia`. **Q**:
   should the 4 pure-function tests live in contracts (with the
   function under test) and the 5 integration tests in unifia
   (with the runtime)?
5. **Phase 7 reviewer prompt independence** — the 6 reviewers
   are spawned as fresh worker agents per the §7.1 prompt
   template. **Q**: should the prompt explicitly forbid the
   reviewer from reading the v2 review (to prevent
   anchor-on-prior-finding), or trust the lens to be
   sufficiently narrow?
6. **Bucket 4 → bucket 1 promotion** — if Phase 0.5's import
   fix does NOT make the 8 VaultSource tests pass (i.e., the
   failure is in the production code, not the missing import),
   the 8 should be promoted from bucket 4 to bucket 1 (or
   bucket 5 if the test is misaligned). **Q**: should the
   audit file pre-commit to the bucket-4-as-bucket-1-fallback
   promotion rule, or leave it to the implementer's judgement?
7. **C23 scope vs C1/C4/C26** — v3 routes C1, C4, and C26 fails
   through C23 ("graph + composition"). C1 is CLI, C4 is policy
   wiring, C26 is daemon. **Q**: should C23 be split into C23a
   (CLI runtime), C23b (policy wiring), C23c (graph+composition),
   or kept as one card with 3 sub-tasks?

## 13. Self-confidence

**Three sub-scores** (split per v1 review n-1, instead of a single
number that mixes uncertainty classes):

| Sub-score | Value | Bounded by |
|---|---:|---|
| **Coverage** (how well v3 addresses the v1 + v2 findings) | **8.0/10** | (a) Phase 0.5 import fix may expand if `realOrNull` synchronous calls at `vault.ts:122, 210, 212` are also async-required; (b) D-0022's "renaming" of `portable_restrictions` is forward-looking and not in any phase budget |
| **Ordering** (whether the 0 → 0.5 → 1 → 2 → 3 → 4 → 5 → 6 → 7 sequence is correct) | **8.5/10** | C22b ordering (last in Phase 3) is correct but the "no bisection needed" finding is conditional on the implementer verifying `git log 9ff20c36f1..HEAD` themselves; the false-bisection trap is the kind of thing a careless implementer falls into |
| **Interpretation** (whether the open questions can be answered without re-planning) | **7.0/10** | Q1 (C22 budget) and Q4 (test location) are real choices; Q7 (C23 split) may reveal hidden C1/C4/C26 coupling |

**Average** : 7.8/10. **Conditional overall** : 7.5/10 (matches
v2's self-rating; the +0.3 average is offset by the residual
uncertainty in the interpretation sub-score).

**v3's confidence is conditional on** : Phase 1 bucket
distribution matching the predicted 0/19/0/8/14; C22b implementation
fitting in 3-5 h; Q4 test-location answer being "split" (the
default that v3 already commits to via the disjunction in the
commit-type column).

## 14. Changes from v2 (audit trail)

v3 corrects the following v2 issues, surfaced by the 6 v2 reviewers
in the v2 review (`REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v2.md`):

| # | Issue (v2) | v3 correction | Source reviewer |
|---|---|---|---|
| 1 | C30 count claimed 13 fail; actual 11 | §4: C30 = 11 fail; 5+11=16 of 41 in C25+C30 | security, test-strategy, doc-consistency |
| 2 | DoD count claimed 10/7/4; actual 12/7/3 | §1, §2: updated to 12/7/3 | doc-consistency |
| 3 | Probe arithmetic 4+9+2=15 didn't match the 4+10+1=15 table | §6: arithmetic is 4 + 11 + 1 + 2 = 18 (v3 has 18 probes) | doc-consistency |
| 4 | D-0021 said "is applied project-wide" but CLAUDE.md scopes the rule to `packages/app/` | D-0021: "is **extended to apply** project-wide" | conventions, doc-consistency |
| 5 | D-0021 said "53 files" but actual is 60 | D-0021: "60 files" (verified) | conventions |
| 6 | D-0021..D-0025 not yet in DECISIONS.md | §9 commits to appending in Phase 0.B (single commit) | implementation, conventions |
| 7 | D-0022 didn't specify the field set | D-0022: 4 fields named (`remoteModel`/`localModel`/`embeddable`/`exportable`), in-memory vs on-disk vs retired surfaces distinguished | security, adversarial |
| 8 | C18 framing assumed portable restrictions were unimplemented | C18 reframed: "wire the egress guard into `service.search()` and `service.backlinks()` + emit `egress.decision` event" (restrictions are implemented; integration + audit emission are the actual gaps) | security |
| 9 | C22 framing claimed "may be a regression introduced by 9ff20c36f1" — factually false | C22 split into C22a (wire) + C22b (daemon lifecycle); the 4 C22 tests have never been green; no bisection needed | security |
| 10 | Phase 1 budget 1.5-2.5h was optimistic (realistic 2.5-3.5h) | §3: 2.5-3.5h | implementation |
| 11 | Phase 0 budget 45 min was optimistic (realistic 50-70 min) | §3: 50-70 min | implementation |
| 12 | No platform scope statement (P0-02 is Windows-only) | §0.1: Platform assumptions; probe 6 exits 77 on non-Windows | test-strategy, implementation |
| 13 | Phase 6 wording "Probes are committed as scripts... before Phase 6 starts" was misleading (probes are replay harnesses) | §6: "thin wrapper scripts... replay harnesses, not new tests" | implementation |
| 14 | Probes directory `docs/knowledge/execution/probes/` was forward-looking | §2 row 7: pre-staged in **Phase 0.E** | conventions |
| 15 | Phase 5 commit type `chore:` (no scope) was inconsistent with the rest | §3 Phase 5: `chore(knowledge):` | conventions |
| 16 | Phase 4 commit type `test(knowledge):` may be inaccurate (decideEgress lives in contracts) | §3 Phase 4: `test(contracts):` (or `test(knowledge):`) + `fix(knowledge):` for the audit emission | conventions |
| 17 | Phase 6 "all 15 must pass" was too strict on platform axis (P0-02 on Linux) | §6: P0-02 exits 77 (platform-not-applicable) per autotools convention; all 18 must pass on Windows | test-strategy |
| 18 | R-0012 §6 (audit `egress.decision` emission) was unaddressed | C18 scope includes audit emission; probe 16 asserts the event; gate 14 covers the function | security |
| 19 | 12 gates were insufficient (no security-critical path coverage, no negative-path coverage, no replay integrity) | §5: 15 gates; gates 13 (90% on 4 security paths), 14 (9 egress tests), 15 (replay integrity) added | test-strategy |
| 20 | C18 wording "every read path" was misleading (1 of 3 wired) | §4 C18: explicit "wire the guard into `service.search()` and `service.backlinks()`" | test-strategy |
| 21 | C22 conflated wire protocol and daemon lifecycle | §4: C22 split into C22a + C22b | test-strategy |
| 22 | Vitest config was a non-choice (add config vs move files) | D-0026: Opus 5's "move to `test/legacy/` + exclude glob" is committed | conventions, test-strategy |
| 23 | Phase 7 was structurally required but operationally undefined | §7.1: 6-lens packet composition + prompt template + fresh-agent rule | all 6 reviewers |
| 24 | §4 "16 of 41" arithmetic didn't match the table (5+13=18) | §4: 5+11=16 (C30 count corrected) | doc-consistency |
| 25 | §1 cited a SHA the next reviewer would see as stale | §1: SHA dropped; "(illustrative — D-0024 uses file presence, not SHA)" | conventions |
| 26 | C26 routing through C22 was loose (different layer) | §4: C22 split; C26 tests route through C22b (daemon lifecycle) | test-strategy |
| 27 | Bucket 1 vs bucket 4 boundary was the most likely misclassification | §8: disambiguation rule (bucket 1 = merged commit, bucket 4 = uncommitted working tree) | test-strategy |
| 28 | `git diff --check` fix was first action of Phase 5 (too late) | §2 row 1: moved to **Phase 0.A'** so the implementation starts from a clean hygiene baseline | conventions |
| 29 | Phase 0.5 had no escalation if scope > 1 line | §3 Phase 0.5: "abort and re-plan if scope > 1 line" | implementation |
| 30 | Self-confidence was a single number (7.5/10) | §13: 3 sub-scores (coverage 8.0, ordering 8.5, interpretation 7.0; average 7.8; conditional 7.5) | adversarial |
| 31 | Egress test depth (4 tests) was inadequate for a security-critical function | §4 Phase 4: 9 tests (4 `decideEgress` + 5 depth) per Opus 5's "depth should follow blast radius" | test-strategy, security |
| 32 | C26 routing through C22 conflated the 4 fails (which are C22 characterisation, not C26 separate) | §4: the 4 C22 fails route through C22a (wire) + C22b (daemon) | test-strategy |

---

*v3 supersedes v2. v2 is preserved in
`PRODUCTION-READINESS-PLAN-2026-08-30.v2.md` for the audit trail.
v1 is preserved in `PRODUCTION-READINESS-PLAN-2026-08-30.md`.
v3 was authored by integrating the 6-reviewer feedback against v2
(see `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v2.md` for the
aggregation).*
