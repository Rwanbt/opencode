<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0 Comparative Baseline — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> (V1.1.2-E1 / IMPLEMENTATION PACK, FROZEN 2026-09-02, 2184 lignes).
>
> Ce fichier est créé 2026-09-03 (post review v1.1) pour matérialiser
> le baseline du M0 comparatif UNIFIA_NATIVE ↔ DBOS_GO_SQLITE.
> Il ne **sélectionne** aucun candidat. Il établit l'état de départ.

---

## 1. Statut de départ (2026-09-03)

| Élément | Statut | Source |
|---|---|---|
| Plan maitre | V2.3.1 GELÉ | `UNIFIA-Automate-Master-Implementation-Plan-V2.3.1.md` (SHA256 `3A63FE3D2CE12E84CC47787A2B6257167F2FEC50EAB294CD125D9CFB86510815`, 71 KB, 3729 lignes) |
| ADR-000 architecture | FROZEN | `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` (2184 lignes, V1.1.2-E1) |
| ADR-000 contrat M0 | FROZEN | idem |
| ADR-000 substrate final | **NOT_RATIFIED** | idem (live ADR-000 fichier = résumé non-normatif) |
| ADR-000 M1 | **NO-GO** | idem |
| Finalistes Local | UNIFIA_NATIVE + DBOS_GO_SQLITE | idem |
| Stratégie | S2 — LOCAL AUTHORITY + PROFILE-SPECIFIC CERTIFIED ADAPTERS | idem |
| Décideur final | Erwan (signature) | idem |
| M0 contract feasibility | 36/36 PASS (reclassifié) | commit `d12bdad3dc` |
| Minimal reference substrate | 15/15 PASS (reclassifié) | commit `28e3058110` |
| Branch | `agent/automate-v2-baseline-20260901` | local + remote |
| HEAD | `b11334b76a` (post-réconciliation 2026-09-03) | `git rev-parse HEAD` |
| 123+ commits poussés | origin | `git log --oneline 24b04998..HEAD \| wc -l` |
| 851 tests V2 PASS | 632 contracts + 27 workflow-runtime + 177 m0-contract + 15 m0-harness | `bun test` per package |
| 32 migration tool tests PASS | V1 fixtures | `packages/automate-migration-tool` |
| 15 cert gates GREEN / 25 | cert runner | `bun run scripts/cert.ts` |

## 2. Ce que la M0 feasibility proof NE prouve PAS

Les 51/51 tests sont une **feasibility proof du contrat M0**, pas une
**substrate selection proof**. Limites explicites documentées dans
`packages/automate-m0-harness/src/minimal-substrate.ts` (lignes 12-16) :

```text
* It is **not** a production kernel (no concurrency, no
* persistence, no scheduler). It exists solely to demonstrate that
* the 10 M0 criteria are achievable on a substrate that conforms to
* the M0 contract.
```

Donc 51/51 PASS prouve :

- Le contrat M0 est cohérent (types, state machines, invariants)
- Un substrate minimal peut satisfaire les 10 critères logiques
- Les abstractions substrate-neutral sont testables

51/51 PASS ne prouve PAS :

- Qu'UNIFIA_NATIVE (kernel de production) passe le M0
- Que DBOS_GO_SQLITE (kernel de production) échoue le M0
- Qu'UNIFIA_NATIVE est meilleur que DBOS_GO_SQLITE
- Power-loss durability
- Real restart durability
- Real process fencing (FC-14)
- Real external effect reconciliation (FC-04 + provider)
- Windows Local-GA suitability
- Replay model vs checkpoint (FC-32)
- FC-31A / FC-31B canonical value conformance

## 3. Topologie cible du M0 comparatif

```
M0 Contract (gelé, source normative = pack gelé)
       |
       v
M0 Harness substrate-neutral (NO LOGIC dans l'oracle commun)
       |
       +--> NativeQualificationAdapter
       |     - implémente l'interface Native
       |     - exécute le harness en mode Native
       |     - produit M0_RESULTS_NATIVE.json
       |
       +--> DBOSGoQualificationAdapter
             - implémente l'interface DBOS Go + SQLite
             - exécute le harness en mode DBOS Go
             - produit M0_RESULTS_DBOS_GO.json
```

Les adapters peuvent différer dans leur implémentation. Les
invariants testés et la taxonomie des résultats ne diffèrent pas.

## 4. Tests obligatoires (per pack gelé §10-§11)

- FC-01 ... FC-30 (Functional Criteria)
- FC-31A : canonical UnifiaValue → durable persistence → restart → exact canonical semantic value
- FC-31B : host types → canonical adapter (séparation stricte float64 9007199254740992 PASS vs typed integer NUMBER_OUT_OF_CANONICAL_RANGE)
- FC-32 : replay vs checkpoint — REQUIRES_DETERMINISTIC_ORCHESTRATION = YES | NO | PARTIAL
- FC-13-CTRL : power-loss negative control (doit détecter la perte)

### Early discriminating tests (P0-1..P0-8 dans pack gelé §11)

1. **P0-1 FC-13-CTRL** : power-loss negative control (valide que le harness détecte la perte)
2. **P0-2 FC-13** : power-loss / storage fault réel (pas `kill -9` simple)
3. **P0-3 FC-31A** : canonical durable round-trip
4. **P0-4 FC-31B** : host adapter conformance
5. **P0-5 FC-14** : second real process / authority
6. **P0-6 FC-25** : stale authority fencing
7. **P0-7 FC-04** : provider success + local ACK lost
8. **P0-8 FC-32** : replay / checkpoint conformance

