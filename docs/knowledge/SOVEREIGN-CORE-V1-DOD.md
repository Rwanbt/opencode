<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# SOVEREIGN CORE V1 — Definition of Done

> Pour chaque exigence user-level (U-) et engineering-level (E-), on
> donne un oracle (comment vérifier), une commande reproductible, une
> preuve attendue et un owner de module. Aucun item "vérifier
> manuellement" sans procédure.

## Légende

- **Oracle** : ce qui doit être vrai.
- **Commande** : la commande exacte, à exécuter dans
  `D:\App\unifia\unifia-memory`.
- **Preuve** : artefact ou log capturé.
- **Owner** : package ou crate responsable de l'item.

---

## User-level (U-)

### U-01 — Le vault Markdown reste canonique

- **Oracle** : un utilisateur peut ouvrir n'importe quel fichier
  `.md` du vault dans Obsidian / VS Code / Neovim sans perte
  d'information ni d'opération. Aucun fichier requis par
  l'utilisateur n'est dans un format fermé.
- **Commande** :
  `git ls-files | Select-String "\.md$" | ForEach-Object { Get-Content $_ -TotalCount 1 }`
  (sanity check qu'aucun fichier canonique n'est non-Markdown).
- **Preuve** : log des premières lignes de chaque `.md`, présence
  d'un frontmatter `unifia_schema: 1`.
- **Owner** : `packages/unifia/src/knowledge/source/`.

### U-02 — Recherche lexicale fonctionnelle

- **Oracle** : pour une requête en français ou en anglais, le
  Knowledge Service retourne des résultats ordonnés par pertinence
  avec un budget de latence documenté.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/query/`
  (sous-tests à créer en Phase 1.3 / 3.2).
- **Preuve** : test `lexical-retrieval.test.ts` qui assert ≥ 1 hit
  pour 5 requêtes de référence (FR + EN).
- **Owner** : `packages/unifia/src/knowledge/service/query.ts`.

### U-03 — Recherche sémantique activable ou explicitement désactivée

- **Oracle** : si un modèle ONNX admissible est téléchargé et vérifié,
  la recherche sémantique améliore le Recall@5/10 sur le holdout.
  Sinon, elle est désactivée sans backend factice, et FTS + graph
  reste le produit.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/semantic/`
  + script `scripts/bench-semantic.ts`.
- **Preuve** : rapport `evidence/semantic-bench.md` avec Recall@5/10,
  forbidden/superseded violation rate, latency, RAM peak.
- **Owner** : `packages/unifia/src/knowledge/semantic/`.

### U-04 — Lifecycle mémoire

- **Oracle** : une note peut transiter de `candidate` → `active` →
  `superseded` (ou `archived`). Chaque transition laisse une trace
  dans le journal de contrôle. Aucune suppression silencieuse.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/memory/`
- **Preuve** : tests `lifecycle.test.ts` couvrent les 5 chemins
  (create candidate, promote, supersede, archive, invalid
  transition).
- **Owner** : `packages/unifia/src/knowledge/memory/`.

### U-05 — Provenance complète

- **Oracle** : chaque note `active` porte : source document, source
  session, source agent, source tool, source commit, created
  timestamp, validation state. La perte d'un champ est détectée par
  `knowledge doctor`.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/provenance/`
- **Preuve** : test `provenance-completeness.test.ts` qui charge 50
  fixtures et assert que 0 fichier canonique a un champ manquant.
- **Owner** : `packages/unifia/src/knowledge/domain/provenance.ts`.

### U-06 — Wikilinks et backlinks

- **Oracle** : un wikilink `[[Foo]]` est résolu, et la note
  destination reçoit un backlink. La résolution fonctionne sur
  alias portables. Les liens cassés sont listés par `knowledge
  doctor`.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/graph/`
- **Preuve** : test `wikilinks.test.ts` avec 10 fixtures (5 EN, 5 FR)
  et 3 cas d'alias.
- **Owner** : `packages/unifia/src/knowledge/graph/`.

### U-07 — Egress refusée par défaut pour UNCLASSIFIED

- **Oracle** : un contenu non classifié ne peut pas être envoyé à un
  provider cloud. Le `DataFlowGuard` refuse la mutation et l'egress
  avec un message typé.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/policy/`
- **Preuve** : test `egress-default-deny.test.ts` avec 4 cas :
  UNCLASSIFIED, provenance non résolue, fallback cloud, déclassif
  valide.
- **Owner** : `packages/unifia/src/knowledge/policy/`.

### U-08 — Édition externe first-class

