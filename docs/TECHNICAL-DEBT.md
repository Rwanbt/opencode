# Registre de dette technique — OpenCode (fork Rwanbt)

> **Document vivant.** Registre maître de la dette technique. À re-valider à chaque fin de sprint
> et avant tout push majeur (`/verify-standards`, `/health`).
> Dernière mise à jour : **2026-06-16** (audit ciblé modules roadmap-critiques).
> Liés : [ADR-0003 fork strategy](adr/0003-fork-strategy.md), [loc-debt-upstream.md](loc-debt-upstream.md),
> [KNOWN_FAILURE_PATTERNS.md](KNOWN_FAILURE_PATTERNS.md), [MOBILE-IDE-ROADMAP.md](MOBILE-IDE-ROADMAP.md),
> [ARCHITECTURE.md](ARCHITECTURE.md), [lock-hierarchy.md](lock-hierarchy.md).

## Philosophie (non négociable)

Ce projet vise une **stabilité long terme et une maintenabilité élevée**, pas une vélocité MVP.
En conséquence :

- **On ne livre pas de raccourci sciemment.** Un correctif partiel qui laisse une dette non tracée
  est interdit. Si on ne peut pas faire propre maintenant, on **trace la dette ici** avec un plan daté.
- **La dette se rembourse au point de contact** (règle Boy Scout) : on modifie un fichier → on corrige
  la dette voisine < 15 min ; sinon on l'inscrit ici.
- **Pas de dette silencieuse** : tout raccourci a une entrée dans ce registre + un `// DEBT:` dans le code
  référant l'ID de l'entrée (ex. `// DEBT: D-12`).
- **Stop-the-line** sur les catégories P0/P1 (voir SLA) : on ne construit pas par-dessus.

## Échelle de sévérité & SLA

| Niveau | Définition | SLA |
|--------|-----------|-----|
| **P0 — Critique** | Risque de corruption de données, faille sécurité, crash silencieux récurrent | Immédiat — stop-the-line |
| **P1 — Élevé** | Fragilité non testée sur chemin critique, data race, swallow d'erreur masquant des pannes | ≤ 7 jours |
| **P2 — Moyen** | God file, couplage fort, friction process, observabilité manquante | Backlog priorisé |
| **P3 — Faible / Upstream** | Dette héritée upstream hors scope fork, polish | Opportuniste / contribution upstream |

---

## 1. Inventaire de la dette

### A. Taille des fichiers / god files

Norme SonarQube : vert ≤ 500, alerte 800, bloquant 1500. État au 2026-06-16 :
**12 fichiers > 1500 LOC**, 38 entre 800-1500, 44 entre 500-800.

| ID | Fichier | LOC | Zone | Sévérité | Note |
|----|---------|-----|------|----------|------|
| D-01 | `packages/mobile/src-tauri/src/runtime.rs` | 1869 | **Fork** | **P1** | God file, 7 responsabilités — voir §E |
| D-02 | `packages/app/src/components/prompt-input.tsx` | 1482 | Fork | P2 | Approche le plancher bloquant |
| D-03 | `packages/app/src/pages/layout.tsx` | 1126 | Fork | P2 | Coordinateur, exception [ADR-0002](adr/0002-coordinator-loc-floor.md) |
| D-04 | `packages/app/src/components/settings-general.tsx` | 1108 | Fork | P2 | Décomposable par sections de réglages |
| D-05 | `packages/app/src/pages/session.tsx` | 1022 | Fork | P2 | Coordinateur, exception ADR-0002 |
| D-06 | Upstream god files (9 fichiers) | 1618–2292 | **Upstream** | P3 | `prompt.ts` 2085, `lsp/server.ts` 1958, `config.ts` 1802, `message-part.tsx` 2268, `provider.ts` 1618, TUI session index 2292, `github.ts` 1647, copilot model 1769, `acp/agent.ts` 1769 — voir [loc-debt-upstream.md](loc-debt-upstream.md) |

> **Note fork** : seuls les fichiers `packages/app/` sont sous gate LOC strict (ADR-0003). Les upstream
> (D-06) sont hors scope du gate mais restent une dette réelle si contribution upstream visée.

### B. Couverture de tests

