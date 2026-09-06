<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M2-TEST EVIDENCE — graph property tests (Plan V2.3.1 §199, ADR-002)

> Statut : **EVIDENCE_PINNED** (46/46 PASS, mutation-testé)
> Date : 2026-09-02
> Carte : `M2-TEST` de [`M2-IMPLEMENTATION-PLAN.md`](../M2-IMPLEMENTATION-PLAN.md) §3.7
> Livrables : `packages/contracts/src/workflow-graph.ts` (validateur de graphe),
> `packages/contracts/src/workflow-map-key.ts` (matière de clé ADR-005),
> `packages/contracts/test/graph-property.test.ts` (tests)

## 0. Cadrage

Le plan §199 demande six catégories de tests sur le graphe. Les schémas
par famille livrés par M2-01..06 valident **un nœud à la fois** ; aucun
d'eux ne voit le graphe. `workflow-graph.ts` est la moitié graphe du même
contrat : une fonction **pure** sur `WorkflowDefinition`, sans I/O, sans
horloge, sans crypto.

**Code de production durable modifié** : `packages/contracts` — 2 nouveaux
modules + 2 lignes d'export dans le barrel. Le kernel `WorkflowRuntime`
n'est pas touché par cette carte (voir §8, finding F-M2-02, pour l'écart
entre ce critère et l'état réel du dépôt).

**Découpage** : le validateur de graphe (ADR-002, topologie) et la matière
de clé de map (ADR-005, identité par item) ne partagent rien — pas un
type, pas une fonction. Ils sont dans deux modules parce que la couche
digest consommera uniquement le second. Un module unique aurait forcé
`@unifia/digest-runtime` à importer un validateur de graphe dont il n'a
aucun usage.

**Commandes de reproduction** :

```bash
cd D:/App/unifia/.worktrees/rev3m-20260901/design/packages/contracts
bun test test/graph-property.test.ts
bun test
bunx tsc --noEmit
```

## 1. Couverture des six catégories du plan §199

| §199 | Bloc `describe` | Tests | Verdict |
|---|---|---|---|
| graph property tests | well-formedness | 1–15 | **PASS 15/15** |
| fan-out/fan-in | fan-out / fan-in | 16–23 | **PASS 8/8** |
| parallel race | deterministic identity | 24–28 | **PASS 5/5 (statique — voir §4)** |
| bounded loops | bounded loops | 29–34 | **PASS 6/6** |
| dynamic identity | dynamic identity | 35–37 | **PASS 3/3** |
| stable map keys | stable map keys | 38–46 | **PASS 9/9** |

## 2. Résultats mesurés

```text
$ bun test test/graph-property.test.ts
 46 pass
 0 fail
 1427 expect() calls
Ran 46 tests across 1 file. [228.00ms]

$ bun test                       # suite contracts complète
 285 pass
 0 fail
 2029 expect() calls
Ran 285 tests across 22 files. [554.00ms]

$ bunx tsc --noEmit              # packages/contracts
 exit 0

$ bunx biome check packages/contracts/src/workflow-graph.ts \
      packages/contracts/test/graph-property.test.ts \
      packages/contracts/src/index.ts
 Checked 3 files in 64ms. No fixes applied.
```

Régression : la suite contracts passait de **239** à **285** tests, soit
exactement les 46 nouveaux. **0 test existant cassé.**

## 3. Mutation testing — preuve que les tests mordent

Une suite écrite en même temps que son implémentation peut être
tautologique. Trois mutations ont été appliquées au validateur, chacune
suivie d'une restauration vérifiée par `diff -q` :

| Mutation | Effet attendu | Mesuré |
|---|---|---|
| `drawn !== branches.length` → `drawn > branches.length` (fan-out) | un test tombe | **45 pass / 1 fail** |
| `sortDiagnostics` rendu no-op (retour non trié) | l'ordre-indépendance tombe | **45 pass / 1 fail** — `(26) FailingGraph_DiagnosticsAreOrderIndependent` |
| `Object.hasOwn(record, field)` → `false` (clé map absente tolérée) | l'identité stable tombe | **45 pass / 1 fail** |

