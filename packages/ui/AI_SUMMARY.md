# AI_SUMMARY — ui

> **Auto-generated 2026-05-27 17:45** — do not edit manually.
> Source: `tools/ai_docs/generate_ai_summary.py`
> For purpose, thread model and constraints, read `AI_CONTEXT.md`.

## Purpose
Bibliothèque de composants SolidJS partagés entre `packages/app`, `packages/desktop`
et `packages/web`. Composants Kobalte (Slider, SegmentedButton, Dialog…) + Tailwind 4,
icônes, primitives de layout, et système de thèmes (tokens CSS).

## Common failure modes
- **Slider Kobalte valeur display** : `tabular-nums` requis pour éviter le layout shift
- **SegmentedButton custom** : Kobalte n'a pas de composant natif — pattern custom avec `data-selected`
- **Tailwind purge** : classes dynamiques non détectées → utiliser la safelist ou préférer les classes statiques

## Hot files
- [packages/ui/src/](src/) — composants principaux
- [packages/ui/src/theme.css](src/theme.css) — tokens CSS globaux (si présent)

## Files & LOC
| File | LOC | |
|------|-----|--|
| `sst-env.d.ts` | 2 | |
| `vite.config.ts` | 56 | |
| **Total** | **58** | |
