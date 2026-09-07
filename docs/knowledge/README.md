<!-- SPDX-License-Identifier: MIT -->
# Knowledge — Unifia Sovereign Knowledge Core V1

> Index of the Knowledge subsystem. Read this first; it tells you
> what's where, why, and how to resume work.

## What is this?

The Sovereign Knowledge Core V1 is the offline-first, provider-
independent, egress-bounded memory that powers the ContextRouter
across the **Code**, **Work**, and **Design** modes of Unifia.
The canonical source of truth is **Markdown + YAML frontmatter**
(Class A) in the user's vault; everything else is derived.

See `WHY-NOT-VAULT-RG-GIT.md` for the motivation and
`SOVEREIGN-CORE-V1-DOD.md` for the Definition of Done.

## Map

```
docs/knowledge/
├── README.md                # this file
├── WHY-NOT-VAULT-RG-GIT.md  # motivation
├── PRODUCT-CASES.md         # 10 real failure cases (PC-01..PC-10)
├── SOVEREIGN-CORE-V1-DOD.md # Definition of Done
├── CHANGELOG.md            # v0.1.0-knowledge
├── adr/                    # 9 knowledge ADRs
│   ├── 0001-knowledge-identity.md
│   ├── 0002-knowledge-canonical.md
│   ├── 0003-knowledge-class-b.md
│   ├── 0004-knowledge-class-c.md
│   ├── 0005-knowledge-class-d.md
│   ├── 0006-knowledge-egress.md
│   ├── 0007-knowledge-native-port.md
│   ├── 0008-knowledge-search.md
│   └── 0009-knowledge-lifecycle.md
└── execution/               # session / run artefacts
    ├── BASELINE.md
    ├── STATE.md             # append-only
    ├── DECISIONS.md
    ├── RISKS.md
    ├── COVERAGE.md
    ├── TEST-MATRIX.md
    ├── ARTIFACTS.md
    ├── POST-WORK-DESIGN-CONVERGENCE.md
    ├── FRONTIER-REVIEW-PACKET.md
    ├── FINAL-REPORT.md      # last sprint summary
    ├── COMPACT.md           # one-screen view (resumption)
    ├── checkpoints/         # session checkpoints
    ├── blockers/            # open blockers
    └── evidence/            # collected proofs
```

## Code map

```
packages/
├── contracts/src/knowledge/  # 10 files, 79 tests
└── unifia/src/knowledge/      # 60+ modules
    ├── domain/        # KnowledgeFailure
    ├── parser/        # frontmatter, wikilinks, parser
    ├── source/        # KnowledgeSource + 4 spaces
    ├── policy/        # decideEgress, KnowledgePolicy store
    ├── context/       # router, inspector, dataflow
    ├── derived/       # DDL, chunker, indexer, doctor
    ├── admin/         # 19 admin tools (tags, projects, by-*, etc.)
    ├── memory/        # lifecycle, promotion, inbox, audit
    ├── semantic/      # embedding score, BruteForceIndex, benchmark, simulate
    ├── stack/         # ai-native-dev-stack mapping
    ├── facade/        # KnowledgeService
    ├── git/           # GitProvider, precommit
    ├── mcp/           # McpKnowledgeServer, token registry
    ├── mobile/        # Android storage + probe
    ├── events/        # DomainBus
    ├── cross-mode/    # CrossModePipeline, CrossModeBusPipeline
    ├── hardening/     # crash matrix, sovereignty, fuzz, SBOM, drill, recovery, verify, etc.
    ├── wal/           # TS WAL adapter
    ├── classb/        # TS ClassB adapter + portable-store, reachability, GC
    ├── control/       # TS ControlStore adapter
    └── spike/         # P0 spike primitives

crates/
└── unifia-knowledge-core/src/  # 8 modules, 34 tests
    ├── error.rs           # KnowledgeError (11 kinds)
    ├── hash.rs            # BLAKE3 / SHA-256
    ├── path.rs            # ResolvedKnowledgePath
    ├── watcher.rs         # debounce + coalesce
    ├── wal.rs             # append-only WAL
    ├── classb.rs          # Class B copy-on-write
    └── control_store.rs   # Class C
```

