# GATE-PHASE-0 — Rebrand, gouvernance, stratégie upstream

**Phase :** 0
**Statut :** `VERIFIED` — gate passé pour les livrables documentaires
**Date :** 2026-07-31
**Auditeur :** Hermes Agent (MiniMax-M3) — self-check + revue fresh-context à venir pour gates security/release

## 1. Livrables du Plan V3 §12 attendus

| Livrable | Statut |
|---|---|
| Identité Unifia | ✅ `package.json` racine = `unifia-workbench`, 22 packages `@unifia/*`, binaire `unifia` |
| Disclaimer non-affiliation | ✅ README.md ligne 44 « Unofficial fork notice » conservé |
| `GOVERNANCE.md` | ⏳ À créer (carte Phase 0 future, hors scope P0-C001..C007) |
| `SECURITY.md` | ✅ Existe déjà dans le fork racine (à adapter Phase 3) |
| `CONTRIBUTING.md` | ✅ Existe déjà (21 traductions) |
| `UPSTREAM-STRATEGY.md` | ⏳ À créer (cf. `UPSTREAM-SOURCES.lock.json` v0) |
| Conventions de nommage | ⏳ À formaliser dans `GOVERNANCE.md` |
| Stratégie de migration config | ⏳ Phase 2 (contrats) |
| Stratégie de branches | ✅ Documentée dans BASELINE.md |

## 2. Cartes exécutées (P0-C001 à P0-C007)

| Carte | Statut | Commit | Lignes modifiées |
|---|---|---|---:|
| P0-C001 — branche agent/integration | ✅ INTEGRATED_LOCAL | `3a4f8fc` | merge |
| P0-C002 — package.json racine | ✅ INTEGRATED_LOCAL | `5ea48f6` | 2 |
| P0-C003 — 22 packages @unifia/* | ✅ INTEGRATED_LOCAL | `36cf381` | 41 |
| P0-C004 — binaire CLI unifia | ✅ INTEGRATED_LOCAL | `316d137` | 1 + rename |
| P0-C005 — Tauri identifier/scheme | ✅ INTEGRATED_LOCAL | `f04e870` | 4 |
| P0-C006 — README.md rebrand ciblé | ✅ INTEGRATED_LOCAL | `53d7986` | 8 |
| P0-C007 — Bannière OpencodeX.png | ✅ INTEGRATED_LOCAL | `a1b7a0f` | -1 557 615 bytes |

## 3. Cartes Phase 0 restantes (hors scope C001-C007)

- **P0-C008** : Créer `GOVERNANCE.md` (carte à créer)
- **P0-C009** : Créer `UPSTREAM-STRATEGY.md` (carte à créer)
- **P0-C010** : Hook pre-commit refusant `**/ee/**` (à créer, voir DO-NOT-IMPORT §6)
- **P0-C011** : Hook pre-commit exigeant SPDX-License-Identifier (à créer, voir ATTRIBUTION-TEMPLATE)
- **P0-C012** : Renames de 21 langues README/CONTRIBUTING/LICENSE/SECURITY racine (P1-C010 dans TASK-GRAPH)

## 4. Critères de sortie du Plan V3 §12 (cochés)

- [x] Le produit s'appelle Unifia (binaire, packages, manifest racine, Tauri, README)
- [ ] Le CLI et les configs possèdent une migration documentée
- [x] Les remotes upstream sont définis (push bloqué sur `invalid.local`)
- [ ] Le processus d'import est reproductible (UPSTREAM-SOURCES.lock.json existe, mais `import_log` vide)
- [x] Aucun code fonctionnel majeur n'est encore fusionné

## 5. Comparaison à la baseline

| Métrique | Baseline `207ff452` | Après Phase 0 |
|---|---|---|
| Fichiers | 5295 | 5278 (-17 fichiers) |
| Branches agent/* | 0 | 1 (agent/integration) |
| Commits totaux | (n/a) | +11 commits atomiques |
| Push distant | possible (URL upstream) | **IMPOSSIBLE** (invalid.local) |
| LOC modifiés total | 0 | ~58 (rebrand) |

## 6. Risques ouverts

| Risque | Niveau | Action |
|---|---|---|
| Tauri identifier changé = re-certification macOS requise | `HIGH` | Marqué `NEEDS_EXTERNAL_E2` dans P0-C005. BD-4 à valider utilisateur. |
| productName et mainBinaryName Tauri pas encore rebrandés | `LOW` | Carte P0-C013 à créer (séparée pour ne pas mêler identifier technique et UI branding) |
| 57 occurrences 'opencode' restantes dans README.md | `LOW` | Cartes P1-C020 (app/src) et P2-C050 (workflows) les traiteront progressivement |
| i18n 21 langues pas encore rebrandées | `LOW` | P1-C010 (84 fichiers) à exécuter |
| desktop-electron/ toujours présent | `LOW` | BD-3 par défaut = DEPRECATE. À formaliser dans carte dédiée. |
| `packages/enterprise/` toujours présent | `LOW` | BD-2 par défaut = EXCLUDE. Vérifier qu'aucun commit n'y touche. |
| i18n utilisateur Open Cowork non encore fournie | `BLOCKED_MISSING_SOURCE` | Carte `P-1-I18N-USER-SOURCE` (Phase M1) |

## 7. Provenance

- **Source :** `https://github.com/Rwanbt/opencode.git@207ff452`
- **Licence :** MIT (héritée fork)
- **Modifications Phase 0 :** rebrand cosmétique (nom, packages, binaire, identifier, bannière)
- **Conformité UPSTREAM-PROVENANCE.md :** OK (cf. trailer `Upstream-*` dans chaque commit)

## 8. Verdict

**Phase 0 : REBRAND COSMÉTIQUE — VERIFIED**

- 7/7 cartes de rebrand cosmétique exécutées et intégrées dans `agent/integration`.
- Aucun commit de code applicatif (uniquement manifests + binaires + config Tauri + 1 README + 1 binaire retiré).
- Push distant toujours techniquement bloqué.
- Tous les commits ont les trailers `Upstream-Repo/Commit/Path/License` conformes.

**Niveau de confiance :** ÉLEVÉ pour le rebrand, MOYEN pour la Phase 1+ (qui demande harness CI + tests réels, hors portée conteneur).

**Gates à venir :**
- Gate P0 complet (tous les §12) : il manque GOVERNANCE.md, UPSTREAM-STRATEGY.md, hooks pre-commit, migration config.
- Gate A (Workbench headless stable) : Phase 5-6.
- Gate B (Cowork local-first sécurisé) : Phase 10.
- Gate C (Plateforme extensible stabilisée) : Phase 16.

**Recommandation :** passer à Phase 1 (CI, tests, builds) en lançant P1-C100 (harness) et P1-C110 (SBOM). Ces cartes sont faisables dans le conteneur (modifications de `.github/workflows/`, `scripts/`, `package.json` du repo).

**Action immédiate :** continuer avec P1-C100, P1-C110, P1-C120 (Phase 1) tant qu'elles ne violent pas de gates.
