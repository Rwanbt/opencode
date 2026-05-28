# ADR-0002 : Coordinator LOC Floor — Pages session.tsx et layout.tsx

**Date** : 2026-05-27 | **Statut** : Accepté

## Contexte

Après extraction maximale via le pattern Factory with Deps (ADR-0001), `session.tsx` (1010 LOC) et `layout.tsx` (1127 LOC) restent au-dessus du seuil ALERTE (800 LOC). Toute extraction supplémentaire est-elle souhaitable ?

## Décision

Ces fichiers ont atteint leur **plancher architectural**. Ne pas extraire davantage car :

- Le JSX return de session.tsx (~176 LOC) nécessiterait ~25 props pour être extrait en composant
- Les 3 context objects de layout.tsx (~140 LOC) ferment sur ~40 variables locales
- Chaque extraction supplémentaire crée du prop-drilling ou des couplages implicites pires que le fichier unique

## Exceptions documentées

| Fichier | LOC | Raison du plancher |
|---------|-----|-------------------|
| `session.tsx` | ~1010 | JSX 176 LOC + resumeScroll circular dep + 25 refs DOM |
| `layout.tsx` | ~1127 | 3 context objects fermant sur ~40 vars + JSX 148 LOC |

## Conséquences

- La gate LOC (> 1500) n'est pas déclenchée pour ces fichiers
- Le seuil ALERTE (> 800) est atteint mais documenté comme acceptable
- Tout ajout futur dans ces fichiers doit passer par une factory extraite