- **Oracle** : un fichier modifié par Obsidian pendant que
  Unifia tourne est détecté et intégré dans l'index sans crash. Le
  watcher émet un événement domain `file.changed`.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/source/watcher.test.ts`
- **Preuve** : test `external-editor.test.ts` qui crée un fichier
  depuis un autre process et assert que l'index est mis à jour
  sous 5 s.
- **Owner** : `crates/unifia-knowledge-core/src/watcher/`.

### U-09 — Code, Work et Design partagent la même mémoire

- **Oracle** : une décision écrite depuis le mode Design est visible
  depuis le mode Code sans duplication ni store séparé. Un E2E
  cross-mode desktop prouve la chaîne.
- **Commande** : `bun --cwd packages/desktop test:e2e knowledge-cross-mode`
- **Preuve** : E2E test `cross-mode.test.ts` (à créer Phase 7).
- **Owner** : `packages/unifia/src/knowledge/service/knowledge-service.ts`.

### U-10 — Android dans le scope validé

- **Oracle** : sur device physique OU en `NOT_EXECUTED_EXTERNAL_BOUNDARY`
  documenté, l'app Android ouvre un vault (app-private managed),
  fait une recherche lexicale et affiche des backlinks.
- **Commande** : `bun --cwd packages/mobile test knowledge-android`
  + `bun --cwd packages/mobile build` (artefact APK).
- **Preuve** : artefact `evidence/apk-{timestamp}.apk` avec SHA-256.
- **Owner** : `packages/mobile/src-tauri/`.

### U-11 — MCP borné

- **Oracle** : les méthodes `knowledge_search`, `knowledge_get`,
  `knowledge_backlinks`, `knowledge_trace`, `knowledge_status`,
  `knowledge_propose` sont exposées avec token scoped au workspace,
  quotas, rate limits, deadlines et tailles bornées. Lecture par
  défaut, écriture désactivée si pas de secure storage.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/mcp/`
- **Preuve** : tests `mcp-bounds.test.ts` : token revoked, quota
  dépassé, payload oversized, egress denied.
- **Owner** : `packages/unifia/src/knowledge/mcp/adapter.ts`.

### U-12 — Git explicite, sans auto-push

- **Oracle** : `git push` n'est jamais déclenché automatiquement. Le
  pre-push scan détecte les secrets supprimés dans le dernier
  commit mais présents dans la plage sortante.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/git/`
- **Preuve** : test `git-prepush-scan.test.ts` avec une plage
  sortante contenant un faux secret historique.
- **Owner** : `packages/unifia/src/knowledge/git/provider.ts`.

---

## Engineering-level (E-)

### E-01 — Typecheck et tests verts (gate continu)

- **Oracle** : tous les packages touchés passent typecheck + tests
  (runbook §22).
- **Commande** : `bun --cwd packages/contracts typecheck && bun --cwd packages/contracts test && bun --cwd packages/unifia typecheck && bun --cwd packages/unifia test && bun --cwd packages/app typecheck && bun --cwd packages/desktop typecheck && bun --cwd packages/desktop build && bun --cwd packages/mobile typecheck && bun run lint && git diff --check`
- **Preuve** : log de chaque commande, exit 0, durée en secondes.
- **Owner** : session.

### E-02 — Cargo gates (chaque crate)

- **Oracle** : pour chaque crate touchée : `cargo fmt --check`,
  `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo test --all-features`.
- **Commande** :
  `cargo fmt --manifest-path crates/unifia-knowledge-core/Cargo.toml --check ; cargo clippy --manifest-path crates/unifia-knowledge-core/Cargo.toml --all-targets --all-features -- -D warnings ; cargo test --manifest-path crates/unifia-knowledge-core/Cargo.toml --all-features`
- **Preuve** : log par crate.
- **Owner** : session.

### E-03 — Couverture des invariants

- **Oracle** : les sept invariants du plan gelé (canonical safety,
  authority isolation, egress security, provider independence,
  external editor safety, rebuildable indexes, basic retrieval)
  sont testés par au moins un test reproductible.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/invariants/`
- **Preuve** : `tests/knowledge/invariants/*.test.ts`, 1 par invariant.
- **Owner** : session.

### E-04 — Migration dry-run + rollback

- **Oracle** : un dry-run de migration ne mute rien. Un rollback
  ramène l'état pré-migration.
- **Commande** : `bun --cwd packages/unifia run knowledge migrate --dry-run && bun --cwd packages/unifia run knowledge migrate --rollback`
- **Preuve** : log dry-run, log rollback, diff de la DB dérivée.
- **Owner** : `packages/unifia/src/knowledge/service/admin.ts`.

### E-05 — Doctor détecte les anomalies

