<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# MODULE-MAP — Cartographie des composants pré-existants vs Knowledge Core V1

> Cartographie P0.1 (runbook §10 P0.1). Pour chaque composant
> pré-existant : statut (**REUSE** / **ADAPT** / **REPLACE** / **DEPRECATE**)
> + 3 call sites réels + justification. Cette cartographie n'est pas un
> plan d'attaque ; elle sert à ne pas dupliquer ce qui existe et à ne
> pas casser ce qui marche.

> **Date** : 2026-08-29.
> **Sources** : `docs/ARCHITECTURE.md`, `docs/adr/0017..0021`, `docs/adr/1026..1032`,
> `docs/KNOWN_ISSUES.md`, `docs/KNOWN_FAILURE_PATTERNS.md`, lecture
> partielle de `packages/unifia/src/`, `packages/contracts/`,
> `packages/memory-{governance,runtime}/`, `packages/{desktop,mobile}/src-tauri/`.

---

## Légende

| Statut | Sens |
|---|---|
| **REUSE** | le composant est gardé tel quel ; le Knowledge Core s'y branche |
| **ADAPT** | petites modifications non-rupturistes, double-export éventuel |
| **REPLACE** | nouvelle implémentation, l'ancienne est supprimée en V1 |
| **DEPRECATE** | l'ancienne API reste pour V1 mais est marquée `@deprecated` ; plan de suppression V2 |

---

## 1. Project — `packages/unifia/src/project/`

- **Statut** : **ADAPT**
- **Pourquoi** : `Project` est la notion d'unité de travail dans
  Unifia. Le Knowledge Core V1 a besoin d'un *Project Space*
  (runbook §15). Plutôt que d'inventer un second type, le Project
  existant devient la racine du `Project Space`. Aucune rupture.
- **Call sites existants** :
  - `packages/unifia/src/cli/cmd/project.ts` (probable — non vérifié exhaustivement)
  - `packages/unifia/src/server/server.ts` (route `/project`)
  - `packages/app/src/pages/layout/project-switcher.tsx` (UI)
- **Adaptation prévue** : ajouter un champ optionnel
  `project.knowledgeRef` qui pointe vers la racine du Project Space
  dans le vault personnel ; ne pas casser `Project` lui-même.

## 2. Session — `packages/unifia/src/session/`

- **Statut** : **ADAPT**
- **Pourquoi** : la Session runtime reste la session runtime. Le
  Knowledge Core V1 a besoin d'un *Session Space* (runbook §16) qui
  s'attache à une session runtime. Le Session Store existant est
  compatible (stocke messages, parts).
- **Call sites existants** :
  - `packages/unifia/src/session/session.ts` (storage messages + events)
  - `packages/unifia/src/session/processor.ts` (boucle, tool calls)
  - `packages/unifia/src/server/server.ts` (route `/session/:id/stream`)
- **Adaptation prévue** : brancher `KnowledgeService` au démarrage de
  Session pour exposer un *ContextRouter* ; aucune modification
  publique des types `Message` / `Part`.

## 3. Storage — `packages/unifia/src/storage/`

- **Statut** : **REUSE** + **ADAPT**
- **Pourquoi** : ADR 1030 ("Migration, rollback et dérive SDK") acte
  déjà que la DB canonique est Drizzle/Bun SQLite avec migrations
  timestampées. Le Knowledge Core V1 **doit** réutiliser ce pipeline
  pour ses propres tables, sans inventer une seconde base.
- **Call sites existants** :
  - `packages/unifia/src/storage/db.ts` (Drizzle)
  - `packages/unifia/src/storage/db.bun.ts` (Bun)
  - `packages/unifia/src/storage/db.node.ts` (Node)
  - `packages/unifia/src/storage/json-migration.ts` (JsonMigration)
  - `packages/unifia/src/storage/schema.sql.ts` (schéma global)
- **Adaptation prévue** : nouvelles tables versionnées
  `knowledge_*` ajoutées via une nouvelle migration timestampée.
  L'ADR 1030 garantit le pattern : "première migration additive,
  aucune modification destructive".

## 4. Tools — `packages/unifia/src/tool/`

- **Statut** : **ADAPT**
- **Pourquoi** : les tools existants (`bash.ts`, `read.ts`, `write.ts`,
  `edit.ts`, `glob.ts`, `grep.ts`, etc.) sont la surface d'action.
  Le Knowledge Core V1 doit leur appliquer le même
  `AgentDataFlowGuard` que les autres I/O (runbook §8.6).
