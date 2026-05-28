# Ownership Map — OpenCode Fork

Carte de possession des modules. Mise à jour après chaque extraction majeure.

## packages/app/ — UI SolidJS

| Module | Responsable | Dernière modification |
|--------|-------------|----------------------|
| `src/pages/session.tsx` | Fork | 2026-05-27 |
| `src/pages/session/session-mutations.ts` | Fork | 2026-05-27 |
| `src/pages/session/session-sync-effects.ts` | Fork | 2026-05-27 |
| `src/pages/session/session-scroll.ts` | Fork | 2026-05-27 |
| `src/pages/layout.tsx` | Fork | 2026-05-27 |
| `src/pages/layout/layout-navigation.ts` | Fork | 2026-05-27 |
| `src/pages/layout/project-actions.tsx` | Fork | 2026-05-27 |
| `src/pages/layout/workspace-ops.ts` | Fork | 2026-05-27 |
| `src/pages/layout/notifications.ts` | Fork | 2026-05-27 |
| `src/components/prompt-input.tsx` | Fork (LOC reduction) | 2026-05-27 |
| `src/components/prompt-input/keyboard-handler.ts` | Fork | 2026-05-27 |

## packages/opencode/ — Backend TypeScript

| Module | Responsable | Notes |
|--------|-------------|-------|
| `src/session/` | Upstream + Fork patches | Minimal fork changes |
| `src/provider/` | Upstream + Fork patches | local-llm, Hexagon, OpenCL |
| `src/lsp/` | Upstream | Ne pas modifier sans besoin |

## packages/desktop/src-tauri/ — Rust backend

| Module | Responsable | Notes |
|--------|-------------|-------|
| `src/tls.rs` | Upstream | TLS self-signed |
| `src/speech.rs` | Upstream | Parakeet + Kokoro |
| `src/llm.rs` | Upstream + Fork | Local LLM Tauri commands |

## Règle de mise à jour

Après chaque extraction de module, ajouter la ligne correspondante ici avant de commiter.
