<!-- SPDX-License-Identifier: MIT -->
# FRONTIER REVIEW PACKET — Sovereign Knowledge Core V1

> Self-contained packet for external frontier-model review (per
> runbook V2 §24). The reviewer should be able to read this file,
> run the listed commands, and form an independent opinion.
>
> All claims below are backed by either (a) a commit SHA in this
> branch, (b) a test result captured in the session, or (c) a
> cited source file. Speculation is explicitly marked.

## TL;DR

| Item | Value |
|---|---|
| Branch | `feat/sovereign-knowledge-core` |
| Base | `origin/dev` @ `95350647140a382ee6d5d61bc2f6639597d80f0b` |
| Worktree | `D:\App\unifia\unifia-memory` (sibling of `unifia-work-design`, untouched) |
| Local commits | **111** (HEAD `c67a7e22`) |
| Tests | **635 green** (522 TS knowledge + 79 contracts + 34 Rust) |
| Phases | 13 / 13 covered (P10.2 / P10.3 = `PASS_WITH_SAFE_FALLBACK`) |
| Public surface | 55 CLI subcommands, 38 admin tools (P11.32-P11.56) |
| ADRs | 9 (`docs/knowledge/adr/0001..0009-knowledge-*.md`) |
| Mutations | **0** — no push, no PR, no merge, no release, no publication |
| Remote tracking | **none** — branch has no upstream |

## Why this review exists

The Sovereign Knowledge Core V1 is the offline-first, provider-
independent, egress-bounded memory layer behind the `ContextRouter`
that powers the **Code**, **Work**, and **Design** modes of Unifia.
A frontier review is required by runbook V2 §24 before any merge
to a public branch. The reviewer is asked to challenge:

1. **Correctness** of the contracts and parsers.
2. **Sovereignty** guarantees (offline-first, no silent egress).
3. **Test adequacy** — is the suite sufficient for the V1 DoD?
4. **Reversibility** — can V1 be uninstalled cleanly?
5. **External boundaries** — are the deferred items (device,
   embedding) honestly labeled?

## Repo layout at HEAD

```
packages/
├── contracts/src/knowledge/   # 10 Zod files, 79 tests
└── unifia/src/knowledge/      # 60+ TS modules
    ├── domain/      parser/   source/    policy/   context/
    ├── derived/     admin/    memory/    semantic/ stack/
    ├── facade/      git/      mcp/       mobile/   events/
    ├── cross-mode/  hardening/ wal/      classb/   control/
    └── spike/                 # P0 spike primitives

crates/
└── unifia-knowledge-core/src/  # 8 Rust modules, 34 tests
    ├── error.rs   hash.rs   path.rs   watcher.rs
    ├── wal.rs     classb.rs control_store.rs

packages/unifia/bin/
└── unifia-knowledge.ts         # CLI dispatcher (55 subcommands)

docs/knowledge/
├── README.md                    # navigation index
├── CHANGELOG.md                 # v0.1.0 + v0.2.0-knowledge
├── PERMISSIONS.md               # 5 KB default-deny policy
├── DISASTER-RECOVERY.md         # 5-step procedure
├── PRODUCT-CASES.md             # 10 real failure cases (PC-01..PC-10)
├── SOVEREIGN-CORE-V1-DOD.md     # 12U + 10E requirements
├── WHY-NOT-VAULT-RG-GIT.md      # motivation
├── adr/0001..0009-knowledge-*.md
└── execution/
    ├── STATE.md                 # append-only, ~74k chars, 100+ cards
    ├── DECISIONS.md             # 20+ autonomous decisions (D-0001..D-0020)
    ├── RISKS.md                 # open risks, classified
    ├── COVERAGE.md              # file coverage per phase
    ├── TEST-MATRIX.md           # what each test exercises
    ├── ARTIFACTS.md             # per-phase artefact list
    ├── FINAL-REPORT.md          # ~15 kB sprint summary
    ├── COMPACT.md               # one-screen resumption view
    └── FRONTIER-REVIEW-PACKET.md # this file
```

## V1 contracts (`packages/contracts/src/knowledge/`)

