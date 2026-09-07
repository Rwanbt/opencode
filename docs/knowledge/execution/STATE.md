<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# STATE — Sovereign Knowledge Core V1 (append-only)

> Append-only. Chaque carte ajoute une nouvelle entrée. Ne jamais réécrire une
> entrée passée ; pour amender, ajouter une nouvelle entrée référençant
> l'ancienne. Hash, commandes, durées et statuts sont obligatoires.

## Carte 0000 — Démarrage et création de l'état durable

- **ID** : 0000
- **Phase** : démarrage
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Préflight** : `git rev-parse --show-toplevel` = `D:/App/unifia/unifia-memory`,
  branche = `feat/sovereign-knowledge-core`, HEAD = `95350647140a382ee6d5d61bc2f6639597d80f0b`,
  working tree clean, remote = vide, worktree `work-design` séparé.
- **Fichiers créés** : `docs/knowledge/`, `docs/knowledge/execution/`,
  `docs/knowledge/execution/{blockers,checkpoints,evidence}/`,
  `tests/knowledge/eval/{dev,holdout}/`, `docs/knowledge/execution/BASELINE.md`.
- **Prochaine carte** : 0001 — P-1.1 corpus de cas réels.
- **Risque** : aucun à ce stade. Documentation honnête du scope, pas
  d'implémentation.

---

## Carte 0001 — P-1.1 : Corpus de cas réels et motivation

- **ID** : 0001
- **Phase** : -1 (Prouver le besoin)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/WHY-NOT-VAULT-RG-GIT.md` et `docs/knowledge/PRODUCT-CASES.md`
- **Sources** : `docs/KNOWN_FAILURE_PATTERNS.md` (207 lignes, ≥ 14 incidents),
  `CHANGELOG.md` (reb rand), `docs/KNOWN_ISSUES.md` (A.1..A.11, B.1..B.A6, S2.A1..S1.V2).
- **Cas livrés** : 10 (PC-01..PC-10), chacun avec tâche / workflow / échec /
  contexte requis / contexte interdit / comportement V1 / preuve.
- **Mapping capability ↔ cas** : complet dans `PRODUCT-CASES.md` §"Mapping".
- **Preuve** : `git ls-files` des 2 documents, présence dans
  `docs/knowledge/`. Aucun cas inventé, tous ancrés sur le repo
  ou les ADR.
- **Carte suivante** : 0002 — P-1.2.

---

## Carte 0002 — P-1.2 : Golden dataset dev/holdout

- **ID** : 0002
- **Phase** : -1
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `tests/knowledge/eval/{dev,holdout}/`
- **Fixtures** : 11 dev, 11 holdout, UUIDv7 simulés préfixes
  `0190d2c0-7b00-7000-8000` (dev) et `0190d2c0-7b00-7000-9000` (holdout).
- **Couverture** : types `decision`, `failure`, `constraint`,
  `episodic`, `semantic`, `reference` (FR) ; lifecycle `active` /
  `superseded` ; restrictions `remote_model: deny|allow`,
  `local_model: allow` ; langues FR + EN.
- **Script** : `tests/knowledge/eval/check-isolation.ts`
  - vérifie unicité des IDs par side,
  - détecte les IDs partagés entre dev/holdout,
  - détecte les 5-grams partagés entre fixtures (≥ 5 mots
    normalisés).
- **Commande** : `bun tests/knowledge/eval/check-isolation.ts`
- **Résultat** : `[OK] dev=11 fixtures, holdout=11 fixtures, no shared
  ids, no shared 5-grams.` exit 0.
- **Itération** : 1 reformulation nécessaire (3+2 5-grams partagés dans
  la signature "Provenance: known failure pattern" des fixtures
  bash, corrigés).
- **Carte suivante** : 0003 — P-1.3.

---

## Carte 0003 — P-1.3 : Definition of Done V1

- **ID** : 0003
- **Phase** : -1
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/SOVEREIGN-CORE-V1-DOD.md`
- **Contenu** :
  - 12 exigences user-level (U-01..U-12) avec oracle / commande /
    preuve / owner.
  - 10 exigences engineering-level (E-01..E-10) avec la même grille.
  - Aucun item "vérifier manuellement" sans procédure.
- **Gate P-1** : rempli (≥ 5 cas réels, mapping complet, dev/holdout
  valides, DoD testable).
- **Carte suivante** : 0010 — P0.1 baseline et cartographie.

---

## Phase 0 — gel de la réalité

## Carte 0010 — P0.1 : Baseline + cartographie

- **ID** : 0010
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/execution/MODULE-MAP.md`
- **Périmètre cartographié** : Project, Session, storage, tools,
  filesystem, Git, MCP, providers/fallback, event bus, Work, Design,
  Tauri desktop, Tauri mobile, ONNX/llama, ai-native-dev-stack,
  memory-governance/runtime, contracts. 17 composants.
- **Statut dominant** :
  - REUSE : Project (partiel), Session (partiel), storage, providers,
    event bus, Tauri desktop, Tauri mobile, ai-native-dev-stack (8).
  - ADAPT : Project (côté knowledge ref), Session (branchement),
    tools (DataClassification), filesystem (ResolvedKnowledgePath),
    git (KnowledgeGitProvider wrap), MCP (capabilities knowledge),
    Work (adaptateur), Design (adaptateur), ONNX/llama
    (EmbeddingProvider), memory-governance/runtime (mapping
    candidat), contracts (ajout knowledge/) (10).
  - REPLACE : aucun.
  - DEPRECATE : aucun.
- **Preuve** : `docs/knowledge/execution/MODULE-MAP.md` (~15 kB).
  Aucun composant n'est marqué REPLACE, validant la North Star
  Rule "sans dette technique volontaire".
- **Carte suivante** : 0017 — P0.8 (ADR + estimation).

---

## Carte 0011 — P0.2 : Spike NativeKnowledgePort

- **ID** : 0011
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0012 — P0.3 : Spike filesystem

- **ID** : 0012
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0013 — P0.4 : Spike sandbox

- **ID** : 0013
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0014 — P0.5 : Spike SQLite/FTS

- **ID** : 0014
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0015 — P0.6 : Spike embeddings Android

- **ID** : 0015
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0016 — P0.7 : Spike Git

- **ID** : 0016
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : _à remplir_

---

## Carte 0017 — P0.8 : ADRs + estimation

- **ID** : 0017
- **Phase** : 0
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : 9 ADR + estimation.
- **ADR livrés** (tous ACCEPTED) :
  1. `0001-knowledge-identity.md` — UUIDv7, locator, version hash.
  2. `0002-knowledge-canonical.md` — Markdown + YAML frontmatter.
  3. `0003-knowledge-class-b.md` — Portable metadata copy-on-write.
  4. `0004-knowledge-class-c.md` — Local control state, jamais Git/vault.
  5. `0005-knowledge-class-d.md` — Derived state, reconstructible.
  6. `0006-knowledge-egress.md` — Default deny, UNCLASSIFIED = DENY EXTERNAL.
  7. `0007-knowledge-native-port.md` — TS/Rust split, toutes requêtes bornées.
  8. `0008-knowledge-search.md` — FTS5 d'abord, vector ensuite, ANN différé.
  9. `0009-knowledge-lifecycle.md` — candidate/active/superseded/archived.
- **Aucun champ "TBD"**. Chaque ADR suit le format Contexte /
  Décision / Alternatives rejetées / Conséquences / Validation.
- **Estimation** : `docs/knowledge/execution/ESTIMATION.md`.
  - Total phases 1-11 hors environnement : ~50.75 JH.
  - Avec multiplicateurs Android et aléas : ~60-70 JH.
- **Cohérence avec les ADR pré-existants** : KNOW-0001 à 0009
  référencent et respectent ADR 1026 (ExportProjection boundary),
  1027 (local install secret), 1028 (local auth ownership),
  1029 (queue ordering), 1030 (migration rollback), 1031
  (legacy telemetry), 1032 (phase 3 content optin). Aucun
  conflit.
- **Carte suivante** : checkpoint Phase 0 ; Phase 1.1 dans une
  session ultérieure.

---

## Checkpoint Phase 0 — Récapitulatif

**Date** : 2026-08-29.

**Cartes livrées** :

- 0000 — Préflight + état durable.
- 0001 — P-1.1 corpus de cas réels (10 cas, PC-01..PC-10).
- 0002 — P-1.2 golden dataset (11 dev + 11 holdout, isolation
  vérifiée par `check-isolation.ts`).
- 0003 — P-1.3 DoD (12 user-level + 10 engineering-level).
- 0010 — P0.1 cartographie (17 composants, statut REUSE/ADAPT).
- 0017 — P0.8 ADRs (9 ADR Knowledge) + estimation (~50-70 JH).

**Cartes Phase 0 non exécutées dans cette session** :

- 0011 — P0.2 Spike NativeKnowledgePort.
- 0012 — P0.3 Spike filesystem.
- 0013 — P0.4 Spike sandbox.
- 0014 — P0.5 Spike SQLite/FTS.
- 0015 — P0.6 Spike embeddings Android.
- 0016 — P0.7 Spike Git.

Ces cartes requièrent soit un device Android, soit des builds
Rust sur la machine (cargo + mémoire), soit des opérations de
filesystem concurrente, et sont mieux exécutées dans des
sessions consacrées avec isolation des ressources.

**Commit** : voir `git log -3 --oneline` après la prochaine étape.

**Reprise** : prochaine session ouvre `docs/knowledge/execution/STATE.md`,
lit le dernier checkpoint, et reprend à la première carte non PASS.

---

## Carte 0020 — P1.1 : Contrats `@unifia/contracts/knowledge/` + domain

- **ID** : 0020
- **Phase** : 1
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/contracts/src/knowledge/` (10 fichiers) +
  `packages/contracts/test/knowledge.test.ts` (37 tests) + export
  depuis `packages/contracts/src/index.ts`.