| ID | Zone | État | Sévérité | Impact |
|----|------|------|----------|--------|
| D-07 | `packages/ui/src` | **3 fichiers de test** (≈ 0% sur file/tabs/composants critiques) | **P1** | L'éditeur Phase 1 atterrit là — régressions invisibles |
| D-08 | `packages/app/src` chemins critiques | `file.tsx` context, `file-tabs.tsx`, `session.tsx` **non testés** (~30% global) | P2 | Comportement UX critique non couvert |
| D-09 | Rust mobile `src-tauri/src` | **8 `#[test]`** (runtime schema + proxy uniquement) ; `llm.rs`, `speech.rs`, toolchain wrappers, server spawn **non testés** | **P1** | Chaîne shebang/symlinks/IPC LLM = chemin critique sans filet |

### C. Gestion d'erreurs / observabilité

| ID | Localisation | Pattern | Sévérité |
|----|-------------|---------|----------|
| D-10 | `file/index.ts` (≈368, 376, 627) | `orElseSucceed(() => [])` masque erreurs réseau/scan → scans incomplets silencieux | P2 |
| D-11 | `file/index.ts` (≈407, 411, 688) | `catchCause`/`Effect.catch(() => void)` → invalidation cache & échecs mkdir invisibles | P2 |
| D-12 | `runtime.rs` (≈766-820) | `let _ = fs::symlink(...)` / `remove_file(...)` → 50+ symlinks recréés par lancement, échec **non loggé** | **P1** |
| D-13 | `runtime.rs` `repair_rootfs_hardlinks` (159-199) | Continue silencieusement si binaire critique (gcc/g++) manquant après extraction | **P1** |

### D. Frontière fork (risque de divergence upstream)

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-14 | Discipline `// FORK:` | P2 | ADR-0003 impose des blocs délimités pour toute modif upstream. À vérifier que les ajouts roadmap (routes file/git, LSP) respectent ça pour absorber `git merge upstream/main` sans conflit. |
| D-15 | Graphe de dépendances stale | P3 | `graphify-out/` daté du commit `0238f7b7` (29/05) — re-générer après gros changements (`graphify update .`). |

### E. Fragilité du runtime mobile

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-16 | Chaîne shebang + LD_PRELOAD | **P1** | `binfmt_script → libbash_exec.so → libmusl_linker.so → ELF`. **Zéro test.** Échec en cascade silencieux si un maillon casse (ex. path mort après update APK). Documenté dans le code (5 CAVEAT) mais pas dans [KNOWN_FAILURE_PATTERNS.md](KNOWN_FAILURE_PATTERNS.md). |
| D-17 | Double bundling CLI | **P1** | `prepare-android-runtime.sh` (build local) ≠ `bundle-mobile.mjs` (CI) → risque de CLI stale embarquée (pattern de panne connu). |
| D-18 | État global serveur | P2 | `static SERVER_PROCESS: Mutex<Option<Child>>` (runtime.rs:16-17) — double `start_embedded_server()` rapproché peut orphaner une instance. |
| D-19 | Busybox static + seccomp | P2 | Applets interactifs (vi/less/top) crashent en SIGSYS ; fallback toybox non détecté à l'exécution. |

### F. Friction process

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-20 | Régénération SDK par route | P2 | Chaque route Hono exige `describeRoute()` + rebuild `packages/sdk/js`. Oubli = route invisible aux clients. ~10-15 min/route, pas de gate CI aujourd'hui. |
| D-21 | Tests runtime Android-gated en CI | P2 | `test.yml` ne lance que `proxy::tests` ; les tests `runtime.rs` sont `#[cfg(target_os="android")]` → inexécutables sur CI Linux. Aucun test émulateur/intégration. |

