<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# POST-WORK-DESIGN-CONVERGENCE — Sovereign Knowledge Core V1

> Document de suivi pour la **future** fusion normale de `work-design`
> dans `dev`. Ne pas écrire ici de code ou de référence au contenu
> exclusif de `work-design`. Uniquement des **contrats** et **tests** à
> rejouer après la fusion.

## Rappel

La branche `work-design` (HEAD `1bbbe6a614`) possède 236 commits absents
de `dev` au moment de la création du worktree Knowledge. Ces commits ne
sont **pas importés**. Le coeur Knowledge est implémenté contre les
contrats présents dans `origin/dev` et derrière des adaptateurs stables
qui ne dépendent d'aucun fichier exclusif de `work-design`.

## Contrats neutres créés par Knowledge (côté `dev`)

(à remplir au fil de l'eau)

- `packages/contracts/src/knowledge/knowledge-ref.ts`
- `packages/contracts/src/knowledge/knowledge-space.ts`
- `packages/contracts/src/knowledge/restrictions.ts`
- `packages/contracts/src/knowledge/retrieval-candidate.ts`
- `packages/contracts/src/knowledge/context-pack.ts`
- `packages/contracts/src/knowledge/mutation-intent.ts`
- (etc.)

## Adaptateurs Knowledge → frontends présents dans `dev`

- `packages/unifia/src/knowledge/source/personal.ts`
- `packages/unifia/src/knowledge/source/project.ts`
- `packages/unifia/src/knowledge/source/external.ts`
- `packages/unifia/src/knowledge/source/session.ts`
- (etc.)

## Tests de compatibilité à rejouer après la fusion de `work-design` dans `dev`

(à remplir)

- Test 1 : un front issu de `work-design` consomme `@unifia/contracts`
  via les types `knowledge/*` ; aucune modification de l'API publique
  requise.
- Test 2 : le `KnowledgeService` injecté côté UI fonctionne en SSR
  (SolidStart) et CSR.
- Test 3 : aucun chemin d'import `knowledge/*` ne référence un
  composant UI propre à un mode.

## Oracle d'acceptation post-fusion

"Aucun changement du coeur Knowledge requis" — la branche Knowledge doit
pouvoir être fusionnée (par le propriétaire) dans `dev` à côté de
`work-design` déjà fusionné, sans patch du coeur. Seuls les adaptateurs
frontends peuvent nécessiter un re-bind (un test d'intégration, jamais
une réécriture).

## Procédure de re-vérification

1. `git fetch origin`
2. `git checkout dev`
3. `git merge --no-ff origin/work-design` (ou inverse) — par le propriétaire
4. `git checkout feat/sovereign-knowledge-core`
5. `git merge origin/dev` — par le propriétaire (sécurise la branche)
6. `bun --cwd packages/contracts typecheck && bun --cwd packages/contracts test`
7. `bun --cwd packages/unifia typecheck && bun --cwd packages/unifia test`
8. Tests `tests/knowledge/eval/dev/` et `tests/knowledge/eval/holdout/`
9. Si une régression, appliquer le patch knowledge minimal, rejouer.

## Limitations connues

Cette procédure est un **contrat** ; elle n'a pas été exécutée dans
cette session parce que la fusion `work-design` → `dev` n'a pas eu lieu.