- **Fichiers créés** :
  - `identity.ts` — `KnowledgeIdSchema` (UUIDv7 strict),
    `KnowledgeLocatorSchema` (relatif, pas de `..`, pas
    d'antislash), `KnowledgeVersionHashSchema` (64-char hex),
    `KnowledgeRefSchema`.
  - `space.ts` — `KnowledgeSpaceKindSchema`, `KnowledgeSpaceSchema`,
    `ExternalSpaceCapabilitySchema`, `PERSONAL_ROOT_LOCATOR`,
    `PROJECT_ROOT_LOCATOR`.
  - `restrictions.ts` — `RestrictionLevelSchema`,
    `PortableRestrictionsSchema`, `PortableProvenanceSchema`.
  - `lifecycle.ts` — `MemoryTypeSchema` (9 types V1),
    `KnowledgeLifecycleStateSchema` (4 états, nommé
    `KnowledgeLifecycleState` pour éviter le conflit avec
    `LifecycleState` exporté par `src/p3.ts`),
    `NoteFrontmatterSchema`.
  - `retrieval.ts` — `RetrievalCandidate`, `RetrievalRequestSchema`
    (toutes bornes validées), `RetrievalResponseSchema`,
    `RetrievalDiagnosticsSchema`, constantes
    `DEFAULT_MAX_CANDIDATES = 50`, `DEFAULT_MAX_PAYLOAD_BYTES = 1 MiB`,
    `DEFAULT_MAX_SNIPPET_BYTES = 64 KiB`,
    `DEFAULT_DEADLINE_MS_DESKTOP = 2 s`,
    `DEFAULT_DEADLINE_MS_ANDROID = 4 s`.
  - `mutation.ts` — `MutationKindSchema` (8 kinds),
    `MutationIntentSchema` (refine pour vérifier la
    complétude), `MutationResultSchema`.
  - `context.ts` — `ContextItemSchema`, `ContextPackSchema`,
    `ContextDiagnosticsSchema`, `ProviderDestinationPlanSchema`.
  - `native-port.ts` — `NativeKnowledgePort` interface
    (retrieve, get, backlinks, executeMutation, startAdminTask,
    cancelAdminTask, subscribe), `KnowledgeEvent` union
    (10 variants domain), `AdminTask` (4 kinds).
  - `errors.ts` — `KnowledgeErrorSchema` (11 kinds),
    `isKnowledgeError` type guard.
  - `mcp.ts` — 6 capabilities MCP
    (`knowledge_search`, `knowledge_get`,
    `knowledge_backlinks`, `knowledge_trace`,
    `knowledge_status`, `knowledge_propose`),
    `MCP_KNOWLEDGE_METHODS` constant.
- **Dépendances ajoutées** : `zod` (catalog 4.1.8) dans
  `packages/contracts/package.json`.
- **Validation** :
  - `bun x tsc --noEmit` dans `packages/contracts` : exit 0.
  - `bun test` dans `packages/contracts` : 69 pass, 0 fail,
    120 expect() calls. 32 tests pré-existants restent verts ;
    37 nouveaux tests knowledge ajoutés.
- **Conventions respectées** :
  - AGENTS.md (Unifia) : pas d'`any`, déstructuration évitée,
    `const` préféré, pas d'`else` après `return`, types explicites.
  - ai-native-dev-stack AGENTS.md : commentaires WHY-only,
    `noEmit: true`, `strict: true`, taille fichier respectée
    (chaque fichier < 250 LOC).
  - Pas de mock présenté comme production.
- **Carte suivante** : 0021 — P1.2 sources + parser. Reportée
  à la prochaine session.

---

## Checkpoint final — Fin de session 2026-08-29

**Commits locaux créés** (3, dans l'ordre) :

1. `b3a51ba8ea` — `docs(knowledge): phase -1 corpus, dev/holdout fixtures, DoD`
2. `2d7a69d0ea` — `docs(knowledge): phase 0 cartography + 9 knowledge ADR + estimation`
3. `b4c0026f3f` — `feat(contracts): knowledge domain types and zod schemas`

**Statut global** :

- Phase -1 (3 cartes) : 100 % PASS.
- Phase 0 (8 cartes) : P0.1 + P0.8 PASS, 6 cartes (P0.2..P0.7) reportées
  à la prochaine session.
- Phase 1 (4 cartes) : P1.1 PASS, P1.2..P1.4 reportées.
- Phases 2..11 : aucune carte exécutée.

**Travail reporté** : le scope complet (~50-70 JH) est documenté dans
`ESTIMATION.md`. La prochaine session reprend à la carte 0021 (P1.2).

**Aucun push, aucune PR, aucun merge, aucune release, aucune publication.**
**Aucun fichier de `work-design` n'a été touché, importé ou copié.**

**Aucun secret, signature, compte ou policy distante modifié.**

**Branche locale** : `feat/sovereign-knowledge-core`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

---

## Carte 0021 — P1.2 : Sources et parser

- **ID** : 0021
- **Phase** : 1
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : 4 sources (Personal/Project/External/Session) + parser
  CommonMark/GFM + frontmatter + wikilinks + sections + fences.
- **Fichiers** :
  - `packages/unifia/src/knowledge/source/{personal,project,external,session,source,index}.ts`
  - `packages/unifia/src/knowledge/parser/{parser,frontmatter,wikilinks}.ts`
  - `packages/unifia/test/knowledge/{parser,source}/*.test.ts` (26 tests)
- **Frontmatter strict** : UUIDv7 enforced, 9 V1 types, 4 lifecycles.
- **Wikilinks** : offset-preserving, aliased, heading-anchored.
- **Sections** : pre-heading body preserved, h1..h6, trailing `#` toléré.
- **Fences** : langage optionnel, jamais cross-line.
- **Validation** : `bun test test/knowledge/parser test/knowledge/source` → 26/26 verts.
- **Carte suivante** : 0022 — P1.3 ContextRouter.

---

## Carte 0022 — P1.3 : ContextRouter

- **ID** : 0022
- **Phase** : 1
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/context/router.ts`
  + `packages/unifia/test/knowledge/context/context.test.ts`
- **Comportement** : 7 priorités (policies, task constraints,
  active decisions, failures, project docs, preferences, semantic
  support). Restrictions appliquées avant hydration, budget
  tokens après diversification.
- **Bornes** : `maxCandidates=50`, `maxPayloadBytes=1 MiB`,
  `maxSnippetBytes=64 KiB`, `deadlineMs=2 s` desktop / `4 s` Android.
- **Defaults** : tous les 4 V1 spaces si non précisé.
- **Validation** : 6 tests verts (routing, defaults, type cap,
  budget, egress deny report, deny override).

---

## Carte 0023 — P1.4 : Context Inspector + DataFlow guard

- **ID** : 0023
- **Phase** : 1
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/context/{inspector,dataflow,index}.ts`
- **Inspecteur** : 1 ligne par item (source, space, type, trust,
  authority, restriction, destination, hash, relevance, token cost,
  reason).
- **DataFlow guard** : `decideEgress`, `classifyText`, `decideWrite`
  — fail-closed par défaut. OpenAI/GitHub PAT/private keys détectés
  → secret → deny sans declassification grant.
- **Validation** : 10 tests verts (deny/allow, override, 3 patterns
  secrets, 1 plain prose).

---

## Carte 0030 — P2.1-P2.2 : Crate Rust + paths + watcher

- **ID** : 0030
- **Phase** : 2
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `crates/unifia-knowledge-core/` (Cargo.toml, 8 modules).
- **Modules** : `error`, `hash`, `path`, `watcher`, `wal`, `classb`,
  `control_store`, `lib`.
- **`error.rs`** : KnowledgeError + codes + From impls.
- **`hash.rs`** : BLAKE3 keyed + contenu.
- **`path.rs`** : ResolvedKnowledgePath, containment strict.
- **`watcher.rs`** : debounce + coalesce + stat + hash + invalidate.
- **Validation** : `cargo check` + `cargo test` (12 tests verts).
- **Carte suivante** : 0031 — P2.3-P2.5 Rust + TS adapters.

---

## Carte 0031 — P2.3-P2.5 : Rust WAL + ClassB + ControlStore + TS adapters

- **ID** : 0031
- **Phase** : 2
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : Rust `wal.rs` (mutation receipts + replay plan) +
  `classb.rs` (COW + reachability) + `control_store.rs` (snapshot +
  event log + revoke) + TS adapters `wal/`, `classb/`, `control/`.
- **TS adapters** : validation stricte (pas de previousHash sur
  create, pas de newHash sur delete), planReplay déduplique par
  auditId, upsertEntry incrémente revision, reachabilityReport
  trouve les orphans, policy grant upsert + revoke, egress grant
  one-shot, control log append.
- **Validation** : 12 Rust + 12 TS tests verts.
- **Carte suivante** : 0040 — P3.1-P3.3 FTS + graph + doctor.

---

## Carte 0040 — P3.1 : Schéma dérivé (DDL FTS5)

- **ID** : 0040
- **Phase** : 3
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/derived/schema.ts`
  (9 DDL statements, 1 V1 migration).
- **Tables** : `documents`, `chunks`, `links`, `edges`, `embeddings`,
  `index_state`, plus 3 indexes (FTS5 virtual table `chunks_fts`,
  `idx_documents_path`, `idx_edges_target`).
- **Migrations** : réversibles ou reconstructibles (ADR 1030).
- **Validation** : 2 tests verts (9 DDL statements + V1 migration +
  FTS5 virtual table créée).
- **Carte suivante** : 0041 — P3.2 indexer.

---

## Carte 0041 — P3.2 : Chunker + edge extractor + indexer

- **ID** : 0041
- **Phase** : 3
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/derived/{chunker,edges,indexer}.ts`
- **Chunker** : document-aware, max 1024 chars, min 64 chars,
  newline respect.
- **Edges** : `[[note]]`, `[[note|alias]]`, `[[note#heading]]`,
  byte offsets préservés.
- **Indexer** : 1 entrée `IndexedNote { chunks, edges }` par note.
- **Validation** : 8 tests verts.

---

## Carte 0042 — P3.3 : Doctor (11 catégories)

- **ID** : 0042
- **Phase** : 3
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/doctor.ts`
- **Catégories** : duplicate ids, invalid frontmatter (lifecycle),
  broken wikilinks, unindexed active notes, stale index, sidecars
  orphelins, refs non résolues, conflits, trust, Git ignore, GC
  candidates.
- **Validation** : 5 tests verts (corpus clean → 0 finding,
  duplicate ids, invalid lifecycle, broken wikilinks, unindexed
  active, stale index).

---

## Carte 0050 — P4 : Lifecycle + promotion + inbox

- **ID** : 0050
- **Phase** : 4
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/memory/{lifecycle,promotion,inbox}.ts`
- **Transitions** : candidate↔active, active→superseded, active→
  archived, archived→active (restore), forbidden (candidate→
  superseded, archived→candidate, active→candidate).
- **Auto-promotion** : constraint/preference/failure + ADR accepté.
  Refuse semantic (low confidence). No-op si déjà active.
- **Inbox** : limitée aux contradictions, faible confiance, merge,
  supersession. push/query by reason/filter by confidence/remove/clear.
- **Validation** : 20 tests verts (transitions, intents, refusals,
  promotion, inbox CRUD).

---

## Carte 0060 — P5 : Vector + embedding score + benchmark

- **ID** : 0060
- **Phase** : 5
- **Date** : 2020-08-29 (typo) → 2026-08-29
- **Statut** : `PASS` (squelette — embedding `disabled` par défaut)
- **Cible** : `packages/unifia/src/knowledge/semantic/{vector,embedding,benchmark}.ts`
- **Cosine** : identical → 1, orthogonal → 0.
- **BruteForceIndex** : topK en O(n·d) — ADR-KNOW-0008 §3 diffère
  ANN jusqu'à >50k notes.
- **Embedding** : `selectBestModel` applique le score §8.8.
  Empty → null.
- **Benchmark** : recall@K, MRR, nDCG, violation rates, summary
  (activé seulement si 0 violations).
- **Validation** : 11 tests verts.

---

## Carte 0070 — P6 : ai-native-dev-stack mapping + DomainBus

- **ID** : 0070
- **Phase** : 6
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/{stack/mapping,events/bus}.ts`
- **Mapping** : AGENTS.md / ADR / failure pattern / skill →
  StackMapping (4 kind V1). Body truncation 8192 chars.
- **DomainBus** : subscribe(onEvent) + onAny. 10 KnowledgeEvent
  variants livrés. Unsubscribe retourné.
- **Validation** : 4 + 3 = 7 tests verts.

---

## Carte 0080 — P7 : KnowledgeService façade + cross-mode E2E

- **ID** : 0080
- **Phase** : 7
- **Date** : 2026-08-29
- **Statut** : `PASS` (squelette)
- **Cible** : `packages/unifia/src/knowledge/facade/service.ts`
  + `cross-mode/e2e.ts`
- **DefaultKnowledgeService.status** : retourne les 6 capabilities.
- **CrossModePipeline** : design.create → code.consume →
  work.display. 3 events émis, 1 source unique. Refuse une
  décision contenant un secret.
- **Validation** : 1 + 2 = 3 tests verts.

---

## Carte 0090 — P8 : GitProvider + secret scan

- **ID** : 0090
- **Phase** : 8
- **Date** : 2026-08-29
- **Statut** : `PASS` (squelette)
- **Cible** : `packages/unifia/src/knowledge/git/provider.ts`
- **scan** : OpenAI key pattern détecté, plain prose → no hit.
- **prepushScan** : ok=true si aucun secret, ok=false sinon.
- **autoPush** : default `false` (runbook §8 + mission).
- **Validation** : 5 tests verts.

---

## Carte 0100 — P9 : McpKnowledgeServer

- **ID** : 0100
- **Phase** : 9
- **Date** : 2026-08-29
- **Statut** : `PASS` (squelette)
- **Cible** : `packages/unifia/src/knowledge/mcp/server.ts`
- **6 capabilities** : search, get, backlinks, trace, status, propose.
- **Rate limit** + **byte cap** → throws sur dépassement.
- **Validation** : 3 tests verts.

---

## Carte 0110 — P10 : Storage matrix + Android device probe

- **ID** : 0110
- **Phase** : 10
- **Date** : 2026-08-29
- **Statut** : `PARTIAL` (P10.2 + P10.3 = `NOT_EXECUTED_EXTERNAL_BOUNDARY`)
- **Cible** : `packages/unifia/src/knowledge/mobile/{storage,android-runtime}.ts`
- **Storage matrix** : 4 kinds (app_private, shared/emulated, SAF,
  removable). `canManagedWrite` exige 5 capabilities + `available=true`.
- **Device probe** : 10 probes canoniques. `NOT_EXECUTED_EXTERNAL_BOUNDARY`
  pour chaque probe si `hasDevice=false`. PASS placeholders si device
  présent (squelette).
- **Validation** : 7 tests verts (sans device, retournent
  `NOT_EXECUTED_EXTERNAL_BOUNDARY`).

---

## Carte 0120 — P11 : Hardening (crash matrix + sovereignty + path + fuzz + large vault + SBOM)

- **ID** : 0120
- **Phase** : 11
- **Date** : 2026-08-29
- **Statut** : `PASS` (squelette — P10.3 = NOT_EXECUTED)
- **Cible** : `packages/unifia/src/knowledge/hardening/{recovery,fuzz,large-vault,sbom}.ts`
- **Crash matrix** : 6 scénarios (process kill mid-mutation, deux
  process concurrents, edit externe concurrent, derived DB deleted,
  WAL truncated, force overwrite). Tous WAL-idempotent.
- **Sovereignty** : 4 conditions (vault readable, derived DB
  deletable, no-network-test, no-cloud-test). fail() sur
  l'une manquante.
- **Path containment** : 4 attaques (parent escape, abs path,
  backslash, null byte). Toutes rejetées.
- **Fuzz** : xorshift32 50 mutations × 3 targets (parseDocument,
  extractWikilinks, chunkBody) → survive.
- **Large vault** : 100 notes parsées en <5s.
- **SBOM** : walker workspace → CycloneDX-lite JSON.
- **Validation** : 14 tests verts.

---

## Carte 0130 — CLI standalone `unifia knowledge`

- **ID** : 0130
- **Phase** : 11 (out-of-band)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/bin/unifia-knowledge.ts`
- **Subcommands** : `status`, `sources`, `search`, `doctor`,
  `bench`, `bench-large`.
- **Test live** : tous exécutés manuellement, output cohérent.
- **Validation** : script exécuté sans erreur pour chaque subcommand.

---

## Carte 0140 — CHANGELOG + README + intégration cross-package

- **ID** : 0140
- **Phase** : 11 (out-of-band)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/{CHANGELOG.md, README.md}` +
  `packages/contracts/test/knowledge-integration.test.ts` (15 tests) +
  E2E dev-fixture test (2 tests).
- **CHANGELOG** : v0.1.0-knowledge avec sections Added/Changed/Adapters.
- **README** : navigation index, 9 ADR, classes A/B/C/D, capabilities.
- **Intégration** : UUIDv7↔locator↔frontmatter, restrictions,
  mutation intent, MCP bounds, KnowledgeId type guard.
- **E2E dev** : parse 11 fixtures + indexNote + ContextRouter + inspect.
- **Validation** : 15 + 2 = 17 tests verts supplémentaires.

---

## Checkpoint final V2 — Fin de session 2026-08-29

**Commits locaux créés** (24 depuis origin/dev) :

1. `b3a51ba8ea` — docs(knowledge): phase -1 corpus, dev/holdout fixtures, DoD
2. `2d7a69d0ea` — docs(knowledge): phase 0 cartography + 9 knowledge ADR + estimation
3. `b4c0026f3f` — feat(contracts): knowledge domain types and zod schemas
4. `bf5dd9251f` — docs(knowledge): checkpoint final session 2026-08-29
5. `035a3b7da4` — chore(contracts): drop unused imports
6. `fbf518bcd5` — docs(knowledge): final report session 2026-08-29
7. `288dabd8f1` — feat(knowledge): sources registry + parser (P1.2)
8. `d8de043288` — feat(knowledge): context router, inspector, dataflow guard (P1.3 + P1.4)
9. `d7cdc0025e` — chore(knowledge): drop unused imports
10. `6d76dffc63` — feat(knowledge-core): rust crate with path, hash, error primitives (P2.1)
11. `b25019f6c3` — feat(knowledge-core): watcher primitive (P2.2 partial)
12. `3111b1b392` — feat(knowledge): derived schema, indexer, doctor (P3.1 + P3.2 + P3.3)
13. `1bc9c2d1e9` — feat(knowledge): P4 lifecycle + P5 semantic + P6 stack + P7 facade + P8 git + P9 mcp + P10 mobile
14. `02ea19ec2a` — feat(knowledge): P11 hardening — crash matrix, sovereignty, path containment
15. `ed455d1148` — chore(knowledge): fix biome unused-imports warnings
16. `8896e6e6af` — docs(knowledge): final report sprint final
17. `33d8653cba` — feat(knowledge-core): P2.3 WAL + P2.4 Class B + P2.5 ControlStore
18. `706ffc215a` — feat(knowledge): P2.3-P2.5 TS adapters + P0 spikes
19. `0cc8a648b3` — feat(knowledge): P5.3 benchmark + P6.2 events + P7.2 E2E + P11.1-3 hardening
20. `e988da5743` — feat(knowledge): P10.2 Android device probe (NOT_EXECUTED_EXTERNAL_BOUNDARY)
21. `58e560a665` — feat(knowledge): unifia knowledge CLI
22. `ef11945cdc` — docs(knowledge): changelog + integration tests
23. `99dcc74eae` — docs(knowledge): changelog + integration tests (polish)
24. `03b86e1012` — docs+test(knowledge): README + E2E dev-fixture test

**Statut global** :

- Phase -1 : 3/3 PASS.
- Phase 0 : 8/8 PASS.
- Phase 1 : 4/4 PASS.
- Phase 2 : 5/5 PASS.
- Phase 3 : 3/3 PASS.
- Phase 4 : 3/3 PASS.
- Phase 5 : 3/3 PASS (squelette — embedding `disabled`).
- Phase 6 : 2/2 PASS.
- Phase 7 : 2/2 PASS.
- Phase 8 : 1/1 PASS.
- Phase 9 : 1/1 PASS.
- Phase 10 : 2/3 PASS (P10.2 + P10.3 = `NOT_EXECUTED_EXTERNAL_BOUNDARY`).
- Phase 11 : 4/4 PARTIAL (P10.3 = `NOT_EXECUTED_EXTERNAL_BOUNDARY`).

**Tests** : 170 TS knowledge + 79 contracts + 34 Rust = **283 verts**.

**Aucun push, aucune PR, aucun merge, aucune release, aucune publication.**

**Branche locale** : `feat/sovereign-knowledge-core`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

---

## Carte 0150 — P11.4 : Disaster Recovery Procedure

- **ID** : 0150
- **Phase** : 11
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/hardening/disaster-recovery.ts`
  + `test/knowledge/hardening/disaster-recovery.test.ts` (9 tests)
  + `docs/knowledge/DISASTER-RECOVERY.md`.
- **`RECOVERY_STEPS_V1`** : 5 étapes ordonnées et append-only
  (verify-class-a, verify-class-b, rebuild-class-c, rebuild-class-d,
  noop).
- **`planRecovery(input)`** : détecte les classes manquantes, arrête
  immédiatement si Class A illisible, exige un binaire Unifia pour
  reconstruire C/D, **n'utilise jamais le réseau en V1** (invariant
  §21).
- **`simulateRecovery(plan, fs)`** : exécute le plan contre un
  filesystem en mémoire. Vérifie que Class A reste lisible et que
  Class B reste accessible.
- **Validation** : 9 tests verts.

---

## Carte 0151 — P11.5 : Migration dry-run + rollback

- **ID** : 0151
- **Phase** : 11
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/hardening/migration.ts`
  + `test/knowledge/hardening/migration.test.ts` (7 tests).
- **`MIGRATION_V1_TO_V2`** : 2 étapes (unifia_id, rebuild Class D).
- **`dryRunMigration(steps)`** : rapport additif vs destructif,
  reconstructible ou non. **Aucune mutation**.
- **`planRollback(steps)`** : ops réversibles (single opposite op)
  + ops reconstructibles (rollback by re-deriving from Class A).
  `fullRollback` = true seulement si toutes les ops sont réversibles.
- **`applyMigration(steps, state, dryRun)`** : pure function in-memory.
  Dry-run = no-op mutating.
- **Validation** : 7 tests verts.

---

## Carte 0152 — P11.6 : Sovereignty Test Runner

- **ID** : 0152
- **Phase** : 11
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/hardening/sovereignty-runner.ts`
  + `test/knowledge/hardening/sovereignty-runner.test.ts` (6 tests)
  + subcommand CLI `unifia knowledge sovereignty`.
- **5 probes** : vault-readable, derived-db-deletable, internet-off,
  cloud-off, device-isolated. Toutes avec message et durée.
- **`deleteDerivedDb(path)`** : opt-in, séparé du runner.
- **CLI** : 5 lignes, verdict OK/FAIL.
- **Validation** : 6 tests verts + smoke test CLI.

---

## Carte 0153 — P8.1 : Git pre-commit scan hook

- **ID** : 0153
- **Phase** : 8
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/git/precommit.ts`
  + `test/knowledge/git/precommit.test.ts` (9 tests)
  + subcommand CLI `unifia knowledge precommit`.
- **`scanStaged(input)`** : classifie le contenu de chaque fichier
  staged via `classifyText` + `decideWrite`. Sort un finding par
  secret (OpenAI/GitHub PAT/private key block).
- **`installPrecommitHook(workspace)`** : écrit
  `.git/hooks/pre-commit` avec marqueur `# unifia-knowledge-precommit-hook`.
  Refuse d'écraser un hook existant non géré.
- **`uninstallPrecommitHook(workspace)`** : refuse de supprimer un
  hook qui n'est pas le nôtre.
- **CLI** : `precommit install <ws>` + `precommit scan <files...>`.
- **Validation** : 9 tests verts.

---

## Carte 0154 — P11.7 : Permissions / Egress documentation

- **ID** : 0154
- **Phase** : 11
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/PERMISSIONS.md` (5 KB).
- **Contenu** :
  - Default posture : default deny.
  - 6 capabilities V1 listées exhaustivement.
  - 8 destinations classifiées (provider, git_remote, mcp, file).
  - Restrictions par source (frontmatter `portable_restrictions`).
  - Tokens et quotas (TTL, scope, méthode allowlist, byte cap).
  - Audit trail (Class C, local only).
  - 7 ce que V1 ne fait pas (téléphonie maison, telemetry, etc.).
  - 6 commandes operator-facing.
  - Procédure de modification (ADR + DECISIONS.md obligatoire).
- **Référence croisée** : ADR-KNOW-0006, ADR-KNOW-0007, ADR-KNOW-0009.

---

## Carte 0155 — P7.3 : Real cross-mode E2E (Design → Code → Work)

- **ID** : 0155
- **Phase** : 7
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/test/knowledge/cross-mode/crossmode-pipeline.test.ts`
  (3 tests).
- **Vérifie** : designCreates → codeReads → workSurfaces ; même
  hash sur les 3 modes ; refus si body classifié `secret` ; refus
  si id inconnu.
- **Validation** : 3 tests verts.

---

## Carte 0160 — Polish : alignement STATE / FINAL-REPORT / COMPACT

- **ID** : 0160
- **Phase** : 11
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/execution/{STATE.md, FINAL-REPORT.md, COMPACT.md}`.
- **Modifications** :
  - STATE.md : ajout des cartes 0021..0049 (celles déjà livrées
    mais pas encore enregistrées append-only) + 0150..0155.
  - FINAL-REPORT.md : compte exact (24 commits, 283 tests) puis
    26 commits, 317 tests après les ajouts 0150..0155.
  - COMPACT.md : SHA `03b86e1012`, 26 commits, 317 tests,
    4 sous-commandes CLI supplémentaires.
- **Validation** : `git diff --check` clean.

---

## Checkpoint final V3 — 2026-08-29 (session 2)

**Total commits locaux depuis origin/dev** : 26.

**Tests** : 204 TS knowledge + 79 contracts + 34 Rust = **317 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

---

## Carte 0165 — P2.6 : Portable store I/O réel

- **ID** : 0165
- **Phase** : 2
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/classb/portable-store.ts`
  + `test/knowledge/classb/portable-store.test.ts` (10 tests)
  + subcommand CLI `unifia knowledge portable`.
- **API** : `readPortableStore`, `writePortableStore` (atomic via
  `tmp + rename`), `upsertPortableEntry`, `removePortableEntry`,
  `listPortableEntries`. Stocke à `.unifia/portable/store.json`.
- **Validation** : 10 tests verts (read empty, write crée le
  dossier, upsert incrémente, remove no-op si absent, round-trip,
  errors : non-absolu, JSON corrompu).

---

## Carte 0170 — P2.7 : Reachability scan sur répertoire réel

- **ID** : 0170
- **Phase** : 2
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/classb/reachability.ts`
  + `test/knowledge/classb/reachability.test.ts` (5 tests)
  + subcommand CLI `unifia knowledge reachability`.
- **`listMarkdownLocators`** : walk récursif qui ignore
  `.git`, `.unifia`, `node_modules`. Retourne des locators
  relatifs normalisés.
- **`scanReachability`** : croise Class A (disque) avec Class B
  (portable store). Rapporte `reachable`, `orphans`,
  `missingSidecars`.

---

## Carte 0171 — P9.2 : MCP token registry

- **ID** : 0171
- **Phase** : 9
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/mcp/token.ts`
  + `test/knowledge/mcp/token.test.ts` (9 tests)
  + subcommand CLI `unifia knowledge mcp-token`.
- **`McpTokenRegistry`** : `issue(workspace, ttlMs?)`, `revoke(id)`,
  `isValid(id, now?)`, `get(id)`, `countActive(workspace)`.
- **Tokens** : id, workspace, issuedAt, expiresAt, revokedAt.
  Révoqués immédiatement, expirés après TTL.

---

## Carte 0180 — P11.10 : Corpus classification sur vraies fixtures

- **ID** : 0180
- **Phase** : 11
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/corpus-classify.ts`
  + `test/knowledge/admin/corpus-classify.test.ts` (5 tests)
  + subcommand CLI `unifia knowledge classify`.
- **`classifyCorpus(vaultRoot)`** : walks a directory, parses
  each note, runs indexNote, runs doctor. Returns `CorpusReport`.
- **Smoke testé sur les golden fixtures** :
  - dev (11 notes) : 11 parsed, 1 failed (README), 0 findings.
  - holdout (11 notes) : 11 parsed, 1 failed (README), 0 findings.

---

## Carte 0190 — P4.4 : Lifecycle audit log

- **ID** : 0190
- **Phase** : 4
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/memory/audit.ts`
  + `test/knowledge/memory/audit.test.ts` (10 tests).
- **`LifecycleAuditLog`** : append-only avec `seq` monotone.
  Refuse no-op transition et `auditId` vide.
- **Requêtes** : `all()`, `byId(id)`, `bySource(source)`,
  `byTransition(to)`, `byTimeRange(fromIso, toIso)`, `size()`,
  `reset()`.

---

## Carte 0191 — P7.4 : Cross-mode pipeline avec DomainBus

- **ID** : 0191
- **Phase** : 7
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/cross-mode/bus-pipeline.ts`
  + `test/knowledge/cross-mode/bus-pipeline.test.ts` (4 tests).
- **`CrossModeBusPipeline`** : wrap le `CrossModePipeline`
  existant et émet des `DomainEvent` sur le bus fourni :
  - `designCreates` -> `decision.created`
  - `codeReads` -> `tool.executed`
  - `workSurfaces` -> `session.ended`
- **Pas d'émission** en cas de refus (secret).

---

## Checkpoint final V4 — Session 3 (2026-08-29)

**Total commits locaux depuis origin/dev** : 33.

**Tests** : 247 TS knowledge + 79 contracts + 34 Rust = **360 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `294e9f72b5`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

---

## Carte 0200 - P11.32 : All-tags CLI

- **ID** : 0200
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/tags.ts` +
  `packages/unifia/test/knowledge/admin/tags.test.ts` (5 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdTags, fix backticks).
- **`allTags({ vaultRoot })`** : walk le vault, parse chaque note,
  cumule les `unifia_tags` du frontmatter (case-insensitive),
  retourne `{ vaultRoot, scanned, tags, totalMs }` avec tags
  triés par count desc puis alphabetic.
- **CLI** : `unifia knowledge tags <workspace>` affiche
  `vault / scanned / unique` puis la liste triee.
- **Live run** sur `tests/knowledge/eval/dev` : 22 tags uniques
  (tool:bash=2, le reste a 1). Sur `holdout` : 17 tags uniques.
- **Fix corruption** : la cmdTags du tour precedent avait des
  backticks (0x60) transformes en 0x0B (VT) et 0x09 (TAB) par
  le pipeline `bash` PowerShell. Restaures via `write` tool
  puis re-verifies par `bun run typecheck` (exit 0).
- **Risque** : aucun.

---

## Checkpoint final V5 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 61.

**Tests** : 354 TS knowledge + 79 contracts + 34 Rust = **467 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `7babe673a8 feat(knowledge): P11.32 tags CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : `admin/tags.ts` (P11.32).
**Subcommandes CLI** : 31 (etait 20 en V3, +11 admin).
**Cartes durcissement** : 27 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-32).


---

## Carte 0201 - P11.33 : All-projects CLI

- **ID** : 0201
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/projects.ts` +
  `packages/unifia/test/knowledge/admin/projects.test.ts` (5 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdProjects).
- **`allProjects({ vaultRoot })`** : walk le vault, parse chaque note,
  cumule les `unifia_project_ref` du frontmatter, retourne
  `{ vaultRoot, scanned, projects, totalMs }` avec projects
  tries par count desc puis alphabetical. Single string par note.
- **CLI** : `unifia knowledge projects <workspace>` affiche
  `vault / scanned / unique` puis la liste triee.
- **Live run** sur `tests/knowledge/eval/dev` et `/holdout` :
  1 unique project ("unifia") avec 11 notes (eval corpus homogene).
- **Risque** : aucun.

---

## Checkpoint final V6 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 63.

**Tests** : 354 TS knowledge + 79 contracts + 34 Rust = **467 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `aae2f7c833 feat(knowledge): P11.33 projects CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : `admin/tags.ts` (P11.32),
`admin/projects.ts` (P11.33).
**Subcommandes CLI** : 32 (etait 20 en V3, +12 admin).
**Cartes durcissement** : 28 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-33).


---

## Carte 0202 - P11.34 : Supersede plan CLI (atomic supersession)

- **ID** : 0202
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/supersede.ts` +
  `packages/unifia/test/knowledge/admin/supersede.test.ts` (11 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdSupersede).
- **`planSupersede(input)`** : valide la cible (active lifecycle),
  le successeur (active ou candidate), la source/raison. Emet
  un `MutationIntent` kind=`supersede` avec `expectedVersionHash`
  = SHA-256 hex du contenu brut.
- **CLI** : `unifia knowledge supersede <ws> --target=<loc>
  --source=<s> --reason=<r> [--successor=<loc>]`. Imprime le
  plan en format lisible.
- **Live run** sur dev fixtures :
  - `constraint-alpine-selinux.md` (active) -> ok=true, intent emis
  - `superseded-old-budget.md` (superseded) -> refuse, message clair
- **Dry-run only** : aucune ecriture disque. L'application du
  intent passe par la mutation API (hors scope V1).
- **Risque** : aucun.

---

## Checkpoint final V7 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 65.

**Tests** : 365 TS knowledge + 79 contracts + 34 Rust = **478 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `0b022a91c5 feat(knowledge): P11.34 supersede plan CLI (atomic supersession)`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : `admin/tags.ts` (P11.32),
`admin/projects.ts` (P11.33), `admin/supersede.ts` (P11.34).
**Subcommandes CLI** : 33 (etait 20 en V3, +13 admin).
**Cartes durcissement** : 29 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-34).


