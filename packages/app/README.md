# @opencode-ai/app

Shared UI package for all OpenCode frontends (desktop, mobile, web). Built with SolidJS and Tailwind CSS.

## Development

```bash
bun install
bun run dev          # Vite dev server on localhost:1430
```

## Build

```bash
bun run build        # Production build to dist/
```

## Testing

### Unit Tests

```bash
bun run test:unit           # Run all unit tests (300+ tests)
bun run test:unit:watch     # Watch mode
```

### E2E Tests (Playwright)

Playwright starts the Vite dev server automatically via `webServer`, and UI tests need an opencode backend (defaults to `localhost:4096`).

```bash
bunx playwright install
bun run test:e2e:local
bun run test:e2e:local -- --grep "settings"
```

Environment options:
- `PLAYWRIGHT_SERVER_HOST` / `PLAYWRIGHT_SERVER_PORT` (backend address, default: `localhost:4096`)
- `PLAYWRIGHT_PORT` (Vite dev server port, default: `3000`)
- `PLAYWRIGHT_BASE_URL` (override base URL, default: `http://localhost:<PLAYWRIGHT_PORT>`)

## Architecture

```
src/
├── components/          # Shared UI components
│   ├── prompt-input/    # Rich text prompt editor
│   ├── session/         # Session header, message timeline
│   ├── settings-*.tsx   # Settings dialog pages
│   ├── dialog-*.tsx     # Modal dialogs
│   └── terminal.tsx     # Terminal (Ghostty WASM + canvas fallback)
├── context/             # SolidJS context providers
│   ├── platform.tsx     # Platform abstraction (desktop/mobile/web)
│   ├── terminal.tsx     # PTY session management
│   ├── layout.tsx       # Persistent layout state
│   ├── global-sync/     # Server data synchronization
│   └── ...
├── pages/
│   ├── home.tsx         # Project selector
│   ├── layout.tsx       # Main layout with sidebar
│   └── session.tsx      # Chat session view
├── hooks/               # Reusable hooks
├── i18n/                # 18+ language translations
└── utils/               # Utilities
```

### Platform Support

The app adapts to three platforms via `PlatformProvider`:
- **Desktop** (`platform: "desktop"`) — Tauri desktop with native features
- **Mobile** (`platform: "mobile"`) — Tauri Android/iOS with touch optimizations
- **Web** (`platform: "web"`) — Browser-only mode

Responsive behavior uses `@solid-primitives/media` breakpoints:
- `< 768px` — Mobile layout (tab switcher, vertical panels)
- `768px - 1280px` — Tablet layout
- `> 1280px` — Desktop layout (sidebar, horizontal panels)

### Terminal

The terminal component uses `ghostty-web` with a canvas renderer fallback:
- Desktop: Full Ghostty WASM rendering
- Mobile: If WASM fails to load, falls back to built-in canvas renderer
- Connects to backend PTY via WebSocket (`/pty/{id}/connect`)
- Mobile PTY uses a custom musl-compiled `librust_pty.so` (forkpty wrapper) loaded by bun-pty via `BUN_PTY_LIB`