| File | Purpose | Tests |
|---|---|---|
| `identity.ts` | UUIDv7, locator, hash | 7 |
| `space.ts` | 4 V1 spaces (Personal/Project/External/Session) | 4 |
| `restrictions.ts` | remote/local/embeddable/exportable | 6 |
| `lifecycle.ts` | 4 states × 9 types, transition table | 11 |
| `retrieval.ts` | bounded retrieval defaults | 5 |
| `mutation.ts` | 8 mutation kinds with intent completeness | 8 |
| `context.ts` | `ContextPack` shape | 6 |
| `native-port.ts` | 7 method signatures | 5 |
| `errors.ts` | 11 typed error kinds | 9 |
| `mcp.ts` | 6 MCP capabilities | 18 |

All 79 tests must pass at HEAD; reviewer can run
`bun --cwd packages/contracts test`.

## V1 core (`crates/unifia-knowledge-core/`)

| Module | Public API | Tests |
|---|---|---|
| `error.rs` | `KnowledgeError` (11 kinds, snake_case) | 4 |
| `hash.rs` | BLAKE3 + SHA-256, 64-char hex validation | 5 |
| `path.rs` | `ResolvedKnowledgePath` with symlink/junction containment | 6 |
| `watcher.rs` | debounce + coalesce, `hash_file` | 3 |
| `wal.rs` | append-only WAL, 8 kinds, idempotent replay | 6 |
| `classb.rs` | copy-on-write aliases, reachability, GC | 5 |
| `control_store.rs` | Class C (device_id, PolicyGrant, EgressGrant) | 5 |

All 34 tests must pass at HEAD; reviewer can run
`cargo test` in the crate.

## TS knowledge suite (`packages/unifia/src/knowledge/`)

488 tests at HEAD, grouped by module:

| Module | Tests | Notes |
|---|---|---|
| `admin/` | 20 sub-suites | one per admin tool |
| `contracts/` | mirrors Zod, 2× | parser/identity round-trip |
| `cross-mode/` | 6 | CrossModePipeline + bus variant |
| `derived/` | 18 | DDL, chunker, edge extractor, doctor |
| `events/` | 4 | DomainBus (10 event kinds) |
| `facade/` | 8 | KnowledgeService |
| `git/` | 6 | GitProvider + precommit secret scan |
| `hardening/` | 60+ | crash matrix, sovereignty, fuzz, SBOM, drill |
| `mcp/` | 9 | McpKnowledgeServer, token registry |
| `memory/` | 12 | lifecycle, promotion, inbox, audit log |
| `mobile/` | 5 | STORAGE_MATRIX_TEMPLATE, device probe |
| `parser/` | 22 | frontmatter, wikilinks, headings, sections |
| `policy/` | 7 | decideEgress, policy store |
| `context/` | 11 | router, inspector, dataflow guard |
| `semantic/` | 14 | cosine, BruteForceIndex, benchmark, simulate |
| `spike/` | 9 | P0 primitives (P0.2–P0.7) |
| `stack/` | 6 | ai-native-dev-stack source mapping |
| `wal/`, `classb/`, `control/` | 25 | TS adapters of the Rust core |

## CLI surface (55 subcommands)

Original 30 (status, sources, search, doctor, bench, bench-large,
sovereignty, disaster-recovery, migrate, precommit, portable,
reachability, mcp-token, classify, verify, policy, gc, similarity,
summary, drill, validate, report, tag-search, backlinks, stats,
by-type, broken-links, headings, list, show) + 20 in session 12
(tags, projects, supersede, by-lifecycle, by-project, orphans,
lifecycle-distribution, stale, references, fingerprint, by-tag,
vault-compare, recent, supersede-graph, duplicates, timeline,
tag-cooccurrence, supersede-classify, note-diff,
lifecycle-transitions) + 5 in session 14 (note-stats,
size-distribution, weekday-distribution, edge-density,
frontmatter-diff).

Each subcommand is wired through the dispatcher and the `--help`
text. All 50 are pure read-only except `supersede` (plan dry-run
with intent CAS) and the mutation commands under `mcp-token`,
`policy`, `portable`, `gc`, `migrate`.

## Key decisions (full log in `DECISIONS.md`)

