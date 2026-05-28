# AI_CONTEXT — packages/mobile

## Purpose
Couche mobile Android : frontend TypeScript mobile-spécifique (11 fichiers TS)
+ sidecar Rust Tauri (`src-tauri/src/`) gérant le proxy HTTP, le runtime Alpine/busybox,
l'inférence locale (llama-server via LlamaService.kt JNI), et la synthèse vocale.
LlamaService.kt (dans gen/android/) est un foreground service Kotlin qui possède llama-server.

## Process / Thread model
| Composant | Process | Notes |
|---|---|---|
| WebView frontend | Main process | SolidJS mobile entry (`entry.tsx`) |
| Tauri Rust lib | Main process | `lib.rs` — commandes invoke Tauri |
| LlamaService | Foreground Service Android | Kotlin — possède llama-server port 14097 |
| llama-server | Child process de LlamaService | HTTP sur 14097, stdout drainé par thread daemon |
| Alpine runtime | Sous-processus via busybox exec | `runtime.rs::prepare_toolchain_wrappers` |
| Proxy Rust | Interne Tauri | `proxy.rs` — route les requêtes sidecar vers llama-server |

## Constraints
- `OPENCODE_CLIENT=mobile-embedded` est settée par `runtime.rs` dans les env_vars — gater TOUT choix desktop↔mobile avec cette variable
- Sur Adreno 6xx (Mi 10 Pro), Q4_0 CPU bat OpenCL — pas d'OpenCL sur SM8350 et inférieur
- Sur Adreno 7xx (SM8450+), OpenCL est bénéfique pour Q4_0 uniquement (pas les K-quants)
- Q4_K_M + OpenCL Adreno = crash `SET_ROWS` exit 134 — router sur CPU systématiquement pour K-quants
- Gemma-4 SWA désactive `--cache-reuse` — pas de cache multi-turn avec Gemma-4
- Le build Android nécessite `--target aarch64` (armv7 ORT mismatch)
- `bun tauri android build | pipe` ne retourne jamais (gradle daemons gardent le pipe ouvert)

## Forbidden
- Jamais de `HTTP_PROXY` pour les requêtes internes sidecar → llama-server (casse les fetch internes)
- Jamais de `adb shell input` sans le toggle "USB debugging (Security settings)" sur MIUI
- Jamais de rebuild `libpty_server.so` via CMakeLists (non-PIE, inexécutable par ProcessBuilder)
- Jamais de `find()` sur `app_data_file` sans gérer les hard links (SELinux bloque `link()`)

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

## See also
- [docs/ANDROID_DEVELOPMENT.md](../../docs/ANDROID_DEVELOPMENT.md)
- ADR-0003 (fork strategy)
- [reference_hexagon_qualcomm_args](~/.claude/projects/d--App-OpenCode/memory/reference_hexagon_qualcomm_args.md)
- [reference_opencl_adreno_kquant_kill](~/.claude/projects/d--App-OpenCode/memory/reference_opencl_adreno_kquant_kill.md)
