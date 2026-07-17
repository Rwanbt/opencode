# Plan — Internationalisation de l’interface du fork

**Date** : 2026-07-16  
**Branche** : `dev`  
**Statut** : Terminé — chaînes visibles examinées et centralisées

## Objectif

Supprimer les chaînes codées en dur dans les écrans ajoutés au fork, compléter le français et empêcher les nouvelles clés i18n de manquer dans les autres locales.

## Étapes

- [x] Cartographier les chaînes codées en dur des paramètres et fonctionnalités fork.
- [x] Centraliser les chaînes dans packages/app/src/i18n/en.ts et fr.ts.
- [x] Remplacer les textes JSX directs par language.t(...) ; les valeurs techniques restent volontairement littérales.
- [x] Ajouter un contrôle de parité exhaustif des clés pour toutes les locales.
- [x] Exécuter bun typecheck, le test parity i18n et git diff --check.

## Décision

Les locales autres que le français conserveront temporairement le fallback anglais pour les nouvelles clés, mais aucune locale ne devra perdre une clé. Les traductions dédiées pourront ensuite être ajoutées progressivement sans modifier les composants.