## Quick start (CLI)

```bash
# From the workspace root
bun run packages/unifia/bin/unifia-knowledge.ts status
bun run packages/unifia/bin/unifia-knowledge.ts sources
bun run packages/unifia/bin/unifia-knowledge.ts search "Adreno K-quants"
bun run packages/unifia/bin/unifia-knowledge.ts doctor
bun run packages/unifia/bin/unifia-knowledge.ts bench
bun run packages/unifia/bin/unifia-knowledge.ts bench-large 100 256
```

## Validation matrix

| Suite | Command | Last result |
|---|---|---|
| Contracts | `bun --cwd packages/contracts test` | 79 pass, 0 fail |
| unifia knowledge | `bun --cwd packages/unifia test test/knowledge` | 522 pass, 0 fail |
| knowledge-core | `cargo test` (cwd crates/unifia-knowledge-core) | 34 pass, 0 fail |
| unifia typecheck | `bun --cwd packages/unifia run typecheck` | exit 0 |
| knowledge-core clippy | `cargo clippy --all-targets --all-features -- -D warnings` | exit 0 |
| biome | `bunx biome check packages/unifia/src/knowledge` | 0 warning |
| isolation | `bun tests/knowledge/eval/check-isolation.ts` | exit 0 |

## Admin CLI quick reference

The `unifia-knowledge.ts` CLI exposes **49 subcommands**. The
admin tools (under `packages/unifia/src/knowledge/admin/`) are
pure read-only and grouped by purpose:

| Group | Subcommands |
|---|---|
| **Counts / lists** | `tags`, `projects`, `lifecycle-distribution`, `tag-cooccurrence`, `supersede-classify` |
| **Filters** | `by-type`, `by-lifecycle`, `by-project`, `by-tag`, `tag-search`, `list` |
| **Inspection** | `show`, `headings`, `references`, `backlinks`, `broken-links`, `note-stats` |
| **Maintenance** | `duplicates`, `orphans`, `stale`, `recent`, `timeline` |
| **Change detection** | `fingerprint`, `vault-compare`, `note-diff`, `frontmatter-diff` |
| **Distribution** | `size-distribution`, `weekday-distribution`, `edge-density` |
| **Lifecycle ops** | `supersede` (plan), `supersede-graph` |
| **Validation** | `validate`, `doctor`, `classify`, `summary`, `stats`, `report` |
| **Recovery / verify** | `sovereignty`, `disaster-recovery`, `drill`, `verify`, `migrate` |
| **Lifecycle matrix** | `lifecycle-transitions` |
| **Other** | `status`, `sources`, `search`, `bench`, `bench-large`, `precommit`, `mcp-token`, `portable`, `policy`, `gc`, `similarity` |

Total: 55 subcommands, 38 admin tools, 635 tests passants.

## Resume after compaction

```bash
cd D:\App\unifia\unifia-memory
git status --short  # must be empty
git branch --show-current  # must be feat/sovereign-knowledge-core
git rev-parse HEAD  # must match the SHA in execution/FINAL-REPORT.md
```

Read `execution/COMPACT.md` (one screen) then
`execution/FINAL-REPORT.md` (full sprint).

## External boundaries (documented, isolated)

- **Android device** : `PASS_WITH_SAFE_FALLBACK` for P10.2 and
  P10.3 (artefacts in `.artifacts/p10-device-*`). Full chain
  requires APK rebuild with embedded runtime.
- **ONNX embedding model** : `disabled` by default per
  runbook §8.8.
- **Frontier review** : packet ready at
  `execution/FRONTIER-REVIEW-PACKET.md` (runbook §24); no
  external model triggered yet.