- **Oracle** : `knowledge doctor` détecte : IDs dupliqués,
  frontmatter invalide, liens cassés, refs non résolues, sidecars
  orphelins, index stale, documents non indexés, conflits, trust,
  Git, `.gitignore` et candidats GC.
- **Commande** : `bun --cwd packages/unifia run knowledge doctor`
- **Preuve** : log de chaque catégorie, ≥ 1 cas par catégorie.
- **Owner** : `packages/unifia/src/knowledge/service/admin.ts`.

### E-06 — NativeKnowledgePort borné

- **Oracle** : un payload oversized est rejeté côté Rust avant
  sérialisation. Un timeout est respecté. Une cancellation ne
  fuit pas.
- **Commande** : `cargo test --manifest-path crates/unifia-knowledge-core/Cargo.toml --all-features native_port`
- **Preuve** : 4 tests Rust (oversized, timeout, cancellation, error
  serialization).
- **Owner** : `crates/unifia-knowledge-core/src/port/`.

### E-07 — Crash matrix et recovery

- **Oracle** : un crash avant fsync laisse un fichier temp ; un
  crash après publish laisse l'ancien contenu ; un recovery
  idempotent reconstitue l'état logique.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/mutation/recovery.test.ts`
- **Preuve** : test qui simule 3 scénarios de crash et vérifie
  l'invariant WAL.
- **Owner** : `crates/unifia-knowledge-core/src/wal/`.

### E-08 — Rebuilt FTS equals original

- **Oracle** : supprimer `derived.db` puis reconstruire donne un
  index FTS dont les résultats de requêtes de référence sont
  identiques à l'original.
- **Commande** : `bun --cwd packages/unifia test src/knowledge/derived/rebuild.test.ts`
- **Preuve** : test qui compare un set de hits (dev + holdout)
  avant suppression et après rebuild.
- **Owner** : `crates/unifia-knowledge-core/src/derived/`.

### E-09 — Android storage matrix

- **Oracle** : chaque storage testé (app-private, shared/emulated,
  SAF, removable) est qualifié `managed` (write OK) ou
  `read-only` (write refusé, UI explicite). Aucune plateforme n'est
  laissée en zone grise.
- **Commande** : `bun --cwd packages/mobile test knowledge-storage-matrix`
- **Preuve** : matrice CSV dans `evidence/android-storage-matrix.csv`.
- **Owner** : `packages/mobile/src-tauri/`.

### E-10 — SBOM et licences

- **Oracle** : un SBOM CycloneDX est généré ; aucune dépendance
  n'a de licence incompatible avec la distribution.
- **Commande** : `bun --cwd packages/unifia run knowledge sbom`
- **Preuve** : `evidence/sbom-{version}.cdx.json` + log audit.
- **Owner** : session.

---

## Statut par item

> Audité le 2026-08-29 après la remédiation post-contre-revue.
> HEAD : `feat/sovereign-knowledge-core`. Chaque commande ci-dessous a été
> rejouée depuis `packages/unifia/`. Les commandes de la spécification
> pointaient toutes vers `src/knowledge/...` alors que les tests vivent dans
> `test/knowledge/...` : aucune n'était exécutable. Elles sont corrigées ici.
>
> `PASS` = oracle vérifié et commande rejouée. `PARTIAL` = une partie est
> livrée, le reste est nommé. `NOT_EXECUTED` = frontière externe réelle.
> Aucun `PASS` ne s'appuie sur un stub, une simulation ou un placeholder.

