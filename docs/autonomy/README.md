# Unifia Workbench V3 — Autonomy Documents

Documents d'auto-gouvernance de l'agent dans ce clone jetable. Tous les fichiers ici sont produits par Hermes (MiniMax-M3) et versionnés.

## Phase -2 — Audit licences et provenance

| Fichier | Statut | But |
|---|---|---|
| `LICENSE-AUDIT-UNIFIA.md` | `VERIFIED` | Audit MIT du fork, risques, exclusions |
| `THIRD-PARTY-NOTICES.md` | `DRAFT` | 269 deps NPM + Cargo, format automatisé cible |
| `UPSTREAM-PROVENANCE.md` | `VERIFIED` | Chaîne de provenance + modèles d'en-têtes |
| `UPSTREAM-SOURCES.lock.json` | `VERIFIED` | Verrouillage des sources candidates (JSON) |
| `ATTRIBUTION-TEMPLATE.md` | `TEMPLATE` | Modèle d'en-tête SPDX pour imports |

## Phase -1 — Audit comparatif 3 codebases

| Fichier | Statut | But |
|---|---|---|
| `TRI-REPO-ARCHITECTURE-INVENTORY.md` | `VERIFIED_LOCAL` | Métriques mesurées (5308/3364/596 fichiers) |
| `FEATURE-OWNERSHIP-MATRIX.md` | `VERIFIED_LOCAL` | 32 domaines → 5 autorités Unifia |
| `DUPLICATION-MATRIX.md` | `DRAFT` | 3 doublons forts + 15 faibles + 10 compléments |
| `PORTABILITY-ASSESSMENT.md` | `DRAFT` | 6 composants scorés (meilleur: OCW skills, score 9) |
| `SECURITY-GAP-MATRIX.md` | `DRAFT` | 6 gaps critiques + 6 combinaisons interdites |
| `IMPORT-CANDIDATES.md` | `DRAFT` | 4 ADOPT + 4 ADAPT + 1 REWRITE + 3 INSPIRER + 2 EXCLUDE |
| `DO-NOT-IMPORT.md` | `VERIFIED` | Verrous techniques à implémenter |

## Phase 0 — Rebrand, gouvernance, stratégie upstream

| Fichier | Statut | But |
|---|---|---|
| `reports/GATE-PHASE-0.md` | `VERIFIED` | Rapport de gate Phase 0 (7 cartes intégrées) |
| `TASK-GRAPH-v1.0.yaml` | `v1.0` | 22 cartes alignées Plan V3 + 3 i18n |
| `TASK-GRAPH-DRAFT.yaml` | `DEPRECATED` | v0.1 inventée, remplacée par v1.0 |

## Phase -1 / i18n utilisateur

| Fichier | Statut | But |
|---|---|---|
| `P-1-I18N-USER-SOURCE` (carte) | `BLOCKED_MISSING_SOURCE` | Inventaire traduction Open Cowork utilisateur |

## Gouvernance

| Fichier | Statut | But |
|---|---|---|
| `BASELINE.md` | `VERIFIED` | Identité du clone, verrous, environnement |
| `REPO-INVENTORY.md` | `VERIFIED_LOCAL` | Cartographie du fork |
| `UNIFIA-AUDIT-PACK.md` | `VERIFIED` | Audit du pack autonome v1.0 (note 8/10) |
| `PLAN-DIRECTEUR-V3.md` | `SNAPSHOT` | Plan V3 capturé depuis Obsidian (49 575 bytes) |
| `BLOCKED-DECISIONS.md` | `OPEN` | 8 décisions à trancher (BD-1 résolu) |
| `EXECUTION-LOG.jsonl` | `LIVE` | Journal append-only des événements |
| `README.md` | ce fichier | Index de navigation |

## Honnêteté épistémique (snapshot au 2026-07-31)

**Statut global :** `PHASE_0_REBRAND_VERIFIED`

- ✅ Clone jetable créé
- ✅ 3 verrous anti-push en place
- ✅ Baseline documentée
- ✅ Inventaire réel mesuré (5295 fichiers fork, 3364 OpenWork, 596 Open Cowork)
- ✅ Phase -2 audit licences : 5 livrables (LICENSE-AUDIT, NOTICES, PROVENANCE, SOURCES.lock, ATTRIBUTION-TEMPLATE)
- ✅ Phase -1 audit comparatif : 7 livrables (TRI-REPO, FEATURE-OWNERSHIP, DUPLICATION, PORTABILITY, SECURITY-GAP, IMPORT-CANDIDATES, DO-NOT-IMPORT)
- ✅ TASK-GRAPH v1.0 aligné Plan V3 (22 cartes, 3 i18n)
- ✅ Phase 0 rebrand : 7 cartes (C001-C007) intégrées dans `agent/integration`
- ✅ Gate Phase 0 : VERIFIED (cosmétique) — incomplet (manque GOVERNANCE.md, hooks pre-commit)
- ✅ 11 commits atomiques + 5 merges dans agent/integration
- ✅ Aucun commit de code applicatif
- ✅ Aucun push distant
- ⏸ **Phase 1+ :** cartes détaillées (harness CI, SBOM, verrous, contrats, sécurité) — faisables dans le conteneur
- ⏸ **i18n utilisateur :** `P-1-I18N-USER-SOURCE` BLOQUÉE en attente des fichiers
- ⏸ **BD-7/BD-8 :** URLs upstream validées Phase -1 ; BD-4 (Tauri certif) à confirmer utilisateur

## Prochaine étape (recommandation protocole)

1. Phase 1 : P1-C100 (harness multi-runtime), P1-C110 (SBOM), P1-C120 (verrous DO-NOT-IMPORT)
2. Phase 1 : P1-C010 (i18n 21 langues racine), P1-C011 (i18n desktop), P1-C020 (app/src), P1-C030 (provider)
3. Phase 2 : P2-C200 (contrats Unifia)
4. Phase 3 : P3-C300 (security foundation) — SECURITY-CRITICAL, plus de revue externe requise

Sauf violation de gate, le protocole demande de continuer.
