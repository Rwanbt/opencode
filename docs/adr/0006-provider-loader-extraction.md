# ADR-0006 : Extraction des loaders provider hors de provider.ts

**Date** : 2026-06-22 | **Statut** : Accepté

## Contexte

`packages/opencode/src/provider/provider.ts` avait atteint **1644 LOC**, au-delà
du seuil BLOCKER de 1500 LOC fixé par `CLAUDE.md` (refactor obligatoire). La
cause unique : la fonction `custom(dep)` (~614 LOC) qui retournait un
`Record<string, CustomLoader>` — un loader par provider (anthropic, openai,
amazon-bedrock, google-vertex, gitlab, cloudflare-*, etc.) contenant la logique
spécifique d'autoload, de résolution SDK (`responses` vs `chat` vs
`languageModel`), de credentials et de découverte dynamique de modèles.

Cette fonction est une **responsabilité distincte** du reste de provider.ts (qui
orchestre l'état provider, la résolution SDK générique, le streaming). Elle
change pour des raisons différentes (ajout/évolution d'un provider tiers) que le
cœur d'orchestration.

## Décision

Extraire `custom(dep)` vers un module dédié `provider/loaders.ts`, exporté comme
`buildCustomLoaders(dep, log)`. Les types loader (`CustomModelLoader`,
`CustomVarsLoader`, `CustomDiscoverModels`, `CustomLoader`, `CustomDep`) et le
helper `useLanguageModel` y sont co-localisés.

**Granularité : un seul fichier, pas un répertoire de N fichiers.** La majorité
des loaders font 8-12 lignes (anthropic, openrouter, cerebras, kilo…) ; les
éclater en 20 fichiers disperserait des closures triviales sans bénéfice. Un
`loaders.ts` unique (~620 LOC) reste sous le seuil ALERT de 800 LOC et porte une
responsabilité unique : « définitions de loaders provider-spécifiques ».

**Pas de cycle runtime.** loaders.ts référence `Provider.Info` / `Provider.Model`
via `import type` (effacé à la compilation). provider.ts importe
`buildCustomLoaders` en valeur. La dépendance runtime est unidirectionnelle
(provider → loaders).

## Conséquences

- provider.ts : 1644 → **1007 LOC** (sous le seuil BLOCKER ; reste un
  coordinateur au-dessus du seuil ALERT, acceptable par ADR-0002).
- Comportement préservé à l'identique (extraction mécanique pure) : 288 tests
  provider verts, typecheck clean, les tests exercent le graphe runtime
  provider → loaders.
- Ajouter un nouveau provider tiers se fait désormais dans loaders.ts sans
  toucher au cœur d'orchestration.

## Alternatives rejetées

- **Répertoire `provider/loaders/<provider>.ts`** : sur-découpage pour des
  loaders majoritairement triviaux ; augmente la surface d'imports sans gain de
  lisibilité.
- **Laisser en l'état** : viole le seuil BLOCKER de CLAUDE.md ; le god-file
  freine toute évolution provider.
