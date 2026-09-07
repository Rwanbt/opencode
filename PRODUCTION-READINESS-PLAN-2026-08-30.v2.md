<!-- SPDX-License-Identifier: MIT -->
# Production-Readiness Plan — Sovereign Knowledge Core V1 (v2)

> v2 supersedes v1 (`PRODUCTION-READINESS-PLAN-2026-08-30.md`).
> v2 integrates feedback from 6 specialised reviewers (adversarial,
> security, conventions, test strategy, implementation feasibility,
> doc consistency) who reviewed v1 in parallel. v1 is preserved
> in the worktree as the audit trail.
>
> The reviewing AI is invited to challenge v2 on the same axes
> the v1 reviewers used. The 5 questions left open in §12 are the
> known decision points.

---

## 0. Pre-flight (must pass before reading further)

```bash
cd D:\App\unifia\unifia-memory
git rev-parse --show-toplevel          # must be D:\App\unifia\unifia-memory
git branch --show-current              # must be feat/sovereign-knowledge-core
git config --get branch.feat/sovereign-knowledge-core.remote
# must fail (no upstream)
```

The plan does **not** assert a specific HEAD SHA — HEAD has moved
across reviews. Instead, the plan asserts the presence of these
files (run from the worktree root):

- `PRODUCTION-READINESS-PLAN-2026-08-30.md` (v1, audit trail)
- `PRODUCTION-READINESS-PLAN-2026-08-30.v2.md` (this file)
- `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.md` (v1 review)
- `REVIEW-PRODUCTION-READINESS-CLAUDE-2026-08-30.md` (Claude review)
- `docs/knowledge/execution/FRONTIER-REVIEW-VERDICT.md` (Opus 5 review)
- `docs/knowledge/execution/RISKS.md` (with R-0012 already present)
- `docs/knowledge/CHANGELOG.md` (with v0.5.0 honesty corrections applied)

If any of these files is missing, the operating environment has
changed. Re-read before proceeding.

---

## 1. Snapshot (at HEAD `1d9e3b4650`, 141 commits since `origin/dev`)

| Field | Value |
|---|---|
| Branch | `feat/sovereign-knowledge-core` (no upstream) |
| Local commits | **141** |
| Tests pass | **637** (TS knowledge) + 79 (contracts) + 35 (Rust) = **751** |
| Tests fail | **41** (TS knowledge characterization tests) |
| CHANGELOG v0.5.0 claim | 771 passing (still inflated; corrected in Phase 0.A) |
| Working tree | 2 modified (`containment.ts`, `vault.ts`) + 1 untracked (REVIEW-CLAUDE) |
| Mutations external | 0 push, 0 PR, 0 merge, 0 release, 0 publication |

**Critical uncommitted bug (B-2 from v1 review)** :
`packages/unifia/src/knowledge/source/vault.ts:26` imports only
the synchronous functions `isContained, realOrNull` from
`./containment.js`. The uncommitted C19 fix at line 44, 71, 78
calls the async versions `realOrNullAsync, isContainedAsync` which
are **not imported**. Committing the working tree as-is would
trigger `ReferenceError: realOrNullAsync is not defined` at
runtime and regress 9 tests. **Phase 0.5 fixes this.**

## 2. Already-done in working tree (DO NOT re-do)

The v1 plan listed 9 "what's not done" rows. **Six of them are
already done at HEAD `1d9e3b4650`.** v2 does not re-do them.

| Row | Status at HEAD | Evidence |
|---|---|---|
| R-0012 (portable restrictions unimplemented) | **EXISTS, OPEN** | `RISKS.md:142-175` already has the entry; severity high, dated 2026-08-29 |
| ADR-0006 marked `PARTIALLY IMPLEMENTED` | **DONE** | `adr/0006-knowledge-egress.md:113` already carries the marker; the 2026-08-29 amendment lists what V1 delivers and what is deferred |
| DoD status table filled in | **DONE** | `SOVEREIGN-CORE-V1-DOD.md:264-287` already has 10 PASS, 7 PARTIAL, 4 NOT_EXECUTED |
| PERMISSIONS.md §4/§5/§8 corrections | **DONE** | the corrections Opus 5 listed are integrated in the current file |
| Opus 5 P2 (wikilink fence leak) | **DONE** | CHANGELOG v0.3.0 records the fix; `parser/code-mask.ts` exists; the C9 characterisation passes |
| `commands-report.ts` (>891 LOC) decomposed | **DONE** | replaced by `commands-vault.ts` (525 LOC), `commands-graph.ts` (442 LOC), `commands-mcp.ts` (137 LOC), `runtime.ts` (151 LOC), `shared.ts` (57 LOC), `usage.ts` (88 LOC) |