### G. Sécurité / invariants

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-22 | Guard d'écriture absent | **P1 (préventif)** | `assertInsideProject` (file/index.ts:513-526) protège `read/list/mkdir` mais **PAS l'écriture** (write/rename/move/delete n'existent pas encore). Tout ajout d'écriture DOIT passer ce guard — sinon évasion hors workspace. |

### H. Code désactivé / mort

| ID | Sujet | Sévérité | Détail |
|----|-------|----------|--------|
| D-23 | `/find/symbol` désactivé | P2 | `server/routes/file.ts:109-114` — `LSP.workspaceSymbol` commenté, renvoie `[]`. Désactivé par effet de bord d'une régén OpenAPI (commit f969b1dac), pas pour perf. Dette = fonctionnalité morte non documentée dans le code. |

### I. Dette marquée (TODO/FIXME/HACK)

État : app 17, ui 23, opencode 23, mobile 2. À auditer à chaque fin de session (règle globale) :
chaque occurrence doit avoir un ticket ou être résolue.

| ID | Action |
|----|--------|
| D-24 | Recenser les 65 marqueurs TODO/FIXME/HACK, les convertir en entrées datées ici ou les résoudre. |

---

## 2. TODO list (à cocher régulièrement)

> Cocher au fil de l'eau. Re-valider la liste complète à chaque fin de sprint.

### P0 — Critique (stop-the-line)
- [ ] *(aucune entrée P0 active au 2026-06-16 — maintenir vide)*

### P1 — Élevé (≤ 7 jours quand activé)
- [ ] **D-22** Implémenter le guard `assertInsideProject` sur write/rename/move/delete **avant** d'exposer la moindre route d'écriture.
- [ ] **D-12** Supprimer le swallow `let _ =` sur symlink/fs dans `runtime.rs`, ajouter logging d'échec.
- [ ] **D-13** `repair_rootfs_hardlinks` : vérifier la présence des binaires critiques post-extraction, logger les liens échoués.
- [ ] **D-16** Documenter la chaîne shebang+LD_PRELOAD dans `KNOWN_FAILURE_PATTERNS.md` (diagramme) + test d'idempotence `prepare_toolchain_wrappers()`.
- [ ] **D-17** Unifier le bundling CLI (`prepare-android-runtime.sh` ↔ `bundle-mobile.mjs`) sur une source unique.
- [ ] **D-07** Établir une suite de tests `packages/ui` (≥ composants critiques) — démarre avec l'editor-store.
- [ ] **D-09** Tests d'intégration Rust mobile pour toolchain wrappers + server spawn (avec rootfs mocké).
- [ ] **D-01** Décomposer `runtime.rs` en `{extraction, toolchain, server_lifecycle}` (réduit D-12/D-16/D-18).

### P2 — Moyen (backlog priorisé)
- [ ] **D-20** Ajouter un gate CI de synchro SDK (échoue si `packages/sdk/js` désynchronisé du serveur).
- [ ] **D-21** Rendre les tests `runtime.rs` exécutables hors Android (abstraction FS/OS) OU job émulateur CI.
- [ ] **D-10 / D-11** Ajouter du logging aux `orElseSucceed`/`catch` silencieux de `file/index.ts`.
- [ ] **D-08** Tests d'intégration `file-tabs.tsx`, `context/file.tsx`, `session.tsx`.
- [ ] **D-03 / D-05** Geler la croissance des coordinateurs (budgets : layout ≤ +30, session ≤ +80) ; extraire toute nouvelle logique en hooks/composants.
- [ ] **D-02** Décomposer `prompt-input.tsx` (1482) avant tout nouvel ajout.
- [ ] **D-04** Décomposer `settings-general.tsx` par sections de réglages.
- [ ] **D-23** Réactiver `/find/symbol` avec `Effect.timeout` + fallback, OU supprimer le code mort si non prévu.
- [ ] **D-18** Protéger `start_embedded_server()` contre les appels concurrents (single-flight).
- [ ] **D-19** Détection runtime des applets busybox défaillants + message clair.
- [ ] **D-14** Audit des modifs upstream : encadrer en blocs `// FORK:`.
- [ ] **D-24** Recenser/résoudre les 65 marqueurs TODO/FIXME/HACK.

### P3 — Faible / Upstream (opportuniste)
- [ ] **D-06** God files upstream — traiter via contribution upstream ou session dédiée Track B.
- [ ] **D-15** Re-générer le graphe graphify (`graphify update .`) après gros changements.

---

## 3. Plan de correction (séquencé, sans raccourci)

Principe : on rembourse d'abord ce qui **bloque la stabilité** (P1 sécurité/crash silencieux), puis ce qui
**réduit le coût de toute la suite** (tests + décomposition), puis le polish.

### Vague 1 — Sécuriser & rendre visible (P1, avant tout nouveau chantier d'écriture)
1. **D-22** Guard d'écriture (pré-requis absolu de la Phase 1 roadmap).
2. **D-12 + D-13** Tuer les swallows mobiles → toute panne devient observable.
3. **D-16** Documenter + tester la chaîne shebang (débloque toute confiance on-device).
4. **D-17** Source unique de bundling CLI.

*Sortie de vague* : plus aucun chemin critique mobile ni d'écriture ne peut échouer en silence.

### Vague 2 — Filet de tests & décomposition (réduit le coût futur)
5. **D-07 + D-09** Suites de tests `ui` et Rust mobile (intégration, pas seulement unitaire).
6. **D-01** Décomposer `runtime.rs` (s'appuie sur les tests de la vague 1-2).
7. **D-20** Gate CI synchro SDK (industrialise la friction des routes roadmap).
8. **D-21** Tests runtime exécutables hors Android.

*Sortie de vague* : modifications futures protégées par des tests ; god file mobile démantelé.

### Vague 3 — Hygiène continue & polish (P2/P3)
9. **D-10/D-11** Observabilité backend.
10. **D-08** Tests coordinateurs frontend.
11. **D-02/D-04** Décomposition god files fork.
12. **D-23** Trancher `/find/symbol` (réactiver proprement ou supprimer).
13. **D-18/D-19/D-24** Reste P2.
14. **D-06/D-15** Upstream & graphe.

> Les vagues 1-2 sont des **pré-requis** des Phases 1 et 4 de la [roadmap IDE](MOBILE-IDE-ROADMAP.md).
> Ne pas démarrer la Phase 4 (build/test on-device) avant la Vague 1 mobile.

---

## 4. Garde-fous anti-dette (prévention)

Pour éviter d'en réintroduire. À intégrer en CI et en revue.

### 4.1 Gates CI (bloquants)
- **Gate LOC** : échec si un fichier `packages/app/src` dépasse 1500 LOC (resserrer à 800 quand sain).
- **Gate synchro SDK** : échec si `packages/sdk/js` n'est pas régénéré après une modif de route.
- **Lint/format zéro warning** : `biome check`, `tsc --noEmit`, `cargo clippy -- -D warnings`.
- **Tests obligatoires** : la logique métier nouvelle DOIT venir avec ses tests (pas de merge sinon).
- **Dead code** : `knip` en CI ; tout code mort est supprimé (jamais commenté).

### 4.2 Politique de code (revue)
- **Zéro swallow d'erreur** : interdit `let _ =` sur I/O, `catch {}` vide, `orElseSucceed` sans log.
  Frontières système (I/O, réseau, FFI, parsing) → erreur gérée explicitement.
- **Guards de sécurité** : toute opération FS passe par `assertInsideProject` (ou équivalent).
- **Budgets** : fonction ≤ 50 LOC, complexité ≤ 10, imbrication ≤ 3 ; fichier ≤ 500 LOC (alerte 800).
- **Single Responsibility** : avant d'ajouter à un fichier, vérifier que le code y appartient.
- **Frontière fork** : modif upstream uniquement en blocs `// FORK:` ; préférer l'injection.
- **`// DEBT: D-NN`** : tout raccourci consenti est tracé ici + référencé dans le code.

### 4.3 Discipline documentaire
- **ADR** pour toute décision architecturale non triviale (`docs/adr/`).
- **`// See ADR-XXXX`** dans le code qui implémente une décision.
- **Invariants = assertions** : tout invariant documenté a un `assert`/`debug_assert` correspondant.
- **KNOWN_FAILURE_PATTERNS.md** : tout contournement fragile y est documenté avec sa cause racine.

### 4.4 Définition de « terminé » (Definition of Done)
Une tâche n'est terminée que si : code propre (pas de raccourci non tracé) · tests passants couvrant la
logique · zéro warning lint · pas de croissance de god file · SDK régénéré si route · doc/ADR à jour si
décision · dette éventuelle inscrite ici avec plan daté.

### 4.5 Rituels
- **Fin de session** : audit TODO/FIXME (D-24), mise à jour de ce registre si dette créée.
- **Fin de sprint** : re-validation complète de la TODO §2.
- **Avant push majeur** : `/verify-standards` + `/health` + relecture des entrées P0/P1.
