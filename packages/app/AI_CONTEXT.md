# AI_CONTEXT — packages/app

## Purpose
Frontend SolidJS partagé entre desktop, web et mobile WebView.
Contient l'UI du chat (messages, terminal, saisie), les panels (modèles, settings, partage),
le système de thèmes, l'internationalisation, et le routing.
Communique avec le sidecar `packages/opencode` via SSE (events entrants) et REST (commandes).

## Thread model
| Composant | Thread | Notes |
|---|---|---|
| UI SolidJS | Main thread WebView | Reactive signals — pas de workers |
| Terminal (ghostty-web) | Main thread | Canvas + textarea — PAS xterm.js |
| SSE consumer | Main thread | `EventSource` → signal updates |
| REST calls | Main thread async | `fetch()` vers le sidecar local |

## Constraints
- Le terminal utilise ghostty-web (canvas+textarea) — jamais chercher `.xterm-*` dans le DOM
- Sur mobile, `100dvh` est instable sous MIUI au keyboard toggle — utiliser `var(--vvh, 100dvh)` + `visualViewport` listener
- `process.env.OPENCODE_CLIENT === "mobile-embedded"` gate les comportements desktop vs mobile
- Les imports de `packages/opencode` sont interdits dans ce package (couplage UI→backend)
- CSP WebView requiert `http://ipc.localhost` (connect-src) et `http://asset.localhost` (img-src)

## Forbidden
- Jamais d'import direct depuis `packages/opencode/src/` (couplage circulaire)
- Jamais de `window.location.reload()` pour réinitialiser l'état — utiliser les signals SolidJS
- Jamais de `console.log` non filtré sur les events Tauri decorum (MutationObserver)

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

## See also
- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [reference_ghostty_web_not_xterm](~/.claude/projects/d--App-OpenCode/memory/reference_ghostty_web_not_xterm.md)
- [reference_tauri_csp_ipc_localhost](~/.claude/projects/d--App-OpenCode/memory/reference_tauri_csp_ipc_localhost.md)
