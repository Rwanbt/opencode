# AI_SUMMARY — desktop

> **Auto-generated 2026-05-27 17:45** — do not edit manually.
> Source: `tools/ai_docs/generate_ai_summary.py`
> For purpose, thread model and constraints, read `AI_CONTEXT.md`.

## Purpose
Application desktop Tauri 2.0 : backend Rust (`src-tauri/src/`) gérant le TLS,
la synthèse/reconnaissance vocale (Kokoro TTS, Parakeet STT), l'orchestration LLM local
(llama-server subprocess), et la personnalisation de la fenêtre (titlebar décorum).
Le frontend SolidJS est servi depuis `packages/app`.

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

## Files & LOC
| File | LOC | |
|------|-----|--|
| `sst-env.d.ts` | 2 | |
| `vite.config.ts` | 26 | |
| **Total** | **28** | |
