<!-- SPDX-License-Identifier: MIT -->
# Audit final — Unifia V3 au 2026-08-07

Mode **Audit** au sens de `AGENTS.md` : contrat d'exécution explicite, lecture
directe, **aucun sous-agent**, couverture rapportée.

## Contrat d'exécution

Périmètre = les **25 paquets détenus** déclarés dans `scripts/unifia-conformance.mjs`,
plus le script de gate lui-même. Le fork hérité est **hors périmètre** : il n'a pas
été écrit ici et l'auditer reviendrait à auditer OpenCode amont.

```
Paquets détenus     : 25
Suites déclarées    : 41
Fichiers au contrat : 119  (72 source, 47 test)
Octets              : 679 985  → ~170k tokens
Stratégie           : > 150k → multi-phases (cartographie → lectures ciblées → synthèse)
```

## Le résultat principal

**179 exports détenus. 16 sont consommés hors des tests — soit 9 %.**
**24 des 25 paquets ne sont importés par aucun code produit.**

Un seul paquet V3, `@unifia/contracts`, est importé par du code produit, depuis
exactement **deux fichiers** : `packages/unifia/src/unifia/opencode-runtime-backend.ts`
et `packages/slack/src/remote-adapter.ts`.

> `@unifia/app` apparaît aussi dans les imports du desktop et du mobile, mais c'est
> le frontend renommé du fork, **pas** un des 25 paquets V3. Il ne compte pas.

### Ce que ce chiffre veut dire, et ce qu'il ne veut pas dire

Ce n'est **pas** un défaut d'un paquet en particulier. Chacun fait ce que sa
section du plan demande et le prouve contre sa propre suite. Les preuves sont
réelles et reproductibles.

Mais « 16 phases sur 21 à `PASS local` » peut se lire comme « le produit est
construit aux 16/21 », et **cette lecture serait fausse**. L'état réel est :

> un ensemble de **bibliothèques qui démontrent les exigences du plan contre
> leurs propres suites**, non câblées dans une application qui tourne.

C'est exactement ce que la convention `PASS local` disait déjà — « ce n'est pas
une preuve de production » — mais dit en chiffres plutôt qu'en note de bas de page.
C'est aussi la raison pour laquelle la **Phase 7** (shell rendu) reste le seul vrai
chantier : c'est elle qui consommerait ces 179 exports.

## Défauts trouvés et corrigés pendant l'audit

| Sévérité | Défaut | Correction |
|---|---|---|
| Haute | `gate-b.ts` contenait un `verify: () => true` **anonyme** — la convention `PRE_VERIFIED`, créée deux jours plus tôt pour rendre ces cas greppables, violée par son propre auteur | Routé via `PRE_VERIFIED` avec le commentaire exigé |
| Moyenne | **6 compteurs périmés** dans la table de statut (`SandboxDrivers` 29 → 40, `ArtifactStudio` 33 → 53, `MemoryGovernance` 34 → 46, `ArtifactStore` 27 → 37, `DocumentPackRegistry` 6 → 27, `WorkbenchBootstrap` 39 → 40) — tous des **sous-estimations**, rien de surévalué | Rafraîchis |
| Moyenne | Les notes des gates **répétaient des compteurs** qui dérivent en silence | Compteurs **retirés des notes** : une note dit *où vit la preuve*, pas un nombre qui périme. C'était l'intention de conception initiale, trahie par son auteur |

## Faux positifs de l'outil d'audit, corrigés avant rapport

L'outil a d'abord produit **102 signalements**. Avant de les rapporter, il a été
audité lui-même — il en restait **54** après correction de deux générateurs :

1. **Exports « morts »** : le contrôle excluait le fichier de définition entier,
   donc `main()` appelant `startWorkbench` dans le même fichier se lisait comme
   inutilisé. Corrigé : seule la ligne de déclaration est retirée.
2. **Compteurs « figés »** : le comptage d'assertions était ancré en début de
   ligne et limité à quelques noms, donc une suite en style `if (…) throw` sortait
   à zéro. Corrigé.
3. **Trois « suites orphelines »** (`browser-entry.ts`, `browser-e2e-impl.ts`,
   `happydom.ts`) sont en réalité de la **machinerie** de la suite navigateur
   déclarée — vérifié fichier par fichier.

> C'est la règle appliquée à moi-même : **un outil n'est pas une autorité**. Les
> 48 signalements écartés l'ont été après vérification, pas par confort.

## Contrôles restés verts

- **Aucune erreur avalée** (`catch {}`) dans les 72 fichiers source détenus.
- **Aucun résidu de rebrand** (`ai.opencode.mobile`, `opencode_mobile_lib`) au contrat.
- **Aucune suite fantôme** : les 41 suites déclarées existent toutes sur le disque.
- **Aucune suite orpheline** réelle : tout fichier de test détenu tourne dans un gate.
- Conformance **8/8**, typecheck, lint : verts.

## Couverture — Audit Unifia V3

```
Fichiers : 119 au contrat | Exclus (fork hérité) : par déclaration | À lire : 119
Cartographie déterministe : 119/119 (100%)
Lectures ciblées : 11 fichiers sur signalement (gate-b, gate-c, les 3 machineries
navigateur, runtime.rs, extraction.rs, api.ts, infra/app.ts, remote.ts, browser.ts)

Fichiers de logique métier non couverts : aucun
Modules centraux non couverts (>5 imports entrants) : aucun
```

**Confiance : 8/10.** Plafonnée par la revendication porteuse la plus faible : la
cartographie est `VERIFIED` (exécutée, reproductible), et le chiffre de 9 % est
`VERIFIED` par recoupement direct des imports. Ce qui reste `INFERRED` est le
**comportement** des 24 paquets non câblés en conditions réelles — leurs suites
prouvent le contrat, pas l'usage. Aucune incertitude P0/P1 ouverte.

## Ce que cet audit ne peut pas établir

- **« Aucun P0/P1 sécurité »** — ne peut pas être auto-certifié. C'est la thèse
  qu'un audit tiers existe pour tester. Quatre défauts réels ont été trouvés par
  les gates de ce projet le 2026-08-05 seul : preuve que les gates fonctionnent,
  **pas** que la liste est vide.
- **Le comportement en production** — aucun des 25 paquets ne tourne dans une
  application déployée.
