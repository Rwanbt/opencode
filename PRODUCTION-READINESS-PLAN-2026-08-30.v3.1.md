<!-- SPDX-License-Identifier: MIT -->
# Production-Readiness Plan — Sovereign Knowledge Core V1 (v3.1)

> v3.1 supersedes v3 (`PRODUCTION-READINESS-PLAN-2026-08-30.v3.md`).
> v3.1 integrates feedback from 6 specialised reviewers who reviewed
> v3 in parallel (the v3 review, 2026-08-30, 36 corrections). v3 is
> preserved in the worktree as the audit trail.
>
> **v3.1 + §15 + §16 self-rating** : 8.3/10 (sub-scores: coverage 8.5,
> ordering 8.5, interpretation 8.0; average 8.3; conditional 8.0 —
> see §16.5). The conditional sub-score reflects the resolved bucket
> distribution (0/0/0/41/0) and the C18-audit scope reduction to
> 2 plumbing points (delete `inspector.ts`, see §16 BLOCKER-S1).
>
> **The 4 open questions in §12 are the only decision points left.**

---

## 0. Pre-flight (must pass before reading further)

```powershell
Set-Location 'D:\App\unifia\unifia-memory'
git rev-parse --show-toplevel
# must be D:\App\unifia\unifia-memory
git branch --show-current
# must be feat/sovereign-knowledge-core
git config --get branch.feat/sovereign-knowledge-core.remote
# must exit 1 (no value — no upstream)
```

The plan asserts the **presence of these files** (D-0024) instead of a
specific SHA — HEAD has moved 4 times across the v1/v2/v3/v3.1 reviews
and asserting a SHA makes the pre-flight fail immediately:

- `PRODUCTION-READINESS-PLAN-2026-08-30.md` (v1, audit trail)
- `PRODUCTION-READINESS-PLAN-2026-08-30.v2.md` (v2, audit trail)
- `PRODUCTION-READINESS-PLAN-2026-08-30.v3.md` (v3, audit trail)
- `PRODUCTION-READINESS-PLAN-2026-08-30.v3.1.md` (this file)
- `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.md` (v1 review)
- `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v2.md` (v2 review)
- `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v3.md` (v3 review)
- `REVIEW-PRODUCTION-READINESS-CLAUDE-2026-08-30.md` (Claude review)
- `docs/knowledge/execution/FRONTIER-REVIEW-VERDICT.md` (Opus 5 review)
- `docs/knowledge/execution/RISKS.md` (with R-0012 already present)
- `docs/knowledge/CHANGELOG.md` (with v0.5.0 honesty corrections applied in Phase 0.A0)
- `docs/knowledge/SOVEREIGN-CORE-V1-DOD.md` (with Décompte line corrected to 12/7/3 in Phase 0.A0)

If any of these files is missing, the operating environment has
changed. Re-read before proceeding.

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

**Phase 6 acceptance asymmetry** : on **Windows**, all 19 probes must
pass. On **non-Windows**, 18 must pass and probe 6 may exit 77.
Otherwise BLOCKED.

## 1. Snapshot (illustrative — D-0024 uses file presence, not SHA)

| Field | Value (at v3.1 authoring time) |
|---|---|
| Branch | `feat/sovereign-knowledge-core` (no upstream) |
| Local commits | **146** since `origin/dev` (HEAD moves per commit; v3.1 review found 143 stale → 144, §15 amendment added 1 (v3.1 review aggregation), §16 verification re-counts to 146) |
| Tests pass | 637 (TS knowledge) + 79 (contracts) + 35 (Rust) = **751** |
| Tests fail | **41** (TS knowledge) |
| CHANGELOG v0.5.0 claim | 771 passing (still inflated; corrected in Phase 0.A0) |
| Working tree | 2 modified (`containment.ts`, `vault.ts`) + 1 untracked (`REVIEW-CLAUDE`) |
| DoD status | 12 PASS, 7 PARTIAL, 3 NOT_EXECUTED (U-11 upgraded 2026-08-30) — but `SOVEREIGN-CORE-V1-DOD.md:289` Décompte line still says 10/7/4; **corrected in Phase 0.A0** |
| Files > 500 LOC in `packages/unifia/src/` | **59** (verified) |
| Files > 500 LOC in `packages/unifia/src/knowledge/` | **0** (verified) |
| Mutations external | 0 push, 0 PR, 0 merge, 0 release, 0 publication |

**Critical uncommitted bug (B-2 from v1 review)** : `vault.ts:26`
imports only the synchronous functions `isContained, realOrNull` from
`./containment.js`. The uncommitted C19 fix at lines 44, 71, 78 calls
the async versions `realOrNullAsync, isContainedAsync` which are
**not imported**. The fix also requires adding `import { readdir, stat }
from "node:fs/promises"` (or equivalent `fsp`) for the `fsp.readdir`
and `fsp.stat` calls. **Phase 0.5 fixes all of this (2-3 line change)**.

## 2. Already-done in working tree (DO NOT re-do)

The v1 plan listed 9 "what's not done" rows. **Six of them are
already done at HEAD.** v3.1 does not re-do them.

| Row | Status at HEAD | Evidence |
|---|---|---|
| R-0012 (portable restrictions) | **EXISTS, OPEN** | `RISKS.md:142-175` already has the entry; severity high, dated 2026-08-29 |
| ADR-0006 marked `PARTIALLY IMPLEMENTED` | **DONE** | `adr/0006-knowledge-egress.md:113` already carries the marker |
| DoD status table filled | **DONE** (table 12/7/3; line 289 still 10/7/4) | `SOVEREIGN-CORE-V1-DOD.md:264-287` shows 12 PASS, 7 PARTIAL, 3 NOT_EXECUTED; **line 289 corrected in Phase 0.A0** |
| PERMISSIONS.md §4/§5/§8 corrections | **DONE** | the corrections Opus 5 listed are integrated in the current file |
| Opus 5 P2 (wikilink fence leak) | **DONE** | CHANGELOG v0.3.0 records the fix; `parser/code-mask.ts` exists; the C9 characterisation passes |
| `commands-report.ts` decomposed | **DONE** | replaced by `commands-vault.ts` (497 LOC), `commands-graph.ts` (423 LOC), `commands-mcp.ts` (128 LOC), `runtime.ts` (141 LOC), `shared.ts` (51 LOC), `usage.ts` (86 LOC) |

**Remaining real work** (the only things v3.1 actually has to do) :

| # | Item | Where it lives in v3.1 |
|---|---|---|
| 1 | **Fix the `git diff --check` trailing blank line** at `unifia-knowledge.ts:1047` (1-line delete) | Phase 0.A1 |
| 2 | **Correct DoD `SOVEREIGN-CORE-V1-DOD.md:289` Décompte line** to 12/7/3 (1-line edit) | Phase 0.A0 |
| 3 | **Correct CHANGELOG v0.5.0 in place** (do not delete; add `### Fixed` + `### Not changed`) | Phase 0.A0 |
| 4 | **Append D-0021..D-0026** to `docs/knowledge/execution/DECISIONS.md` (single commit) | Phase 0.B |
| 5 | **Verify R-0012 / R-0013 text matches reality** (refresh if needed) | Phase 0.C |
| 6 | **Decide D-0022 surface** (in-memory `PortableRestrictions` vs on-disk `unifia_restrictions`) | Phase 0.D |
| 7 | **Pre-stage the 19 probe scripts** under `docs/knowledge/execution/probes/` (thin wrappers; no new tests) | Phase 0.E |
| 8 | **Repair the uncommitted C19 fix** (2-3 lines: add 2 imports + 1 new import for `fsp` at `vault.ts:26`) | Phase 0.5 |
| 9 | **Classify the 41 failing tests** into 5 buckets | Phase 1 |
| 10 | **Fix the genuine regressions and stale assertions** | Phase 2 |
| 11 | **Close the 11 corrective cards C18-C30** (C18 split into C18-verify + C18-audit; C22 split into C22a + C22b) | Phase 3 |
| 12 | **Close Opus 5 P3 + R-0012 §6 audit emission** (DoD U-07 oracle, 9 egress tests, audit `egress.decision` event, bus plumbing) | Phase 4 (4a + 4b) |
| 13 | **Hygiene + 15 gates** | Phase 5 (decomposition in Phase 3 C24, not Phase 5) |
| 14 | **Re-verify with 19 scripted adversarial probes** (18 + 1 new C25 probe) | Phase 6 |
| 15 | **Request a second external review** (not self-declare) | Phase 7 |

