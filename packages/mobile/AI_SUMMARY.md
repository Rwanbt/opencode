# AI_SUMMARY — mobile

> **Auto-generated 2026-05-27 17:45** — do not edit manually.
> Source: `tools/ai_docs/generate_ai_summary.py`
> For purpose, thread model and constraints, read `AI_CONTEXT.md`.

## Purpose
Couche mobile Android : frontend TypeScript mobile-spécifique (11 fichiers TS)
+ sidecar Rust Tauri (`src-tauri/src/`) gérant le proxy HTTP, le runtime Alpine/busybox,
l'inférence locale (llama-server via LlamaService.kt JNI), et la synthèse vocale.
LlamaService.kt (dans gen/android/) est un foreground service Kotlin qui possède llama-server.

## Common failure modes
- **llama-server dupliqué** : deux instances sur port 14097 → VRAM splittée, 5-10x ralentissement — vérifier PID avant spawn ([référence](~/.claude/projects/d--App-OpenCode/memory/project_llama_server_dup.md))
- **OpenCL non-engagé** : stdout llama-server non drainé → inference silencieusement CPU-only — thread daemon `forEachLine Log.d` obligatoire
- **APK stale après `adb install -r`** : WebView cache persiste — `pm clear` requis
- **Bash tool schema bug** : Gemma envoie `dry_run` au lieu de `description` → cargo build/check échouent en agent mode
- **Android build hang** : `bun tauri android build > log.txt 2>&1` puis `tail -f log.txt` en parallèle
- **Alpine hardlinks SELinux** : `tar` avorte sur `link()` — fix `fix_hardlinks.py` via WSL avant build

## Hot files
- [packages/mobile/src-tauri/src/runtime.rs](src-tauri/src/runtime.rs) — toolchain wrappers, env setup
- [packages/mobile/src-tauri/src/llm.rs](src-tauri/src/llm.rs) — spawn/stop LlamaService bridge
- [packages/mobile/src-tauri/src/proxy.rs](src-tauri/src/proxy.rs) — HTTP proxy sidecar↔llama
- [packages/mobile/src/entry.tsx](src/entry.tsx) — entry point mobile WebView
- [packages/mobile/src/model-catalog.ts](src/model-catalog.ts) — catalog modèles + routing accélération

## Files & LOC
| File | LOC | |
|------|-----|--|
| `vite.config.ts` | 26 | |
| **Total** | **26** | |