Restauration : `diff -q` byte-identique, puis **46 pass / 0 fail**.

## 4. Ce qui n'est PAS couvert, et pourquoi

**`runId` déterministe pour deux runs concurrents d'un même
`versionDigest`** — c'est la moitié runtime de « parallel race » (§199).
La dérivation n'existe pas : elle appartient au kernel durable et est
bloquée par **ADR-000** (substrate), la moitié contrat étant
interface-only dans `workflow-run.ts` (carte M1-09, YELLOW). Ce qui est
testable au niveau contrat aujourd'hui est la moitié **statique** :
l'analyse de graphe est une fonction pure dont la sortie ne dépend pas de
l'ordre d'écriture. C'est ce que verrouillent les tests 24–28. La moitié
runtime reste **non couverte, non revendiquée comme verte**.

**`mapItemId` physique** — `extractMapKeyMaterial()` livre la *matière* de
la clé ; le hash est le travail de `@unifia/digest-runtime`, qui dépend de
`@unifia/contracts`. L'importer ici inverserait la dépendance (AGENTS.md
§ dependency direction). Il n'existe par ailleurs aucun `DigestDomain`
`map-item` : en ajouter un est une décision ADR-026, hors périmètre M2.
Les tests 38–46 verrouillent donc le déterminisme et l'indépendance à
l'ordre de la matière de clé, pas le digest final.

**Consommateur runtime** — `validateWorkflowGraph` est exporté du barrel
`@unifia/contracts` mais **aucun appelant ne l'invoque encore**. C'est
attendu : M2 produit des contrats que le kernel consommera en M3+, comme
M1 a produit les siens. Ce n'est pas une implémentation « câblée » et
n'est pas présentée comme telle.

## 5. Décision technique — pas de `fast-check`

`fast-check` est présent dans `node_modules` **uniquement en dépendance
transitive de vitest** ; aucun `package.json` du dépôt ne le déclare
(`grep -l '"fast-check"' packages/*/package.json package.json` → vide).
Dépendre d'un paquet hissé transitivement est un défaut de chaîne
d'approvisionnement, et le déclarer ferait bouger le lockfile racine
partagé par 50 packages pour quelques permutations.

Le générateur est donc un `mulberry32` de 6 lignes, **seedé** : chaque
assertion d'ordre-indépendance porte son seed dans le message, donc un
échec est reproductible en une ligne. 400 permutations seedées au total
(200 sur un graphe valide, 200 sur un graphe fautif).

## 6. Invariants verrouillés par le validateur

**Erreurs** (bloquent la promotion en `WorkflowVersion`) : `duplicate-node-id`,
`edge-unknown-node`, `no-entry-node`, `multiple-entry-nodes`,
`cycle-detected`, `node-config-invalid`, `target-unknown-node`,
`parallel-fanout-mismatch`, `merge-fanin-mismatch`.

**Avertissements** (enregistrés, jamais bloquants) :
`multiple-trigger-entry-nodes`, `unreachable-node`, `dynamic-node-id`,
`orphan-merge`, `repeat-iterations-at-ceiling`.

Deux choix méritent d'être justifiés :

1. **Plusieurs points d'entrée** — le plan demande « un seul entry
   point ». Un workflow multi-trigger en a légitimement plusieurs. La
   règle implémentée est donc : plus d'un point d'entrée **non-trigger**
   = erreur ; plusieurs points d'entrée tous triggers = avertissement.
   L'exigence est enforced là où elle a un sens, sans rejeter une
   topologie valide.

2. **Boucles** — `control.repeat` et `control.map` bouclent via
   `config.body`, jamais via une arête retour. Le graphe d'arêtes reste
   donc acyclique et un cycle dessiné est une vraie erreur (test 34).

## 7. Budgets AGENTS.md — mesuré, pas supposé

