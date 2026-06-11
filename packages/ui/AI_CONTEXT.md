# AI_CONTEXT — packages/ui

## Purpose
Bibliothèque de composants SolidJS partagés entre `packages/app`, `packages/desktop`
et `packages/web`. Composants Kobalte (Slider, SegmentedButton, Dialog…) + Tailwind 4,
icônes, primitives de layout, et système de thèmes (tokens CSS).

## Thread model
| Composant | Thread | Notes |
|---|---|---|
| Tous les composants | Main thread WebView | SolidJS — synchrone, pas de workers |

## Constraints
- Les composants Kobalte ont des quirks spécifiques — voir [reference_kobalte_slider](~/.claude/projects/d--App-OpenCode/memory/reference_kobalte_slider.md)
- Aucune dépendance vers `packages/opencode` ou `packages/app` (dépendance descendante uniquement)
- Les tokens CSS de thème sont la source de vérité — jamais de couleurs hardcodées dans les composants
- Tailwind 4 — utiliser les nouvelles APIs (`@theme`, `@variant`) pas les anciennes (`theme.extend`)

## Forbidden
- Jamais d'import de `packages/opencode` ou `packages/app` depuis ce package
- Jamais de state global dans les composants (composants purement présentationnels)

## Common failure modes
- **Slider Kobalte valeur display** : `tabular-nums` requis pour éviter le layout shift
- **SegmentedButton custom** : Kobalte n'a pas de composant natif — pattern custom avec `data-selected`
- **Tailwind purge** : classes dynamiques non détectées → utiliser la safelist ou préférer les classes statiques

## Hot files
- [packages/ui/src/](src/) — composants principaux
- [packages/ui/src/theme.css](src/theme.css) — tokens CSS globaux (si présent)

## See also
- [reference_kobalte_slider](~/.claude/projects/d--App-OpenCode/memory/reference_kobalte_slider.md)
- [packages/app/AI_CONTEXT.md](../app/AI_CONTEXT.md)