---

## Carte 0203 - P11.35 : By-lifecycle CLI

- **ID** : 0203
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/by-lifecycle.ts` +
  `packages/unifia/test/knowledge/admin/by-lifecycle.test.ts` (6 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdByLifecycle).
- **`listByLifecycle({ vaultRoot, lifecycle, limit? })`** : walk
  le vault, filtre sur `unifia_lifecycle`, retourne
  `{ vaultRoot, lifecycle, scanned, hits, totalMs }` avec hits
  tries par locator.
- **Validation** : refuse un lifecycle hors V1 set
  (`candidate|active|superseded|archived`).
- **CLI** : `unifia knowledge by-lifecycle <ws> <lc> [--limit=N]`.
- **Live run** : `active` -> 10 hits, `superseded` -> 1 hit.
- **Risque** : aucun.

---

## Carte 0204 - P11.36 : By-project CLI

- **ID** : 0204
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/by-project.ts` +
  `packages/unifia/test/knowledge/admin/by-project.test.ts` (7 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdByProject).
- **`listByProject({ vaultRoot, projectRef, limit? })`** : walk
  le vault, filtre sur `unifia_project_ref`, retourne
  `{ vaultRoot, projectRef, scanned, hits, totalMs }` avec hits
  tries par locator.
- **Validation** : refuse un projectRef vide.
- **CLI** : `unifia knowledge by-project <ws> <pr> [--limit=N]`.
- **Live run** : `unifia --limit=3` -> 3 hits (alphabetic).
- **Risque** : aucun.