**Remaining real work** (the only things v2 actually has to do) :

| # | Item | Where it lives in v2 |
|---|---|---|
| 1 | **Repair the uncommitted C19 fix** (1-line import in `vault.ts:26`) | Phase 0.5 |
| 2 | **Correct CHANGELOG v0.5.0 in place** (do not delete; add `### Fixed` + `### Not changed`) | Phase 0.A |
| 3 | **Verify R-0012 / R-0013 text matches reality** (refresh if needed) | Phase 0.C |
| 4 | **Decide Q4** (portable restrictions: implement or document?) | Phase 0.D (decision, ADR amendment) |
| 5 | **Classify the 41 failing tests** into 5 buckets | Phase 1 |
| 6 | **Fix the genuine regressions and stale assertions** | Phase 2 |
| 7 | **Close the 9 corrective cards C18-C30** (was C18-C24) | Phase 3 |
| 8 | **Close Opus 5 P3** (DoD U-07 oracle command, two expected-fail egress tests) | Phase 4 |
| 9 | **Hygiene + 12 gates** | Phase 5 |
| 10 | **Re-verify with 15 scripted adversarial probes** | Phase 6 |
| 11 | **Request a second external review** (not self-declare) | Phase 7 |

## 3. Phase plan (sequenced; no parallel work)

| # | Phase | What | Estimated | Commit type |
|---|---|---|---:|---|
| 0 | Honest accounting | CHANGELOG correction + R-0012 verify + R-0013 verify + Q4 decision (ADR amendment) | 45 min | `docs(knowledge):` |
| 0.5 | **Repair the uncommitted C19 fix** | add `realOrNullAsync, isContainedAsync` to the import at `vault.ts:26` | 5 min | `fix(knowledge):` |
| 1 | Classify the 41 failing tests | 5-bucket classification (regression / characterization / stale / in-flight-fix / test-infra-rot) + per-test SHA | 1.5–2.5 h | `docs(knowledge):` (audit file) |
| 2 | Fix regressions + stale assertions | depends on Phase 1 output; budget 0.5–4 h; may be no-op | 0.5–4 h | `fix(knowledge):` or `test(knowledge):` |
| 3 | Close the 9 corrective cards C18-C30 | see §4 for per-card scope | 8–15 h | `fix(knowledge):` |
| 4 | Close Opus 5 P3 | DoD U-07 oracle command (1-line fix) + 4 `decideEgress` tests (2 expected to fail as R-0012 trackers) | 3–5 h | `docs(knowledge):` + `test(knowledge):` |
| 5 | Hygiene + 12 gates | see §5 for the 12 gates; decompose `unifia-knowledge.ts` (1048 LOC) | 2–4 h | `refactor(knowledge):` + `chore:` |
| 6 | Re-verify with 15 scripted probes | all 15 probes must pass; otherwise BLOCKED | 2–3 h | `test(knowledge):` + `docs(knowledge):` |
| 7 | Request second external review | hand the same `REVIEW-OF-…` packet to a different AI; do not self-declare | — | `docs(knowledge):` |

**Total**: ~18–32 h of focused work, spread across 3–5 sessions.
The v1 plan's "1.5 engineer-days" estimate was for Opus 5 P1-P3
only; v2 is 2× that because it includes the 9 corrective cards.

**Phase 0 must complete before Phase 0.5.** The repair
(`vault.ts:26`) is the precondition for any other work. Without
it, the test suite has a `ReferenceError` and Phase 1 cannot
classify reliably.

**Phase 0 must complete before Phase 1.** The CHANGELOG
correction sets the contract: the audit file (Phase 1 deliverable)
will report the bucket distribution, and that distribution
drives the CHANGELOG's `### Tests` line. Doing it in the
opposite order (v1) risks a second CHANGELOG correction if
Phase 1 finds regressions the CHANGELOG does not yet name.

**Phase 1 must complete before Phase 2 and Phase 3.** Phase 2
and Phase 3 both consume the Phase 1 classification.

## 4. Phase 3 — the 9 corrective cards C18-C30