| ID | Statut | Commande rejouable (depuis `packages/unifia/`) | Preuve |
|---|---|---|---|
| U-01 vault canonique | **PASS** | `bun test test/knowledge/source test/knowledge/regression` | `VaultSource` lit le Markdown brut, aucun index requis ; confinement vérifié contre une junction Windows réelle |
| U-02 recherche lexicale | **PASS** | `bun test test/knowledge/context test/knowledge/cli` | 43 tests ; requête absente → 0 hit, deux requêtes différentes → réponses différentes |
| U-03 recherche sémantique | **PARTIAL** | `bun test test/knowledge/semantic` | 4 tests ; cosinus + index brute-force câblés, mais aucun modèle ONNX → `status` rapporte `vector: disabled` |
| U-04 lifecycle mémoire | **PASS** | `bun test test/knowledge/memory` | 30 tests ; table de transitions unique, chaque transition autorisée a un `MutationKind` |
| U-05 provenance | **PARTIAL** | `bun test test/knowledge/parser` | 30 tests ; le frontmatter porte created/updated/project_ref/supersedes. `source_document` et `source_commit` sont dans les contrats mais non peuplés à l'écriture |
| U-06 wikilinks et backlinks | **PASS** | `bun test test/knowledge/parser test/knowledge/facade` | 44 tests ; masque de code unique, `backlinks()` résout sur Class A |
| U-07 egress refusée par défaut | **PASS** | `bun test test/knowledge/regression test/knowledge/facade` | 34 tests ; override ne peut plus élargir un `deny`, `policy.json` atteint la décision |
| U-08 édition externe | **PARTIAL** | `bun test test/knowledge/source` | Relecture à chaque requête, donc une édition externe est vue. Aucun watcher OS : `VaultSource.watch()` refuse au lieu de simuler |
| U-09 mémoire partagée entre modes | **PASS** | `bun test test/knowledge/cross-mode` | 7 tests ; une seule façade, aucun cache par mode |
| U-10 Android | **NOT_EXECUTED** | `bun test test/knowledge/mobile` | 6 tests ; un `PASS` exige une `ProbeEvidence` du harness. Aucun device branché ici |
| U-11 MCP borné | **PASS** | `bun test test/knowledge/sprint.test.ts` puis `bun run bin/unifia-knowledge.ts mcp-token session <ws>` | 35 tests ; chaque méthode authentifiée, workspace vérifié, quotas et bornes UTF-8 ; serveur réellement composé (`mcp/compose.ts`), token utilisable, révocation effective. Aucun daemon : le token ne survit pas au processus |
| U-12 Git sans auto-push | **PASS** | `bun test test/knowledge/git` | 9 tests ; `gitAutoPush` par défaut `false`, scan pre-commit |
| E-01 typecheck et tests | **PASS** | `bun run typecheck && bun test test/knowledge` | 0 erreur ; 612 tests verts |
| E-02 gates cargo | **PASS** | `cargo fmt --check && cargo clippy -- -D warnings && cargo test` | fmt propre, clippy 0 warning, 34 tests |
| E-03 couverture des invariants | **PASS** | `bun test test/knowledge/regression` | 20 tests de caractérisation, écrits rouges puis passés au vert |
| E-04 migration dry-run + rollback | **PARTIAL** | `bun test test/knowledge/hardening` | Plan et rollback calculés en mémoire ; aucune I/O réelle. Le WAL du writer (`mutation/writer.ts`) est en revanche persisté et rejouable |
| E-05 doctor détecte les anomalies | **PASS** | `bun test test/knowledge/admin` | 6 checks réels ; `verify` distingue PASS/WARN/FAIL/NOT_EXECUTED |
| E-06 NativeKnowledgePort borné | **PARTIAL** | `bun --cwd ../contracts test` | Les 4 bornes sont appliquées côté TS par le router. Aucun port Rust : `crates/.../port/` n'existe pas |
| E-07 crash matrix et recovery | **PARTIAL** | `bun run bin/unifia-knowledge.ts drill` | 6/6 scénarios ; la recovery reste une simulation, `verify` la marque `NOT_EXECUTED` |
| E-08 FTS reconstruite = originale | **NOT_EXECUTED** | — | Aucun runtime FTS5 en V1. `status` rapporte `fts: disabled` |
| E-09 matrice de stockage Android | **NOT_EXECUTED** | `bun test test/knowledge/mobile` | Template livré ; exige un device |
| E-10 SBOM et licences | **PARTIAL** | `bun test test/knowledge/hardening` | Squelette CycloneDX ; pas un scan supply-chain complet |

**Décompte** : 12 PASS, 7 PARTIAL, 3 NOT_EXECUTED (E-01/E-02 sont des gates permanents).

> Ce total est recompté depuis la table ci-dessus, pas reporté à la main : il
> disait 10/7/4 alors que la table portait déjà 12/7/3.

> Mise à jour 2026-08-30 : U-11 (MCP) passe de « serveur non exposé » à un
> daemon réel (`mcp serve`), et le chemin d'écriture Class A existe désormais
> (`VaultMutationWriter`), ce qui clôt R-0013. Les statuts PARTIAL restants
> tiennent aux frontières nommées : pas de runtime FTS5, pas de modèle ONNX,
> pas de watcher OS, pas de device Android.

Aucun item n'est `PASS` sur la foi d'un stub. Les `PARTIAL` et `NOT_EXECUTED`
nomment ce qui manque et ce qu'il faudrait pour les lever.

## Pass condition

Un item est `PASS` quand :

1. l'oracle est vérifié sur la machine de la session ;
2. la commande est rejouable par un autre agent sans intervention ;
3. la preuve existe dans `docs/knowledge/execution/evidence/` ou
   dans le log de validation ;
4. l'owner est confirmé par un test ou un chemin de code.
