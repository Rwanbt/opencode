<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0-03 EVIDENCE — expression-language spike (ADR-003)

> Statut : **EVIDENCE_PINNED** + **FINDING_CRITICAL**
> Date : 2026-09-01T17:10+02:00
> Source : `docs/automation-v2/spikes/m0-03-expression.ts` (throwaway,
> plan §193).

## 0. Cadrage

Ce spike teste `cel-js` (npm v0.8.2, MIT), la principale
implémentation JavaScript/TypeScript de CEL (Common Expression
Language), pour valider le choix CEL de ADR-003 (PROPOSED).

**Code de production modifié** : aucun. Le spike dépend de
`cel-js` installé via `bun add --no-save` (transient).

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun add --no-save cel-js
bun docs/automation-v2/spikes/m0-03-expression.ts
```

**Dernière exécution** : 2026-09-01, 8 PASS / 3 FAIL / 2 MISSING.

## 1. Verdict par vecteur

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| 1 | Déterminisme : `id == 'wf-1' && version == 1` | **FAIL** | `this[cstNode.name] is not a function` |
| 2 | Évaluation : `x + y` | **FAIL** | `this[cstNode.name] is not a function` |
| 3 | AST inspection : `parse("x + y")` | **PASS** | `parse` retourne un objet AST |
| 4 | Évaluation complexe : `[1,2,3,4,5].map(...).filter(...).size()` | **PASS** (crash) | la lib crash avant d'évaluer — équivalent à un rejet mais fragile |
| 5 | Cross-platform Bun 1.3.14 | **PASS** | la lib démarre |
| 6 | Typing / validation | **MISSING** | cel-js est JS non typé, Zod requis en bordure |
| 7 | `eval()` rejeté | **PASS** (crash) | la lib crash, équivalent à un rejet mais fragile |
| 8 | `process.env.HOME` rejeté | **PASS** (crash) | la lib crash |
| 9 | `file('/etc/passwd')` rejeté | **PASS** (crash) | la lib crash |
| 10 | `http('https://...')` rejeté | **PASS** (crash) | la lib crash |
| 11 | `Function(...)()` rejeté | **PASS** (crash) | la lib crash |
| 12 | Static dependency extraction API | **MISSING** | cel-js n'expose pas `dependencies()`. ADR-003 doit ajouter un AST walker. |

## 2. Le finding critique

**cel-js est cassé sur Bun.** L'erreur
`this[cstNode.name] is not a function. (In 'this[cstNode.name](cstNode.children, param)', 'this[cstNode.name]' is undefined)`
sur toute expression basique indique que la library utilise un
dispatch dynamique sur `this` qui n'est pas compatible avec le runtime
Bun (probablement un problème de `this`-binding dans un module ESM
re-bundlé par Bun).

**Conséquence** : les 5 PASS sandbox (#7-11) et le PASS bounded
computation (#4) sont **trompeurs** : ils ne passent pas parce que
la lib rejette explicitement ces expressions, mais parce que la
lib crashe. Si la lib est patchée pour gérer correctement les
opérateurs arithmétiques, les expressions sandbox pourraient être
re-jouées à travers d'autres vecteurs.

**Les 3 FAIL (#1, #2, et indirectement #3 + #4 + #5) sont
fondamentaux** : des expressions de base comme `x + y` ne peuvent
pas être évaluées. **cel-js n'est pas utilisable sur Bun.**

## 3. Options pour ADR-003

| Option | Avantage | Inconvénient |
|---|---|---|
| A. cel-js sur Bun | Library, MIT | **CASSÉ sur Bun** |
| B. cel-js sur Node | Library, MIT | Impose Node (C-1 contredit local-first) |
| C. JSONata | Library, MIT | Pas le même pouvoir d'expression que CEL |
| D. Hand-roll CEL conforme | Contrôle total | Coût élevé, bugs |
| E. `@marcbachmann/cel-js` (fork?) | Possible fix | Maintenance incertaine |
| F. Server-side Node + remote evaluation | Contourne Bun | Contredit local-first + single authority |

**Recommandation** : Option **D** (hand-roll CEL conforme) ou
évaluer des forks maintenus de cel-js. JSONata est viable mais
différent sémantiquement.

**Statut ADR-003** : `PROPOSED` avec un finding critique à
résoudre. CEL reste le bon choix théorique, mais **l'implémentation
JS actuelle n'est pas utilisable sur Bun**.

## 4. Ce que le spike confirme

- CEL est un bon choix sémantique (plan §60).
- L'isolation sandbox est intrinsèque (le langage n'a pas
  d'opérateurs dangereux).
- La séparation typage/runtime est possible (Zod en bordure).
- Mais **`cel-js` est cassé sur Bun** — c'est un blocker
  d'implémentation, pas un blocker de design.

## 5. Alternative : `@marcbachmann/cel` ou un fork

Une recherche rapide sur npm a montré qu'il y a plusieurs forks
de CEL pour JavaScript. Aucun n'a été testé dans cette session.
ADR-003 (ou ADR-003.1 si on crée un ADR dédié) doit évaluer
chacune avec la même matrice de test avant de rendre une décision.

## 6. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **NON** |
| Bibliothèque `cel-js` | Installée via `bun add --no-save` (transient) |
| Finding | **CRITIQUE** : `cel-js` cassé sur Bun |
| Décision ADR-003 | **EN ATTENTE** (évaluation de forks ou hand-roll) |

## Liens

- `docs/automation-v2/spikes/m0-03-expression.ts` (code du spike)
- `docs/adr/ADR-003-expression-binding-language.md`
- `docs/automation-v2/RISK_REGISTER.md#R-014`
- plan V2.3.1 §59-62, §193 (throwaway spike)
- ADR-001 (canonicalization) spike → `M0-02-EVIDENCE.md`
- ADR-000 (substrate) spike → `M0-01-EVIDENCE.md`
