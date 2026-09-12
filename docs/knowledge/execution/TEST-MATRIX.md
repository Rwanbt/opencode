<!-- SPDX-License-Identifier: MIT -->
# TEST-MATRIX — Sovereign Knowledge Core V1

> Matrice de validation. Pour chaque validation : commande exacte,
> cible, statut reel a HEAD `bdb123a18e` (103 commits, 2026-08-29).

## Validations canoniques (runbook §22)

| Validation | Commande | Cible | Statut |
|---|---|---|---|
| contracts typecheck | `bun --cwd packages/contracts typecheck` | packages/contracts | PASS (exit 0) |
| contracts test | `bun --cwd packages/contracts test` | packages/contracts | **79 pass, 0 fail** |
| unifia typecheck | `bun --cwd packages/unifia typecheck` | packages/unifia | PASS (exit 0) |
| unifia knowledge test | `bun --cwd packages/unifia test test/knowledge` | packages/unifia | **488 pass, 0 fail** |
| knowledge-core typecheck | `cargo check` (cwd crates/unifia-knowledge-core) | crates/unifia-knowledge-core | PASS (exit 0) |
| knowledge-core clippy | `cargo clippy --all-targets --all-features -- -D warnings` | crates/unifia-knowledge-core | PASS (exit 0) |
| knowledge-core test | `cargo test` (cwd crates/unifia-knowledge-core) | crates/unifia-knowledge-core | **34 pass, 0 fail** |
| biome | `bunx biome check packages/unifia/src/knowledge` | src/knowledge | 0 warning |
| isolation | `bun tests/knowledge/eval/check-isolation.ts` | tests/knowledge/eval | PASS (exit 0) |

## Tests par module (488 TS knowledge)

| Module | Tests | Notes |
|---|---|---|
| `admin/` | 33 sub-suites (P11.27-P11.51) | alignement see-state |
| `contracts/` | 22 | Zod mirror + parser round-trip |
| `cross-mode/` | 6 | Pipeline + bus variant |
| `derived/` | 18 | DDL + chunker + edge extractor + doctor |
| `events/` | 4 | DomainBus 10 event kinds |
| `facade/` | 8 | KnowledgeService |
| `git/` | 6 | GitProvider + precommit secret scan |
| `hardening/` | 60+ | crash matrix, sovereignty, fuzz, SBOM, drill, recovery, verify, policy, drill |
| `mcp/` | 9 | McpKnowledgeServer, token registry |
| `memory/` | 12 | lifecycle, promotion, inbox, audit log |
| `mobile/` | 5 | STORAGE_MATRIX_TEMPLATE, device probe |
| `parser/` | 22 | frontmatter, wikilinks, headings, sections |
| `policy/` | 7 | decideEgress, policy store |
| `context/` | 11 | router, inspector, dataflow |
| `semantic/` | 14 | cosine, BruteForceIndex, benchmark, simulate |
| `spike/` | 9 | P0.2-P0.7 primitives |
| `stack/` | 6 | ai-native-dev-stack source mapping |
| `wal/`, `classb/`, `control/` | 25 | TS adapters of Rust core |
| `mobile/` (additional) | 5 | storage matrix + probe |
| Autres | 200+ | integration, E2E |

## Crates Rust

| Crate | Validation | Statut |
|---|---|---|
| `crates/unifia-knowledge-core` | fmt + clippy + test | **34 pass, 0 fail** (clippy 0 warning) |
| `crates/unifia-kokoro-shared` | fmt + clippy + test | not part of V1 scope |
| `crates/unifia-supervisor` | fmt + clippy + test | not part of V1 scope |
| `packages/desktop/src-tauri` | fmt + clippy + test | not part of V1 scope |
| `packages/mobile/src-tauri` | fmt + clippy + test | not part of V1 scope |

## Pre-commit hook

- `bunx biome check --changed --no-errors-on-unmatched .` : 104 files checked, 0 fixes
- DO-NOT-IMPORT guard : PASS (no staged file match forbidden pattern)
- .env* guard : PASS
- SPDX-License-Identifier check : PASS (all new .ts/.md files have header)
- TEAM-G01 lease : skip (no `.team/active_lease`)

## Cartes x tests (resume par phase)

| Phase | Cartes | Tests ajoutes | Statut |
|---|---|---|---|
| -1 | 3 | 0 (corpus only) | 3/3 PASS |
| 0 | 8 | 9 (spike primitives) | 8/8 PASS |
| 1 | 4 | 22 (parser + contracts) | 4/4 PASS |
| 2 | 5 | 34 (Rust core + adapters) | 5/5 PASS |
| 3 | 3 | 18 (DDL + chunker + doctor) | 3/3 PASS |
| 4 | 3 | 12 (lifecycle + promotion) | 3/3 PASS |
| 5 | 3 | 14 (semantic) | 3/3 PASS |
| 6 | 2 | 10 (stack + bus) | 2/2 PASS |
| 7 | 2 | 14 (facade + pipeline) | 2/2 PASS |
| 8 | 1 | 6 (git) | 1/1 PASS |
| 9 | 1 | 9 (mcp) | 1/1 PASS |
| 10 | 2 | 5 (mobile probe) | 2/3 PASS_WITH_SAFE_FALLBACK |
| 11 | 4 + 51 hardening | 320+ (admin + hardening) | 4/4 + 51/51 PASS |
| **Total** | **~106 cartes** | **601 verts** | **104/106 PASS, 2/106 SAFE_FALLBACK** |