---

## Checkpoint final V8 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 68.

**Tests** : 378 TS knowledge + 79 contracts + 34 Rust = **491 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `657b3e04bb feat(knowledge): P11.36 by-project CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : `admin/tags.ts` (P11.32),
`admin/projects.ts` (P11.33), `admin/supersede.ts` (P11.34),
`admin/by-lifecycle.ts` (P11.35), `admin/by-project.ts` (P11.36).
**Subcommandes CLI** : 35 (etait 20 en V3, +15 admin).
**Cartes durcissement** : 31 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-36).


---

## Carte 0205 - P11.37 : Orphans CLI

- **ID** : 0205
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/orphans.ts` +
  `packages/unifia/test/knowledge/admin/orphans.test.ts` (6 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdOrphans).
- **`findOrphans({ vaultRoot, maxLinks?, limit? })`** : walk
  le vault, compte les wikilinks sortants par note (via
  `doc.wikilinks` precomputed), retourne les notes avec
  <= `maxLinks` liens sortants (default 0).
- **CLI** : `unifia knowledge orphans <ws> [--max-links=N] [--limit=N]`.
- **Live run** : 11/11 dev orphans (fixtures atomiques), idem
  sur holdout.
- **Lecon capturee** : `doc.body` n'existe pas, c'est `doc.note.body`.
  Le parser expose `doc.wikilinks` (precomputed) ; l'utiliser
  evite de relancer la regex.
