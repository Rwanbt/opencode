<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0-CONTRACT — le contrat canonique substrate-neutral

> Étape **I2** de l'ordre §85. Statut : **implémenté et testé**, gelé pour
> la durée de la qualification M0.
> Package : `packages/automate-m0-contract`
> Date : 2026-09-02

---

## 1. Ce que ce contrat est, et ce qu'il n'est pas

Il est la représentation **substrate-neutral** des concepts que les deux
candidats — `UNIFIA_NATIVE` et `DBOS_GO_SQLITE` — doivent implémenter à
l'identique pour être comparables. ADR-000 §17 le délimite d'une phrase :

> Le contrat M0 n'est pas encore le WorkflowIR complet.

**Il n'est pas** un package de production. Rien hors du harness M0 ne doit
en dépendre. Il est jetable après ratification, au sens du plan §193
(« throwaway spike, contract experiment »).

**Il ne consomme pas** `@unifia/contracts`, qui porte les contrats
WorkflowIR de M1/M2. Les mélanger coupleraient le harness de qualification
à du code de production et ferait hériter au harness une décision M1 — ce
que §48 interdit (« sans couplage à un candidat »). Voir F-M0-01 et
F-M0-03 dans [`BASELINE.md`](./BASELINE.md).

---

## 2. Couverture de §17

§17 énumère les concepts que le contrat doit porter. État d'implémentation :

| Concept §17 | Module | Statut |
|---|---|---|
| `WorkflowVersionId` | `ids.ts` | **fait** |
| `WorkflowDeploymentId` | `ids.ts` | **fait** — globalement unique (§18) |
| `WorkflowRunId` | `ids.ts` | **fait** — globalement unique (§18) |
| `DeploymentScope` / `OwnershipScope` | `ids.ts` | **fait** — porté par le run (§6) |
| `LogicalInvocationId` | `ids.ts` | **fait** |
| `AttemptId` | `ids.ts` | **fait** |
| `EffectKey` | `effect.ts` | **fait** — 5 champs de §20, égalité structurelle |
| `EffectId` | `effect.ts` | **fait** — opaque, dérivation injectée |
| `EffectPolicy` | `effect.ts` | **fait** — les 5 classes de §22 |
| `EffectRecord` | `effect.ts` | **fait** |
| `DurableTimerId` | `ids.ts` | **fait** |
| `CanonicalTimestamp` | `value.ts` | **fait** — §28, borné ±(2^53−1) |
| `ApprovalId` | `ids.ts` | **fait** |
| `AuthorityKind` | `ids.ts` | **fait** — les 2 finalistes |
| `AuthorityProtocolVersion` | `ids.ts` | **fait** |
| `AuthorityGeneration` | `ids.ts` | **fait** — époque de fencing (§16) |
| `SchemaVersion` | `ids.ts` | **fait** |
| `UnifiaValue` | `value.ts` | **fait** — §25-§31, 50 vecteurs |
| `UNKNOWN_EXTERNAL_STATE` | `effect.ts` | **fait** — état durable de première classe |
| `WorkflowEvent` / `HistorySequence` | — | **à faire** — dépend du harness (§35) |
| `ApprovalBinding` | — | **à faire** — scope routé vers carte `M0-M02` (§36) |
| `CancellationState` | — | **à faire** — avec FC-08/09/23 |

---

## 3. Les trois décisions de conception qui portent le reste

### 3.1 Deux points d'entrée numériques, pas un

§27 exige que `host float64 9007199254740992` **passe** et que
`host int64 9007199254740992` soit **rejeté**, et qualifie la distinction
de volontaire. En JavaScript, un `number` **est** un float64 : la
distinction n'existe pas dans la valeur, elle existe dans l'**intention de
l'appelant**.

D'où `fromHostFloat64` et `fromHostInteger`, et le refus d'un point
d'entrée unique qui devinerait via `Number.isInteger()` — il rendrait les
deux cas indiscernables et violerait §27 en silence.