- **Call sites existants** :
  - `packages/unifia/src/tool/bash.ts` (déjà patché pour Gemma-4
    schema, voir PC-02)
  - `packages/unifia/src/tool/read.ts`
  - `packages/unifia/src/tool/write.ts` (atomic write)
  - `packages/unifia/src/tool/edit.ts`
- **Adaptation prévue** : chaque tool déclare son
  `DataClassification` (input / output) ; le guard refuse les
  écritures non classifiées. Le contrat est ADAPT, pas REPLACE.

## 5. Filesystem — `packages/unifia/src/filesystem/`

- **Statut** : **ADAPT**
- **Pourquoi** : il existe déjà des primitives filesystem Unifia
  (`path`, `read`, `write`, `ignore`). Le Knowledge Core a besoin
  d'une primitive `ResolvedKnowledgePath` unique (runbook §13.2
  Phase 2). Plutôt que d'écrire un second module, on ADAPT
  `filesystem/` pour exposer le résolveur canonique.
- **Call sites existants** :
  - `packages/unifia/src/filesystem/path.ts`
  - `packages/unifia/src/filesystem/ignore.ts`
  - `packages/unifia/src/filesystem/watch.ts` (probable chokidar wrapper)
- **Adaptation prévue** : ajout d'une fonction
  `resolveKnowledgePath(cwd, target)` qui implémente la matrice
  symlink / junction / UNC / casse / Unicode du runbook §8.5. Tests
  dans `packages/unifia/test/filesystem/path.test.ts` étendu.

## 6. Git — `packages/unifia/src/git/`

- **Statut** : **ADAPT**
- **Pourquoi** : il existe déjà `project/vcs.ts` (Vcs.Event.BranchBehind)
  et probablement `git/` (à vérifier). Le Knowledge Core Phase 8
  réutilise ce sous-système, sans réinventer la wheel.
- **Call sites existants** :
  - `packages/unifia/src/project/vcs.ts` (probe upstream 5 min)
  - `packages/unifia/src/git/` (probable provider isomorphique)
  - `packages/unifia/src/cli/cmd/git.ts` (si présent)
- **Adaptation prévue** : `KnowledgeGitProvider` *wrap* le provider
  Git existant pour ajouter : pre-push scan secret, scan plage
  sortante, hooks policy, worktree management. Aucune duplication
  des primitives `git fetch` / `git log`.

## 7. MCP — `packages/unifia/src/mcp/`

- **Statut** : **ADAPT**
- **Pourquoi** : MCP est déjà supporté (cf. ADR 0020 + dépendance
  `@modelcontextprotocol/sdk`). Le Knowledge Core expose
  `knowledge_*` via MCP, en réutilisant le serveur MCP existant
  comme transport. Lecture par défaut, écriture désactivée si pas
  de secure storage.
- **Call sites existants** :
  - `packages/unifia/src/mcp/` (server MCP)
  - `packages/unifia/src/cli/cmd/mcp.ts` (commande `mcp add`)
  - `packages/unifia/src/server/server.ts` (route MCP)
- **Adaptation prévue** : nouvelles capabilities
  `knowledge_search`, `knowledge_get`, `knowledge_backlinks`,
  `knowledge_trace`, `knowledge_status`, `knowledge_propose`
  (runbook §19 Phase 9) enregistrées via le registre MCP existant.

## 8. Providers / fallback — `packages/unifia/src/provider/`

- **Statut** : **REUSE**
- **Pourquoi** : 20+ providers bundlés (Anthropic, OpenAI, Google,
  etc.) + pseudo-provider `local-llm` + `models-snapshot.js`. Le
  Knowledge Core V1 n'a pas besoin d'un second provider system ; il
  utilise le plan de destination existant via
  `ProviderDestinationPlan` (runbook §36).
- **Call sites existants** :
  - `packages/unifia/src/provider/transform.ts`
  - `packages/unifia/src/provider/provider.ts`
  - `packages/unifia/src/cli/cmd/models.ts`
- **Adaptation prévue** : aucune. Le `ContextPack.items[]` porte un
  `ProviderDestination` que les providers existants consomment.

## 9. Event bus — `packages/unifia/src/bus/`

- **Statut** : **REUSE**
- **Pourquoi** : `createEventBus` (solid-primitives) déjà en place.
  Le Knowledge Core émet des événements domain (`file.changed`,
  `decision.created`, etc.) via ce bus.
- **Call sites existants** :
  - `packages/unifia/src/bus/index.ts`
  - `packages/app/src/context/notification.tsx` (consumer desktop + mobile)
  - `packages/unifia/src/session/session.ts` (publisher)