v1's plan listed 7 cards (C18-C24) inherited from Claude's
review. v2 expands to 9 (C18-C30) to include the **16 of 41
failing tests** that v1 missed (C25: 5 fails, C30: 13 fails).

| Card | Scope | Tests | Estimate |
|---|---|---:|---:|
| C18 | egress guard on every read path | 2 fail | 1–2 h |
| C19 | filesystem containment (real paths, junction reject) | 1 fail + 8 VaultSource regressions (re-test) | 0.5–1 h |
| C20 | round-trip of `unifia_restrictions` (parse → serialise → parse) | 0 fail (already done; verify) | 0.5–1 h |
| C21 | deadline bound on `list()` and `read()` | 0 fail (already done; verify with slow-source characterisation) | 1–2 h |
| C22 | MCP wire-protocol (token threaded, not echoed, valid across calls) | 4 fail | 2–4 h |
| C23 | graph + composition (dedup, real supersedes lineage, `status.vector` honesty) | covered by C1/C4 fails; verify | 1–2 h |
| C24 | evidence + hygiene (Android `isUsableEvidence`, `verify` exit code, real SHA-256, `git diff --check`) | 0 fail (already done; verify the one remaining `git diff --check` error) | 1–2 h |
| **C25** | **VaultMutationWriter behaviour** (CAS, lifecycle, propose via facade) | **5 fail** | 1–2 h |
| **C30** | **writer-contract** (archive, supersede, move, CAS — 4 defects × ~3 cases each) | **13 fail** | 2–4 h |
| | | **Total** | 8–15 h |

**Order within Phase 3** : C18 → C19 → C20 → C21 → C23 → C25 →
C30 → C22 → C24. C18 first because every read path depends
on the egress guard. C22 (MCP wire protocol) last because
the C26 transport failures may be a regression introduced by
9ff20c36f1 and need bisection. C24 last because it includes
the `unifia-knowledge.ts` decomposition which is a multi-commit
refactor that risks behaviour change.

**Cross-cuts to be aware of** :

- C18 and C22 are linked. C18 closes the egress leak; C22
  wires the MCP token. If C18 changes the `backlinks()` return
  shape, C22 must follow.
- C23 depends on C19. Personal/project dedup is easier once
  containment is correct.
- C18 cannot pass without portable restrictions (Opus 5 P1).
  The Q4 decision in Phase 0.D determines whether this is a
  Phase 3 implementation or a documented gap.
- C24's `verify` exit-code change (return non-zero on WARN)
  is a behaviour change that may break existing CI scripts
  that rely on `verify` returning 0. Document in the commit.

## 5. Phase 5 — the 12 self-verification gates

v1 listed 8 gates. v2 adds 4 because the v1 8 are hygiene, not
readiness. The order is cheapest → most expensive.

| # | Gate | Currently | Time |
|---|---|---|---|
| 1 | `git diff --check origin/dev..HEAD` | **FAIL** (1 error: `unifia-knowledge.ts:1047: new blank line at EOF`) | 5 s |
| 2 | `bunx biome check packages/unifia/src/knowledge` | 0 warning | 30 s |
| 3 | `bun --cwd packages/contracts typecheck` | exit 0 | 5 s |
| 4 | `bun --cwd packages/contracts test` | 79 pass, 0 fail | 5 s |
| 5 | `bun --cwd packages/unifia run typecheck` | exit 0 | 30 s |
| 6 | `bun --cwd packages/unifia test test/knowledge` | 637 pass, **41 fail** (target: 678 pass) | 30 s |
| 7 | `cd crates/unifia-knowledge-core && cargo fmt --check` | exit 0 | 5 s |
| 8 | `cd crates/unifia-knowledge-core && cargo clippy --all-targets --all-features -- -D warnings` | exit 0 | 60 s |
| 9 | `cd crates/unifia-knowledge-core && cargo test` | 35 pass, 0 fail | 30 s |
| 10 | `bun --cwd packages/unifia test test/knowledge/regression` (subset) | covered by gate 6 but tracked separately | 10 s |
| 11 | `! grep -rE 'fetch\(|http://|https://|undici|net\.' packages/unifia/src/knowledge crates/unifia-knowledge-core/src` | 0 matches (preserves offline-first by absence) | 10 s |
| 12 | `bun --cwd packages/unifia test --coverage --coverage-reporter=text` | ≥ 70% line coverage on `src/knowledge/` | 60 s |

Each gate produces a count and a status. The post-phase report
must include the count and the status. **A gate that fails
because of a new commit is a regression to fix before the next
phase.**

