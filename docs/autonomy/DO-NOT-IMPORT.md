# DO-NOT-IMPORT.md

**Phase :** -1 (Audit comparatif)
**Statut :** `VERIFIED` — verrous actifs dans `UPSTREAM-SOURCES.lock.json`
**Date :** 2026-07-31

Ce fichier liste les **chemins et composants explicitement interdits d'import** dans Unifia. Tout agent ou développeur qui tente d'importer un de ces chemins doit être **rejeté en CI** et **notifié à l'utilisateur**.

## 1. Chemins interdits (toutes sources)

| Pattern | Sources concernées | Justification |
|---|---|---|
| `**/ee/**` | OpenWork (1 067 chemins Fair Source) | Code propriétaire Plan V3 §3.1 « Exclure par défaut » |
| `**/.ee/**` | générique | Idem |
| `**/enterprise/**` | Fork Unifia (`packages/enterprise/`) | BD-2 par défaut, possible code propriétaire |
| `**/commercial/**` | générique | Idem |
| `**/private/**` | générique | Idem |
| `**/ee-pro/**` | OpenWork — UNVERIFIED path-level | Idem |
| `**/pro-payloads/**` | OpenWork — UNVERIFIED path-level | Idem |

## 2. Composants interdits (par source)

### Depuis OpenWork upstream

| Composant | Raison | Action |
|---|---|---|
| `.infisical.json` | SaaS externe de secrets, à remplacer par SecretStore Unifia (Plan V3 §3.3) | EXCLUDE, réécrire |
| `STATS.md`, `STATS_V2.md` | Télémétrie activée par défaut = fuite de données | EXCLUDE pour Unifia v1 |
| Code Swift natif (`*.swift`) | Tauri garde-fou Phase 0-18 | DEFER Phase 19+ |
| OpenWork `/ee` (1 067 chemins, Fair Source FSL-1.1-MIT) | Plan V3 §3.1 « Exclure par défaut » | EXCLUDE |
| `apps/den-api/*` | API propriétaire, sous `ee/` | EXCLUDE |
| `.vercelignore` | Déploiement Vercel non-pertinent pour Unifia | EXCLUDE |
| `.devcontainer/` | Config dev container, à recréer pour Unifia | EXCLUDE, réécrire |

### Depuis Open Cowork upstream

| Composant | Raison | Action |
|---|---|---|
| Agent runner | Plan V3 §3.2 « Ne pas reprendre, Unifia Core est l'autorité » | EXCLUDE |
| Provider routing | Idem | EXCLUDE |
| Session manager | Idem | EXCLUDE |
| Memory manager | « Ne pas reprendre tel quel, migrer les idées utiles » | EXCLUDE code, MIGRER idées |
| Config store | « Ne pas reprendre tel quel, Config versionnée Unifia » | EXCLUDE code, REWRITE |
| Electron IPC métier | « Ne pas reprendre, Ports et API indépendants du shell » | EXCLUDE |

### Depuis le fork Unifia (Rwanbt/unifia)

| Composant | Raison | Action |
|---|---|---|
| `packages/enterprise/` | BD-2 par défaut | EXCLUDE |
| `packages/desktop-electron/` | BD-3 par défaut (DEPRECATE) | EXCLUDE, marquer DEPRECATE |
| `Bannière OpencodeX.png` | Asset non audité, hors charte Unifia | REPLACE (P0-C007) |
| Anciens fichiers AGENTS.md/CLAUDE.md | Remplacer par versions Unifia | REPLACE |

## 3. Patterns de code interdits (toutes sources)

| Pattern | Raison |
|---|---|
| `eval(`, `Function()` constructor | Injection |
| `child_process.exec(string)` (shell) | Injection shell |
| `innerHTML = ...` non sanitized | XSS |
| `dangerouslySetInnerHTML` (équivalent) | XSS |
| `.env` lu en dur sans SecretStore | Fuite de secrets |
| `Math.random()` pour crypto | Faible entropie |
| `setTimeout` avec string | Code injection |
| `git config --global` | Modification hors scope |
| Code téléchargé via `curl | bash` | Risque supply chain |

## 4. Licences incompatibles avec Unifia

| Licence | Statut | Justification |
|---|---|---|
| GPL-2.0 | Refusé | Copyleft fort |
| GPL-3.0 | Refusé | Copyleft fort |
| AGPL-3.0 | Refusé | Copyleft réseau (SaaS) |
| SSPL | Refusé | Copyleft réseau (Mongo) |
| BUSL | Refusé | Source-available, pas open source |
| Licence propriétaire non précisée | Refusé | Risque juridique |
| Pas de licence | À examiner | Statut par défaut = propriétaire |

**Note :** aucune dépendance copyleft fort détectée dans le fork Unifia ni dans les 2 upstreams (cf. `LICENSE-AUDIT-UNIFIA.md`). Mais cela reste un point de contrôle en CI.

## 5. Imports qui nécessitent une revue utilisateur explicite (même sans être interdits)

| Type d'import | Pourquoi | Procédure |
|---|---|---|
| Tout fichier > 400 lignes modifié | Plan V3 §2.1 / Pack carte limite | Découper en sous-cartes |
| Tout import depuis une branche `enterprise` | Risque licence | ADR obligatoire |
| Tout import de code Python | Sandbox obligatoire | SandboxBroker Phase 8 d'abord |
| Tout import Swift natif | Conflit Tauri | DEFER Phase 19+ |
| Tout import d'un nouveau provider de modèles | Sécurité (prompt injection) | Audit ApprovalBroker |
| Tout import de binaire (`.so`, `.dll`, `.dylib`) | Risque supply chain | Build local obligatoire |
| Tout import qui modifie un package du workspace `packages/unifia/` | Cœur d'Unifia | Revue MiniMax + carte dédiée |

## 6. Verrous techniques à implémenter

| Verrou | Phase | Statut |
|---|---|---|
| Hook pre-commit refusant les chemins `**/ee/**` | Phase 0 | À implémenter (carte dédiée) |
| Hook pre-commit refusant les `.env*` | Phase 0 | À vérifier si déjà actif |
| Hook pre-commit exigeant SPDX-License-Identifier | Phase 0 | Modèle dans `ATTRIBUTION-TEMPLATE.md` |
| Scan CI `git ls-tree` qui refuse tout import d'une branche `ee/*` | Phase 1 | À implémenter |
| `cargo deny` et `npm sbom` en CI | Phase 1 | À implémenter |
| `npm audit` et `cargo audit` en CI | Phase 1 | À implémenter |
| Linter qui refuse les patterns §3 | Phase 1 | À implémenter (Biome rules custom) |

## 7. Conclusion

Tout ce qui est listé ici est **interdit d'import** par défaut, avec des verrous techniques prévus pour empêcher l'import accidentel. Les imports autorisés sont dans `IMPORT-CANDIDATES.md` ; les imports modérés sont dans `FEATURE-OWNERSHIP-MATRIX.md` ; les imports risqués sont dans `PORTABILITY-ASSESSMENT.md`.

**Règle d'or :** *en cas de doute, ne pas importer.*