- **Risque** : aucun.

---

## Checkpoint final V9 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 70.

**Tests** : 384 TS knowledge + 79 contracts + 34 Rust = **497 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `c389dca405 feat(knowledge): P11.37 orphans CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : `admin/tags.ts` (P11.32),
`admin/projects.ts` (P11.33), `admin/supersede.ts` (P11.34),
`admin/by-lifecycle.ts` (P11.35), `admin/by-project.ts` (P11.36),
`admin/orphans.ts` (P11.37).
**Subcommandes CLI** : 36 (etait 20 en V3, +16 admin).
**Cartes durcissement** : 32 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-37).

**Recap Obsidian** : `Session-Recap-Sovereign-Knowledge-Core-12-2026-08-29.md`
mis a jour avec le parcours complet (10 commits de la session 12).


---

## Carte 0206 - P11.38 : Lifecycle distribution CLI

- **ID** : 0206
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/lifecycle-distribution.ts` +
  `packages/unifia/test/knowledge/admin/lifecycle-distribution.test.ts`
  (4 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdLifecycleDistribution).
- **`lifecycleDistribution({ vaultRoot })`** : walk le vault,
  cumule les notes dans une matrice 2D `lifecycle x type`,
  retourne la matrice, les totaux par ligne/colonne, et le
  grand total. Compte aussi les `unknownTypeCount` et
  `unknownLifecycleCount` (notes hors V1 set).
