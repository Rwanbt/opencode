<!-- SPDX-License-Identifier: MIT -->
# FRONTIER-REVIEW-PROMPT — Sovereign Knowledge Core V1

> Copy-paste prompt for launching a full frontier-model review of
> the Sovereign Knowledge Core V1 implementation. Designed to be
> handed to Claude Opus, GPT-5, or Gemini 2.x Pro with the local
> repo accessible.
>
> Usage : open a new session with a frontier model, paste the
> `PROMPT` section below, give the model access to the worktree
> `D:\App\unifia\unifia-memory`, and let it work through the 10
> questions in `FRONTIER-QUESTIONS.md`.

---

## Context (give the model this upfront)

You are reviewing the **Sovereign Knowledge Core V1** of the
**Unifia** application. Unifia is an offline-first, provider-
independent, egress-bounded AI workspace with three modes
(Code, Work, Design). The Knowledge Core is the
provider-independent memory layer that powers the
`ContextRouter` across these modes.

Worktree : `D:\App\unifia\unifia-memory`
Branch : `feat/sovereign-knowledge-core` (no upstream)
HEAD : `2278d1b110`
Base : `origin/dev` @ `95350647140a382ee6d5d61bc2f6639597d80f0b`
Local commits : 114
Tests : 635 green (522 TS knowledge + 79 contracts + 34 Rust)
CLI subcommands : 55
Admin tools : 38 (under `packages/unifia/src/knowledge/admin/`)
Decisions documented : 20 (D-0001..D-0020)
ADR : 9 (0001..0009-knowledge)
Mutations : 0 push, 0 PR, 0 merge, 0 release, 0 publication

The implementation is **complete** for the V1 scope. No code
changes are expected. You are reviewing the architecture, the
contracts, the test adequacy, and the operational maturity —
not asking for new features.

---

## Files to read (in order)

1. `docs/knowledge/execution/FRONTIER-REVIEW-PACKET.md`
   — main packet (17 968 chars, ~7 sections)
2. `docs/knowledge/execution/FRONTIER-QUESTIONS.md`
   — the 10 specific questions (5 829 bytes)
3. `docs/knowledge/CHANGELOG.md`
   — v0.1.0 + v0.2.0-knowledge release notes
4. `docs/knowledge/SOVEREIGN-CORE-V1-DOD.md`
   — Definition of Done (12 user + 10 engineering requirements)
5. `docs/knowledge/PERMISSIONS.md`
   — 5 KB, default-deny policy
6. `docs/knowledge/DISASTER-RECOVERY.md`
   — 5-step procedure
7. `docs/knowledge/adr/0001..0009-knowledge-*.md`
   — 9 Architecture Decision Records
8. `docs/knowledge/execution/DECISIONS.md`
   — 20 autonomous decisions, append-only log
9. `docs/knowledge/execution/RISKS.md`
   — 11 risks (7 OPEN, 4 CLOSED) with mitigation
10. `docs/knowledge/execution/STATE.md`
    — append-only checkpoints (V1..V24)
11. `packages/contracts/src/knowledge/*.ts`
    — 10 Zod contracts (identity, space, restrictions, lifecycle,
      retrieval, mutation, context, native-port, errors, mcp)
12. `packages/unifia/src/knowledge/admin/*.ts`
    — 38 admin tools (read-mostly; some mutations gated)
13. `crates/unifia-knowledge-core/src/*.rs`
    — 8 Rust modules (error, hash, path, watcher, wal, classb,
      control_store)

Optional but recommended :

- `docs/knowledge/execution/FINAL-REPORT.md` — sprint report
- `docs/knowledge/execution/COMPACT.md` — resumption view
- `docs/knowledge/execution/COVERAGE.md` — coverage table
- `docs/knowledge/execution/TEST-MATRIX.md` — test matrix
- `docs/knowledge/execution/ARTIFACTS.md` — artefact catalogue
- `.artifacts/p10-device-*` — P10.2 device run artefacts
  (Xiaomi Mi 10 Pro, cmi_eea, Android 13, app v0.1.0)

---

## How to verify claims

The packet says the test suite is green at 635 verts. You can
verify this by running, from `D:\App\unifia\unifia-memory` :