Gate 1 (the 30-second `git diff --check` fix) is a 1-line
delete; do it as the first action of Phase 5, separately from
the decomposition work, so a hygiene failure cannot block the
substantive work.

## 6. Phase 6 — the 15 scripted adversarial probes

v1 listed 14. v2 corrects to 15 (Opus 5 has 4 FAIL probes, not 6;
Claude has 9 P0/P1 blockers, not 8; plus 2 Claude P2 hygiene probes
that v1 missed).

**Probes are committed as scripts** under
`docs/knowledge/execution/probes/` before Phase 6 starts. The
re-run is then:

```bash
for f in docs/knowledge/execution/probes/*.sh; do bash "$f"; done
```

| # | Probe | Source | Test in repo? | Platform |
|---|---|---|---|---|
| 1 | `decideEgress` with `trust: "unverified"`, default `allow` → deny external | Opus 5 Q2 | partial (no test) | any |
| 2 | `unifia_restrictions` in frontmatter → parses, round-trips | Opus 5 Q2 | yes (Q2 round-trip in C30) | any |
| 3 | Wikilink in fenced code block → not extracted | Opus 5 Q3 | yes (C9 passes) | any |
| 4 | DoD U-07 oracle command exits 0 with all green | Opus 5 Q7 | command path fix needed | any |
| 5 | MCP `knowledge_search` for `remote_model: deny` note → returns no body | Claude P0-01 | covered by C18 (failing) | any |
| 6 | Junction `vault/escape` → `..` → not listed | Claude P0-02 | covered by C19 | **Windows** |
| 7 | `serialiseNote` round-trip preserves restrictions | Claude P1-03 | covered by C20 | any |
| 8 | 300ms slow source + 20ms deadline → `truncated: true` | Claude P1-04 | covered by C21 | any |
| 9 | MCP token across calls → valid + not echoed | Claude P1-05 | covered by C22 | any |
| 10 | `verify` with WARN + NOT_EXECUTED → exit 1 | Claude P1-06 | covered by C24 | any |
| 11 | Empty `ProbeEvidence` → NOT `PASS` | Claude P1-06 cont. | yes (C24 passes) | any |
| 12 | `memory/note.md` mounted under project → appears once | Claude P1-07 | covered by C23 | any |
| 13 | `status.vector` reports loaded model, not flag | Claude P1-08 | covered by C23 | any |
| 14 | `trace` follows real `unifia_supersedes`, not backlinks | Claude P1-09 | covered by C23 | any |
| 15 | `< 800 LOC` for all new files (the 500-LOC rule) | Claude P2-11 | manual check | any |