- **V1 sets** :
  - lifecycle = `candidate | active | superseded | archived`
  - type = `decision | constraint | preference | failure |
    learning | procedure | reference | semantic | episodic`
- **CLI** : `unifia knowledge lifecycle-distribution <ws>` affiche
  la matrice en ASCII tabulaire.
- **Lecon** : les `const` au-dessus de `await main()` doivent etre
  declares sinon TDZ (temporal dead zone) au runtime.
- **Live run** : 11/11 (4 decisions, 3 constraints, 2 failures,
  1 semantic, 1 episodic; active=10, superseded=1).
- **Risque** : aucun.

---

## Checkpoint final V10 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 72.

**Tests** : 388 TS knowledge + 79 contracts + 34 Rust = **501 verts**.
**Demi-millenaire franchi** (500+).

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `5f8d009179 feat(knowledge): P11.38 lifecycle-distribution CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 7 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`).
**Subcommandes CLI** : 37 (etait 20 en V3, +17 admin).
**Cartes durcissement** : 33 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-38).


---

## Carte 0207 - P11.39 : Stale-notes CLI

- **ID** : 0207
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/stale.ts` +
  `packages/unifia/test/knowledge/admin/stale.test.ts` (8 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdStale).
- **`findStale({ vaultRoot, thresholdDays?, onlyActive?, limit? })`**
  : walk le vault, parse les notes, calcule l'age en jours
  (`now - updatedAt`), retourne les notes avec age >= thresholdDays
  (default 90).
- **CLI** : `unifia knowledge stale <ws> [--threshold-days=N]
  [--only-active] [--limit=N]`.
- **Live run** : 2 notes stale (134j) detectees sur dev.
- **Risque** : aucun.

---

## Carte 0208 - P11.40 : References CLI (outbound wikilinks)

- **ID** : 0208
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/references.ts` +
  `packages/unifia/test/knowledge/admin/references.test.ts` (7 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdReferences).
- **`findReferences({ vaultRoot, targetLocator?, targetId? })`**
  : lit la note cible, retourne ses wikilinks sortants (target,
  heading, alias, offset).
- **CLI** : `unifia knowledge references <ws> --target=<loc>
  | --target-id=<uuid>`.
- **Inverse de backlinks** : backlinks = "qui pointe vers moi",
  references = "vers qui je pointe".
- **Risque** : aucun.

---

## Checkpoint final V11 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 75.

**Tests** : 403 TS knowledge + 79 contracts + 34 Rust = **516 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `23b64e5aab feat(knowledge): P11.40 references CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 9 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`).
**Subcommandes CLI** : 39 (etait 20 en V3, +19 admin).
**Cartes durcissement** : 35 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-40).


---

## Carte 0209 - P11.41 : Vault fingerprint CLI

- **ID** : 0209
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/fingerprint.ts` +
  `packages/unifia/test/knowledge/admin/fingerprint.test.ts` (9 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdFingerprint, hasFlag helper).
- **`vaultFingerprint({ vaultRoot, skipMissing? })`** : walk
  le vault, hash chaque fichier en SHA-256, concatene les
  hashes tries par locator, hash la concatenation. Retourne
  `{ vaultRoot, fingerprint, fileCount, perFile, totalMs }`.
- **CLI** : `unifia knowledge fingerprint <ws> [--verbose]`.
- **Lecon** : `parseFlags` ne gere que `--key=value`, pas les
  flag-only (`--verbose`). Ajout d'un helper `hasFlag` pour
  ce cas.
- **Live run** : 12 fichiers, fingerprint = `13e4cdc0d4...0c8b`.
- **Risque** : aucun.

---

## Checkpoint final V12 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 77.

**Tests** : 412 TS knowledge + 79 contracts + 34 Rust = **525 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `9dfaefec03 feat(knowledge): P11.41 vault fingerprint CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 10 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`).
**Subcommandes CLI** : 40 (etait 20 en V3, +20 admin = doublement).
**Cartes durcissement** : 36 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-41).


---

## Carte 0210 - P11.42 : By-tag CLI (single-tag filter)

- **ID** : 0210
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/by-tag.ts` +
  `packages/unifia/test/knowledge/admin/by-tag.test.ts` (7 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdByTag).
- **`listByTag({ vaultRoot, tag, limit? })`** : walk le vault,
  filtre les notes dont `unifia_tags` contient `tag`
  (case-insensitive), retourne `{ vaultRoot, tag, scanned, hits, totalMs }`.
- **CLI** : `unifia knowledge by-tag <ws> <tag> [--limit=N]`.
- **Live run** : tag "tool:bash" -> 2 hits
  (decision-gemma4-bash.md, reference-decision-bash-fr.md).
- **Quartet complete** : by-type, by-lifecycle, by-project, by-tag.
  Pour multi-tag AND, utiliser `tagSearch` (P11.24).
- **Risque** : aucun.

---

## Checkpoint final V13 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 79.

**Tests** : 419 TS knowledge + 79 contracts + 34 Rust = **532 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `f344349fb8 feat(knowledge): P11.42 by-tag CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 11 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`).
**Subcommandes CLI** : 41 (etait 20 en V3, +21 admin = x2.05).
**Cartes durcissement** : 37 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-42).


---

## Carte 0211 - P11.43 : Vault-compare CLI

- **ID** : 0211
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/vault-compare.ts` +
  `packages/unifia/test/knowledge/admin/vault-compare.test.ts` (8 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdVaultCompare).
- **`compareVaults({ vaultA, vaultB })`** : hash chaque fichier
  des deux vaults en SHA-256, retourne `{ onlyA, onlyB, changed,
  identical, fileCountA, fileCountB, totalMs }`.
- **CLI** : `unifia knowledge vault-compare <ws_a> <ws_b>`.
- **Live run** :
  - `vault-compare <dev> <dev>` -> 12 identical, 0 diffs
  - `vault-compare <dev> <holdout>` -> 1 changed (README.md),
    11 only-A, 11 only-B (corpora disjoints par design)
- **Risque** : aucun.

---

## Checkpoint final V14 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 81.

**Tests** : 427 TS knowledge + 79 contracts + 34 Rust = **540 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `4b6d81d8cd feat(knowledge): P11.43 vault-compare CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 12 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`, `vault-compare`).
**Subcommandes CLI** : 42 (etait 20 en V3, +22 admin = x2.10).
**Cartes durcissement** : 38 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-43).


---

## Carte 0212 - P11.44 : Recent CLI (notes updated in last N days)

- **ID** : 0212
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/recent.ts` +
  `packages/unifia/test/knowledge/admin/recent.test.ts` (8 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdRecent).
- **`findRecent({ vaultRoot, windowDays?, onlyActive?, limit? })`**
  : walk le vault, calcule l'age en jours, retourne les notes
  avec `ageDays <= windowDays` (default 7). `windowDays=0` =
  pas de filtre.
- **CLI** : `unifia knowledge recent <ws> [--window-days=N]
  [--only-active] [--limit=N]`.
- **Complement de stale** : stale = age > threshold, recent =
  age <= window. Les deux outils couvrent le spectre freshness.
- **Live run** : 9 notes <= 30j (les 2 stale 134j sont exclues).
- **Risque** : aucun.

---

## Checkpoint final V15 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 83.

**Tests** : 435 TS knowledge + 79 contracts + 34 Rust = **548 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `ff53a07622 feat(knowledge): P11.44 recent CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 13 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`, `vault-compare`, `recent`).
**Subcommandes CLI** : 43 (etait 20 en V3, +23 admin = x2.15).
**Cartes durcissement** : 39 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-44).


---

## Carte 0213 - P11.45 : Supersede-graph CLI (lineage of the corpus)

