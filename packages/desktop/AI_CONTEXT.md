# AI_CONTEXT — packages/desktop

## Purpose
Application desktop Tauri 2.0 : backend Rust (`src-tauri/src/`) gérant le TLS,
la synthèse/reconnaissance vocale (Kokoro TTS, Parakeet STT), l'orchestration LLM local
(llama-server subprocess), et la personnalisation de la fenêtre (titlebar décorum).
Le frontend SolidJS est servi depuis `packages/app`.

## Process / Thread model
| Composant | Process | Notes |
|---|---|---|
| Tauri Rust core | Main process | `lib.rs` — commandes invoke Tauri |
| Sidecar opencode-cli | Child process | `opencode-cli-x86_64-pc-windows-msvc.exe` |
| llama-server | Child process | `llm.rs` — spawn/stop, port configurable |
| Speech workers | Threads async Rust | `speech.rs` — Kokoro + Parakeet |
| TLS proxy | Async task | `tls.rs` — certificats auto-signés |

## Constraints
- Le sidecar `opencode-cli.exe` N'est PAS recompilé par `bun tauri build` — toujours `bun run build --single --baseline` dans `packages/opencode` d'abord, puis copier dans `sidecars/`
- `debuggable=true` en release via `build.gradle.kts buildTypes.release`, PAS dans le manifest
- `bun tauri build` (pas `cargo build --release`) — sinon webview cassée (devUrl localhost:1430)
- La config LLM est poussée via `invoke("set_llm_config", {...})` — les 12 champs sont obligatoires
- Les certificats TLS sont auto-signés — `DangerousSettings` doit être activé en Internet mode

## Forbidden
- Jamais de `cargo build --release` direct (casse Tauri 2 webview)
- Jamais de modifier `opencode-cli.exe` dans `sidecars/` sans recompiler le source TypeScript d'abord
- Jamais de push sur `main` sans tester le build desktop complet

## Common failure modes
- **Sidecar stale** : code TypeScript modifié mais `opencode-cli.exe` pas recompilé → comportement old version sans erreur visible ([référence](~/.claude/projects/d--App-OpenCode/memory/reference_sidecar_baseline_build.md))
- **TLS HTTPS scope manquant** : `https://*:*/*` absent du `tauri.conf.json` scope → les appels HTTPS échouent silencieusement en mode Internet
- **Deep-link non détecté** : scheme absent de `plugins.deep-link.mobile` dans `tauri.conf.json` — le manifest intent-filter seul est silencieusement ignoré
- **Config LLM non propagée** : `pushConfigToEnv` ne propage rien si les 12 champs ne sont pas tous présents dans l'invoke

## Hot files
- [packages/desktop/src-tauri/src/server.rs](src-tauri/src/server.rs) — spawn sidecar + communication
- [packages/desktop/src-tauri/src/llm.rs](src-tauri/src/llm.rs) — orchestration llama-server local
- [packages/desktop/src-tauri/src/tls.rs](src-tauri/src/tls.rs) — proxy TLS auto-signé
- [packages/desktop/src-tauri/src/speech.rs](src-tauri/src/speech.rs) — TTS/STT pipeline
- [packages/desktop/src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) — config Tauri (CSP, scopes, deep-links)

## See also
- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [reference_sidecar_baseline_build](~/.claude/projects/d--App-OpenCode/memory/reference_sidecar_baseline_build.md)
- [reference_tauri_deeplink_2_4_8_config](~/.claude/projects/d--App-OpenCode/memory/reference_tauri_deeplink_2_4_8_config.md)
