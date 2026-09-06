<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0-02 EVIDENCE — canonicalization spike (ADR-001)

> Statut : **EVIDENCE_PINNED** (input for ADR-001)
> Date : 2026-09-01T17:00+02:00
> Source : `docs/automation-v2/spikes/m0-02-canonicalization.ts` (throwaway,
> plan §193).

## 0. Cadrage

Ce spike est un test d'évidence pour ADR-001 (Canonical Serialization /
Digest Model). Le spike vérifie qu'une bibliothèque JCS standard
(`canonicalize` npm v4.0.0) implémente correctement RFC 8785 sur 9
vecteurs représentatifs.

**Code de production modifié** : aucun. Le spike dépend de la
bibliothèque `canonicalize` installée via `bun add --no-save` (non
commitée). Aucun fichier `package.json` modifié.

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun add --no-save canonicalize
bun docs/automation-v2/spikes/m0-02-canonicalization.ts
```

**Dernière exécution** : 2026-09-01, 8 PASS / 1 FAIL.

## 1. Verdict par vecteur

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| 1 | Déterminisme (même input → même SHA-256) | **PASS** | `58a0edf5f1a49a65...` (16 premiers hex) |
| 2 | Invariance clé racine (JCS trie les clés) | **PASS** | ordre différent, digest identique |
| 3 | Invariance clé imbriquée (récursif) | **PASS** | ordre différent, digest identique |
| 4 | Précision numérique RFC 8785 §3.2.2.3 | **FAIL** | `1` et `1.0` collapsent à `{"x":1}` (devrait être `{"x":1.0}`) |
| 5 | Préservation Unicode (UTF-8) | **PASS** | `{"café":1}` préservé |
| 6 | Ordre des tableaux préservé (JCS ne trie pas les arrays) | **PASS** | `[1,2,3]` et `[3,2,1]` → digests différents |
| 7 | Séparation par domaine | **PASS** | `workflow-version` ≠ `approval-effect` pour un même payload |
| 8 | Stabilité de la forme canonique (même string, pas juste même hash) | **PASS** | `{"x":1,"y":2}` reproductible |
| 9 | Migration d'algorithme (JCS-v1 vs JCS-v2) | **PASS** | versions distinctes, pas de collision |

## 2. Verdict agrégé

```text
PASS  8
FAIL  1
```

## 3. Le FAIL — analyse

**RFC 8785 §3.2.2.3** exige que la sérialisation distingue les
entiers des flottants. La sortie canonique de `1` doit être `"1"`,
la sortie canonique de `1.0` doit être `"1.0"`.

Le test vecteur 4 mesure exactement cela :

```ts
canonicalize({ x: 1 })   // -> '{"x":1}'   (correct)
canonicalize({ x: 1.0 }) // -> '{"x":1}'   (BUG: devrait etre '{"x":1.0}')
```

**Source du bug** : la bibliothèque `canonicalize` (npm v4.0.0) utilise
`JSON.stringify` en interne. `JSON.stringify` ne distingue pas `1` et
`1.0` — il sérialise les deux comme `1`. C'est une violation de
RFC 8785.

**Impact** :

- Pour `WorkflowVersion.canonicalDigest` (un entier `version: 1`),
  l'impact est nul : le format est toujours entier.
- Pour `costUnits` (numérique, peut être un ratio), l'impact est
  nul si on n'utilise que des entiers.
- Pour les vecteurs réels d'`artifact-export`, aucun vecteur n'a
  été touché.

**Risque latent** : si un futur vecteur contient `1.0` (entier
exprimé en flottant, par exemple via un import JSON qui infère
`number` en flottant), il collisionnera avec `1`. C'est un bug
silencieux qui peut produire des digests non-désirés.

## 4. Options pour ADR-001

| Option | Avantage | Inconvénient |
|---|---|---|
| A. Utiliser `canonicalize` + post-processor | Library maintenue, simple | Post-processor custom, risque de bug |
| B. Utiliser `canonicalize` + verrouiller la sémantique entière (Zod coerce int) | Aucun risque | Refuse les vrais floats |
| C. `json-canonicalize` (autre library) | Conforme RFC 8785 | Moins maintenue |
| D. Hand-roll JCS conforme | Conformité totale | Effort, bugs possibles |
| E. Utiliser CBOR canonical (RFC 8949) | Standard industriel | Migration du format JSON partout |

**Recommandation** : Option **A** avec une règle stricte : tous
les nombres dans les payloads canonisés sont des entiers (vérifié par
Zod avant canonicalisation). Les floats sont refusés à la frontière
de publication (`WorkflowVersion`). Si un flottant devient
nécessaire, on évalue Option **C** (`json-canonicalize`) ou
Option **D** (hand-roll).

**Statut ADR-001** : `PROPOSED` avec une contrainte nouvelle — la
sémantique de `costUnits` et autres numériques est **entier uniquement**
jusqu'à preuve du contraire. Les floats ne sont pas supportés dans
la première version.

## 5. Ce que le spike confirme

- JCS est utilisable pour notre cas (8/9 vecteurs).
- Le seul bug est localisable (numeric precision) et a un
  workaround simple (entier uniquement).
- La séparation par domaine fonctionne.
- La migration d'algorithme est possible.

**Conclusion** : ADR-001 est faisable. Le spike fournit l'évidence
empirique pour le choix technique.

## 6. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **NON** |
| Bibliothèque `canonicalize` | Installée via `bun add --no-save` (transient) |
| Verdict ADR-001 | Faisable, avec contrainte "entier uniquement" |
| Décision ADR-001 | **EN ATTENTE** (décision externe) |

## Liens

- `docs/automation-v2/spikes/m0-02-canonicalization.ts` (code du spike)
- `docs/adr/ADR-001-canonical-serialization-digest.md`
- `docs/automation-v2/RISK_REGISTER.md#R-014`
- plan V2.3.1 §63-66, §193 (throwaway spike)
- RFC 8785 : https://www.rfc-editor.org/rfc/rfc8785