| ID | Topic | Choice |
|---|---|---|
| D-0001 | Scope per session | phase-by-phase with checkpoints, not big-bang |
| D-0002 | Real cases origin | from `KNOWN_FAILURE_PATTERNS.md`, never invented |
| D-0003 | Authority hierarchy | Runbook V2 > Plan master > pre-existing ADRs |
| D-0004 | Deferred parts (P5–P10) | interfaces + default impls + tests, parts needing device/model marked `NOT_EXECUTED_EXTERNAL_BOUNDARY` |
| (ADR-KNOW-0008 §3) | Search index | `BruteForceIndex`, ANN deferred until >50k notes |
| (ADR-KNOW-0007) | Default retrieval | `maxCandidates=50`, `maxPayloadBytes=1 MiB`, `maxSnippetBytes=64 KiB`, `deadlineMs=2_000` desktop / `4_000` Android |
| (ADR-KNOW-0009) | V1 lifecycle | `candidate|active|superseded|archived` with allowed transitions |
| (runbook §8.8) | Embedding | `disabled` by default; P5.5 uses deterministic fake embed |

Full list at `docs/knowledge/execution/DECISIONS.md` (30+ entries
D-0001 .. D-0030+).

## Architecture invariants (per ADR-KNOW series)

- **Class A** = Markdown + YAML frontmatter (canonical, in vault).
- **Class B** = derived (SQLite + FTS5, embeddings, graph) — can
  be rebuilt from Class A.
- **Class C** = control store (device_id, PolicyGrant, EgressGrant,
  append-only control log) — owned by Rust core.
- **Class D** = delivery (MCP, NativePort, ContextPack) — egress
  goes through `decideEgress` per ADR-KNOW-0006.
- **Default deny** everywhere — policy.json must explicitly allow
  a destination for any network egress.

## External boundaries (honestly labeled)

### P10.2 — Android device run

| Field | Value |
|---|---|
| Status | `PASS_WITH_SAFE_FALLBACK` |
| Device | Xiaomi Mi 10 Pro (`cmi_eea`) |
| Android | 13 (SDK 33), `arm64-v8a` |
| App | `ai.unifia.mobile` v0.1.0, PID 22883 at capture |
| Battery | 100 %, 32.7 °C |
| RAM | 7.4 GiB total, RSS 85 MiB |
| Storage | 69 GB free |
| Deep-link | `unifia://` works |
| Probes | adb✓, app installed✓, app running✓, fs writable✓, deep-link✓ |
| Artefacts | `.artifacts/p10-device-{screen.png, report.json, run.md}` |

**What is NOT exercised**: the full vault/FTS/graph/policy chain
on the device. The installed APK v0.1.0 does not embed the
Knowledge runtime (no `rootfs.tgz`). To exercise the chain end-
to-end on the device, an APK rebuild is required:
`bun --cwd packages/mobile build:android` (30–60 min native
compile). This is the only blocker for a `PASS` (not fallback)
verdict.

### P10.3 — Android resource pressure

| Field | Value |
|---|---|
| Status | `PASS_WITH_SAFE_FALLBACK` (idle capture only) |
| Capture | RSS 49 MB, VSZ 6 GB, 32.7 °C, battery 100 % |
| Stress test | **NOT executed** — ONNX disabled, LLM absent from V1 |
| Rationale | runbook §8.8: embedding `disabled` by default; if activated later, recommend FTS + graph during local generation |

### ONNX embedding model

- **Status** : not downloaded.
- **Rationale** : runbook §8.8 default is `disabled`; P5.5 simulate
  uses a deterministic fake embed (4-dim, byte-mixed) for
  reproducible tests.
- **Implication** : semantic search is wired (cosine, BruteForceIndex)
  but cannot be exercised on real notes without the model.

### Frontier review (this packet)

- **Status** : packet ready, no external model triggered yet.
- **Rationale** : runbook V2 §24 requires a frontier model
  (Claude Opus, GPT-5, Gemini 2.x Pro) for this review.

## How to reproduce

