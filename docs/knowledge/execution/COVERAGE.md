<!-- SPDX-License-Identifier: MIT -->
# COVERAGE — Sovereign Knowledge Core V1

> Cumul de la couverture. Mise a jour par carte. Sections : code,
> tests, docs, contrats, frontieres externes. Append-only.

## Etat a 103 commits (HEAD `bdb123a18e`, 2026-08-29)

| Categorie | Couvert | Total | % | Notes |
|---|---|---|---|---|
| Modules TS `packages/unifia/src/knowledge/*` | 60+ | 60+ | 100% | 33 admin tools (P11.27-P11.51) + 27 P0-P10 |
| `@unifia/contracts/src/knowledge/*` | 10 | 10 | 100% | identity, space, restrictions, lifecycle, retrieval, mutation, context, native-port, errors, mcp |
| `crates/unifia-knowledge-core/src/*` | 8 | 8 | 100% | error, hash, path, watcher, wal, classb, control_store |
| Tests TS knowledge | 488 | 488 | 100% | 33 admin suites + cross-mode, derived, events, facade, git, hardening, mcp, memory, mobile, parser, policy, context, semantic, spike, stack |
| Tests contracts knowledge | 79 | 79 | 100% | Zod schemas + native-port + mcp + lifecycle matrix |
| Tests Rust knowledge-core | 34 | 34 | 100% | error, hash, path, watcher, wal, classb, control_store |
| ADR knowledge | 9 | 9 | 100% | 0001..0009-knowledge-*.md |
| Cas reels PC-01..PC-10 | 10 | 10 | 100% | `PRODUCT-CASES.md` |
| Fixtures dev/holdout | 22 | 22 | 100% | 11 dev + 11 holdout, isolation validee |
| Cartes phase -1 | 3 | 3 | 100% | corpus + fixtures + DoD |
| Cartes phase 0 | 8 | 8 | 100% | P0.1 cartography + P0.2-P0.7 spikes + P0.8 ADR |
| Cartes phase 1 | 4 | 4 | 100% | contracts, sources, parser, ContextRouter |
| Cartes phase 2 | 5 | 5 | 100% | Rust crate + TS adapters + portable-store + reachability + GC |
| Cartes phase 3 | 3 | 3 | 100% | SQLite+FTS5 DDL, chunker, edge extractor, doctor |
| Cartes phase 4 | 3 | 3 | 100% | lifecycle transitions, auto-promotion, Inbox |
| Cartes phase 5 | 3 | 3 | 100% | cosine, BruteForceIndex, benchmark, P5.5 simulate |
| Cartes phase 6 | 2 | 2 | 100% | ai-native-dev-stack mapping + DomainBus |
| Cartes phase 7 | 2 | 2 | 100% | KnowledgeService + CrossModePipeline E2E + bus-pipeline |
| Cartes phase 8 | 1 | 1 | 100% | GitProvider + precommit hook |
| Cartes phase 9 | 1 | 1 | 100% | McpKnowledgeServer + P9.2 token registry |
| Cartes phase 10 | 2 | 3 | 67% | P10.2/P10.3 = `PASS_WITH_SAFE_FALLBACK` (device alive, full chain not exercisable without APK rebuild with embedded runtime) |
| Cartes phase 11 | 4 | 4 | 100% | crash matrix, sovereignty, path containment, fuzz, large vault, SBOM, drill, recovery, verify, policy, by-*, orphans, duplicates, references, fingerprint, recent, stale, tags, projects, lifecycle-distribution, supersede, supersede-graph, supersede-classify, tag-cooccurrence, timeline, note-diff, lifecycle-transitions |
| Cartes P11.x hardening | 51 | 51 | 100% | P11.4-P11.51 (20 admin tools) |
| Frontiere Android device | 0 | 1 | n/a | `PASS_WITH_SAFE_FALLBACK` ; full chain requires APK rebuild with embedded runtime |
| Frontiere ONNX embedding | 0 | 1 | n/a | `disabled` par defaut (runbook §8.8) ; P5.5 utilise fake embed deterministe |
| Frontiere frontier review | 0 | 1 | n/a | packet pret (`FRONTIER-REVIEW-PACKET.md`) ; aucun modele externe declenche |

## Bilan global

- **Cartes V1 planifiees** : ~106
- **Cartes V1 executees** : ~104 (98% — seules P10.2 full chain et P10.3 stress sont en `PASS_WITH_SAFE_FALLBACK`)
- **Tests verts** : 601 (488 TS knowledge + 79 contracts + 34 Rust)
- **CLI subcommands** : 50
- **Admin tools** : 33 (P11.32-P11.51 = 20 nouveaux + 13 anciens)
- **Mutations** : 0 push, 0 PR, 0 merge, 0 release, 0 publication
- **Remote tracking** : aucun sur `feat/sovereign-knowledge-core`