- **Adaptation prévue** : aucune. Le Knowledge Core utilise le bus
  existant pour publier, sans créer un second canal.

## 10. Work — (mode Shell Unifia §7, ADR Plan V3)

- **Statut** : **REUSE via adaptateur**
- **Pourquoi** : le mode Work est l'un des trois modes canoniques
  (Code / Work / Design). Le Knowledge Core V1 n'implémente pas Work
  — il expose une surface *read* du même `KnowledgeService` que
  Code et Design.
- **Call sites existants** :
  - `packages/app/src/pages/work/*` (UI)
  - `packages/app/src/components/work/*` (composants)
- **Adaptation prévue** : un adaptateur côté `packages/unifia/src/knowledge/source/work.ts`
  expose la même interface que `personal.ts` / `project.ts` /
  `external.ts`. Pas d'import des fichiers UI dans le coeur
  Knowledge.

## 11. Design — ADR 0017 (OpenDesign) + ADR 0021 (Spec-Driven)

- **Statut** : **REUSE via adaptateur**
- **Pourquoi** : le mode Design a déjà un `OpenDesignPort` (ADR
  0017) et un `SpecDriven` (ADR 0021). Le Knowledge Core V1
  consomme le `Spec` produit par Design et le stocke comme
  `unifia_type: decision` ou `unifia_type: reference` dans le
  Project Space.
- **Call sites existants** :
  - `packages/unifia/src/spec/` (probable)
  - `packages/app/src/pages/design/*` (UI)
- **Adaptation prévue** : un adaptateur
  `packages/unifia/src/knowledge/source/design.ts` mappe
  `Spec` → `KnowledgeRef` et `Decision` → `KnowledgeRef`. Pas
  d'import de OpenDesignPort dans le coeur Knowledge : on dépend
  uniquement des types de `@unifia/contracts/knowledge/`.

## 12. Tauri desktop — `packages/desktop/src-tauri/`

- **Statut** : **REUSE**
- **Pourquoi** : `tls.rs`, `server.rs`, `speech.rs` déjà en place.
  Le Knowledge Core V1 est appelé depuis le sidecar via le port
  HTTP existant.
- **Call sites existants** :
  - `packages/desktop/src-tauri/src/server.rs` (lance le sidecar)
  - `packages/desktop/src-tauri/src/cli.rs` (gestion des env, point
    critique S2.S1)
  - `packages/desktop/src-tauri/src/tls.rs` (cert self-signed)
- **Adaptation prévue** : aucune modification Rust. Le Knowledge
  Core tourne dans le sidecar TS.

## 13. Tauri mobile — `packages/mobile/src-tauri/`

- **Statut** : **REUSE**
- **Pourquoi** : `lib.rs`, `llm.rs`, `speech.rs`, `kokoro/`,
  `runtime.rs`, `proxy.rs` (avec `AtomicU16` cf. B.A6) déjà en
  place. Le Knowledge Core V1 tourne en TS dans le WebView et
  appelle des commandes Tauri bornées côté Rust.
- **Call sites existants** :
  - `packages/mobile/src-tauri/src/lib.rs` (entry)
  - `packages/mobile/src-tauri/src/llm.rs` (déjà patché pour K-quants
    routing, PC-07)
  - `packages/mobile/src-tauri/src/runtime.rs` (chemins runtime)
- **Adaptation prévue** : nouvelles commandes Tauri bornées
  (`knowledge_*`) côté `packages/mobile/src-tauri/src/knowledge.rs`
  (à créer). Réutilise `proxy.rs` pour le port.

## 14. ONNX / llama — `packages/mobile/src/model-catalog.ts` + `crates/unifia-kokoro-shared/`

- **Statut** : **REUSE** + **ADAPT** (modèle d'embedding à sélectionner
  selon runbook §8.8)
- **Pourquoi** : Parakeet (STT), Kokoro (TTS), llama.cpp (LLM) déjà
  en place. Le Knowledge Core Phase 5 ajoute un modèle
  d'embedding ONNX, sélectionnable selon les critères du runbook
  (qualité holdout 50 %, latency 20 %, peak RAM 15 %, taille 10 %,
  simplicité 5 %).
- **Call sites existants** :
  - `packages/mobile/src/model-catalog.ts` (catalogue)
  - `packages/mobile/src-tauri/src/kokoro/` (ONNX runtime)
  - `packages/mobile/src-tauri/src/speech.rs` (Parakeet)
  - `crates/unifia-kokoro-shared/` (bindings Kokoro)
- **Adaptation prévue** : un `EmbeddingProvider` TS est ajouté à
  côté du catalogue ; l'ONNX embedding runtime est en Rust (nouveau
  module `crates/unifia-knowledge-core/src/embedding/`).