```bash
# 1. Environment
cd D:\App\unifia\unifia-memory
git status --short   # must be empty
git branch --show-current  # must be feat/sovereign-knowledge-core
git rev-parse HEAD   # must be c67a7e228b516f5061d7253366bece150db46fca

# 2. Tests
bun --cwd packages/contracts test     # 79 pass
bun --cwd packages/unifia test test/knowledge  # 522 pass
cd crates/unifia-knowledge-core && cargo test --release  # 34 pass

# 3. Static checks
bun --cwd packages/unifia run typecheck
cd crates/unifia-knowledge-core && cargo clippy --all-targets --all-features -- -D warnings
bunx biome check packages/unifia/src/knowledge  # 0 warning

# 4. Live CLI smoke
bun run packages/unifia/bin/unifia-knowledge.ts status
bun run packages/unifia/bin/unifia-knowledge.ts drill   # 6/6
bun run packages/unifia/bin/unifia-knowledge.ts verify D:/App/unifia/unifia-memory/tests/knowledge/eval/dev  # 4/4
bun run packages/unifia/bin/unifia-knowledge.ts lifecycle-distribution D:/App/unifia/unifia-memory/tests/knowledge/eval/dev
bun run packages/unifia/bin/unifia-knowledge.ts size-distribution D:/App/unifia/unifia-memory/tests/knowledge/eval/dev
```

## Live verification (captured at HEAD `c67a7e22`)

These are the actual outputs of the smoke commands above at
the time of writing. The reviewer can re-run them and compare.

```
$ unifia knowledge drill
drill: 6/6 scenarios OK (0ms)
  PASS before-fsync                  INV-RECOVERY-PRE-FSYNC
  PASS after-fsync-before-rename     INV-RECOVERY-POST-FSYNC
  PASS after-rename-before-wal-fsync INV-RECOVERY-POST-RENAME
  PASS after-wal-fsync               INV-RECOVERY-POST-WAL
  PASS during-index-update           INV-RECOVERY-DURING-INDEX
  PASS during-wal-compaction         INV-RECOVERY-DURING-COMPACTION

$ unifia knowledge verify tests/knowledge/eval/dev
  PASS  sovereignty           5 probe(s); verdict=OK  (6ms)
  PASS  disaster-recovery     3 step(s); simulation=OK; missing=[network]  (1ms)
  PASS  reachability          classA=12, classB=0, orphans=0, missingSidecars=12  (3ms)
  PASS  classify              parsed=11, failed=1, findings=0  (10ms)
  verdict: OK  (total 20ms)

$ unifia knowledge lifecycle-distribution tests/knowledge/eval/dev
  scanned: 11 (1 note fails the parser, see classify)
              decision  constraint  preference  failure  learning  procedure  reference  semantic  episodic  TOTAL
  candidate       0           0           0        0        0          0          0        0         0       0
  active          3           3           0        2        0          0          0        1         1      10
  superseded      1           0           0        0        0          0          0        0         0       1
  archived        0           0           0        0        0          0          0        0         0       0
  TOTAL           4           3           0        2        0          0          0        1         1      11

$ unifia knowledge size-distribution tests/knowledge/eval/dev
  scanned: 12, total: 9694 bytes, mean: 807, median: 710
  distribution:
    0-1KB       11 ###########
    1-5KB        1 #

$ unifia knowledge tag-cooccurrence tests/knowledge/eval/dev
  scanned: 11
  unique-tags: 22
  pairs: 0
  # (dev fixtures are atomised: each note has a single tag, no co-occurrences)

$ unifia knowledge supersede-graph tests/knowledge/eval/dev
  edges: 1, dangling: 0
  edges (from -> to):
    decision-thinking-budget.md  supersedes -> 0190d2c0-7b00-7000-8000-000000000010
  top-3 deepest lineages:
    decision-thinking-budget.md  depth=1

$ unifia knowledge lifecycle-transitions
  V1 lifecycle transition matrix (per ADR-KNOW-0009):

             candidate   active   superseded   archived
  candidate      -        OK          -          OK
  active         -         -         OK          OK
  superseded     -        OK          -          OK
  archived       -        OK          -           -

  Legend: OK = transition allowed, - = transition refused
```

If a reviewer gets a different number, that's a real regression
to flag. Otherwise the V1 admin tools are deterministic on the
dev fixture set.

## Specific questions for the reviewer

The reviewer is invited to challenge:

1. **Lifecycle coverage** — does the 4×9 matrix in
   `packages/contracts/src/knowledge/lifecycle.ts` cover the
   real promotion paths from PC-01..PC-10?