| Métrique | Cible | Mesuré | Verdict |
|---|---|---|---|
| LOC par fonction | ≤ 50 · alerte > 100 · bloquant > 200 | max **54** (`extractMapKeyMaterial`, doc comprise) | OK |
| `validateWorkflowGraph` | idem | **17** (orchestrateur, 6 appels) | OK |
| `workflow-graph.ts` | flag > 500 | **565 lignes / 414 de code** | **FLAGGÉ** |
| `workflow-map-key.ts` | flag > 500 | 70 / 32 | OK |
| Complexité cyclomatique | ≤ 10 | ≤ 8 (`referencedTargets`, switch à 7 cas) | OK |

Première rédaction : `validateWorkflowGraph` faisait **218 lignes** — au-delà
du seuil *bloquant* d'AGENTS.md. Elle a été décomposée en `indexNodes`,
`indexEdges`, `checkNodeFamilies`, `checkEntryPoints`,
`checkCyclesAndReachability`, `checkOrphanMerges`, chacune avec un `sink`
de diagnostics injecté. Le test net n'a pas bougé : 46/46 avant, 46/46
après.

`workflow-graph.ts` reste **au-dessus du seuil de flag** à 565 lignes
brutes (414 de code, ~150 de commentaires WHY). Ce n'est pas caché : le
seuil de proposition d'extraction d'AGENTS.md est à 800, la densité de
documentation suit celle de `workflow-ir.ts` (1097 lignes) dans le même
package, et découper davantage fragmenterait un validateur cohérent dont
toutes les fonctions partagent `GraphTables`. À réévaluer si M2-07/08/09
(while, child workflow, wait) ajoutent leurs propres règles de graphe.

## 8. Findings ouverts par cette carte

| ID | Sév | Finding | Preuve |
|---|---|---|---|
| **F-M2-01** | Medium | Le hook `pre-commit` husky, lancé pour la première fois de la lignée automate-v2, a trouvé **1 erreur biome + 10 warnings** dans du code déjà committé (M1-08, C-PRE1-04, M2-02). L'erreur était du code mort inatteignable : `packages/capability-runtime/src/enforcer.ts` — un `void DEFAULT_CAPABILITY_MIN_TRUST` après un `return undefined`. `EXECUTION_STATUS.md` affirmait « pre-commit husky : 295 fichiers vérifiés, no fixes applied sur tous les commits » ; `M2-IMPLEMENTATION-PLAN.md` §8.1 prescrit explicitement `git commit --no-verify`. Les deux affirmations ne peuvent pas être vraies ensemble. | `bunx biome check --changed .` → 1 error, 10 warnings, avant correction ; 0 après |
| **F-M2-02** | Low | Le critère de sortie M2 « `git diff packages/workflow-runtime` = 0 » est littéralement faux : M1-09 y a ajouté `adapter.ts` (+215) et `index.ts` (+8). Vérification du contenu : **une seule `interface`, 5 signatures, zéro implémentation** — donc conforme à l'intention (« interface only, impl waits ADR-000 ») mais pas à la lettre du critère, et `EXECUTION_STATUS.md` affirme « Aucun code de `packages/workflow-runtime` (kernel) touché ». | `git diff --stat <base>..HEAD -- packages/workflow-runtime` ; `grep -cE '^export (interface\|type) '` → 1, `^(export )?function` → 0 |

Les 11 findings biome de F-M2-01 sont corrigés dans le commit
`chore(automate-v2)` qui précède celui-ci, sans `--no-verify`. Aucun n'a
été masqué pour obtenir un GO.

## 9. Conclusion

Carte **M2-TEST = GREEN**. Le Round 2 de M2 est complet : M2-05, M2-06 et
M2-TEST livrées. Les 6 cartes GREEN de M2 (§2.1 du plan M2) sont livrées.
M2-07 (`while`), M2-08 (`child workflow`) et M2-09 (`wait` refine)
restent **RED/YELLOW**, bloquées par ADR-000 — aucune n'a été forcée pour
obtenir un GO.