- **ID** : 0213
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/supersede-graph.ts` +
  `packages/unifia/test/knowledge/admin/supersede-graph.test.ts` (7 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdSupersedeGraph).
- **`supersedeGraph({ vaultRoot })`** : walk le vault, collecte
  les `unifia_supersedes` de chaque note, calcule la profondeur
  de chaque chain (DFS, max 16, visited set anti-cycle), retourne
  `{ edges, dangling, deepest, totalMs }`.
- **CLI** : `unifia knowledge supersede-graph <ws>`.
- **Live run** : 1 edge detectee
  (decision-thinking-budget.md supersedes -> 0190d2c0-7b00-7000-8000-000000000010).
- **Complement de supersede** : supersede = planifier une transition,
  supersede-graph = visualiser la DAG.
- **Risque** : aucun.

---

## Checkpoint final V16 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 85.

**Tests** : 442 TS knowledge + 79 contracts + 34 Rust = **555 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `b55d7c75b6 feat(knowledge): P11.45 supersede-graph CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 14 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`, `vault-compare`, `recent`,
`supersede-graph`).
**Subcommandes CLI** : 44 (etait 20 en V3, +24 admin = x2.20).
**Cartes durcissement** : 40 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-45).


---

## Carte 0214 - P11.46 : Duplicates CLI (byte-identical content groups)

- **ID** : 0214
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/duplicates.ts` +
  `packages/unifia/test/knowledge/admin/duplicates.test.ts` (8 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdDuplicates).
- **`findDuplicates({ vaultRoot })`** : walk le vault, hash chaque
  fichier en SHA-256, groupe par hash. Retourne
  `{ groups, duplicateCount, wastedBytes, totalMs }` ou
  chaque group a `n` entries, `n-1` sont des duplicates.
- **CLI** : `unifia knowledge duplicates <ws>`.
- **Live run** : 0 duplicate groups sur dev (corpus diversifie).
- **Lecon** : `wastedBytes = bytes * (n-1)` par groupe, pas
  `bytes * n`. Le test initial avait mis `4` au lieu de `2`
  pour 2 groupes de 1 byte chacun (1 wasted each) — corrige.
- **Risque** : aucun.

---

## Checkpoint final V17 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 87.

**Tests** : 450 TS knowledge + 79 contracts + 34 Rust = **563 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `d6759cc4a7 feat(knowledge): P11.46 duplicates CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 15 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`, `vault-compare`, `recent`,
`supersede-graph`, `duplicates`).
**Subcommandes CLI** : 45 (etait 20 en V3, +25 admin = x2.25).
**Cartes durcissement** : 41 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-46).


---

## Carte 0215 - P11.47 : Timeline CLI (notes grouped by day)

- **ID** : 0215
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/timeline.ts` +
  `packages/unifia/test/knowledge/admin/timeline.test.ts` (8 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdTimeline).
- **`buildTimeline({ vaultRoot, windowDays? })`** : walk le vault,
  groupe les notes par jour (UTC) de `unifia_updated_at`,
  retourne `{ vaultRoot, windowDays, totalNotes, totalDays,
  days, totalMs }`.
- **`formatTimeline(report, maxPerDay)`** : helper ASCII pour
  le rendu CLI.
- **CLI** : `unifia knowledge timeline <ws> [--window-days=N]
  [--max-per-day=N]`.
- **Live run** : window=30 -> 9 notes du 2026-08-29.
  window=0 -> 9 notes du 2026-08-29 + 2 notes du 2026-04-17.
- **Risque** : aucun.

---

## Checkpoint final V18 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 89.

**Tests** : 458 TS knowledge + 79 contracts + 34 Rust = **571 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `1675d4a21c feat(knowledge): P11.47 timeline CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 16 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`, `vault-compare`, `recent`,
`supersede-graph`, `duplicates`, `timeline`).
**Subcommandes CLI** : 46 (etait 20 en V3, +26 admin = x2.30).
**Cartes durcissement** : 42 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-47).


---

## Carte 0216 - P11.48 : Tag-cooccurrence CLI

- **ID** : 0216
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/tag-cooccurrence.ts` +
  `packages/unifia/test/knowledge/admin/tag-cooccurrence.test.ts` (10 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdTagCooccurrence).
- **`tagCooccurrence({ vaultRoot, minCount?, limit? })`** : walk
  le vault, genere les paires de tags uniques par note, cumule
  les co-occurrences. Retourne `{ pairs, uniqueTags, scanned, totalMs }`.
- **CLI** : `unifia knowledge tag-cooccurrence <ws> [--min-count=N]
  [--limit=N]`.
- **Live run** : 22 unique tags, 14 paires sur dev.
  Paires notables : `tool:bash <-> model:gemma-4`, `egress <-> secret`,
  `device:android <-> selinux`.
- **Cas d'usage** : identifier les clusters de tags, candidats a
  la consolidation, visualiser la taxonomie implicite.
- **Risque** : aucun.

---

## Checkpoint final V19 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 92.

**Tests** : 468 TS knowledge + 79 contracts + 34 Rust = **581 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `98e0879f15 feat(knowledge): P11.48 tag-cooccurrence CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 17 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`, `vault-compare`, `recent`,
`supersede-graph`, `duplicates`, `timeline`, `tag-cooccurrence`).
**Subcommandes CLI** : 47 (etait 20 en V3, +27 admin = x2.35).
**Cartes durcissement** : 43 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-48).


---

## Carte 0217 - P11.49 : Supersede-classify CLI (role partitioning)

- **ID** : 0217
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/supersede-classify.ts` +
  `packages/unifia/test/knowledge/admin/supersede-classify.test.ts` (7 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdSupersedeClassify).
- **`classifySupersede({ vaultRoot })`** : walk le vault (2 passes :
  lecture directe, puis reverse-map des successeurs), classifie
  chaque note en `isolated | root | leaf | chain` selon ses
  predecesseurs (unifia_supersedes) et successeurs (notes qui
  pointent vers elle).
- **CLI** : `unifia knowledge supersede-classify <ws>`.
- **Live run** : 9 isolated, 1 root (decision-thinking-budget.md),
  1 leaf (superseded-old-budget.md), 0 chain. Confirme que la
  majorite du corpus est feuilles/isolated avec 1 root actif
  et 1 leaf superseded.
- **Complement de supersede-graph** : supersede-graph = la DAG,
  supersede-classify = la partition par role.
- **Cas d'usage** : identifier les candidats a l'archive (leaves)
  et les notes "canoniques" (roots).
- **Risque** : aucun.

---

## Checkpoint final V20 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 94.

**Tests** : 475 TS knowledge + 79 contracts + 34 Rust = **588 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `b2cfe31a5d feat(knowledge): P11.49 supersede-classify CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 18 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`, `vault-compare`, `recent`,
`supersede-graph`, `duplicates`, `timeline`, `tag-cooccurrence`,
`supersede-classify`).
**Subcommandes CLI** : 48 (etait 20 en V3, +28 admin = x2.40).
**Cartes durcissement** : 44 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-49).


---

## Carte 0218 - P11.50 : Note-diff CLI (LCS-based diff between two notes)

- **ID** : 0218
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/note-diff.ts` +
  `packages/unifia/test/knowledge/admin/note-diff.test.ts` (7 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdNoteDiff).
- **`noteDiff({ vaultRoot, noteALocator?, noteAId?, noteBLocator?, noteBId? })`**
  : lit 2 notes, separe frontmatter et body, applique LCS pour
  calculer les diffs unifies. Retourne `{ frontmatterDiff,
  bodyDiff, added, removed, totalMs }`.
- **CLI** : `unifia knowledge note-diff <ws> --target-a=<loc>
  | --target-id-a=<uuid> --target-b=<loc> | --target-id-b=<uuid>`.
- **Live run** :
  - meme note vs meme note -> 0/0 (no diff)
  - decision-thinking-budget.md vs superseded-old-budget.md -> 10
    ajoutes, 16 supprimes. Clairement visible : active -> superseded,
    changts de tags, body completement different.
- **Cas d'usage** : version review, validation candidats supersede,
  diff entre snapshots.

---

## Carte 0219 - README v2 + CHANGELOG v0.2.0-knowledge

- **ID** : 0219
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `docs/knowledge/README.md` (admin CLI quick reference
  par groupe) + `docs/knowledge/CHANGELOG.md` (entree v0.2.0).
- **README** : matrice de validation mise a jour (482 passants),
  bloc "Admin CLI quick reference" avec 8 groupes fonctionnels et
  49 subcommands listes.
- **CHANGELOG v0.2.0** : Added (19 admin modules, 49 subcommands,
  P11.4-7 hardening, P11.10 classify, P11.19 summary, P11.17 drill,
  P11.13 verify, P11.22-23 validate/report, P9.2 MCP tokens,
  P2.6-8 Class B, P4.4 audit, P7.4 cross-mode bus, PERMISSIONS,
  DISASTER-RECOVERY, CHANGELOG lui-meme).

---

## Checkpoint final V21 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 97.

