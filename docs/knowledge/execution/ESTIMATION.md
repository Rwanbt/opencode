<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# ESTIMATION — Sovereign Knowledge Core V1

> Estimation par carte des phases 1 à 11, en **jours-homme**
> (JH). Échelle : XS = 0.25, S = 0.5, M = 1, L = 2, XL = 4+.
> Multiplicateur plateforme : Android × 1.5, iOS × 2.0, desktop
> Windows/Linux/macOS × 1.0.

> La North Star Rule du plan gelé §2 reste l'arbitre final : si le
> scope d'une carte dépasse 4 JH, on scinde en sous-cartes ou on
> retire la capability du V1.

## Légende

- **Valeur** : criticité V1 (C = critique, I = importante, N = nice).
- **Risque** : probabilité d'un blocker
  (L = Low, M = Medium, H = High).
- **Multiplicateur** : effet plateforme dominante.

## Phase -1 (prouver le besoin)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P-1.1 | Corpus de cas réels | C | S (0.5 JH) | L | 1.0 |
| P-1.2 | Golden dataset dev/holdout | C | S (0.5 JH) | L | 1.0 |
| P-1.3 | Definition of Done | C | S (0.5 JH) | L | 1.0 |

## Phase 0 (geler la réalité)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P0.1 | Baseline + cartographie | C | M (1 JH) | L | 1.0 |
| P0.2 | Spike NativeKnowledgePort | C | M (1 JH) | M | 1.0 (Android 1.5) |
| P0.3 | Spike filesystem | C | L (2 JH) | M | 1.5 (matrix plateforme) |
| P0.4 | Spike sandbox | C | M (1 JH) | M | 1.0 |
| P0.5 | Spike SQLite/FTS | C | M (1 JH) | L | 1.5 (Android) |
| P0.6 | Spike embeddings Android | I | L (2 JH) | H | 2.0 (Android device) |
| P0.7 | Spike Git | C | M (1 JH) | L | 1.0 |
| P0.8 | ADRs + estimation | C | S (0.5 JH) | L | 1.0 |

## Phase 1 (ContextRouter baseline)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P1.1 | Contrats `@unifia/contracts/knowledge/` + domain | C | M (1 JH) | L | 1.0 |
| P1.2 | Sources + parser (Personal, Project, Session, External) | C | L (2 JH) | M | 1.0 |
| P1.3 | ContextRouter | C | L (2 JH) | M | 1.0 |
| P1.4 | Context Inspector + DataFlow baseline | C | M (1 JH) | M | 1.0 |

## Phase 2 (Native Knowledge Foundation)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P2.1 | Crate Rust + transport | C | L (2 JH) | M | 1.5 (Android build) |
| P2.2 | Paths + watcher | C | M (1 JH) | M | 1.0 |
| P2.3 | Mutation WAL | C | L (2 JH) | M | 1.0 |
| P2.4 | Class B + GC | C | M (1 JH) | M | 1.0 |
| P2.5 | ControlStore (Class C) | C | L (2 JH) | M | 1.0 |

## Phase 3 (FTS et graph)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P3.1 | Schéma dérivé (Drizzle) | C | M (1 JH) | L | 1.0 |
| P3.2 | FTS5, liens, rebuild | C | L (2 JH) | M | 1.0 |
| P3.3 | Doctor | C | M (1 JH) | L | 1.0 |

## Phase 4 (Lifecycle)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P4.1 | États + provenance | C | M (1 JH) | L | 1.0 |
| P4.2 | Promotion + supersession | C | M (1 JH) | M | 1.0 |
| P4.3 | Inbox | I | S (0.5 JH) | L | 1.0 |

## Phase 5 (sémantique)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P5.1 | Chunking + embeddings | I | L (2 JH) | H | 2.0 (Android) |
| P5.2 | VectorIndex + fusion | I | L (2 JH) | H | 1.5 (Android) |
| P5.3 | Benchmark | I | M (1 JH) | M | 1.0 |

**Sortie possible** : `disabled` si aucun modèle ONNX admissible
(runbook §8.8).

## Phase 6 (ai-native-dev-stack)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P6.1 | Mapping vers AGENTS.md / AI_CONTEXT / etc. | C | M (1 JH) | L | 1.0 |
| P6.2 | Domain events (session.started, etc.) | C | M (1 JH) | L | 1.0 |

## Phase 7 (Code / Work / Design)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P7.1 | Façade commune (KnowledgeService) | C | L (2 JH) | M | 1.0 |
| P7.2 | E2E cross-mode | C | L (2 JH) | M | 1.0 (Android 1.5) |

## Phase 8 (Git)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P8 | GitProvider, pre-push scan, worktrees | C | L (2 JH) | M | 1.0 |

## Phase 9 (MCP)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P9 | 6 capabilities MCP, token, quotas, rate limit | C | L (2 JH) | M | 1.0 |

## Phase 10 (Android)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P10.1 | Storage matrix | C | M (1 JH) | M | 2.0 (Android device) |
| P10.2 | Chaîne réelle | C | L (2 JH) | H | 2.0 (Android device) |
| P10.3 | Pression ressources | I | M (1 JH) | H | 2.0 (Android device) |

## Phase 11 (hardening)

| Carte | Description | Valeur | Estimation | Risque | Multiplicateur |
|---|---|---|---|---|---|
| P11 | Fuzz, crash matrix, recovery, SBOM, RC | C | XL (4 JH) | H | 1.5 |

---

## Total

Somme des estimations phases 1 à 11 (sans Phase -1 et Phase 0) :

- XS : 1 × 0.25 = 0.25 JH
- S : 5 × 0.5 = 2.5 JH
- M : 18 × 1 = 18 JH
- L : 13 × 2 = 26 JH
- XL : 1 × 4 = 4 JH

**Total hors phase -1 et 0** : 0.25 + 2.5 + 18 + 26 + 4 = **~50.75 JH**.

Avec les multiplicateurs Android concentrés sur les phases
5, 10, 11 (les plus exposées) :

- Phase 5 : (2 + 2 + 1) × 1.5 ≈ 7.5 JH
- Phase 10 : (1 + 2 + 1) × 2.0 = 8 JH
- Phase 11 : 4 × 1.5 = 6 JH

Soit un total réaliste **~60 à 70 JH** en intégrant les aléas.

## Hypothèses

- L'environnement de la session fournit Bun 1.3, Rust 1.95, Node 22.
- Aucun device Android n'est branché en session ; les phases 10 sont
  `NOT_EXECUTED_EXTERNAL_BOUNDARY` jusqu'à preuve device.
- Le téléchargement de modèles ONNX n'est pas autorisé par défaut ;
  la phase 5 sort en `disabled` sauf opt-in explicite.
- L'utilisateur ne demande pas de release, de push, ni de PR.

## Conclusion

L'implémentation complète V1 représente **~60 à 70 jours-homme**
de travail concentré, plus l'attente de l'artefact frontier review.
Cette session exécute le cadrage et la phase 0 ; la suite est
séquentielle et reprise automatique par lecture de STATE.md.