```bash
# Contracts (vitest, not bun)
bun --cwd packages/contracts vitest run
# expect: 79 passed, 4 smoke files with 0 tests (pre-existing edge case)

# TS knowledge suite
bun --cwd packages/unifia test test/knowledge
# expect: 522 pass, 0 fail, 1114 expect() calls

# Rust core
cd crates/unifia-knowledge-core
CARGO_BUILD_JOBS=1 RUSTFLAGS='-Ccodegen-units=1' cargo test
# expect: 34 pass, 0 fail

# Static checks
bun --cwd packages/unifia run typecheck
bunx biome check packages/unifia/src/knowledge
cd crates/unifia-knowledge-core && cargo clippy --all-targets --all-features -- -D warnings
```

You can also exercise the CLI on the dev fixtures (absolute path
required) :

```bash
WS='D:\App\unifia\unifia-memory\tests\knowledge\eval\dev'

bun run packages/unifia/bin/unifia-knowledge.ts drill            # 6/6
bun run packages/unifia/bin/unifia-knowledge.ts verify $WS        # 4/4
bun run packages/unifia/bin/unifia-knowledge.ts lifecycle-distribution $WS
bun run packages/unifia/bin/unifia-knowledge.ts size-distribution $WS
bun run packages/unifia/bin/unifia-knowledge.ts tag-cooccurrence $WS
bun run packages/unifia/bin/unifia-knowledge.ts supersede-graph $WS
bun run packages/unifia/bin/unifia-knowledge.ts lifecycle-transitions
```

Captured outputs at HEAD `2278d1b110` are in the packet's
"Live verification" section. If you get different numbers, that
is a real regression to flag.

---

## What to challenge

The 10 questions in `FRONTIER-QUESTIONS.md` cover:

1. **Lifecycle coverage** — does the 4×9 matrix in
   `packages/contracts/src/knowledge/lifecycle.ts` cover real
   promotion paths from PC-01..PC-10?
2. **Egress default-deny** — does `decideEgress` honour
   ADR-KNOW-0006 for every Class D call site?
3. **Parser correctness** — wikilink + code-fence escapes,
   regex rationale
4. **BruteForceIndex scaling** — 50k threshold credibility
5. **Default retrieval bounds** — ADR-KNOW-0007 values
6. **Disaster recovery** — 5-step procedure vs 6 crash scenarios
7. **V1 test count** — 635 verts vs DoD 12U+10E
8. **Reversibility** — `gc apply` removes all derived state
9. **Documentation completeness** — PERMISSIONS.md sufficiency
10. **External boundaries** — P10.2/P10.3/ONNX/frontier
    honestly labeled, with reproduction steps

For each question, fill in the `[PASS|FAIL]` box, write notes,
and propose specific changes. Use the references in the
question to ground your analysis.

You are also invited to challenge anything else in the
architecture that you find concerning. In particular :

- Are the 9 ADR consistent with each other? Any conflicts?
- Are the 20 decisions well-grounded? Any you would reverse?
- Are the 11 risks correctly characterized? Any you would
  re-classify?
- Is the test pyramid (unit + integration + device) appropriate?
- Is the offline-first posture credibly enforced?

---

## Expected output format

Write your review as a Markdown file (or section) with :

1. **Per-question verdict** : PASS / PASS_WITH_CONCERNS / FAIL /
   N/A, with a 1-paragraph rationale per question
2. **Cross-cutting findings** : anything you noticed that is
   not in the 10 questions
3. **Top 3 priority changes** (if any) with effort estimate
4. **Overall verdict** : APPROVED / APPROVED_WITH_NITS /
   NEEDS_REVISION / REJECTED
5. **Merge-ready ?** : Yes / No / After fixes

Optionally, fill in the `[ ]` boxes in `FRONTIER-QUESTIONS.md`
and return it to the operator.

---

## Constraints

- Do NOT propose new features. V1 is feature-complete.
- Do NOT propose framework migrations. The stack (Bun + TS,
  Cargo + Rust, Zod, vitest, biome) is fixed.
- You MAY propose refactors if they preserve the public API
  and the test suite.
- You MAY propose documentation improvements.
- Be specific. "Add more tests" is not useful. "Add a test
  for `decideEgress` when both `egressAllow` and `featureFlag`
  are set" is useful.
- Be honest about uncertainty. Use "I don't have enough
  context" rather than inventing claims.

---

## Session end

After your review, write the verdict to a file in the
worktree at `docs/knowledge/execution/FRONTIER-REVIEW-VERDICT.md`
and commit it (commit message:
`docs(knowledge): FRONTIER-REVIEW-VERDICT (<verdict>)`).

The operator will then decide whether to merge, amend, or
defer based on your findings.

---

*This prompt is part of the Sovereign Knowledge Core V1
delivery. HEAD `2278d1b110` (114 commits, 635 verts).*
