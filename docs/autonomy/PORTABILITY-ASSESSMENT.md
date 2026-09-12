# PORTABILITY-ASSESSMENT.md

**Phase :** -1 (Audit comparatif)
**Statut :** `DRAFT` — basé sur métadonnées ; tests réels en Phase 1
**Date :** 2026-07-31


## Correctif M1 — règle de preuve

Les mentions UNVERIFIED, UNVERIFIED ou ssumed ne sont pas des preuves. Les décisions historiques restent non exécutables tant que le dépôt, le commit, le chemin exact, la licence et le comportement n'ont pas été vérifiés. Inventaires vérifiés : OpenWork pps/server/ (171 chemins), OpenWork pps/desktop/electron/ (60), Open Cowork src/main/remote/ (16), src/main/sandbox/ (17), et src/main/skills/ + .claude/skills/ (143). OpenWork /ee reste EXCLUDE (1 067 chemins Fair Source). i18n utilisateur reste BLOCKED_MISSING_SOURCE.

## 1. Méthodologie

Pour chaque composant candidat à l'import, on évalue :
- **Portabilité du code** : TS/TSX standard vs code spécifique à un shell (Electron, Tauri, Swift)
- **Dépendances externes** : natives (Rust crates, Python, Swift packages) vs JS/Bun standards
- **Effort d'adaptation** : 0 (drop-in) à 5 (réécriture complète)
- **Risque d'import** : 0 (trivial) à 5 (modification de l'autorité)

Score total = somme pondérée. Plus c'est haut, plus l'import est risqué.

## 2. Évaluation par composant

### 2.1 OpenWork — apps/server (serveur headless)

| Critère | Évaluation | Score |
|---|---|---:|
| Langage principal | TS/TSX (Bun) | 1 |
| Dépendances natives | Tauri (Rust) UNVERIFIED, Pas de Python | 2 |
| Architecture | Monorepo Turborepo UNVERIFIED | 1 |
| Autorité après import | Remplacée par RuntimeAdapter Unifia | 3 |
| Effort d'adaptation | Réécriture des entry points + injection Unifia | 4 |
| Risque d'import | Conflit avec opencode existant | 3 |
| **Total** | | **14 / 30** |

**Verdict :** `ADAPT`. Effort important mais faisable. À planifier en Phase 5.

### 2.2 OpenWork — apps/desktop (UI Electron/Tauri)

| Critère | Évaluation | Score |
|---|---|---:|
| Langage | TSX + UNVERIFIED Tauri/Electron | 2 |
| Dépendances natives | Tauri 2 UNVERIFIED | 2 |
| Architecture | UI monolithique | 2 |
| Autorité après import | Remplacée par Shell Unifia (Phase 7) | 4 |
| Effort d'adaptation | Refonte en Shell Unifia | 5 |
| Risque d'import | Incompatible avec Workbench Unifia | 4 |
| **Total** | | **19 / 30** |

**Verdict :** `INSPIRER` seulement. Ne pas importer le code UI, juste les patterns (Trace Panel, Permission dialogs).

### 2.3 Open Cowork — skills bureautiques (XSD + .ts)

| Critère | Évaluation | Score |
|---|---|---:|
| Langage | TS + 78 XSD (schémas) | 1 |
| Dépendances natives | Python (37 fichiers — sandbox) | 2 |
| Architecture | Capability Packs UNVERIFIED | 1 |
| Autorité après import | CapabilityRegistry Unifia (Phase 6) | 2 |
| Effort d'adaptation | Réadapter les chemins + manifest | 2 |
| Risque d'import | Faible — code isolé | 1 |
| **Total** | | **9 / 30** |

**Verdict :** `ADOPT` en Capability Packs. C'est le **donneur fonctionnel principal** selon Plan V3 §3.2.

### 2.4 Open Cowork — sandbox Python (computer use, WSL2/Lima)

| Critère | Évaluation | Score |
|---|---|---:|
| Langage | Python 3.x | 2 |
| Dépendances natives | pip packages + WSL2/Lima | 3 |
| Architecture | Scripts internes | 1 |
| Autorité après import | SandboxBroker Unifia (Phase 8) | 3 |
| Effort d'adaptation | Réécrire l'interface en SandboxPort | 3 |
| Risque d'import | Sécurité critique (sandbox) | 4 |
| **Total** | | **16 / 30** |

**Verdict :** `ADAPT` tardif. Phase 8 (SandboxBroker) et Phase 10 (Computer Use) avec revue sécurité obligatoire.

### 2.5 Open Cowork — Slack/Feishu remote control

| Critère | Évaluation | Score |
|---|---|---:|
| Langage | TS | 1 |
| Dépendances natives | API Slack/Feishu seulement | 1 |
| Architecture | Plugin remote | 1 |
| Autorité après import | RemoteRuntime Unifia (Phase 9) | 2 |
| Effort d'adaptation | Convertir en Capability Pack | 2 |
| Risque d'import | Sécurité (commandes distantes) | 4 |
| **Total** | | **11 / 30** |

**Verdict :** `ADOPT` après Phase 3 (security foundation). Phase 9.

### 2.6 OpenWork — code Swift natif (iOS/macOS)

| Critère | Évaluation | Score |
|---|---|---:|
| Langage | Swift | 4 |
| Dépendances natives | Xcode toolchain | 4 |
| Architecture | UIKit/AppKit natif | 4 |
| Autorité après import | Hors scope Unifia v1 | 5 |
| Effort d'adaptation | Réécriture en Tauri/Electron | 5 |
| Risque d'import | Énorme — double stack UI | 5 |
| **Total** | | **27 / 30** |

**Verdict :** `EXCLUDE` / `DEFER` (Phase 19+). Tauri garde-fou.

## 3. Synthèse par score

| Score | Composant | Verdict |
|---|---|---|
| 9 | Open Cowork skills bureautiques | `ADOPT` |
| 11 | Open Cowork remote bridges | `ADOPT` après Phase 3 |
| 14 | OpenWork server | `ADAPT` Phase 5 |
| 16 | Open Cowork sandbox Python | `ADAPT` Phase 8+10 |
| 19 | OpenWork desktop UI | `INSPIRER` seulement |
| 27 | OpenWork Swift natif | `EXCLUDE` Phase 0-18, `DEFER` Phase 19+ |

## 4. Risques transverses

| Risque | Niveau | Mitigation |
|---|---|---|
| Imports de dépendances transitives non scannées | `HIGH` | Phase 1 : SBOM complète (npm + cargo) |
| Conflits de versions entre 3 écosystèmes | `MEDIUM` | Phase 1 : harness multi-runtime, conformance suite |
| Licence non uniforme | `LOW` | Audit Phase -2 montre MIT/Apache majoritaire |
| Code `/ee/` d'OpenWork | `HIGH` (50 branches concernées) | Interdit en CI, AUDIT_REQUIRED |
| Présence Python dans Open Cowork | `MEDIUM` | Sandbox isolé (SandboxBroker Phase 8) |
| Présence Swift dans OpenWork | `HIGH` | Exclure de Unifia v1 |

## 5. Conclusion

- Le composant le plus portable = **Open Cowork skills bureautiques** (score 9, ADOPT).
- Le composant le plus risqué = **OpenWork Swift natif** (score 27, EXCLUDE).
- **Aucun composant ne peut être importé tel quel.** Tous demandent au minimum une réécriture de l'autorité.
- La Phase 1 (harness multi-runtime) est **préalable** à tout import : sans harness, on ne peut pas prouver qu'un import ne casse pas la conformance.