## 5. Taxonomie des résultats (per pack gelé §18)

Uniquement :

| Statut | Sens |
|---|---|
| `PASS` | Tous les invariants mesurés satisfaits |
| `FAIL_ARCHITECTURAL` | Candidat ne peut pas satisfaire l'exigence gelée sans casser un invariant d'architecture/produit |
| `FAIL_CORRECTABLE` | Bug/gap d'implémentation, fix possible, rerun → PASS requis pour gagner |
| `NOT_APPLICABLE` | Test non applicable (doit être déclaré AVANT exécution) |
| `BLOCKED` | Dépendance externe manquante |
| `NOT_VALID` | Le harness lui-même n'est pas valide (e.g. power-loss harness ne détecte pas la perte) |

`FAIL_CORRECTABLE` ⇒ fix + rerun + **PASS** requis avant que le candidat puisse gagner.

`NOT_APPLICABLE` ⇒ déclaré AVANT exécution, jamais post-hoc.

## 6. Règles de qualification (per pack gelé §7 + §21)

DBOS Go + SQLite **n'est pas éliminé** sur la base du langage Go. La
qualification exige la preuve que DBOS Go peut être packagé, démarré,
arrêté, upgradé, sauvegardé, monitoré, opéré comme composant managé
par Unifia.

UNIFIA_NATIVE **n'a aucun PASS automatique**. Le choix de topologie
M0 Native (TypeScript/Bun vs Rust vs Hybrid) doit être documenté et
comparé sur 9 axes (durability, SQLite integration, fault injection,
Windows packaging, mobile compatibility, stack, maintenance,
testability, IPC cost).

**Aucun candidat n'est favorisé.**

## 7. Outputs obligatoires (per pack gelé §20)

```
docs/automate/m0/BASELINE.md           ← CE FICHIER
docs/automate/m0/NATIVE_TOPOLOGY.md    ← À CRÉER (topologie M0 Native)
docs/automate/m0/DBOS_ADAPTER.md      ← À CRÉER (config DBOS Go + SQLite)
docs/automate/m0/M0_RESULTS_NATIVE.json
docs/automate/m0/M0_RESULTS_DBOS_GO.json
docs/automate/m0/M0_EXPECTED_NA_NATIVE.json
docs/automate/m0/M0_EXPECTED_NA_DBOS_GO.json
docs/automate/m0/DURABLE-SUBSTRATE-BENCHMARK.md
docs/automate/m0/PACKAGING_RESULTS.md
docs/automate/m0/RESOURCE_RESULTS.md
docs/automate/m0/WINDOWS_PREFLIGHT.md
docs/automate/m0/EXIT_NATIVE.md
docs/automate/m0/EXIT_DBOS_GO.md
docs/automate/m0/evidence/native/      ← créé
docs/automate/m0/evidence/dbos-go/     ← créé
```

(Paths adaptés à la topologie du repo : `docs/automation-v2/m0/`
au lieu de `docs/automate/m0/`.)

## 8. Critères de succès (per pack gelé §23)

ADR-000 peut être RATIFIED **seulement si** :

- M0_RESULTS_NATIVE.json complet
- M0_RESULTS_DBOS_GO.json complet
- FC-13 valide
- FC-14 valide
- FC-25 valide
- FC-31A/B valide
- FC-32 valide
- Windows preflight complet
- Exit strategies completes
- Critical = 0, High = 0

Sortie : `ADR-000 = RATIFIED` avec substrate sélectionné (A ou B)
+ evidence + reason + known consequences + exit strategy.

Sinon, ADR-000 reste OPEN (Outcome C : aucun candidat ne satisfait
les REQUIRED gates).

## 9. Prochaines actions (par ordre)

1. **NATIVE_TOPOLOGY.md** : choix de topologie M0 Native (TS/Bun vs
   Rust vs Hybrid) avec 9 axes comparés
2. **DBOS_ADAPTER.md** : DBOS Go 1.0 + SQLite, config `SQLiteSystemDB`
   ou `DatabaseURL`, journal_mode, synchronous, busy_timeout
3. **M0 harness substrate-neutral** (sans logique Native/DBOS dans
   l'oracle commun)
4. **NativeQualificationAdapter** + **DBOSGoQualificationAdapter**
5. **P0-1..P0-8** early discriminating tests
6. **P1..PN** full M0 matrix
7. **FAIL_CORRECTABLE** findings → fix + rerun
8. **M0_RESULTS_*.json**
9. **DURABLE-SUBSTRATE-BENCHMARK.md** + **PACKAGING_RESULTS.md** +
   **RESOURCE_RESULTS.md** + **WINDOWS_PREFLIGHT.md** + **EXIT_*.md**
10. **External review** avant finalisation
11. **Décision A/B/C** : présenter à Erwan avec preuves

## 10. Source

Pack gelé : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
Plan maitre : `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\roadmaps\UNIFIA-Automate-Master-Implementation-Plan-V2.3.1.md`
Review externe v1.1 : `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\reviews\2026-09-03-Automate-V2-Pending-Decisions-Multi-AI-Review.md`