2. **Egress default-deny** — does `decideEgress` in
   `packages/unifia/src/knowledge/policy/` honour
   ADR-KNOW-0006 for every Class D call site?
3. **Parser correctness** — does the wikilink parser in
   `packages/unifia/src/knowledge/parser/wikilinks.ts` handle
   `[[X]]`, `[[X|Y]]`, `[[X#H]]`, and code-fence escapes
   correctly? The fenced-code regex uses `[^\S\n]*` instead of
   `\s*` — is the rationale documented?
4. **BruteForceIndex scaling** — ADR-KNOW-0008 defers ANN until
   >50k notes. Is the threshold reasonable? Are tests at the
   boundary credible (`bench-large 100 256`)?
5. **Default retrieval bounds** — ADR-KNOW-0007 sets
   `maxCandidates=50`, `maxPayloadBytes=1 MiB`,
   `maxSnippetBytes=64 KiB`, `deadlineMs=2_000` desktop /
   `4_000` Android. Are these appropriate?
6. **Disaster recovery** — does the 5-step procedure in
   `DISASTER-RECOVERY.md` cover the 6 crash scenarios in
   `hardening/crash-matrix.ts`? (drill currently reports 6/6)
7. **V1 test count** — 635 green tests. Is this adequate for the
   V1 DoD (12U + 10E requirements in
   `SOVEREIGN-CORE-V1-DOD.md`)?
8. **Reversibility** — can a user uninstall V1 cleanly? (The
   `gc apply` command should remove all derived state, leaving
   only Class A.)
9. **Documentation completeness** — is `PERMISSIONS.md`
   (5 KB, default-deny, 6 capabilities, 8 destinations, 7
   what-V1-does-not-do) sufficient for an operator to understand
   and modify V1?
10. **External boundaries** — are P10.2 / P10.3 / ONNX / this
    frontier review honestly labeled, with clear reproduction
    steps for unblocking?

## Open risks (full list in `RISKS.md`, IDs match)

- **R-0002** : Bun version drift (1.3.14 installed vs 1.3.11
  declared in `bun.lock`); low risk, monitoring.
- **R-0003** : APK rebuild not run; full P10.2 chain not
  exercised on device (XIAOMI Mi 10 Pro alive, app boots, but
  no `rootfs.tgz` in installed APK).
- **R-0004** : ONNX embedding not downloaded; semantic search
  not exercisable on real notes (V1 = `disabled` per runbook
  §8.8; P5.5 uses deterministic fake embed).
- **R-0008** : `BruteForceIndex` is O(n) per query; if a
  power-user vault exceeds 50k notes, the defer-ANN threshold
  will be hit (ADR-KNOW-0008 §3).
- **R-0009** : `mavis-trash` policy (recoverable delete) is
  Windows-specific; portability to macOS / Linux relies on
  PowerShell-Core UTF-8 detection (cf. gotcha 2026-08-24).
- **R-0010** : `useDefineForClassFields` shadow edge cases —
  field prive shadow method public (cf. P11 events/bus). Tests
  don't systematically cover this case. Mitigation: naming
  discipline + biome + tsc strict.
- **R-0011** : frontier review (this packet) not yet triggered;
  no external model has reviewed the architecture.

Closed risks (R-0001, R-0005, R-0006, R-0007) are documented in
`RISKS.md` with their CLOSED status.

## Sign-off

- Branch prepared by : autonomous session (runbook V2 method).
- Cross-checked by : 17 Obsidian recaps in
  `D:\Documents\Obsidian\IA_Dev_Brain\Unifia/` (Recap-2..8, 12..17, FINAL).
- Ready for : external frontier review (this packet).
- Not ready for : public release, merge to `main`, or any
  external publication.

### Launching the review

The companion file
[`FRONTIER-REVIEW-PROMPT.md`](./FRONTIER-REVIEW-PROMPT.md)
is a self-contained prompt for the frontier model session. It
gives context, file list, verification commands, expected output
format, and constraints. The reviewer should also fill in the
boxes in
[`FRONTIER-QUESTIONS.md`](./FRONTIER-QUESTIONS.md) and write
their verdict to
`docs/knowledge/execution/FRONTIER-REVIEW-VERDICT.md`.

— end of packet —