## 15. ai-native-dev-stack — `D:\App\ai-native-dev-stack\`

- **Statut** : **REUSE** (méthodologie) + **REUSE** (cartographie)
- **Pourquoi** : la stack elle-même est la méthodologie (AGENTS.md,
  ADR, Graphify, hooks, memory, verify-ai-docs, verify-standards).
  Le Knowledge Core Phase 6 mappe ces sources vers Knowledge Spaces
  sans augmenter leur autorité.
- **Call sites existants** :
  - `D:\App\ai-native-dev-stack\AGENTS.md` (autorité)
  - `D:\App\ai-native-dev-stack\docs/adr/` (ADR méthode)
  - `D:\App\ai-native-dev-stack\scripts/graphify.py` (cartographie)
  - `D:\App\ai-native-dev-stack\hooks/` (hooks)
- **Adaptation prévue** : Phase 6 produit le mapping sans
  modification de la stack elle-même. Aucun fichier de la stack
  n'est importé dans le repo Unifia.

## 16. memory-governance + memory-runtime — `packages/memory-{governance,runtime}/`

- **Statut** : **ADAPT** (à vérifier dans Phase 0 par lecture du code)
- **Pourquoi** : ADR 0018 propose un `MemorySystem` avec
  `session()` et `longTerm()`. Le Knowledge Core V1 a un
  positionnement différent (cf. plan gelé §11 "Quatre classes
  d'état") : Class A est canonique Markdown, alors que ADR 0018
  parle de working + long-term "memory". Le Knowledge Core
  consomme le *résultat* de `MemorySystem.longTerm()` (notes
  candidates) et le stocke en Markdown.
- **Call sites existants** : à confirmer par lecture du code de
  `packages/memory-governance/src/` et `packages/memory-runtime/src/`.
- **Adaptation prévue** : si `memory-governance` est déjà implémenté
  (au moins partiellement), le Knowledge Core l'utilise comme
  *candidat source* vers la promotion Markdown. Sinon, on implémente
  le Knowledge Core d'abord et `memory-governance` se branche
  dessus en V1.1+.
- **Note d'incertitude** : ces deux packages ont des `package.json`
  minimaux (`name` + `version`) et un seul fichier
  `src/index.ts`. Lecture détaillée reportée à une carte ultérieure.

## 17. Contracts — `packages/contracts/`

- **Statut** : **ADAPT** (presque vide, à enrichir)
- **Pourquoi** : `@unifia/contracts` v0.1.0 ne contient que
  `typescript` + `vitest` en devDeps. Le plan gelé §19 et le runbook
  §8.3 imposent que les types cross-package vivent ici.
- **Call sites existants** :
  - `packages/contracts/src/` (à inspecter — pas lu exhaustivement)
  - `packages/contracts/test/` (idem)
- **Adaptation prévue** : créer `packages/contracts/src/knowledge/`
  avec les types du plan gelé : `KnowledgeRef`, `KnowledgeSpace`,
  `PortableRestrictions`, `RetrievalCandidate`, `MutationIntent`,
  `ContextCandidate`, `ContextDiagnostics`, et les contrats MCP
  knowledge. Phase 1.

---

## Synthèse

| Composant | Statut dominant | Risque |
|---|---|---|
| Project, Session, storage, providers, bus, Tauri desktop/mobile, ai-native-dev-stack | **REUSE** | Faible — pattern d'extension sans rupture |
| Tools, filesystem, git, MCP, Work, Design, ONNX/llama, memory-governance, contracts | **ADAPT** | Moyen — extensions additives, double-export éventuel |
| Aucun composant marqué **REPLACE** ou **DEPRECATE** à ce stade | — | — |

**Aucun composant n'est en REPLACE**, ce qui valide la North Star
Rule du plan gelé §2 : "Sans dette technique volontaire pour
terminer plus vite". Les seuls remplacements éventuels sont les
nouveaux modules Knowledge (Rust + TS) qui sont *ajoutés*, pas des
remplacements.

## Suites à exécuter

1. Phase 0.8 (ADR Knowledge) : figer ces décisions dans
   `docs/knowledge/adr/0001..0009-knowledge-*.md`.
2. Phase 1 : `packages/contracts/src/knowledge/` (KnowledgeRef,
   KnowledgeSpace, restrictions, etc.) sans casser les exports
   actuels.
3. Phase 1.2 : adaptateurs Knowledge pour Project, Session,
   Personal, External.
4. Phase 6 : mapping vers ai-native-dev-stack sans importer.
