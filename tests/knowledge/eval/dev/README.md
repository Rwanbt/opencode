<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# Golden Dataset — DEV

> Fixtures pour l'évaluation en développement. Ces fixtures sont
> **utilisées pour régler** les poids du retrieval, fusion, ranking.
> Elles ne sont **pas** mélangées avec `holdout/`.

## Structure

Chaque fixture est un fichier `.md` qui :

1. a un frontmatter `unifia_schema: 1` ;
2. un `unifia_id` unique (UUIDv7 simulé) ;
3. un `unifia_type` (decision / constraint / failure / preference /
   learning / procedure / reference / semantic / episodic) ;
4. un `unifia_lifecycle` (candidate / active / superseded / archived) ;
5. un corps Markdown avec frontmatter `unifia_restrictions` quand
   applicable.

## Cas

| Fichier | Type | Langue | Tags | Sujet |
|---|---|---|---|---|
| `decision-gemma4-bash.md` | decision | en | model:gemma-4, tool:bash | Patch schema `tool/bash.ts` |
| `failure-sidecar-stale.md` | failure | en | build:desktop, ts:recompile | Rebuild CLI après modif TS |
| `failure-adreno-kquants.md` | failure | en | device:adreno-6xx, quant:k-quants | K-quants → CPU only |
| `constraint-rag-lru.md` | constraint | en | cache:lru, ttl:30min | LRU 64/30min pour index dirs |
| `constraint-alpine-selinux.md` | constraint | en | device:android, selinux, link | `fix_hardlinks.py` avant build |
| `decision-thinking-budget.md` | decision | en | model:qwen, model:deepseek, reasoning | Cap 8192 pour thinking |
| `episodic-rust-static-mut.md` | episodic | en | lang:rust, concurrency | `static mut` → `AtomicU16` |
| `reference-decision-bash-fr.md` | decision | fr | tool:bash, patch | Patch `tool/bash.ts` (version FR) |
| `semantic-fr-context.md` | semantic | fr | embedding, context | Test embedding FR |
| `superseded-old-budget.md` | superseded | en | reasoning:budget | Ancien cap 1024 (avant A.2) |

> Le contenu réel est généré au moment de la première exécution
> P-1.2 dans la session. Les fichiers `.md` minimum sont créés ici
> avec un placeholder de structure.
