# AI_SUMMARY — app

> **Auto-generated 2026-05-27 17:45** — do not edit manually.
> Source: `tools/ai_docs/generate_ai_summary.py`
> For purpose, thread model and constraints, read `AI_CONTEXT.md`.

## Purpose
Frontend SolidJS partagé entre desktop, web et mobile WebView.
Contient l'UI du chat (messages, terminal, saisie), les panels (modèles, settings, partage),
le système de thèmes, l'internationalisation, et le routing.
Communique avec le sidecar `packages/opencode` via SSE (events entrants) et REST (commandes).

## Common failure modes
- **Cache WebView stale** : `adb install -r` garde le cache — toujours `pm clear` + reinstall pour tester des modifs frontend ([référence](~/.claude/projects/d--App-OpenCode/memory/reference_android_webview_cache_stale.md))
- **IPC postMessage lent** : CSP manquant `http://ipc.localhost` → fallback polling lent
- **`<audio>` "no supported source"** : `http://asset.localhost` absent du CSP media-src
- **Decorum floating div** : placeholder `[data-tauri-decorum-tb]` absent → div title bar flottant
- **Mobile IME ne s'attache pas** : manque `canvas.addEventListener("touchend", textarea.focus())`

## Hot files
- [packages/app/src/components/terminal.tsx](src/components/terminal.tsx) — rendu terminal ghostty-web
- [packages/app/src/entry.tsx](src/entry.tsx) — bootstrap app + SSE connection
- [packages/app/src/pages/](src/pages/) — routing et pages principales
- [packages/app/src/context/](src/context/) — providers SolidJS globaux

## Files & LOC
| File | LOC | |
|------|-----|--|
| `happydom.ts` | 72 | |
| `playwright.config.ts` | 47 | |
| `sst-env.d.ts` | 2 | |
| `vite.config.ts` | 13 | |
| `vite.js` | 45 | |
| **Total** | **179** | |
