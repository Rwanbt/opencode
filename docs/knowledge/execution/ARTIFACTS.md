<!-- SPDX-License-Identifier: MIT -->
# ARTIFACTS — Sovereign Knowledge Core V1

> Catalogue des artefacts locaux (binaires, bundles, fixtures, hash
> report). Pour chaque artefact : path, type, taille, SHA-256, timestamp,
> commande emettrice, statut.

## Convention de hash

SHA-256 calcule par :

```powershell
Get-FileHash -Path <path> -Algorithm SHA256 | Select-Object -ExpandProperty Hash
```

## Convention de timestamp

ISO-8601 UTC, capture par `Get-Date -AsUTC -Format "o"`.

## Artefacts V1 (a HEAD `bdb123a18e`, 103 commits, 2026-08-29)

| # | Path | Type | Taille | Statut |
|---|---|---|---|---|
| 000 | `docs/knowledge/execution/STATE.md` | append-only log | 74 527 chars | OK |
| 001 | `docs/knowledge/execution/DECISIONS.md` | decisions log | 2 691 chars | OK |
| 002 | `docs/knowledge/execution/COMPACT.md` | resumption view | 5 367 chars | OK |
| 003 | `docs/knowledge/execution/FINAL-REPORT.md` | sprint report | 16 546 chars | OK |
| 004 | `docs/knowledge/execution/FRONTIER-REVIEW-PACKET.md` | frontier packet | 14 318 chars | OK (runbook §24) |
| 005 | `docs/knowledge/execution/RISKS.md` | risk register | 3 610 chars | OK |
| 006 | `docs/knowledge/execution/COVERAGE.md` | coverage table | this file | OK |
| 007 | `docs/knowledge/execution/TEST-MATRIX.md` | test matrix | this file | OK |
| 008 | `docs/knowledge/execution/ARTIFACTS.md` | this catalogue | this file | OK |
| 009 | `docs/knowledge/CHANGELOG.md` | changelog | OK | v0.1.0 + v0.2.0-knowledge |
| 010 | `docs/knowledge/README.md` | navigation index | OK | 33 admin tools, 50 subcommands |
| 011 | `docs/knowledge/PERMISSIONS.md` | permissions | 5 KB | OK (default-deny) |
| 012 | `docs/knowledge/DISASTER-RECOVERY.md` | recovery procedure | 5 KB | OK (5-step) |
| 013 | `docs/knowledge/PRODUCT-CASES.md` | 10 real cases | OK | PC-01..PC-10 |
| 014 | `docs/knowledge/SOVEREIGN-CORE-V1-DOD.md` | DoD | OK | 12U + 10E |
| 015 | `docs/knowledge/WHY-NOT-VAULT-RG-GIT.md` | motivation | OK | |
| 016 | `docs/knowledge/adr/0001-knowledge-identity.md` | ADR | OK | |
| 017 | `docs/knowledge/adr/0002-knowledge-canonical.md` | ADR | OK | |
| 018 | `docs/knowledge/adr/0003-knowledge-class-b.md` | ADR | OK | |
| 019 | `docs/knowledge/adr/0004-knowledge-class-c.md` | ADR | OK | |
| 020 | `docs/knowledge/adr/0005-knowledge-class-d.md` | ADR | OK | |
| 021 | `docs/knowledge/adr/0006-knowledge-egress.md` | ADR | OK | |
| 022 | `docs/knowledge/adr/0007-knowledge-native-port.md` | ADR | OK | |
| 023 | `docs/knowledge/adr/0008-knowledge-search.md` | ADR | OK | |
| 024 | `docs/knowledge/adr/0009-knowledge-lifecycle.md` | ADR | OK | |

## P10.2 / P10.3 device artefacts

| # | Path | Type | Taille | Statut |
|---|---|---|---|---|
| 100 | `.artifacts/p10-device-screen.png` | screenshot | 93 199 bytes | OK (Unifia Mobile v0.1.0 running) |
| 101 | `.artifacts/p10-device-report.json` | device JSON | 1 214 bytes | OK (full state) |
| 102 | `.artifacts/p10-device-run.md` | operator report | 5 240 bytes | OK (procedure documented) |

Device : Xiaomi Mi 10 Pro (cmi_eea), Android 13, arm64-v8a,
PID 22883, deep-link `unifia://` works, battery 100 % / 32.7 °C,
RSS 85 MiB, storage 69 GB free.
Status : `PASS_WITH_SAFE_FALLBACK` (device alive, app boots, full
chain not exercisable without APK rebuild with embedded runtime).

## Fixtures (eval corpus)

| # | Path | Notes | Statut |
|---|---|---|---|
| 200 | `tests/knowledge/eval/dev/` | 11 dev fixtures + holdout set | OK (isolation validated) |
| 201 | `tests/knowledge/eval/holdout/` | 11 holdout fixtures | OK |
| 202 | `tests/knowledge/eval/check-isolation.ts` | isolation script | OK (exit 0) |

## Source artefacts (code)

| # | Path | Type | Statut |
|---|---|---|---|
| 300 | `packages/contracts/src/knowledge/` | 10 Zod files | OK (79 tests) |
| 301 | `packages/unifia/src/knowledge/` | 60+ TS modules | OK (488 tests) |
| 302 | `packages/unifia/bin/unifia-knowledge.ts` | CLI dispatcher | OK (50 subcommands) |
| 303 | `crates/unifia-knowledge-core/src/` | 8 Rust modules | OK (34 tests) |

## Obsidian recaps (cross-session memory)

| # | Path | Statut |
|---|---|---|
| 400 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\Session-Recap-Sovereign-Knowledge-Core-2-2026-08-29.md` | OK |
| 401 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\Session-Recap-Sovereign-Knowledge-Core-3-2026-08-29.md` | OK |
| 402 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\Session-Recap-Sovereign-Knowledge-Core-4-2026-08-29.md` | OK |
| 403 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\Session-Recap-Sovereign-Knowledge-Core-5-2026-08-29.md` | OK |
| 404 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\Session-Recap-Sovereign-Knowledge-Core-6-2026-08-29.md` | OK |
| 405 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\Session-Recap-Sovereign-Knowledge-Core-7-2026-08-29.md` | OK |
| 406 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\Session-Recap-Sovereign-Knowledge-Core-8-2026-08-29.md` | OK |
| 407 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\Session-Recap-Sovereign-Knowledge-Core-12-2026-08-29.md` | OK |
| 408 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\Session-Recap-Sovereign-Knowledge-Core-13-2026-08-29.md` | OK |