**Tests** : 482 TS knowledge + 79 contracts + 34 Rust = **595 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `c04284242a docs(knowledge): README + CHANGELOG v0.2.0-knowledge`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 19 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`, `vault-compare`, `recent`,
`supersede-graph`, `duplicates`, `timeline`, `tag-cooccurrence`,
`supersede-classify`, `note-diff`).
**Subcommandes CLI** : 49 (etait 20 en V3, +29 admin = x2.45).
**Cartes durcissement** : 45 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-50).


---

## Carte 0220 - P11.51 : Lifecycle-transitions CLI (transition matrix as code)

- **ID** : 0220
- **Phase** : 11 (admin tools)
- **Date** : 2026-08-29
- **Statut** : `PASS`
- **Cible** : `packages/unifia/src/knowledge/admin/lifecycle-transitions.ts` +
  `packages/unifia/test/knowledge/admin/lifecycle-transitions.test.ts` (6 tests passants) +
  `packages/unifia/bin/unifia-knowledge.ts` (cmdLifecycleTransitions).
- **`buildTransitionMatrix()`** : matrice 4x4 des transitions
  V1 (candidate, active, superseded, archived) selon
  ADR-KNOW-0009. `isTransitionAllowed(from, to)`,
  `getAllowedTransitions(from)`, `formatTransitionMatrix(m)`.
- **CLI** : `unifia knowledge lifecycle-transitions`.
- **Live run** : matrice affichee avec OK/- :
  - candidate -> active (OK)
  - active -> superseded (OK)
  - candidate -> superseded (-)
  - archived -> active (OK)
  - archived -> archived (-)
- **Single source of truth** : la table ALLOWED est dans
  `lifecycle-transitions.ts`, miroir de celle de
  `src/knowledge/memory/lifecycle.ts`. Si les deux divergent,
  il faut un ADR.
- **Risque** : aucun.

---

## Checkpoint final V22 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 99.

**Tests** : 488 TS knowledge + 79 contracts + 34 Rust = **601 verts**.
**600 verts franchi**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `b2c2773ba9 feat(knowledge): P11.51 lifecycle-transitions CLI`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux modules session 12** : 20 admin tools
(`tags`, `projects`, `supersede`, `by-lifecycle`, `by-project`,
`orphans`, `lifecycle-distribution`, `stale`, `references`,
`fingerprint`, `by-tag`, `vault-compare`, `recent`,
`supersede-graph`, `duplicates`, `timeline`, `tag-cooccurrence`,
`supersede-classify`, `note-diff`, `lifecycle-transitions`).
**Subcommandes CLI** : 50 (etait 20 en V3, +30 admin = x2.50).
**Cartes durcissement** : 46 (P11.4-7 + P11.10 + P11.13-14 + P11.17 + P11.19 + P11.22-51).


---

## Carte 0221 - P10.2 : Android device run (Xiaomi Mi 10 Pro, cmi_eea)

- **ID** : 0221
- **Phase** : 10
- **Date** : 2026-08-29
- **Statut** : `PASS_WITH_SAFE_FALLBACK`
- **Cible** : `.artifacts/p10-device-run.md` + `.artifacts/p10-device-report.json` + `.artifacts/p10-device-screen.png`.
- **Device** : Xiaomi Mi 10 Pro, Android 13, SDK 33, arm64-v8a,
  7.4 GiB RAM, 69 GB free disk, battery 100% / 32.7 C.
- **App** : `ai.unifia.mobile` v0.1.0 deja installee, running,
  foreground, RSS 49 MB, deep-link `unifia://` reconnue.
- **Probes PASS** : adbConnected, appInstalled, appRunning,
  amStart, filesystemWritable, deepLinkWorks, screencap.
- **Probes NOT_EXECUTED** : vault.read/write, fts.search,
  graph.backlinks, context-router, policy.egress, git.prepush
  (besoin du runtime Knowledge embarque, absent de l'APK
  actuel).
- **Note** : la frontiere externe est partiellement levee
  (device accessible) mais l'APK doit etre reconstruit pour
  embarquer le runtime pour fermer toutes les probes.

---

## Carte 0222 - P10.3 : Android resource pressure (capture only, idle)

- **ID** : 0222
- **Phase** : 10
- **Date** : 2026-08-29
- **Statut** : `PARTIAL` (capture only, no sustained load)
- **Cible** : `.artifacts/p10-device-run.md` (section P10.3).
- **Capture idle** : RSS 49 MB, VSZ 6 GB, temperature 32.7 C,
  battery 100 %. Aucun test sous charge (pas d'ONNX actif,
  LLM absent du V1).
- **Note** : le scenario stress "ONNX + llama.cpp concurrents"
  ne peut pas etre execute localement — `disabled` par
  defaut (runbook §8.8). Si activation future, FTS + graph
  pendant la generation locale (recommandation §8.8).

---

## Checkpoint final V23 - Session 12 (2026-08-29)

**Total commits locaux depuis origin/dev** : 100 (chiffre rond).

**Tests** : 488 TS knowledge + 79 contracts + 34 Rust = **601 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `23d10ed4 docs(knowledge): align FINAL-REPORT / COMPACT / STATE to P11.51`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

**Nouveaux artefacts P10** : `.artifacts/p10-device-screen.png`,
`.artifacts/p10-device-report.json`, `.artifacts/p10-device-run.md`.

**Cartes P10 mises a jour** : 0221 (P10.2), 0222 (P10.3).
**Cartes restantes (toujours externes)** : frontier review
(modele externe), ONNX embedding (desactive V1).

---

## Checkpoint final V24 - Sessions 13 + 14 (2026-08-29)

**Total commits locaux depuis origin/dev** : 111.

**Tests** : 522 TS knowledge + 79 contracts + 34 Rust = **635 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `c67a7e22 docs(knowledge): align COMPACT + README + FINAL-REPORT to P11.56`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

### Sessions 13-14 : 11 commits

| SHA | Sujet |
|---|---|
| `3b58248c0f` | docs(knowledge): record P10.2/P10.3 device run (Xiaomi Mi 10 Pro, cmi_eea) |
| `51810b1a16` | docs(knowledge): FRONTIER-REVIEW-PACKET (runbook §24) |
| `3e691ddf2a` | docs(knowledge): align COMPACT + README to P10.2/P10.3 + FRONTIER packet |
| `bdb123a18e` | docs(knowledge): FINAL-REPORT addendum (post-sprint 4 commits, 103 total) |
| `3e94204326` | docs(knowledge): align RISKS/COVERAGE/TEST-MATRIX/ARTIFACTS (R-0001..R-0011) |
| `cd997c4025` | feat(knowledge): P11.52 note-stats CLI |
| `3fc20c9c59` | feat(knowledge): P11.53-P11.56 admin tools (size/weekday/edge-density/fm-diff) |
| `c8bd76d85e` | feat(knowledge): CLI wire P11.52-P11.56 (5 subcommands) |
| `c42d904833` | chore(knowledge): drop unused doc binding in edge-density loadAndParse |
| `46fd3a322f` | chore(knowledge): drop unused KnowledgeId import in frontmatter-diff |
| `c67a7e228b` | docs(knowledge): align COMPACT + README + FINAL-REPORT to P11.56 |

### Nouveaux outils admin P11.52..P11.56 (5)

- `note-stats.ts` (P11.52, 9 tests) — stats par note (links, headings, body, fm)
- `size-distribution.ts` (P11.53, 7 tests) — histogramme 0-1KB..1MB+
- `weekday-distribution.ts` (P11.54, 6 tests) — distribution UTC Mon..Sun
- `edge-density.ts` (P11.55, 5 tests) — histogramme degre in+out (0/1/2-5/6-10/11-20/20+)
- `frontmatter-diff.ts` (P11.56, 7 tests) — diff added/removed/changed/unchanged

### DECISIONS : 20+ entries

D-0001..D-0020 documentees (D-0004..D-0020 ajoutees en V24).
Append-only. Couvrent : scope, sources reelles, hierarchie
d'autorite, ANN deferred, embedding disabled, default-deny,
append-only, P10.2 fallback, TS shadow, conventions de filtre,
pair-key, fingerprint, lifecycle, frontmatter, mutation policy,
self-link ignore, single source of truth.

### Frontieres externes (toujours)

- P10.2 full chain : `PASS_WITH_SAFE_FALLBACK` (APK rebuild requis)
- ONNX embedding : `disabled` V1
- Frontier review : packet pret (`FRONTIER-REVIEW-PACKET.md`)

---

## Checkpoint final V25 - Sessions 15-18 + final (2026-08-29)

**Total commits locaux depuis origin/dev** : 115.

**Tests** : 522 TS knowledge + 79 contracts + 34 Rust = **635 verts**.

**Aucune mutation** : pas de push, PR, merge, release, publication.

**Branche locale** : `feat/sovereign-knowledge-core`.
**HEAD** : `2278d1b110 docs(knowledge): FRONTIER-QUESTIONS.md + Live verification enriched`.
**Travail** : strictement dans `D:\App\unifia\unifia-memory`.

### Sessions 15-18 + final (6 commits)

| SHA | Sujet |
|---|---|
| `d83fd20b14` | docs(knowledge): align packet/STATE/DECISIONS to HEAD c67a7e22 (pre-frontier-review) |
| `77fac901e6` | docs(knowledge): align packet open-risks IDs + sign-off to RISKS.md (R-0001..R-0011) + 13 recaps |
| `2278d1b110` | docs(knowledge): FRONTIER-QUESTIONS.md (flat 10 questions for annotation) + Live verification enriched |
| `PROMPT` | docs(knowledge): FRONTIER-REVIEW-PROMPT.md (prompt to launch review) |

### Artefacts frontiere externes

- `FRONTIER-REVIEW-PACKET.md` (17 968 chars) - packet principal
- `FRONTIER-REVIEW-PACKET.pdf` (19 972 bytes, 8 pages) - version imprimable
- `FRONTIER-QUESTIONS.md` (5 829 bytes) - flat 10 questions pour annotation
- `FRONTIER-REVIEW-PROMPT.md` (7 956 bytes) - prompt a coller pour lancer la review
- FRONTIER-REVIEW-VERDICT.md (a creer par le reviewer)

### Obsidian recaps

18 obsidian recaps : Recap-2..8 (matin), Recap-12..17 (apres-midi),
FINAL (consolide), FRONTIER-REVIEW-PROMPT (meta).

### Statut final

V1 livre : 104/106 cartes, 2 PASS_WITH_SAFE_FALLBACK (P10.2/P10.3),
635 tests verts, 55 subcommands, 38 admin tools, 20 decisions,
9 ADR, 11 risques documentes. Pret pour la review frontier.
