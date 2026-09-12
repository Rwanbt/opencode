<!-- SPDX-License-Identifier: MIT -->
# COMPACT — Sovereign Knowledge Core V1 (session compact view)

> Vue compacte pour reprise rapide après compaction de session.
> Voir `FINAL-REPORT.md` pour le détail et `STATE.md` pour
> l'append-only historique.

## One-liner

110 commits locaux, 522 TS knowledge + 79 contracts + 34 Rust = 635 verts
(4569 total TS suite, 4 pre-existing fail non-knowledge),
13 phases couvertes (P10.2 + P10.3 = `PASS_WITH_SAFE_FALLBACK`).
**55 subcommands**, **38 admin tools**, **FRONTIER-REVIEW-PACKET** ready,
**P11.52-P11.56** delivered (note-stats, size-distribution,
weekday-distribution, edge-density, frontmatter-diff).

## SHA

- Branche : `feat/sovereign-knowledge-core`
- HEAD : `46fd3a322f chore(knowledge): drop unused KnowledgeId import in frontmatter-diff`
- Initial : `95350647140a382ee6d5d61bc2f6639597d80f0b` (origin/dev)
- P10.2/P10.3 device artefacts : `.artifacts/p10-device-{screen.png, report.json, run.md}`

## Files at a glance

- Contrats : `packages/contracts/src/knowledge/` (10 fichiers).
- Runtime TS : `packages/unifia/src/knowledge/` (60+ modules).
- Runtime Rust : `crates/unifia-knowledge-core/src/` (8 modules).
- CLI : `packages/unifia/bin/unifia-knowledge.ts` (31 subcommands).
- Tests : 635 verts (522 TS knowledge + 79 contracts + 34 Rust).
- Docs : 9 ADR + 10 cas + DoD + crash matrix + CHANGELOG + README
  + PERMISSIONS + DISASTER-RECOVERY + COMPACT + FINAL-REPORT
  + FRONTIER-REVIEW-PACKET.

## Reprise (4 commandes)

```bash
cd D:\App\unifia\unifia-memory
git status --short && git branch --show-current
git log --oneline | head -5
cat docs/knowledge/execution/STATE.md | head -100
cat docs/knowledge/execution/FINAL-REPORT.md | head -40
```

## Cartes restantes (frontieres externes)

- P10.2 device run — `PASS_WITH_SAFE_FALLBACK` (artefacts dans
  `.artifacts/p10-device-*`). Full chain requires APK rebuild
  with embedded runtime.
- P10.3 resource pressure — `PASS_WITH_SAFE_FALLBACK` (idle capture
  only, ONNX disabled).
- Phase Frontier review — packet ready (`FRONTIER-REVIEW-PACKET.md`),
  no external model triggered yet.
- ONNX embedding model — non téléchargé, P5.5 utilise fake embed.

## CLI subcommands (31)

```bash
unifia knowledge status | sources | search | doctor | bench | bench-large
unifia knowledge sovereignty [--vault=DIR] [--derived=PATH]
unifia knowledge disaster-recovery [--no-class-c] [--no-class-d] [--no-unifia] [--offline]
unifia knowledge migrate --dry-run|--rollback
unifia knowledge precommit install <ws>|scan <files...>
unifia knowledge portable <ws> list|upsert|remove|show
unifia knowledge reachability <ws>
unifia knowledge mcp-token issue|revoke|check|demo
unifia knowledge classify <ws>
unifia knowledge verify <ws> [--derived=PATH] [--online] [--cloud] [--device]
unifia knowledge policy <ws> show|set-egress|set-feature
unifia knowledge gc <ws> recommend|apply
unifia knowledge similarity <ws> [--topk=N]
unifia knowledge summary <ws> [--one-line]
unifia knowledge drill
unifia knowledge validate <ws>
unifia knowledge report <ws> [--no-validation] [--no-types] [--no-policy] [--title=T]
unifia knowledge tag-search <ws> <tag> [<tag>...] [--limit=N]
unifia knowledge backlinks <ws> <target>
unifia knowledge stats <ws>
unifia knowledge by-type <ws> <type> [--only-active] [--limit=N]
unifia knowledge broken-links <ws>
unifia knowledge headings <ws> <locator>
unifia knowledge list <ws> [--limit=N] [--offset=N]
unifia knowledge show <ws> <locator>
unifia knowledge tags <ws>
unifia knowledge projects <ws>
unifia knowledge supersede <ws> --target=<loc> --source=<s> --reason=<r> [--successor=<loc>]
unifia knowledge by-lifecycle <ws> <lifecycle> [--limit=N]
unifia knowledge by-project <ws> <project_ref> [--limit=N]
unifia knowledge orphans <ws> [--max-links=N] [--limit=N]
unifia knowledge lifecycle-distribution <ws>
unifia knowledge stale <ws> [--threshold-days=N] [--only-active] [--limit=N]
unifia knowledge references <ws> --target=<locator>|--target-id=<uuid>
unifia knowledge fingerprint <ws> [--verbose]
unifia knowledge by-tag <ws> <tag> [--limit=N]
unifia knowledge vault-compare <ws_a> <ws_b>
unifia knowledge recent <ws> [--window-days=N] [--only-active] [--limit=N]
unifia knowledge supersede-graph <ws>
unifia knowledge duplicates <ws>
unifia knowledge timeline <ws> [--window-days=N] [--max-per-day=N]
unifia knowledge tag-cooccurrence <ws> [--min-count=N] [--limit=N]
unifia knowledge supersede-classify <ws>
unifia knowledge note-diff <ws> --target-a=<loc>|--target-id-a=<uuid> --target-b=<loc>|--target-id-b=<uuid>
unifia knowledge lifecycle-transitions
```

## Test live

`unifia knowledge drill` :
  drill: 6/6 scenarios OK (0ms)
  PASS before-fsync                  INV-RECOVERY-PRE-FSYNC
  PASS after-fsync-before-rename     INV-RECOVERY-POST-FSYNC
  PASS after-rename-before-wal-fsync INV-RECOVERY-POST-RENAME
  PASS after-wal-fsync               INV-RECOVERY-POST-WAL
  PASS during-index-update           INV-RECOVERY-DURING-INDEX
  PASS during-wal-compaction         INV-RECOVERY-DURING-COMPACTION

`unifia knowledge summary tests/knowledge/eval/dev --one-line` :
  vault=...tests/knowledge/eval/dev  notes=12 (active=10)  parse-failures=1  class-B=0  policy.egress=absent

`unifia knowledge tags tests/knowledge/eval/dev` :
  scanned: 11
  unique:  22
  (full list in session log)

`unifia knowledge verify tests/knowledge/eval/dev` :
  4/4 PASS (sovereignty, disaster-recovery, reachability, classify) in 26ms