**Phase 6 acceptance** : **all 15 probes must pass.** Any
failure is a BLOCKED verdict, not a "documented gap". The
plan does not allow P0 leaks to ship as documented (per Claude's
explicit verdict language: "Tant que les cartes correctives …
ne sont pas fermées avec les tests de caractérisation
demandés, la décision reste NO-GO.").

**Phase 6 must end with a "second external review required"
gate.** The implementer does not self-declare. The deliverable
is a prompt for the second review (see §7).

## 7. Phase 7 — second external review (required)

Phase 6 ends with a hand-off, not a verdict. The implementer
must:

1. Re-run the 6-reviewer pattern against the implementation
   (adversarial, security, conventions, test strategy, implementation
   feasibility, doc consistency).
2. Wait for the second review's verdict.
3. Only then declare `READY_FOR_REVIEW` (Opus 5 said "I would
   re-review after P1-P3 and expect APPROVED"; v2 has more than
   P1-P3 so the precedent is the same).

**The reason** : the existing failure mode (CHANGELOG v0.5.0
claiming 771 verts when reality is 637 + 41 fail) was produced
by self-declaration. The 6-reviewer pattern catches this
because the doc-consistency reviewer and the test-strategy
reviewer both check the plan's claims against reality.

## 8. Self-classification framework (Phase 1)

v1's 3-bucket framework missed 8 of the 41 fails. v2 uses
5 buckets:

| # | Bucket | Definition | Action |
|---|---|---|---|
| 1 | **Regression** | test passed at `95350647`, fails at HEAD; no documentation change in between | bisect; fix forward or revert |
| 2 | **Characterization** | test was written red to pin a bug; the bug is not yet fixed | leave red; counts toward Phase 3 closure |
| 3 | **Stale assertion** | test asserted an old behaviour that has correctly changed | update test with a comment naming the commit |
| 4 | **In-flight-fix regression** | test depends on the OLD behaviour; the uncommitted C19 fix in `vault.ts` or `containment.ts` changed it | bucket 4 catches the 8 VaultSource filtering fails that v1 incorrectly classified as C19 characterizations |
| 5 | **Test-infrastructure rot** | the writer's contract evolved and the test was never re-aligned; not a regression but not a clean characterization either | decide per test: re-align or recharacterize |

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

The v1 plan implied new decisions without specifying them. v2
names them:

| # | Decision | When | What |
|---|---|---|---|
| D-0021 | 500-LOC rule scope | Phase 0 | the 500-LOC rule per `CLAUDE.md` is applied project-wide for this branch, not only to `packages/app/`. Existing 53 files in `packages/unifia/src/` are documented technical debt. |
| D-0022 | Portable restrictions spelling | Phase 0.D (Q4) | the canonical name is `unifia_restrictions` per ADR-0002 and ADR-0006 amendment; PERMISSIONS.md and the contracts use this name; any prior reference to `portable_restrictions` or `PortableRestrictions` in code or docs is renamed. |
| D-0023 | CHANGELOG honesty over face-saving | Phase 0.A | a CHANGELOG that overstates test count or declares a risk CLOSED while characterisations remain red is a false proof. v0.5.0 is corrected in place (not deleted) to preserve the audit trail while making the test count honest. |
| D-0024 | Plan pre-flight uses file presence, not specific SHA | Phase 0 | HEAD moves across reviews; asserting a specific SHA causes pre-flight to fail immediately. The plan asserts the presence of source files instead. |
| D-0025 | Self-declare is forbidden; second external review is required | Phase 7 | the existing failure mode (CHANGELOG inflation) was produced by self-declaration. The 6-reviewer pattern catches this; Phase 7 is not optional. |

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
- **No branch destruction.** The 141-commit audit trail is
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

## 12. Open questions for the reviewing AI

The v1 plan left 8 open questions. v2 answers 3 of them (Q1
ordering, Q3 CHANGELOG revert, Q8 second review). 5 remain:

1. **Q4 (portable restrictions: implement or document?)** —
   the Phase 0.D decision. The default is "implement minimum
   portable restrictions in Phase 3" because the security
   review produced a reproducible P0 leak. If the operator
   insists on the document-only path, R-0012 stays OPEN and
   C18 cannot close in V1. The reviewing AI is asked to
   ratify the default or override.
2. **C22 budget** — the C22 MCP wire-protocol work is
   estimated 2–4 h but has the highest implementation risk
   (regression introduction possible). Should the plan set
   a hard stop at 4 h with a "revert 9ff20c36f1" fallback, or
   trust the implementer to manage risk?
3. **Decomposition target for `unifia-knowledge.ts` (1048 LOC)** —
   the plan sets a 400-LOC target per file (below the 500-LOC
   rule to give headroom). The reviewing AI is asked to
   ratify the strategy (extract by responsibility? by command
   group? by lifecycle?) or name a better one.
4. **Holdout vs dev fixture for Phase 6 probes** — the plan
   uses `tests/knowledge/eval/dev/`. Should the holdout fixture
   be reserved for the second external review (Phase 7) only?
5. **Gate 1 (`git diff --check` trailing blank line) — fix
   now or in Phase 5?** — the plan fixes it as the first
   action of Phase 5. The reviewing AI is asked to ratify
   (a 30-second commit is risk-free) or suggest Phase 0.

## 13. Self-confidence

**7.5/10.** After the v1 corrections are applied, the rating
is 7.5/10 (up from 6/10 in v1's self-assessment). The remaining
2.5 points are bounded by:

- Unknown bucket distribution of the 41 fails (until Phase 1)
- C22 wire-protocol risk (until the failing C26 tests are diagnosed)
- Q4 decision impact on C18 closure (the v2 default is "implement
  portable restrictions"; an override would change Phase 3 scope)

**v2's confidence is conditional** : if Phase 1 reveals
predominantly bucket 1 (regressions) or bucket 4 (in-flight-fix),
the plan's Phase 3 budget may be insufficient. Phase 1 is the
pivot point.

---

*v2 supersedes v1. v1 is preserved in
`PRODUCTION-READINESS-PLAN-2026-08-30.md` for the audit trail.
v2 was authored by integrating the 6-reviewer feedback from
`REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.md`.*