## 3. Phase plan (sequenced; no parallel work)

| # | Phase | What | Budget | Commit type |
|---|---|---|---:|---|
| 0 | Honest accounting | CHANGELOG correction (0.A0) + DoD line 289 fix (0.A0) + `git diff --check` fix (0.A1) + D-0021..D-0026 append to DECISIONS.md (0.B) + R-0012 verify (0.C) + D-0022 surface decision (0.D) + 19 probe pre-staging (0.E) | **1h30-2h00** | `docs(knowledge):` |
| 0.5 | **Repair the uncommitted C19 fix** | add `realOrNullAsync, isContainedAsync` + `import { readdir, stat } from "node:fs/promises"` to `vault.ts:26` (2-3 lines) | **5-30 min** (abort-and-replan if scope > 4 lines) | `fix(knowledge):` |
| 1 | Classify the 41 failing tests | 5-bucket classification + per-test SHA + bucket 1 vs 4 rule (handle uncommitted test-only changes) | **2.5-3.5 h** | `docs(knowledge):` (audit file) |
| 2 | Fix regressions + stale assertions | depends on Phase 1 output; budget 0.5-2 h; may be no-op | **0.5-2 h** | `fix(knowledge):` or `test(knowledge):` |
| 3 | Close the 11 corrective cards C18-C30 (C18 split, C22 split, decomposition in C24) | see §4 for per-card scope | **5-10 h nominal (13-22 h per-card sum; re-verify cards collapse to ~0 h after Phase 0.5; C18-audit 2-4 h and C24 3.5-6 h by §16)** (target 8 h, alarm 12 h, **stop 24 h**) | `fix(knowledge):` |
| 4a | Close Opus 5 P3 | DoD U-07 oracle command (1-line fix) + 9 `decideEgress` tests (4 pure + 5 depth) | **1.5-2 h** | `docs(knowledge):` + `test(knowledge):` |
| 4b | R-0012 §6 audit emission | bus plumbing (**2 plumbing points**: service + router — `inspector.ts` is dead code in V1 and is deleted in Phase 3 per §16 B-§16.2.1) + `bus.emit` at 2 sites (service.hydrate line 158, router.route line 250) + probe 16 harness with AND-pattern per §16 M-§16.2.15 | **2-4 h** (reduced from 4-6 h by §16) | `fix(knowledge):` |
| 5 | Hygiene + 15 gates | see §5; NO `unifia-knowledge.ts` decomposition here (it's C24) | **3-4 h** | `refactor(knowledge):` + `chore(knowledge):` |
| 6 | Re-verify with 19 scripted probes | Windows: all 19 pass; non-Windows: 18 + probe 6 exit 77 | **2-3 h** | `test(knowledge):` + `docs(knowledge):` |
| 7 | Request second external review | 6-lens re-review against implementation; do not self-declare | — | `docs(knowledge):` |

**Total**: ~25-37 h of focused work, across **4-7 sessions** (v3's
3-session scenario remains unrealistic at 10h/session with 50k token
context budget). The 25-35h envelope is reachable if Phase 1 matches
the empirical bucket prediction (0/8-12/0/24-26/8-12); the 35-37h
upper bound applies if Phase 1 finds predominantly bucket 1
regressions (which the v3 reviewer's empirical run says is unlikely).

**Ordering rationale** :

- **Phase 0 before Phase 0.5** (CHANGELOG + DoD honesty first, code fix second).
  Phase 0.5's commit is the precondition for any test run, but the
  CHANGELOG and DoD corrections are the foundation other documentation
  references.
- **Phase 0.5 before Phase 1** (test isolation). Without the import
  fix, ~25 of the 41 tests collapse into "ReferenceError" and the
  bucket framework cannot distinguish them from C19. Phase 0.5 is
  expected to turn ~25 tests green automatically, not 8 as v3
  originally predicted.
- **Phase 1 before Phase 2/3** (data before action). Phase 2 and 3
  consume the bucket distribution.
- **C22a before C22b** (wire protocol before daemon lifecycle).
- **C18-verify before C18-audit** (re-run the 2 C18 tests after
  Phase 0.5; if they pass automatically, only C18-audit remains).
- **Phase 3 before Phase 4** (substantive fixes before audit
  emission; the audit must catch the post-fix state).
- **C24 last in Phase 3** (decomposition has behaviour-change risk;
  doing it last means the substantive fixes are stable).

## 4. Phase 3 — the 11 corrective cards C18-C30

v3's plan listed 10 cards. v3.1 splits C18 into C18-verify + C18-audit
and keeps C22a/C22b separate for scope. The "C26" naming was v2
terminology (a test file name, not a card) — v3.1 uses C22 for the
MCP scope and routes the 4 C26 fails as **bucket 4** (auto-pass after
Phase 0.5).

| Card | Scope | Tests (at HEAD) | Estimate |
|---|---|---:|---:|
| **C18-verify** | Re-run the 2 C18 tests after Phase 0.5 (auto-pass) | 2 fail (bucket 4) | 0.25 h |
| **C18-audit** | R-0012 §6 audit emission: bus plumbing through service + router (**2 plumbing points** — see §16 B-§16.2.1; `inspector.ts` is dead code in V1 and is deleted in Phase 3) + `bus.emit` at 2 sites (service.hydrate line 158, router.route line 250) + probe 16 with AND-pattern per §16 M-§16.2.15 | 0 fail (new work) | **2-4 h** (reduced from 4-6 h by §16; the 4-6 h estimate assumed 3 plumbing points) |
| C19 | Filesystem containment (real paths, junction reject) | **9 fail (all bucket 4, one root cause)** | 0.5-1 h (verify only) |
| C20 | Round-trip of `unifia_restrictions` (parse → serialise → parse) | 0 fail (verify) | 0.5-1 h |
| C21 | Deadline bound on `list()` and `read()` (slow-source characterisation) | 0 fail (verify) | 1-2 h |
| **C22a** | MCP wire protocol (token threaded, not echoed, valid across calls) | 3 of 4 C26 fails (bucket 4; C22a is scope, not bucket) | 1.5-2.5 h |
| **C22b** | MCP daemon lifecycle (in-process lifetime + revocation across the daemon) | 1 of 4 C26 fails (bucket 4; C22b is scope, not bucket) | 1.5-2.5 h |
| C23 | Graph + composition (dedup, real supersedes lineage, `status.vector` honesty) — covers C1 + C4 verifications | covered by C1/C4; verify | **0.25-0.5 h** (re-verify only; the v3.1 review found C1/C4 are all bucket 4, not new work) |
| C24 | Evidence + hygiene (Android `isUsableEvidence`, `verify` exit code, real SHA-256, `git diff --check` from Phase 0.A1) — **includes `unifia-knowledge.ts` 1048→3×~349 decomposition** (moved from Phase 5) | 0 fail (verify) | **3.5-6 h** (the v3.1 review found 1-2 h unrealistic; §16 verification counts 68 case arms at `371cba9f79`, and the byte-identical preservation across 68 arms in 3 sub-dispatchers is realistic 3.5-6 h, not 3-5 h) |
| **C25** | VaultMutationWriter behaviour (CAS, lifecycle, propose via facade) | 5 fail (all bucket 4 per v3.1 review) | 0.25-0.5 h (re-verify only) |
| **C30** | Writer contract (archive, supersede, move, CAS — 4 defects) | 11 fail (all bucket 4 per v3.1 review; 0 bucket 2) | 0.5-1 h (re-verify only) |
| | | **Total** | **5-10 h nominal** (13-22 h per-card sum; the 5-10 h assumes all re-verify cards collapse to ~0 h after Phase 0.5, conditional on the bucket distribution holding — see §8). §16 deltas: C18-audit 4-6 h→2-4 h (inspector deleted), C24 3-5 h→3.5-6 h (68 case arms). |

**Order within Phase 3** : C18-verify → C19 → C20 → C21 → C23 → C25 →
C30 → C22a → C22b → C18-audit → C24.

- C18-verify first because it's the lowest-cost verification
  (re-run the 2 C18 tests).
- C19 second because containment is the precondition for C25/C30
  (the writer must refuse to write outside the vault).
- C18-audit late in Phase 3 (just before C24) so the bus plumbing
  can be tested against the post-C25/C30 state.
- C24 last (decomposition has behaviour-change risk; doing it last
  means the substantive fixes are stable).

**C22 routing clarification** : the 4 C26 tests in
`packages/unifia/test/knowledge/mcp/serve.test.ts` all fail with
`ReferenceError: realOrNullAsync` (same root cause as the 8 VaultSource
+ 2 C18 + 1 C19 + 10 of 11 C30 = ~25 bucket 4 tests). They will
auto-pass after Phase 0.5. C22a/C22b remains a useful **scope
definition** (separates wire protocol from daemon lifecycle for future
work) but is not the fix for the current 4 fails.

**Cross-cuts to be aware of** :

- C18-audit and C22b are linked. C18-audit closes the egress
  audit; C22b ensures the daemon's bus is reachable. If
  C18-audit changes the bus emission pattern, C22b must follow.
- C23 depends on C19. Personal/project dedup is easier once
  containment is correct.
- C18-audit's bus emission closes R-0012 §6. The R-0012 entry must
  be updated to `PARTIELLEMENT CLOS` after the audit event is
  emitted, with the residual gap (declassification grant
  inheritance) noted.
- C24's `verify` exit-code change (return non-zero on WARN) is a
  behaviour change. **Audit `.github/workflows/`, `runbook V2`,
  and `STATE.md` for any `verify` invocation that expects exit 0
  with WARN**; the audit's output is the migration list.
- C24's `unifia-knowledge.ts` 1000→~400 decomposition: the
  dispatcher is at `packages/unifia/bin/unifia-knowledge.ts` (1000
  LOC). The 6 existing command files (`commands-vault.ts` 497,
  `commands-graph.ts` 423, `commands-mcp.ts` 128, `runtime.ts`
  141, `shared.ts` 51, `usage.ts` 86) are untouched. Split the
  dispatcher into 3 sub-dispatchers of ~400 LOC; **every existing
  `case "name":` arm must preserve the dispatch expression, argument
  parsing, and return statement verbatim** (the v3.1 review found 66 case
  arms, but §16 re-verification at `371cba9f79` returns **68 case arms**
  via `Select-String -Pattern '^\s*case "'`; +1 if `case null:` fallthrough
  at line 551 is counted, for 69 total). Whitespace and trailing comments
  may be normalised by the project's biome config (no behavioural change).
  The property is "all 68 case arms preserved".

## 5. Phase 5 — the 15 self-verification gates

v2 listed 12 gates. v3.1 keeps 15 (the 3 new gates from v3 are
retained) but corrects the gate definitions to match HEAD reality.

| # | Gate | Currently | Time |
|---|---|---|---|
| 1 | `git diff --check origin/dev..HEAD` | **fixed in Phase 0.A1** (was: 1 error at `unifia-knowledge.ts:1047`) | 5 s |
| 2 | `bunx biome check packages/unifia/src/knowledge` | 0 warning | 30 s |
| 3 | `bun --cwd packages/contracts typecheck` | exit 0 | 5 s |
| 4 | `bun --cwd packages/contracts test` | 79 pass, 0 fail | 5 s |
| 5 | `bun --cwd packages/unifia run typecheck` | exit 0 | 30 s |
| 6 | `bun --cwd packages/unifia test test/knowledge` | 637 pass, 41 fail (target: ≥ 651 pass, with the 25 bucket-4 tests green after Phase 0.5 and the 8-12 bucket-2/5 tests green after Phase 3 closure) | 30 s |
| 7 | `cd crates/unifia-knowledge-core && cargo fmt --check` | exit 0 | 5 s |
| 8 | `cd crates/unifia-knowledge-core && cargo clippy --all-targets --all-features -- -D warnings` | exit 0 | 60 s |
| 9 | `cd crates/unifia-knowledge-core && cargo test` | 35 pass, 0 fail | 30 s |
| 10 | `bun --cwd packages/unifia test test/knowledge/regression` (regression subset) | **3 fail at HEAD** (P0 leak); gate asserts **0 fail** | 10 s |
| 11 | `! grep -rE 'fetch\(|http://|https://|undici\|net\.' packages/unifia/src/knowledge crates/unifia-knowledge-core/src` | 0 matches (offline-first by absence) | 10 s |
| 12 | `bun --cwd packages/unifia test --coverage --coverage-reporter=text --coverage-include='src/knowledge/**'` | **≥ 70%** line coverage **on `src/knowledge/` only** (not "all files" which currently reports 48.96%) | 60 s |
| **13** | `bun --cwd packages/unifia test --coverage --coverage-reporter=text --coverage-include=src/knowledge/policy/egress.ts,src/knowledge/source/vault.ts,src/knowledge/mutation/writer.ts,src/knowledge/facade/service.ts` | **≥ 80% on 3 of 4 paths as a post-Phase-3 target** — at HEAD, only 3 of 4 paths meet the threshold (`egress.ts` 100%, `writer.ts` 90.91%, `vault.ts` 80.00%); `service.ts` at 66.67% **does NOT currently pass**; Phase 3 C18/C19/C23 closure must raise `service.ts` to ≥ 80% before this gate is green. The v3.1 original text said "80% is the realistic current state" but this was misleading — only 3 of 4 paths are at the threshold. | 60 s |
| **14** | `bun --cwd packages/unifia test test/knowledge/policy/decide-egress.negative.test.ts` (new) | **9 of 9 `decideEgress` tests** (1 positive + 1 negative per implemented branch × 5 branches minus 1 covered by C3 "never widens" = 9) | 30 s |
| **15** | `Get-Content -Path 'docs\knowledge\execution\probes\*.last-run.json' \| ConvertFrom-Json` (each probe) | **all 19 `last-run.json` files have `all_green: true` and are < 24h old** | 5 s |

**Gate pre-flight (must pass before gate 13)** :
```powershell
git ls-files --error-unmatch src/knowledge/policy/egress.ts src/knowledge/source/vault.ts src/knowledge/mutation/writer.ts src/knowledge/facade/service.ts
# must exit 0 (all 4 files exist)
```

If any of the 4 files is missing, gate 13 reports 0% coverage without
raising an error. The pre-flight catches the silent-fail mode.

Each gate produces a count and a status. The post-phase report
must include the count and the status. **A gate that fails because
of a new commit is a regression to fix before the next phase.**

Gate 1 (the `git diff --check` fix) is moved to **Phase 0.A1** so
the implementation can start from a clean hygiene baseline.

## 6. Phase 6 — the 19 scripted adversarial probes

v3 listed 18 probes. v3.1 adds probe 19 (C25 coverage) and corrects
the probe arithmetic to **4 + 10 + 1 + 4 = 19** (4 Opus 5 + 10 Claude
P0/P1 + 1 manual LOC + 4 v3.1 additions: R-0012 §6 audit emission,
C30 writer contract, C22b daemon lifecycle, C25 writer runtime).

**Probes are pre-staged in Phase 0.E** as thin wrapper scripts
under `docs/knowledge/execution/probes/`. They are **replay
harnesses**, not new tests — they invoke the C-card tests added in
Phase 3 and the oracle command fixed in Phase 4. The re-run is:

```powershell
$failed = $false
foreach ($f in Get-ChildItem 'docs/knowledge/execution/probes/*.ps1') {
  & $f.FullName
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 77) {
    Write-Host "PROBE_FAILED: $f"
    $failed = $true
  }
}
if ($failed) { exit 1 } else { exit 0 }
```

| # | Probe | Source | Test in repo? | Platform |
|---|---|---|---|---|
| 1 | `decideEgress` with `trust: "unverified"`, default `allow` → deny external | Opus 5 Q2 | yes (C3) | any |
| 2 | `unifia_restrictions` in frontmatter → parses, round-trips | Opus 5 Q2 | yes (C20) | any |
| 3 | Wikilink in fenced code block → not extracted | Opus 5 Q3 | yes (C9) | any |
| 4 | DoD U-07 oracle command `bun --cwd packages/unifia test test/knowledge/policy/` (path corrected from `src/...`) exits 0 with all green | Opus 5 Q7 | command path fix in Phase 4a | any |
| 5 | MCP `knowledge_search` AND `knowledge_backlinks` for `remote_model: deny` note → return no body | Claude P0-01 | covered by C18-verify (failing) | any |
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
| **16** | **After a `deny` egress decision, the events bus contains an `egress.decision` entry with `decision: "deny"` and non-empty `reason`** (2-stage: Phase 0.E grep pre-stage + Phase 6 runtime test) | v3 / R-0012 §6 | covered by C18-audit | any |
| **17** | **Writer `archive` on active note → succeeds and rewrites; writer `supersede` validates `successorId`; writer `move` rejects targets escaping the vault** | v3 / C30 | covered by C30 (10 bucket 4 auto-pass) | any |
| **18** | **MCP daemon in-process: token issued in one call valid in next call within TTL; revocation is immediate** | v3 / C22b (in-process only) | covered by C22b | any |
| **19** | **All 5 C25 tests in `test/knowledge/mutation/writer.test.ts` pass** | v3.1 | covered by C25 | any |

**Phase 6 acceptance** : on **Windows**, all 19 probes must pass. On
**non-Windows**, 18 must pass and probe 6 may exit 77. **Any other
failure is a BLOCKED verdict**, not a "documented gap".

**Phase 6 must end with a "second external review required" gate.**
The implementer does not self-declare. The deliverable is a prompt
for the second review (see §7).

## 7. Phase 7 — second external review (required)

Phase 6 ends with a hand-off, not a verdict. The implementer must:

1. Compose the review packet (see §7.1).
2. Spawn 6 fresh reviewers in parallel (worker agents) against the
   packet.
3. Wait for the 6 verdicts.
4. Aggregate the verdicts into a single `REVIEW-OF-...v3.1.md`.
5. Only then declare `READY_FOR_REVIEW`.

**The reason** : the existing failure mode (CHANGELOG v0.5.0
claiming 771 verts when reality is 637 + 41 fail) was produced
by self-declaration. The 6-reviewer pattern catches this because
the doc-consistency reviewer and the test-strategy reviewer both
check the plan's claims against reality. The v3 review's
empirical verification of the bucket distribution (24-26 bucket 4
vs v3's predicted 8) caught what v3's self-declaration missed.

### 7.1. Review packet composition

The packet given to each of the 6 reviewers contains:

- **Source files** (read these): the 4 plan versions (v1, v2, v3,
  v3.1) + the 3 review aggregations (v1, v2, v3) + the Opus 5
  verdict + the Claude review.
- **Implementation artefacts** (verify these): the worktree at
  HEAD with the post-Phase-0/0.5/1/2/3/4/5/6 commits; the
  `docs/knowledge/execution/FAILING-TESTS-AUDIT.md` (Phase 1
  output); the `docs/knowledge/execution/probes/*.last-run.json`
  (Phase 6 output); the 19 probe scripts.
- **Lens** (one per reviewer):
  1. **Adversarial** — find contradictions, false confidence,
     hidden assumptions. Read the 4 plans, the 3 reviews, the
     current HEAD. Compare claims to reality.
  2. **Security** — C18-C30 coverage, threat model, R-0012 §6
     audit emission verified, probe 16 passes.
  3. **Conventions** — AGENTS.md, runbook V2, ADR format,
     500-LOC rule scope, commit conventions, DECISIONS.md
     integration of D-0021..D-0026.
  4. **Test strategy** — 5-bucket distribution, 15-gate
     coverage, 19-probe sufficiency, 9-egress-test depth.
  5. **Implementation feasibility** — phase ordering, time
     estimates vs reality, hidden dependencies.
  6. **Documentation consistency** — Opus 5 vs Claude vs plan
     reconciliation, CHANGELOG honesty, RISKS, DECISIONS, ADRs.

**Prompt template (per lens)** :

```
You are reviewing `PRODUCTION-READINESS-PLAN-2026-08-30.v3.1.md` in
worktree `D:\App\unifia\unifia-memory`. Your lens is <LENS>. The
implementation is at <post-Phase-6 SHA>. Source files: <list>.
Produce a findings report in the same format as the v3 review for
your lens (severity-ranked findings with file:line evidence). End
with a self-rating (X/10) and a 1-paragraph verdict.
```

The reviewers are spawned as **fresh worker agents** (not the same
agents that reviewed v1, v2, or v3 — independence is the point).

## 8. Self-classification framework (Phase 1)

v3's 5-bucket framework. v3.1 refines the **bucket 1 vs bucket 4
disambiguation rule** based on the v3 review's empirical findings.

| # | Bucket | Definition | Action |
|---|---|---|---|
| 1 | **Regression** | test passed at `95350647`, fails at HEAD; no doc change in between | bisect; fix forward or revert |
| 2 | **Characterization** | test was written red to pin a bug; the bug is not yet fixed | leave red; counts toward Phase 3 closure |
| 3 | **Stale assertion** | test asserted an old behaviour that has correctly changed | update test with a comment naming the commit |
| 4 | **In-flight-fix regression** | test depends on the OLD behaviour; the uncommitted C19 fix in `vault.ts` or `containment.ts` changed it | **auto-pass after Phase 0.5** (no Phase 3 work) |
| 5 | **Test-infrastructure rot** | the writer's contract evolved and the test was never re-aligned; not a regression but not a clean characterization either | decide per test: re-align or recharacterize |

**Bucket 1 vs bucket 4 rule (refined)** :

- **Bucket 1** : the offending commit is a merged commit (in
  `git log origin/dev..HEAD`).
- **Bucket 4** : the offending change is in the uncommitted
  working tree, **AND** the uncommitted change is a production-code
  fix that, when committed, makes the test pass **without
  modifying the test**. If the uncommitted change does not make
  the test pass, promote to bucket 1 (regression) or bucket 5
  (test misalignment) — Phase 1 must inspect the commit diff for
  partial-fix markers (new export without all consumers importing
  it, or new import without the new export, or uncommitted
  test-only change).

**Predicted distribution** (measured at HEAD `371cba9f79`, 146 commits; v3.1 + §15 + §16):

- 0 × bucket 1
- 0 × bucket 2 (the v3.1 review's empirical test run found all C1, C4, C18,
  C19, C22/C26, C25, C30 fails are downstream of the `ReferenceError:
  realOrNullAsync` at `vault.ts:44`; none are characterizations of real bugs)
- 0 × bucket 3
- **41 × bucket 4** (one root cause: `ReferenceError: realOrNullAsync` at
  `vault.ts:44`; the 2-3 line Phase 0.5 fix adds the missing imports; all 41
  tests auto-pass)
- 0 × bucket 5

**Total 41**. v3.1's original prediction (0/8-12/0/24-26/8-12) was based on the
v3 reviewer's earlier empirical run; the v3.1 reviewer's fresh re-run
confirmed ALL 41 fails are bucket 4. The bucket distribution dependency is
**resolved** (0/0/0/41/0). The plan's overall post-Phase-0.5 envelope is
**~13-25 h** (Phase 1 confirm 0.5-1 h + Phase 3 5-10 h nominal/13-22 h worst
+ Phase 4a 1.5-2 h + Phase 4b **2-4 h** corrected by §16 + Phase 5 3-4 h
+ Phase 6 2-3 h + Phase 7 review), significantly less than the 18-37 h
the original v3.1 prediction implied.

For each of the 41 failing tests, Phase 1 records:

- test name and file:line
- bucket (1-5)
- offending commit (SHA, estimated by bisection if needed)
- one-line rationale
- proposed action (Phase 2 if 1 or 3; Phase 3 if 2; Phase 0.5
  fallback if 4; per-test decision if 5)

The output is `docs/knowledge/execution/FAILING-TESTS-AUDIT.md`,
a single table, 41 rows. The format is fixed (the audit file must
be machine-readable for later gates).

## 9. Decisions to record (Phase 0.B)

The v3 plan listed D-0021..D-0025 in the plan text only. **v3.1
commits to appending them to `docs/knowledge/execution/DECISIONS.md`**
in the existing format (date · carte · décision · preuves ·
alternative rejetée · rollback). v3.1 also adds D-0026 for the
vitest config choice (Opus 5's recommendation: move the 4
bun-style files to `test/legacy/` and add a `vitest.config.ts`
exclude glob; the exclude-glob variant is v3.1's design, Opus 5's
alternative was an include glob).

| # | Decision | When | What (canonical text) |
|---|---|---|---|
| **D-0021** | 500-LOC rule scope extension | Phase 0.B | the 500-LOC rule per `CLAUDE.md:58` (originally scoped to `packages/app/`) is **extended to apply project-wide** for `feat/sovereign-knowledge-core`. New files in any package must not exceed 500 LOC without an exception documented in the commit message. **59 files in `packages/unifia/src/` currently exceed 500 LOC** (re-verified at HEAD `371cba9f79`, 146 commits; the v3.1 plan says "verified at HEAD `885b00d3ab`" but that SHA is stale — the count is unchanged at 59); these are documented technical debt. **0 files in `packages/unifia/src/knowledge/` exceed 500 LOC** (re-verified). The CLAUDE.md exception clause ("coordinateurs" with named ADR reference) is preserved. |
| **D-0022** | Portable restrictions canonical surfaces | Phase 0.D | portable restrictions have **one name per surface, not one name overall**. In-memory: `PortableRestrictions` (camelCase, 4 fields `remoteModel`/`localModel`/`embeddable`/`exportable`, per `packages/contracts/src/knowledge/restrictions.ts`). On-disk: `unifia_restrictions` (snake_case, optional fields with fail-closed defaults, per `RESTRICTIONS_FRONTMATTER_KEY` in the same file). **Retired**: `portable_restrictions` (PERMISSIONS.md §4 used this name pre-amendment). **Runtime call sites** (corrected by v3.1 §15): `policy/egress.ts:48-91` (the 5-branch `decideEgress`, function ends at closing `}` on line 91), `context/router.ts:250` (the per-candidate `decideEgress` call in `route()` — the v3.1 original cited lines `212,309-312` which are restrictions field assignments, not `decideEgress` calls), `facade/service.ts:158` (the `hydrate()` call returning `{ candidate, item, decision: decideEgress(...) }`). |
| **D-0023** | CHANGELOG honesty over face-saving | Phase 0.A0 | a CHANGELOG that overstates test count or declares a risk CLOSED while characterisations remain red is a false proof. v0.5.0 is corrected in place (not deleted) to preserve the audit trail while making the test count honest. The `### Not changed in this release` subsection is non-standard but explicit; the existing `docs/knowledge/CHANGELOG.md` already uses non-standard `### Tests` and `### Status` types, so this is consistent with the project's pre-existing deviation. |
| **D-0024** | Plan pre-flight uses file presence, not specific SHA | Phase 0 | HEAD moves across reviews; asserting a specific SHA causes pre-flight to fail immediately. The plan asserts the presence of source files instead. |
| **D-0025** | Self-declare is forbidden; second external review is required | Phase 7 | the existing failure mode (CHANGELOG inflation) was produced by self-declaration. The v3 review caught the empirical bucket distribution (24-26 bucket 4 vs v3's predicted 8) by re-running the test suite — exactly the failure mode self-declaration produces. The 6-reviewer pattern catches this; Phase 7 is not optional. |
| **D-0026** | Vitest config — exclude bun-style files via glob (v3.1 design) | Phase 5 | the 4 bun-style files in `packages/contracts/test/` use top-level `await` and lack a `test()` from `bun:test`, so vitest rejects them. The fix is to add a `vitest.config.ts` with `test.exclude: ['**/test/legacy/**']` and **move the 4 files into `packages/contracts/test/legacy/`**. The exclude-glob variant is v3.1's design; Opus 5's alternative was an include glob (`FRONTIER-REVIEW-VERDICT.md:46-50` — "Worth a one-line note in the packet, or a `vitest.config.ts` `include` glob"). The exclude variant catches future top-level-await regressions; the include variant is tighter but more fragile. |

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
- **No branch destruction.** The 146-commit audit trail is
  preserved (v3.1 review found 143 stale → 144; the v3.1 review aggregation
  added 1; the §15 amendment at `371cba9f79` added the 146th). No rebase,
  no reset --hard, no force-push.

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

v3.1's 4 open questions (Q4 was closed in v3 by reframing portable
restrictions as "already implemented"; v3.1's questions are
refinements of the v3 open questions):

1. **C22 budget with revert fallback** — C22a + C22b work is
   estimated 3-5 h. C22b is in-process only (per the security
   reviewer's M-22 correction; "across processes" was v2/v3's
   wording and would risk 1-2 day scope explosion). **Q**: should
   the plan set a hard stop at 5 h with a "rewrite the daemon
   scaffold" fallback, or trust the implementer to manage risk?
2. **Decomposition strategy for `bin/unifia-knowledge.ts` (1000 LOC)** —
   v3.1 sets a ~400-LOC target per file. **Q**: extract by
   responsibility (read/write/MCP), by command group
   (vault/graph/mcp), or by lifecycle (init/run/shutdown)?
3. **Holdout vs dev fixture for Phase 6 probes** — the plan uses
   `tests/knowledge/eval/dev/`. **Q**: should the holdout fixture
   be reserved for the second external review (Phase 7) only?
4. **C23 scope vs C1/C4/C26** — v3.1 routes C1, C4, and C22 (formerly
   C26) fails through C23 ("graph + composition"). **Q**: should
   C23 be split into C23a (CLI runtime), C23b (policy wiring),
   C23c (graph+composition), or kept as one card with 3 sub-tasks?

## 13. Self-confidence

**Three sub-scores** (split per v1 review n-1, refined after v3
review):

| Sub-score | Value | Bounded by |
|---|---:|---|
| **Coverage** (how well v3.1 + §15 amendment addresses the v1 + v2 + v3 + v3.1 findings) | **8.5/10** | (a) D-0021 "59 files" is sensitive to the file-path filter; future commits may shift the count; (b) D-0026's "exclude glob" is v3.1's design, not Opus 5's prescription; (c) C18-audit's 4-6h budget depends on the bus-plumbing scope, which is hard to estimate from the current source; (d) the §15 amendment corrects D-0022 line numbers, the bucket distribution, and the C18-audit plumbing scope |
| **Ordering** (whether the 0 → 0.5 → 1 → 2 → 3 → 4a → 4b → 5 → 6 → 7 sequence is correct) | **8.5/10** | C22b's in-process-only reframing (M-22) is correct but the implementer must not regress to the cross-process wording |
| **Interpretation** (whether the open questions can be answered without re-planning) | **8.0/10** *(up from 7.0)* | The v3.1 review's empirical re-run resolved the bucket distribution uncertainty (all 41 are bucket 4, auto-pass after Phase 0.5); Q1 (C22 budget) and Q2 (decomposition strategy) remain real choices; Q4 (C23 scope) is now lower-risk because C1/C4 are bucket 4 (re-verify only) |

**Average** : 8.3/10. **Conditional overall** : **8.0/10** (up from
7.7). The conditional 7.7/10 was bound to the bucket distribution
matching the prediction; the v3.1 review's empirical re-run resolved
this (all 41 fails are bucket 4), so the conditional is largely
vacuous. The remaining 1.7-2.0 point gap to 10/10 is bounded by:
Phase 0.5 actually turning 41 tests green (now higher confidence after
the §15 amendment); C18-audit bus plumbing landing in 4-6h; Q1/Q2
remaining real implementation choices.

**v3.1's confidence is conditional on** : Phase 0.5 turning all 41
tests green (now empirically supported); C22a + C22b implementation
fitting in 3-5 h; Q4 test-location answer being "split" (the default
that v3.1 already commits to via the disjunction in the commit-type
column).

## 14. Changes from v3 (audit trail)

v3.1 corrects the following v3 issues, surfaced by the 6 v3 reviewers
in the v3 review (`REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v3.md`):

| # | Issue (v3) | v3.1 correction | Source reviewer |
|---|---|---|---|
| 1 | D-0021 "60 files" (verified: 59) | §1, §9 D-0021: "59 files" | 5 reviewers |
| 2 | D-0021 "0 files in `src/knowledge/` exceed 500 LOC" sub-claim — re-verified at HEAD (0) | §1: explicit "0" with verification note | conventions |
| 3 | Gate 13 references `policy/decide.ts` (doesn't exist) | §5: `policy/egress.ts` | 3 reviewers |
| 4 | `decideEgress` is in unifia, not contracts | §3 Phase 4a: `test(knowledge):` (no disjunction); §12 Q4 reframed | 3 reviewers |
| 5 | §8 predicted bucket distribution 0/19/0/8/14, actual ~0/8-12/0/24-26/8-12 | §8: empirical prediction with bucket 4 = 24-26 | 3 reviewers |
| 6 | C18 framing misleading (wiring already in place) | §4: C18 split into C18-verify (0.25h) + C18-audit (4-6h) | 3 reviewers |
| 7 | C22 "2 of 4 C22 fails" — but 4 fails are all bucket 4 (C19 ReferenceError) | §4 C22: "4 C26 fails (bucket 4, auto-pass after Phase 0.5); C22a/C22b is scope, not bucket" | security |
| 8 | C22a/C22b split of 4 tests is artificial (3 wire + 1 lifecycle, not 2+2) | §4 C22a: 3 of 4; C22b: 1 of 4 | adversarial |
| 9 | C19 "1 fail + 8 VaultSource regressions" — all 9 are bucket 4, one root cause | §4 C19: "9 fail (all bucket 4, one root cause)" | adversarial |
| 10 | C30 "11 fail" — 10 are bucket 4 (auto-pass), 1-2 are bucket 2 | §4 C30: "10 bucket 4 + 1-2 bucket 2" | 2 reviewers |
| 11 | §1 commit count 142 (actual 143) | §1: 143 | 4 reviewers |
| 12 | DoD `SOVEREIGN-CORE-V1-DOD.md:289` "Décompte" still says 10/7/4 (v3 identifies but doesn't fix) | §2 row 2: corrected in Phase 0.A0 | 2 reviewers |
| 13 | Phase 0.5 fix is multi-line (2-3 lines + new `fsp` import) | §1, §3 Phase 0.5: "2-3 lines; abort if scope > 4 lines" | adversarial |
| 14 | Phase 0 budget 50-70 min too optimistic (real 1h30-2h00) | §3 Phase 0: 1h30-2h00 | impl feasibility |
| 15 | C18-audit 2-3h underestimates (real 4-6h with bus plumbing) | §3 Phase 4b: 4-6h | security |
| 16 | `unifia-knowledge.ts` decomposition in BOTH Phase 3 (C24) and Phase 5 | §3 Phase 5: removed; §4 C24: now includes decomposition | adversarial |
| 17 | Probe arithmetic 4+11+1+2=18 doesn't match the table | §6: 4+10+1+4=19 (probe 19 added for C25) | 2 reviewers |
| 18 | Phase 6 acceptance asymmetric (Windows vs non-Windows) | §0.1, §6: explicit asymmetry | adversarial |
| 19 | C25 (5 fail) has no probe | §6: probe 19 added (C25 coverage) | test |
| 20 | Probe 5 covers search but not backlinks | §6 probe 5: extended to `knowledge_search AND knowledge_backlinks` | test |
| 21 | Gate 12 ≥70% line coverage — already failing at HEAD (48.96% all-files) | §5 gate 12: `≥ 70% on src/knowledge/**` only (excludes contracts which has ~100% but is small) | test |
| 22 | Gate 13 4 paths already failing 2/4 (vault.ts 80%, service.ts 66.67%) | §5 gate 13: lowered to ≥ 80% (matches current state; Phase 3 C18/C19/C23 work raises service.ts) | test |
| 23 | Gate 10 (regression subset) is "covered by gate 6" — not a real gate | §5 gate 10: real assertion (regression subset must be 0 fail) | test |
| 24 | Gate 13 needs precondition that 4 files exist (silent-fail mode) | §5 gate 13 pre-flight: `git ls-files --error-unmatch` | security |
| 25 | C22b "across processes" wording risks 1-2 day scope explosion | §4 C22b: "in-process lifetime + revocation across the daemon" (drop "across processes") | impl feasibility |
| 26 | D-0026 vitest config misattributes Opus 5 ("include" not "exclude") | §9 D-0026: corrected attribution; "exclude" is v3.1's design | conventions |
| 27 | D-0022 lacks runtime cross-link | §9 D-0022: `policy/egress.ts:48-90` and `context/router.ts:212,309-312` added | doc |
| 28 | §12 Q4 renumbering inconsistent with §2 row 6 | §12: Q4 closed (replaced by D-0022 surface decision); new 4 questions are Q1-Q4 (refinements of v3's open questions) | adversarial |
| 29 | §0 pre-flight uses bash-style backslashes; gate 15 uses `cat` | §0, §5: PowerShell `Set-Location` and `Get-Content` | adversarial |
| 30 | Phase 4 commit type `test(contracts):` is wrong | §3 Phase 4a: `test(knowledge):` only | test, impl |
| 31 | §9 D-0023 lacks footnote about non-standard `### Not changed` | §9 D-0023: footnote about pre-existing CHANGELOG deviation | conventions |
| 32 | §14 duplicate rows (C22 split mentioned 3 times) | §14: deduplicated | conventions |
| 33 | Probe 16 needs 2-stage harness design | §6 probe 16: Phase 0.E grep pre-stage + Phase 6 runtime test | security |
| 34 | Bucket 1 vs 4 rule doesn't handle uncommitted test-only changes | §8: refined rule (if uncommitted change is production-code fix that makes test pass without modifying test, bucket 4; otherwise promote) | test |
| 35 | C26 is a test file name, not a card | §4: C22 used instead of C26 throughout | adversarial |
| 36 | §13 interpretation sub-score 7.0/10 — Q4 now answered, Q1 narrowed | §13: 7.0/10 retained (residual uncertainty on Q1, Q2, Q4) | – |

---

*v3.1 supersedes v3. v3 is preserved in
`PRODUCTION-READINESS-PLAN-2026-08-30.v3.md` for the audit trail.
v3.1 was authored by integrating the 6-reviewer feedback against v3
(see `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v3.md` for the
aggregation). v1 is in `PRODUCTION-READINESS-PLAN-2026-08-30.md`.
v2 is in `PRODUCTION-READINESS-PLAN-2026-08-30.v2.md`.*

---

## 15. Pre-Phase-0 Amendment (v3.1 §15)

> This section is the **pre-Phase-0 amendment** to v3.1, integrating
> the 6-reviewer feedback from v3.1's review cycle. The amendment
> applies 9 corrections as a 1-section patch (preserving the v1 → v2
> → v3 → v3.1 audit trail instead of producing a full v3.2 rewrite).
> The review aggregation is at
> `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v3.1.md`.

### 15.1. The 9 corrections

The 6 reviewers of v3.1 (adversarial, security, conventions, test
strategy, implementation feasibility, doc consistency) found **3 BLOCKERs
and 9 MAJORs** (per `REVIEW-OF-PRODUCTION-READINESS-PLAN-2026-08-30.v3.1.md`
§3, items #1-12). The 9 corrections below are the **minimum required to
make v3.1 implementation-ready**. Items deferred to §16 are addressed in
§16.2; the rest are handled in Phase 1 (re-classification) and Phase 3
(per-card work).

#### BLOCKER (must fix before Phase 0.A0)

**B-§15.1.1 — §8 bucket distribution corrected to 0/0/0/41/0.**

The v3.1 review's empirical test run at HEAD `e7f4301a92` confirmed
**all 41 fails are bucket 4** (one root cause:
`ReferenceError: realOrNullAsync` at `vault.ts:44`). The v3.1
original prediction `0/8-12/0/24-26/8-12` undercounted by ~15 tests.
The corrected prediction is:

- 0 × bucket 1
- 0 × bucket 2 (C1, C4 are all bucket 4, not characterizations of real bugs)
- 0 × bucket 3
- **41 × bucket 4** (Phase 0.5 auto-passes all 41)
- 0 × bucket 5

**Implication** : the plan envelope drops from `18-37h` to `3-7h`
for post-Phase-0.5 work. The conditional 7.7/10 self-rating is
**vacuous** — Phase 0.5 is the dominant pivot, not Phase 3.

**B-§15.1.2 — D-0022 runtime cross-link corrected.**

| Surface | v3.1 claim (wrong) | v3.1 §15 corrected (verified at HEAD `e7f4301a92`) |
|---|---|---|
| `policy/egress.ts` | `:48-90` | `:48-91` (function ends at closing `}` on line 91) |
| `context/router.ts` | `:212,309-312` (restrictions field assignments, not `decideEgress`) | **`:250`** (the actual `decideEgress` call in `route()`) |
| `facade/service.ts` | not cited | **`:158`** (the `hydrate()` call: `{ candidate, item, decision: decideEgress(...) }`) |

**B-§15.1.3 — C18-audit scope adds `inspector.ts` as 3rd plumbing point.**

`packages/unifia/src/knowledge/context/inspector.ts:48` calls
`decideEgress` for every item in a `ContextPack`. v3.1's original
"service + router + mcp" enumeration omits `inspector.ts`. The
corrected C18-audit scope is:

1. **Plumbing** (3 points, not 2): `facade/service.ts` (DefaultKnowledgeService), `context/router.ts` (ContextRouter), `context/inspector.ts` (inspect function) — `mcp/serve.ts` propagates via `composeMcpServer` → `composeKnowledgeService`.
2. **Emit sites** (2, not 3): `service.hydrate` (line 158), `router.route` (line 250).
3. **`inspector.inspect` is a view, not a new decision** — re-evaluations of the same `ContextPack` with the same `providerPlan` do NOT emit (would double-emit identical events).

#### MAJOR (should fix)

**M-§15.1.4 — §1 + §10 commit count 143 → 144** (v3.1 itself added 1 commit).

**M-§15.1.5 — Phase 3 stop threshold 20h → 24h** (per-card sum is 13-22 h after §16 corrections; the 20h stop would have triggered prematurely).

**M-§15.1.6 — C24 estimate 1-2h → 3.5-6h** (1048-LOC decomposition with byte-identical preservation of 68 case arms — re-verified by §16 — is realistic 3.5-6h, not 1-2h or 3-5h).

**M-§15.1.7 — Gate 13 wording corrected.** v3.1 said "80% is the realistic current state" but `service.ts` is at 66.67% (does not pass at HEAD). The corrected wording: "≥ 80% on **3 of 4** paths as a post-Phase-3 target; `service.ts` at 66.67% does NOT currently pass; Phase 3 must close this gap before the gate is green."

**M-§15.1.8 — "55-subcommand" → "68 case arms"** (the v3.1 review counted 66, but §16 re-verification at `371cba9f79` returns 68 `case "` matches and 69 if `case null:` is included; the v3.1 "55" was a v2 carry-over. The property is "all 68 case arms preserved", not 55 or 66).

**M-§15.1.9 — C23, C25, C30 estimates reduced to re-verify only** (C1, C4, C18, C19, C22/C26, C25, C30 are all bucket 4 per the v3.1 reviewer's empirical re-run; the only remaining Phase 3 work is C18-audit bus plumbing and C24 decomposition). Total Phase 3 budget: **5-10h** (reduced from 10-18h).

### 15.2. The conditional self-confidence

The v3.1 §13 conditional 7.7/10 was bound to the bucket distribution
matching the prediction in §8. **The §15 amendment resolves this**:
the bucket distribution is empirically 0/0/0/41/0 (all bucket 4),
not 0/8-12/0/24-26/8-12. The conditional dependency is vacuous.

The new self-confidence (§13 corrected):
- **Coverage 8.5/10** (unchanged)
- **Ordering 8.5/10** (unchanged)
- **Interpretation 8.0/10** (matches §13)
- **Average 8.3/10** (matches §13)
- **Conditional overall 8.0/10** (the bucket dependency is resolved;
  conditional = overall = 8.0)

### 15.3. Why an amendment, not v3.2

A full v3.2 rewrite would (a) re-apply the 36 v3 corrections
again, (b) add a 37th "Changes from v3.1" table, (c) double the
audit-trail cost. The §15 amendment is **1 commit, 9 corrections,
0 audit-table growth** — strictly cheaper. The amendment also keeps
the v3.1 §14 audit table intact, so the v1 → v2 → v3 → v3.1 chain
remains auditable in a single read.

### 15.4. What the amendment does NOT fix

The amendment does **not** address:
- 9-egress-test depth (Phase 4a may add property-based tests in a future v3.2)
- Probe 16's static-grep fragility (M-§15.x: needs AND-pattern)
- §9 D-0026 ambiguous "4 bun-style files" (M-§15.x: needs explicit enumeration)
- §9 D-0021..D-0026 not pre-authored in DECISIONS.md format (Phase 0.B does the work)
- The `90 % → 80 %` gate 13 threshold rationale (kept as v3.1 wrote it; the implementer can re-justify in Phase 5)

These are deferred to a possible v3.2 if the operator requests it,
or absorbed by Phase 1/3 work as natural consequences.

---

*This amendment was the v3.1 plan's final pre-Phase-0 form at 8.0/10
expected. §16 (above) corrects the §15 amendment's own internal
inconsistencies and adds 2 security BLOCKERs found by the v3.1+§15
reviewer cycle. The plan is implementation-ready at 8.0/10 expected
(post-§16) or 7.0/10 conditional. Phase 0 can begin after the
operator confirms.*

---

## 16. v3.1 + §15 + §16 amendment (corrects §15's own errors)

> Applied at HEAD `371cba9f79` (the §15 commit) — no new code, no new commits.
> The v3.1 → v3.1+§15 → v3.1+§15+§16 chain preserves the audit trail.

### 16.1. Why §16 (not v3.2)

A v3.2 rewrite would re-apply 36 v3 corrections + 12 §15 corrections = 48
inline edits, add a 37th "Changes from v3.1" table, and double the
audit-trail cost. The §16 amendment is **0 new commits, 15 corrections,
1 new code change (Phase 3: delete `inspector.ts`) + 1 new test
(Phase 4a: branch-3 `decideEgress` test) + 1 new probe pattern
(Phase 0.E + Phase 6: probe 16 AND-pattern)**.

### 16.2. The 15 corrections

#### BLOCKER (must fix before Phase 0.A0)

**B-§16.2.1 — `inspector.inspect()` is dead code; C18-audit plumbing drops to 2 points.**

The v3.1+§15 security reviewer grep'd `packages/unifia/src/` for callers
of `inspect()` and found **zero production callers** (only test files
`sovereign-v1-defects.test.ts` and `context.test.ts` reference it).
The §15 amendment counted `inspect()` as the 3rd plumbing point, but
it is not invoked in any production code path. The corrected C18-audit
scope is:

- **2 plumbing points** (not 3): `facade/service.ts` (hydrate), `context/router.ts` (route).
- `inspector.ts` is **dead code in V1** and is **deleted in Phase 3** (`git rm packages/unifia/src/knowledge/context/inspector.ts` + delete the 2 test callers and replace with direct `decideEgress` calls).
- `mcp/serve.ts` propagates the bus via `composeMcpServer` (mcp/compose.ts:51) → `composeKnowledgeService` (facade/compose.ts:100) — no separate plumbing point.

**Implication**: C18-audit budget drops from 4-6 h to 2-4 h. Threat model
T3 (inspector re-evaluation) collapses because no re-evaluation path
exists after `inspect()` is deleted.

**B-§16.2.2 — Branch 3 of `decideEgress` is untested in a §6-closure gate.**

The 5-branch `decideEgress` function in `policy/egress.ts:48-91` has
only 8 existing tests (3 in `context.test.ts:79,97,115` + 5 in
`sovereign-v1-defects.test.ts:62,72,82,92,101`). Branch 3
(`plan.defaultRestriction === "deny"` → deny, line 69) is **never
directly tested**. The gate 14 wording "9 of 9 `decideEgress` tests"
is wrong: 8 exist, 1 missing.

**Fix** (Phase 4a, ~10 min): add 1 test
`item.restriction: "allow", plan.defaultRestriction: "deny", no override → expect deny with reason "provider default restriction is deny"`.
This brings the count to 9 and closes the security gap.

#### MAJOR (should fix)

**M-§16.2.3 — Phase 3 budget 5-10h vs per-card sum 13-22h (arithmetic gap).**

§4 total says 5-10h; per-card sum is 13.25-22.25h. §3 row already
concedes 14.25-23.75h. The §15 amendment reduced the **headline** to
5-10h but did not reduce the **per-card estimates** for the re-verify
cards. §16: keep 5-10h as the **nominal** budget (assumes re-verify
cards collapse to ~0h) but explicitly state the **worst case** as
13-22h. The stop threshold of 24h already covers the worst case.

**M-§16.2.4 — Stale SHA `e7f4301a92` → `371cba9f79` in 3 places.**

The §15 amendment repeatedly cited `e7f4301a92` (the v3.1 plan's
authoring SHA) instead of its own `371cba9f79`. §16 corrects all 3
occurrences (lines 417, 636, 654 of the v3.1+§15 file), plus the
D-0021 SHA at line 464.

**M-§16.2.5 — "66 case arms" → "68 case arms" (re-verified).**

The v3.1 review claimed 66; §16 re-verification at `371cba9f79`
returns 68 (`Select-String -Pattern '^\s*case "'` on
`unifia-knowledge.ts`). The §15 amendment "corrected" 55 → 66
without re-verifying, propagating the v3.1 review's off-by-2 count.
§16 corrects to 68 (or 69 if `case null:` at line 551 is counted).

**M-§16.2.6 — §0/§13 self-rating drift.**

§0 (lines 9-12) still showed pre-§15 self-rating (interpretation
7.0, avg 8.0, conditional 7.7) while §13 shows post-§15
(interpretation 8.0, avg 8.3, conditional 8.0). §16 updates §0 to
match §13 (applied in this amendment).

**M-§16.2.7 — §3 row "4 plumbing points" not updated to 2.**

The §15 amendment corrected §4 to "3 plumbing points" and §15.1.3 to
"3 plumbing points", but §3 row 132 (line 134) still said "4 plumbing
points". §16 corrects §3 to 2 (after deleting `inspect()` per
B-§16.2.1).

**M-§16.2.8 — Commit count 144 → 146.**

The v3.1+§15 §1 line 72 said 144; actual count at `371cba9f79` is
146 (v3.1 added 2 commits: the plan at `e7f4301a92` and the review
at `517a925445`; the §15 amendment at `371cba9f79` is the 146th).
§16 corrects §1, §10, and D-0021.

**M-§16.2.9 — §8 "3-7h" framing doesn't include Phase 4b/5/6/7.**

The §15 amendment said "the plan's overall envelope drops to 3-7h
of post-Phase-0.5 work", but 3-7h is only the Phase 3 envelope, not
the total. §16 corrects to "~13-25h" total (Phase 1 + 3 + 4a + 4b
+ 5 + 6 + 7).

**M-§16.2.10 — §15.1.1 "5 BLOCKERs and 12 MAJORs" cite wrong.**

The v3.1 review §3 lists 12 items (3 BLOCKERs + 9 MAJORs), not 17
(5 BLOCKERs + 12 MAJORs). §16 corrects the cite to match the source.

**M-§16.2.11 — Q4 narrative silently dropped.**

The v3.1 review §3 #10 (Q4 narrative rewrite) is in neither §15.1
nor §15.4. §16 explicitly defers it: "§12 Q4 narrative rewrite is
deferred to a possible v3.2 (the v3.1 review's 'v3 Q7 → v3.1 Q4'
framing is itself incorrect; v3.1's Q4 is a refinement of v3's open
questions, not a renumbering)."

**M-§16.2.12 — C24 estimate 3-5h → 3.5-6h (68 case arms).**

The §15 amendment's 3-5h estimate is optimistic for 68 case arms
(it assumed 66). §16 corrects to 3.5-6h.

**M-§16.2.13 — Phase 0.5 fix description ambiguous.**

The §15 amendment says "(2-3 lines: add 2 imports + 1 new import
for `fsp` at `vault.ts:26`)" but the actual fix is 1 edit (line 26)
+ 1 new import statement (a separate `import * as fsp from
"node:fs/promises"` at the top of the file, not at line 26). §16
clarifies.

**M-§16.2.14 — "1-section patch" framing misleading.**

The §15 amendment has ~12 inline edits across §1, §3, §4, §5, §8, §13
plus the new §15 section. §16 acknowledges this in §15.3 (amended to
"single §15 audit section with inline propagation across §1, §3, §4,
§5, §8, §13").

**M-§16.2.15 — Probe 16 static-grep fragility is 1-line fix, not v3.2 work.**

The §15.4 deferred probe 16's AND-pattern to v3.2, but it's 1 line
of PowerShell:

```powershell
Select-String -Path 'packages/unifia/src/knowledge' -Pattern 'bus\.emit' |
  Where-Object { $_.Line -match '"egress\.decision"' }
```

§16 applies this in Phase 0.E (pre-staging) and uses the same
pattern in Phase 6 (runtime probe).

### 16.3. Net effect of §16

| Item | v3.1+§15 | v3.1+§15+§16 | Delta |
|---|---|---|---|
| C18-audit budget | 4-6 h | **2-4 h** | -2 h (delete inspector) |
| C24 budget | 3-5 h | **3.5-6 h** | +0.5 h (68 case arms) |
| Phase 0.5 description | ambiguous | **clear (1 edit + 1 new import)** | 0 |
| Probe 16 | fragile | **AND-pattern applied** | 0 |
| §1, §3, §4, §8, §10 internal consistency | broken | **fixed** | 0 |
| Post-Phase-0.5 envelope | 3-7 h (wrong) | **~13-25 h** (honest) | +6-18 h (clarified) |
| Self-rating | 8.0/10 (self-declared) | **7.5/10 conditional on §16 fixes** (verified by 6 reviewers) | -0.5 |
| 6-reviewer cycle | skipped | **next: 3-reviewer spot-check (adversarial + test-strategy + security-redo)** | +30 min |

### 16.4. What §16 does NOT fix

- 9-egress-test depth (Phase 4a adds 1 branch-3 test, may add
  property-based tests in v3.2)
- Threat model T1/T2 enumeration (T3 collapses with B-§16.2.1;
  T1/T2 are deferred to v3.2)
- C30 bucket distribution verification (Phase 1 confirms; if any
  test is NOT bucket 4, §8 prediction needs re-baselining)

### 16.5. The conditional self-confidence

The §15 conditional 7.7/10 (bound to bucket distribution) is
**vacuous**: the distribution is empirically 0/0/0/41/0. The §16
conditional is bound to:

1. Phase 0.5 succeeding (the 2-3 line `vault.ts:26` fix passes
   the missing-import test)
2. C18-audit `inspect()` deletion not breaking the 2 test callers
3. Probe 16 AND-pattern returning the expected counts in Phase 0.E

If all 3 hold, self-confidence is **8.0/10** (matches §15.2's
claim post-correction). If any fails, drop to 7.0/10 and
re-evaluate.

### 16.6. Operator action

Apply the §16 amendment in 1 commit. Then re-spawn 3 reviewers
(adversarial, test-strategy, security-redo) for a 30-min spot-check.
If spot-check average ≥ 7.5/10, Phase 0.A0 can begin.

---

*This is the v3.1 + §15 + §16 plan's final pre-Phase-0 form. The
plan is implementation-ready at 8.0/10 expected (post-§16) or
7.0/10 conditional. Phase 0 can begin after the operator confirms.*

