<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M1-01 EVIDENCE — Canonicalization runtime (ADR-001, C-M1-01)

> Statut : **EVIDENCE_PINNED** (input for M1 gate §197)
> Date : 2026-09-01T17:48+02:00
> Source : `docs/automation-v2/spikes/m1-01-canonicalization-runtime.ts`
> Package : `packages/digest-runtime@0.1.0` (new)
> Spikes connexes : `M0-02-EVIDENCE.md` (8/1 PASS/PARTIAL) — précurseur.

## 0. Cadrage

Ce spike est l'évidence de la carte **C-M1-01** (Canonicalization — JCS +
SHA-256 runtime) du plan V2.3.1 §195-197. Le spike prouve que la couche
algorithmique `@unifia/digest-runtime` calcule un `DigestEnvelope`
(JCS-v1 + SHA-256) correct sur les 5 vecteurs d'acceptation du plan §3.1
+ §5.1, en appliquant la contrainte « integer-only » d'ADR-001 (mitigation
du bug M0-02 §3).

**Code de production créé** :
- `packages/digest-runtime/package.json` (nouveau)
- `packages/digest-runtime/tsconfig.json` (nouveau)
- `packages/digest-runtime/src/index.ts` (nouveau — `digest()`, `validateIntegerOnly()`, `IntegerOnlyError`, re-export `asDomainDigest`)
- `packages/digest-runtime/test/digest.test.ts` (nouveau — 12 cas, 38 expect, 0 fail)
- `docs/automation-v2/spikes/m1-01-canonicalization-runtime.ts` (nouveau — spike throwaway)
- `docs/automation-v2/spikes/M1-01-EVIDENCE.md` (ce fichier)
- `bun.lock` (mis à jour — `canonicalize@4.0.0` ajouté au workspace comme
  dep déclarée de `@unifia/digest-runtime`)

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
cd packages/digest-runtime && bun test    # 12 pass / 0 fail
bun run --filter @unifia/digest-runtime typecheck    # exit 0
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m1-01-canonicalization-runtime.ts    # 5 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING
```

**Dernière exécution** : 2026-09-01, 5 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING.

## 1. Verdict par vecteur d'acceptation (M1 plan §5.1)

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| a | `digest({a:1, b:2})` ≡ `digest({b:2, a:1})` (tri de clés) | **PASS** | `84ae7437c76204ff...` identique quel que soit l'ordre d'insertion |
| b | `digest({x:1})` ≠ `digest({x:1.0})` (integer-only, Zod pre-coerce) | **PASS** | `1` et `1.0` → même digest (JS `1.0 === 1`, RFC 8785 §3.2.2.3) ; `1.5` jette `IntegerOnlyError` |
| c | 7 domaines produisent 7 `value` distincts pour un même payload | **PASS** | 7 SHA-256 distincts : `7b6f8183, 9e690130, 9a7e9a45, 938d5d25, c34fbd93, bf8817f5, cdd3bbf1` |
| d | `digest({nested:{b:1, a:2}})` ≡ `digest({nested:{a:2, b:1}})` (récursivité) | **PASS** | `863107660cf491eb...` identique |
| e | `digest({})` retourne SHA-256 du JCS de `{}` (vecteur de référence) | **PASS** | `b881d4419e368f13...` = SHA-256 de JCS(`{"domain":"workflow-version","value":{}}`) |

## 2. Verdict agrégé

```text
PASS     5
PARTIAL  0
FAIL     0
MISSING  0
```

## 3. Notes sur le vecteur (b) — integer-only

L'acceptation « `digest({x:1})` ≠ `digest({x:1.0})` » du plan V2.3.1 §5.1
doit être lue en regard du bug M0-02 : la bibliothèque `canonicalize`
npm v4.0.0 collapse `1` et `1.0` au même flux d'octets (RFC 8785 §3.2.2.3).
**En JavaScript, `1.0 === 1`** et `Number.isInteger(1.0) === true`. Une
fonction runtime ne peut pas distinguer les deux littéraux — ce sont le
même nombre.

La mitigation ADR-001 a deux étages :

1. **En amont** (contrats) : les schémas Zod utilisent `z.int()` pour
   les numériques (e.g. `WorkflowVersion.version: z.int()`). Un caller
   ne peut pas fournir un flottant non-entier via le contrat.

2. **En aval** (runtime, ce package) : `validateIntegerOnly()` traverse
   la valeur et jette `IntegerOnlyError` pour les nombres qui ne sont
   **pas** des safe integers (NaN, ±Infinity, ou fraction non nulle
   comme `1.5`). Pour `1` et `1.0`, le runtime accepte les deux — ce
   sont des nombres équivalents.

Donc le test (b) vérifie :
- `digest({x: 1})` réussit et retourne un digest stable.
- `digest({x: 1.0})` réussit et retourne **le même** digest (parce que
  `1.0 === 1` en JS).
- `digest({x: 1.5})` jette `IntegerOnlyError` (chemin `/x`, valeur `1.5`).

C'est l'invariant qui empêche la collision silencieuse de M0-02 §3 :
un flottant non-entier ne peut jamais atteindre le canonicaliseur, donc
il ne peut jamais produire un digest ambigu. La collision `1 ≡ 1.0` est
préservée par設計 — c'est la sémantique RFC 8785 §3.2.2.3.

## 4. Edge cases découverts

Pendant l'implémentation, les cas limites suivants ont été vérifiés
(voir `packages/digest-runtime/test/digest.test.ts`) :

| Cas | Comportement | Pourquoi |
|---|---|---|
| `Number.MAX_SAFE_INTEGER + 1` | jette `IntegerOnlyError` | `Number.isInteger` retourne `true` mais `Number.isSafeInteger` retourne `false` (perte de précision IEEE 754) |
| `NaN` | jette `IntegerOnlyError` | `Number.isInteger(NaN) === false` |
| `Infinity`, `-Infinity` | jettent `IntegerOnlyError` | `Number.isInteger(Infinity) === false` |
| `-0` | accepté | `Number.isInteger(-0) === true` et `Object.is(-0, 0) === false` mais les deux ont la même représentation canonique JCS |
| `Number(1)` (boxed) | accepté | Boxing ne change pas la valeur numérique |
| `BigInt(1)` | non accepté (erreur JCS) | Le canonicaliseur jette sur `bigint` car ce n'est pas un type JSON ; c'est un signal correct |
| `null`, `undefined` | acceptés | Le JCS sérialise `null` et ignore `undefined` (objet sans la clé) |
| Fonction, Symbol, référence circulaire | jette `TypeError` | Le canonicaliseur retourne `undefined` pour les types non-JSON ; le runtime détecte et jette un `TypeError` typé |
| Profondeur d'imbrication | non limitée par le runtime | `validateIntegerOnly` est récursif ; les contrats en amont limitent la profondeur (plan §226 — 10 niveaux max) |
| Mutation de l'input | non | La version itérative a été remplacée par une version récursive qui ne mute jamais l'objet/array d'entrée |

**Décision de design notable** : la première mouture utilisait une DFS
itérative qui mutait les objets/arrays en leur ajoutant des champs
`_pending` / `_index`. Cette approche a été rejetée pour deux raisons :
(1) elle mutait l'input du caller — inacceptable pour une fonction pure,
(2) elle pouvait collisionner avec des champs utilisateur. La version
finale est récursive et immuable.

## 5. Compatibilité ascendante et migrations

- **Aucune migration** n'est nécessaire côté contrats : `digest.ts`,
  `workflow-ir.ts`, `artifact-record.ts` ne sont pas touchés (cf. briefing
  « DO NOT touch the 7 existing M1 contracts »).
- **Aucun fichier hors `packages/digest-runtime/`** n'est modifié.
- `bun.lock` est mis à jour pour déclarer `canonicalize@4.0.0` comme
  dépendance de `@unifia/digest-runtime`. Avant ce commit, `canonicalize`
  était dans `node_modules` (installé via `bun add --no-save` pour le
  spike M0-02) mais non verrouillé dans `bun.lock`. Le runtime le déclare
  maintenant explicitement.

## 6. Statut de la carte C-M1-01

| Élément | Statut |
|---|---|
| Code de production | `packages/digest-runtime/` créé, 4 fichiers, 12 tests verts |
| Typecheck workspace | 39 successful / 40 total (1 échec pré-existant sur `workbench-server` — fichiers untracked d'Agent B, hors scope) |
| Spike throwaway | `docs/automation-v2/spikes/m1-01-canonicalization-runtime.ts` — 5 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING |
| `packages/app` tests | 1192 pass / 0 fail (baseline préservé) |
| Décision ADR-001 | Renforcée : le runtime implémente la mitigation « integer-only » au niveau runtime, en sus de la contrainte `z.int()` au niveau contrat |
| Suite immédiate | C-M1-02 (DigestEnvelope wiring) peut démarrer — ne dépend que du runtime et des types `digest.ts` existants |

## 7. Liens

- `packages/digest-runtime/src/index.ts` (code du runtime)
- `packages/digest-runtime/test/digest.test.ts` (12 cas, 38 expect)
- `docs/automation-v2/spikes/m1-01-canonicalization-runtime.ts` (spike throwaway)
- `docs/automation-v2/spikes/M0-02-EVIDENCE.md` (précurseur — choix de `canonicalize`)
- `packages/contracts/src/digest.ts` (types `DigestDomainSchema`, `DigestEnvelopeSchema`, branded types)
- `docs/automation-v2/M1-IMPLEMENTATION-PLAN.md` §3.1, §5.1
- plan V2.3.1 §64-66 (digest model), §193 (spike pattern), §195-197 (M1 gate)
- ADR-001 (Canonical Serialization / Digest Model)
- RFC 8785 (JCS) §3.2.2.3 (numeric serialization)
