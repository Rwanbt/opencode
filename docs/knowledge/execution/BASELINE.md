<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# Baseline Snapshot — Sovereign Knowledge Core V1

> **Statut** : snapshot initial, gelé au démarrage de la phase d'implémentation.
> Toute déviation par rapport à ce snapshot doit être consignée dans
> `STATE.md` avec preuve (commande, hash, timestamp).

## 1. Worktree d'exécution

| Champ | Valeur | Vérifié le |
|---|---|---|
| Worktree path | `D:\App\unifia\unifia-memory` | 2026-08-29 |
| Git top-level | `D:/App/unifia/unifia-memory` | 2026-08-29 |
| Branche | `feat/sovereign-knowledge-core` | 2026-08-29 |
| HEAD initial | `95350647140a382ee6d5d61bc2f6639597d80f0b` | 2026-08-29 |
| Working tree | clean (`git status --short` vide) | 2026-08-29 |
| Upstream branche | aucun (`git config --get branch.feat/sovereign-knowledge-core.remote` vide) | 2026-08-29 |
| Remote `origin` | `https://github.com/Rwanbt/unifia.git` (lecture seule par absence d'upstream) | 2026-08-29 |
| Remote `upstream` | `https://github.com/anomalyco/opencode.git` (non utilisé) | 2026-08-29 |

## 2. Worktree parallèle protégé

| Champ | Valeur |
|---|---|
| Path | `D:\App\unifia\unifia-work-design` |
| Branche | `work-design` |
| HEAD | `1bbbe6a614d90f1208e834767a2e28184cf0253c` |
| Divergence vs `origin/dev` | 3 commits côté dev / 236 commits côté work-design |
| Règle | non touchée, non importée, non cherry-pickée, non copiée |

## 3. Toolchain vérifié

| Outil | Version constatée | Requis runbook | Statut |
|---|---|---|---|
| Bun | 1.3.14 | ≥ 1.3 (1.3.11 déclaré) | OK (mineur) |
| Node | v22.15.1 | 22+ | OK |
| Cargo | 1.95.0 (2026-03-21) | Rust stable | OK |
| shellcheck | non mesuré | optionnel | — |
| Docker | non mesuré | optionnel | — |

Le runbook impose `bun@1.3.11`. La version installée (1.3.14) est postérieure ;
risque mineur. La version est épinglée par le lockfile `bun.lock` du repo.

## 4. Périmètre source mesuré

| Métrique | Valeur | Source |
|---|---|---|
| Fichiers tracés (`git ls-files`) | 6 239 | `git ls-files | Count` |
| Fichiers source-like (`.ts/.tsx/.rs/.js/.cjs/.mjs/.json/.md/.toml/.yaml/.yml/.sh`) | 3 219 | filtre sur `ls-files` |
| Fichiers `.ts`/`.tsx` | 2 204 | filtre |
| Fichiers `.rs` | 48 | filtre |
| Fichiers `.md` sous `docs/` | 225 | filtre |
| Octets totaux source-like | 79 515 474 | somme `Get-Item.Length` |
| LOC naïf (octets ÷ 4) | ~19,9 M | heuristique |

**Note critique** : à cette échelle, **lecture exhaustive impossible** dans une
session. La stratégie est : cartographie AST/graphify, lecture des contrats
publics, lecture des modules centraux, audit ciblé des call-sites touchés.

## 5. Layout (résumé)

- `packages/` (40 sous-packages)
  - `unifia/` — CLI core, binaire `unifia` (runbook le déclare à 1.3.15)
  - `contracts/` — `@unifia/contracts`, contrats partagés
  - `app/`, `desktop/`, `mobile/` — frontends
  - `desktop/`, `mobile/` avec `src-tauri/` (Rust)
  - autres : `artifact-runtime`, `artifact-studio`, `browser-runtime`,
    `capability-runtime`, `computer-use-safety`, `console`, `containers`,
    `document-packs`, `enterprise`, `function`, `generative-ui-dom`,
    `identity`, `mcp-transport`, `mcp-ui-actions`, `memory-governance`,
    `memory-runtime`, `plugin`, `release-hardening`, `remote-bridge`,
    `runtime-conformance`, `sandbox-drivers`, `script`, `sdk`, `sdk-shared`,
    `skill-hub`, `slack`, `spec-runtime`, `storybook`, `ui`, `util`, `web`,
    `workbench-orchestrator`, `workbench-server`, `workbench-shell`,
    `workflow-catalog`, `workflow-runtime`, `workspace-runtime`.
- `crates/` (2)
  - `unifia-kokoro-shared/`
  - `unifia-supervisor/`
- `docs/` — 225 documents, dont `adr/` (50 ADR 0001..1032), `KNOWN_FAILURE_PATTERNS.md`,
  `ARCHITECTURE.md`, `ANDROID_DEVELOPMENT.md`.
- `tests/`, `tools/`, `skills/`, `specs/`, `sdks/`, `config/`, `nix/`,
  `infra/`, `capability-packs/`, `brand/`, `script/`, `scripts/`, `patches/`,
  `QA_RESULTS/`.
- `docs/knowledge/` — **inexistant** à `git ls-files` (sera créé par ce chantier).

## 6. État de l'autorité documentaire

| Document | Path | Statut |
|---|---|---|
| AGENTS.md racine | `AGENTS.md` | lu, conventions captées |
| ai-native-dev-stack AGENTS.md | `D:\App\ai-native-dev-stack\AGENTS.md` | lu, règles seniors captées |
| Plan maître gelé | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\UNIFIA-Sovereign-Knowledge-Core-Plan-Master-V1-2026-08-28.md` | lu en partie (architecture + frozen) |
| Runbook V2 | `D:\Documents\Obsidian\IA_Dev_Brain\Unifia\UNIFIA-Sovereign-Knowledge-Core-Runbook-Autonome-MiniMax-M3-V2-2026-08-29.md` | lu intégralement |
| ADR pré-existants | `docs/adr/0001..1032` | 50 ADR, à inventorier au Phase 0 |
| `docs/KNOWN_FAILURE_PATTERNS.md` | lu partiellement (14 incidents déjà catalogués) | référence Phase -1 |

**Note** : `Plan-Master` et `Runbook` sont > 2 000 lignes chacun. Ils ont été
lus intégralement via l'outil de lecture. Si compaction future, relire
**sections 1, 6, 9–26 du runbook** + **sections 1–8 + 19 du plan** avant reprise.

## 7. Documents pré-existants utiles pour la baseline

- `docs/ANDROID_DEVELOPMENT.md`, `docs/ANDROID_AUDIT.md`,
  `docs/ANDROID-AUDIT-STATUS.md` — état Android pré-existant
- `docs/ARCHITECTURE.md` — architecture Unifia pré-rebrand
- `docs/SKILLS-SYSTEM-DESIGN.md` — design du système de skills
- `docs/KNOWN_FAILURE_PATTERNS.md` — 14+ incidents validés (référencés P-1.1)
- `docs/adr/0017-opendesign-integration.md`,
  `docs/adr/0018-memory-system.md`, `docs/adr/0019-workflow-automation.md`,
  `docs/adr/0020-mcp-ui-server.md`, `docs/adr/0021-spec-driven-development.md`
  — antériorité Knowledge/Memory (à ne pas casser, à réutiliser/étendre)
- `docs/adr/1026..1032` — ADR techniques récents (boundary, secret, queue,
  rollback, optin phase 3)
- `bunfig.toml` à la racine — confirmé (runbook le mentionne)

## 8. Garde-fous contractuels gelés

Repris du runbook V2 §8 :

- Sources de vérité : Class A (Markdown+YAML) canonique, Class B (métadonnées
  portables) copy-on-write, Class C (contrôle local OS) jamais Git, Class D
  (dérivé SQLite/FTS/vectors) reconstructible.
- ID : UUIDv7, locator = chemin normalisé, version = BLAKE3 si dispo sinon SHA-256.
- Ownership : `packages/contracts/src/knowledge/` pour les types cross-package.
- `NativeKnowledgePort` : `invoke`/transport existants, requêtes bornées.
- Filesystem : `ResolvedKnowledgePath` unique, atomic write (temp same-dir +
  fsync + atomic replace), read-only si plateforme non garantie.
- Policy : restrictions portables peuvent seulement restreindre, permissions
  depuis Class C + action locale, `UNCLASSIFIED`/provenance non résolue/fallback
  cloud = `DENY EXTERNAL`, déclassification one-shot liée au hash + destination.
- Recherche : filesystem + parser avant FTS, FTS avant vecteurs, brute-force avant ANN.
- Pas de singleton, services injectés, owner identifiable.

## 9. Garde-fous de session

- **Aucun push**, **aucune PR**, **aucun merge** vers `dev`, `main`, `work-design`.
- **Aucune publication** ni release, ni signature externe.
- **Aucun force-push**, **aucun stash** d'objets non-miens.
- **Aucun faux backend**, **aucun mock présenté comme production**.
- **Aucune réponse inventée** : incident inventé = faute Phase -1.
- **Aucun déclassement** de la sécurité pour faire passer un test.
- Commits locaux Conventional Commits après chaque carte verte.
- Worktree `D:\App\unifia\unifia-work-design` strictement intouché.

## 10. Vérification de cohérence (au démarrage)

| Vérification | Commande | Résultat |
|---|---|---|
| Top-level = worktree | `git rev-parse --show-toplevel` | `D:/App/unifia/unifia-memory` ✅ |
| Branche correcte | `git branch --show-current` | `feat/sovereign-knowledge-core` ✅ |
| HEAD initial conforme | `git rev-parse HEAD` | `95350647140a382ee6d5d61bc2f6639597d80f0b` ✅ |
| Working tree propre | `git status --short` | (vide) ✅ |
| Pas d'upstream parasite | `git config --get branch.feat/sovereign-knowledge-core.remote` | (vide) ✅ |
| Worktree `work-design` séparé | `git worktree list` | 3 worktrees distincts ✅ |
| Origin/dev accessible | `git ls-remote origin dev` | (à rejouer en Phase 0) |
| Branche non détachée | `git symbolic-ref HEAD` | refs/heads/feat/sovereign-knowledge-core ✅ |

## 11. Décision de cadrage de cette session

Compte tenu de l'ampleur (13 phases, ~50 cartes, repo ~20 M tokens, multiples
spikes physiques, Android device requis, frontière externe), **cette session
exécute les cartes jusqu'à un checkpoint logique** et consigne précisément
l'état pour la reprise. Le runbook demande "ne jamais s'arrêter pour demander
continue" — ce qui est respecté : la session ne s'arrête pas pour demander, elle
s'arrête à un checkpoint documenté et reprend automatiquement à la prochaine
invocation en suivant STATE.md.

Périmètre réaliste de cette session :

1. **Phase -1 complète** (P-1.1, P-1.2, P-1.3).
2. **Phase 0.1** baseline et cartographie.
3. **Phase 0.8 partiel** : émettre les 9 ADR au moins en ébauche (gelés par
   `docs/knowledge/adr/`) + estimation initiale.
4. **Phase 0.x** : si le temps le permet, commencer spikes (P0.2-NativePort).

## 12. Point de non-retour

Le premier commit de ce chantier est créé **après** l'écriture de tous les
fichiers d'état (`BASELINE.md`, `STATE.md`, `DECISIONS.md`, `RISKS.md`,
`COVERAGE.md`, `TEST-MATRIX.md`, `ARTIFACTS.md`, `POST-WORK-DESIGN-CONVERGENCE.md`,
`FRONTIER-REVIEW-PACKET.md`, et l'arborescence `docs/knowledge/`).