### 3.2 L'`EffectId` n'est pas dérivé ici

§20 envoie l'algorithme de hash, l'encodage et le sérialiseur canonique à
**ADR-001**, non décidé. Le contrat définit donc la **structure** de
l'`EffectKey` et son **égalité structurelle**, et laisse la dérivation
derrière un port `EffectIdDeriver` que le harness fournit. Une égalité
passant par un sérialiseur aurait rendu les assertions de la failure matrix
dépendantes d'une décision qui n'a pas été prise.

### 3.3 Le temps est un paramètre, jamais une lecture d'horloge

`evaluateTimerOnRecovery(timer, authoritativeTime)` reçoit le temps. §32
autorise une implémentation à utiliser une horloge monotone en interne, et
FC-15/FC-16 exigent de piloter l'horloge. Un module lisant `Date.now()`
serait intestable pour exactement les propriétés qui comptent le plus.

---

## 4. Interdictions de §82 traduites en assertions

| Interdiction §82 | Où elle est vérifiée |
|---|---|
| `generic exactly-once claim` | `mayAutoReplayUnderUncertainty` — seuls `PURE` et `IDEMPOTENT` ; `REPEATABLE` explicitement exclu |
| `blind retry of uncertain irreversible effect` | `actionUnderUncertainty` renvoie trois actions distinctes, jamais un booléen |
| `substrate-local identity replacing EffectKey` | `assertRetryPreservesIdentity` — un retry qui change la clé est refusé |
| `host-language serialization semantics as Unifia semantics` | `toCanonicalValue` — 10 types hôtes refusés, `§29` sans normalisation implicite |
| `in-memory map as durable run ownership authority` | `OwnershipScope` porté par le run, jamais par une map serveur (§6) |

---

## 5. Le vecteur partagé

`docs/automate/m0/fixtures/M0_UNIFIAVALUE_VECTOR_V1.json` — **50 cas**,
langage-neutre.

§79 Gate A répond `NO DECISION` si les fixtures des deux candidats ne sont
pas identiques. Le vecteur est donc un fichier de données, pas un littéral
TypeScript : l'adapter Go lira le même fichier.

Chaque cas est décrit **structurellement** (`encoding` + `payload`) parce
que JSON ne transporte ni `NaN`, ni les infinis, ni `-0`, ni un `U+0000`
isolé de façon fiable. Les cas numériques sensibles portent leur motif
IEEE-754 sur 16 caractères hexadécimaux, comme l'exige la carte **M0-M06** :
un littéral décimal est une *demande* de valeur, les bits **sont** la
valeur, et seuls les bits attrapent un candidat qui round-trip la décimale
en perturbant la représentation.

---

## 6. Ce qui est mesuré, et ce qui ne l'est pas

```text
bun test packages/automate-m0-contract    130 pass / 0 fail / 239 expects
bunx tsc --noEmit                         exit 0 (src ET test)
bunx biome check                          clean
```

**Ces tests sont la moitié contrat.** Ils verrouillent la sémantique en
processus, sans substrate. La moitié persistance — le
« → persistence → restart → » de §53, et toute la failure matrix §59 —
appartient au harness, qui n'existe pas encore.

§76 interdit de revendiquer un PASS mécanique sans preuve reproductible.
**Aucun résultat FC n'est donc enregistré à ce stade**, et
`M0_RESULTS_*.json` n'existe pas.

---

## 7. Suite

Étapes §85 restantes avant le premier candidat : **I4** (fake external
provider, §50), **I5** (fixtures linéaire/non-linéaire/replay, §51-§52),
**I6** (schéma de résultat + capture de preuve, §77-§78), **I7**
(power-loss harness + FC-13-CTRL, §60).

`FC-13-CTRL` est un préalable non négociable : §60 déclare le harness
power-loss `NOT_VALID` s'il ne détecte pas une perte sous une configuration
volontairement non-durable.
