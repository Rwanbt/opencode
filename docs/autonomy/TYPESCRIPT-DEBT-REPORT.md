# TypeScript Debt Report — Unifia Workbench

**Date :** 2026-08-01

## Résumé

Total `@ts-ignore` et `@ts-expect-error` dans le code Unifia : **40**

Distribué sur **30 fichiers**.

## Distribution par fichier

| File | Count |
|---|---:|
| `packages/app/src/components/settings-general.tsx` | 3 |
| `packages/console/resource/resource.node.ts` | 3 |
| `packages/console/resource/resource.cloudflare.ts` | 2 |
| `packages/unifia/src/provider/provider.ts` | 2 |
| `packages/unifia/src/session/index.ts` | 2 |
| `packages/unifia/test/provider/models-refresh.test.ts` | 2 |
| `packages/unifia/test/sync/index.test.ts` | 2 |
| `packages/ui/src/components/message-part.tsx` | 2 |
| `github/index.ts` | 1 |
| `packages/app/happydom.ts` | 1 |
| `packages/app/src/components/prompt-input.tsx` | 1 |
| `packages/console/core/src/user.ts` | 1 |
| `packages/console/function/src/auth.ts` | 1 |
| `packages/unifia/src/cli/cmd/generate.ts` | 1 |
| `packages/unifia/src/cli/cmd/tui/context/helper.tsx` | 1 |
| `packages/unifia/src/cli/cmd/tui/context/theme.tsx` | 1 |
| `packages/unifia/src/control-plane/adaptors/index.ts` | 1 |
| `packages/unifia/src/file/watcher.ts` | 1 |
| `packages/unifia/src/server/instance.ts` | 1 |
| `packages/unifia/src/server/routes/tui.ts` | 1 |
| `packages/unifia/src/session/llm.ts` | 1 |
| `packages/unifia/src/session/message-v2.ts` | 1 |
| `packages/unifia/test/server/provider-refresh-routes.test.ts` | 1 |
| `packages/plugin/script/publish.ts` | 1 |
| `packages/sdk/js/src/gen/client/client.gen.ts` | 1 |
| `packages/sdk/js/src/v2/gen/client/client.gen.ts` | 1 |
| `packages/ui/src/components/file-ssr.tsx` | 1 |
| `packages/ui/src/components/select.tsx` | 1 |
| `packages/ui/src/context/helper.tsx` | 1 |
| `sdks/vscode/src/extension.ts` | 1 |

## Politique de gestion

### Niveau 1 (Acceptable)
- `@ts-ignore` documenté avec un commentaire explicite
- `@ts-expect-error` pour test de type narrowing

### Niveau 2 (À réduire)
- `@ts-ignore` utilisé pour contourner un bug connu d''une dépendance externe
- `@ts-ignore` sur des API non-encore-typées

### Niveau 3 (Critique)
- `@ts-ignore` qui masque une vraie erreur de type
- `@ts-ignore` ajouté pour éviter de fixer la cause

## Plan

1. **v1.0** : auditer les 30 fichiers, lister les causes
2. **v1.1** : remplacer `@ts-ignore` par des types précis
3. **v2.0** : 0 `@ts-ignore` dans les nouveaux packages (sauf test fixtures)

## Outils

- `grep -rE "@ts-ignore|@ts-expect-error" packages/ --include="*.ts" --include="*.tsx" -c` : compte par fichier
- `bunx tsc --noEmit --strict` : détecte les types manquants

## Liens

- ADR-0029 (Politique de dette technique)
- [TASK-GRAPH-v2.0.yaml](TASK-GRAPH-v2.0.yaml)
- [BLOCKED-DECISIONS.md](BLOCKED-DECISIONS.md)
