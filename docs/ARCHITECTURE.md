# OpenCode Fork — Architecture

> Vue d'ensemble de l'architecture du fork OpenCode (agent IA polyvalent local+cloud).
> Dernière vérification : 2026-04-17.

---

## 1. Monorepo

Runtime : **Bun 1.3.11** + **Turbo 2.8.13** (workspaces).
Langages : **TypeScript 5.8.2** (sidecar + UI), **Rust** (Tauri backends), **Java/Kotlin** (Android glue via Tauri).

```
packages/
├── opencode/          # Sidecar TypeScript (moteur agent, CLI, server)
├── desktop/           # App Tauri 2.0 desktop (Rust + frontend shared)
├── mobile/            # App Tauri 2.0 Android (+ iOS stub)
├── app/               # Frontend SolidJS (shared desktop/web/mobile)
├── tui/               # Interface terminal (moins utilisée)
├── console/           # Dashboard web
├── web/               # Variante web standalone
├── ui/                # Composants UI partagés (Tailwind)
├── sdk/js/            # SDK TypeScript public
├── util/              # Utilitaires partagés
├── containers/        # Docker / sandboxing (stub)
├── enterprise/        # Extensions enterprise
├── desktop-electron/  # Variante Electron (legacy ou alternative)
└── slack/             # Intégration Slack
```

---

## 2. Flux principal (stream d'une requête)

```
Utilisateur (UI SolidJS)
    │
    │  POST /session/:id/stream (SSE)
    ▼
packages/opencode/src/server.ts
    │
    ├─ Session.send() → SessionProcessor → LLM.stream()
    │
    ▼
packages/opencode/src/session/llm.ts
    │
    ├─ Provider.getProvider() → resolve cloud ou local-llm
    ├─ getLocalLLMAdaptiveLimits()  (/props fetch)
    ├─ ProviderTransform.providerOptions()
    │
    ▼
Vercel AI SDK streamText()
    │
    ├─ AbortController signal
    ├─ onError, experimental_repairToolCall
    │
    ▼  (Cloud)                     ▼  (Local)
Anthropic/OpenAI/...         local-llm-server:14097
                                    │
                                    ▼
                             llama-server (C++, GPU)
```

---

## 3. Sidecar llama-server (local inference)

Orchestration dans [packages/opencode/src/local-llm-server/index.ts](../packages/opencode/src/local-llm-server/index.ts).

**Cycle de vie** :
1. `ensureRunning(modelID)` — entry point idempotent (single-flight + lock inter-process).
2. `findRuntimeDir()` — scan `{APPDATA}/ai.opencode.desktop[.dev]/llama-runtime`.
3. `findModelFile(modelID)` — fuzzy match (strip quantization suffixes).
4. `acquireStartLock()` — `O_EXCL` sur `start.lock`.
5. `spawnAndWait()` — `Bun.spawn(llama-server)`, écrit `owner.pid` atomique.
6. `pollHealth()` — boucle `/health` jusqu'à 120 s.
7. `registerRef()` — ajoute un `refs/{pid}.ref` pour lifecycle inter-process.
8. `ensureCorrectModel()` — si modèle chargé ≠ demandé → kill + respawn.
9. `pruneStaleRefs()` — nettoie les refs dont le process owner est mort.

**Fichiers d'état** :
- `llama-runtime/owner.pid` — JSON `{ ownerPid, childPid }` (écriture atomique).
- `llama-runtime/start.lock` — lock exclusif pour spawn.
- `llama-runtime/refs/{pid}.ref` — marqueur de process abonné.

---

## 4. Providers

**Cloud** : définis dans `packages/opencode/src/provider/` + `transform.ts`. 20+ providers bundlés statiquement (Anthropic, OpenAI, Google, Mistral, Bedrock, Azure, Groq, Together, Cohere, Perplexity, XAI, Fireworks, Cerebras, DeepInfra, etc.).

**Local** : pseudo-provider `local-llm` qui pointe vers `http://127.0.0.1:14097/v1`, compatible OpenAI (llama-server).

**Catalogue modèles** : `models-snapshot.js` (1.75 MB statique) chargé au démarrage. Voir [PERFORMANCE_REPORT.md §4](../PERFORMANCE_REPORT.md) pour le quick win (lazy load).

---

## 5. Session & compaction

[packages/opencode/src/session/](../packages/opencode/src/session/)

- **`session.ts`** — entry, stockage messages, événements Bus.
- **`llm.ts`** — stream principal, adaptive limits, transform providers.
- **`compaction.ts`** — pruning part-wise des tool outputs, summary automatique.
- **`processor.ts`** — `SessionProcessor` gère les tool calls, boucle, DOOM_LOOP_THRESHOLD.
- **`message-v2.ts`** — schéma messages, parts (text, tool, file, reasoning, compaction).

**Thresholds compaction** (dynamiques, scalés à `model.limit.context`) :
- `pruneMinimum = min(20_000, context*0.3)` — en dessous, pas de pruning.
- `pruneProtect = min(40_000, context*0.6)` — zone protégée (récente, jamais compactée).

---

## 6. Config & persistence

- **Config cascade** : MDM (macOS managed prefs) → user (`~/.opencode/config.json`) → project (`./opencode.json`).
- **DB** : JSON-based migrations via `JsonMigration.run()` au boot.
- **Auth** : `packages/opencode/src/auth/` — tokens OAuth/API stockés chiffrés.

---

## 7. Desktop (Tauri 2.0)

[packages/desktop/src-tauri/](../packages/desktop/src-tauri/)

- **`tls.rs`** — génération de certificat self-signed (rcgen, SHA-256, 10 ans), fingerprint dans `AppLocalData/tls/fingerprint.txt`.
- **`server.rs`** — `RemoteConfig` persistant (UUID + password), toggle `tls_enabled`.
- **`speech.rs`** — STT (Parakeet ONNX) + TTS (Pocket TTS sidecar + Kokoro ONNX) ; voice clone via WAV stockage `speech/voices/`.
- **Sidecars** : `llama-server`, `opencode-cli` bundlés. `pocket-tts` détecté via `find_pocket_tts()` (Python requis).
- **Deep-link** : schémas `opencode://open-project`, `opencode://new-session`, `opencode://connect` (QR pairing), `opencode://oauth/callback` (finalisation OAuth). Parseurs dans [`packages/app/src/pages/layout/deep-links.ts`](../packages/app/src/pages/layout/deep-links.ts).
- **Devtools** : non force-enable — comportement Tauri par défaut (debug-only) restauré (cf. [SECURITY_AUDIT.md](../SECURITY_AUDIT.md) §1).

---

## 8. Mobile (Tauri Android)

[packages/mobile/src-tauri/](../packages/mobile/src-tauri/)

- **`lib.rs`** — entry Tauri mobile, init chaîne de logging (`android_logger` → logcat tag `OpenCode`).
- **`llm.rs`** — commandes `list_models`, `download_model`, `load_llm_model`, `check_llm_health`, `set_llm_config`, `get_memory_info`, `llm_idle_tick` (visibilitychange hook).
- **`speech.rs`** — STT Parakeet (5 commandes) + TTS Kokoro (6 commandes : `kokoro_available/download_model/load/loaded/voices/synthesize`) + voice clone WAV storage (3 commandes — non utilisées tant qu'un voice encoder n'est pas ajouté).
- **`kokoro/`** — engine ONNX `CPUExecutionProvider` + G2P CMUDict embarqué (140k entries `assets/cmudict.dict`).
- **`runtime.rs`** — détection plateforme, chemins d'extraction du runtime.
- **`proxy.rs`** — port proxy LAN (`AtomicU16` + `compare_exchange`, cf. B.A6).
- **`AndroidManifest.xml`** — permissions (FOREGROUND_SERVICE_SPECIAL_USE, POST_NOTIFICATIONS, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, storage), service `.LlamaService` foreground, deep-link dual-scheme (https://opencode.ai + opencode://).
- **`LlamaService.kt` + `MainActivity.kt`** — foreground service API 34+ avec `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` — garde le process tree à `adj=0` (exempt PhantomProcessKiller).
- **`RustWebChromeClient.kt`** (auto-généré Tauri) — forwarde `AUDIO_CAPTURE` à la runtime permission dialog quand le WebView appelle `getUserMedia({audio:true})`.
- **Bundle** : APK + ORT Android libs (externe, `D:/tmp/ort-android`, env `ORT_LIB_LOCATION`).

---

## 8bis. Upstream watcher + viewport-sized PTY

Ajoutés session 2026-04-17 :

- **`Vcs.Event.BranchBehind`** — [packages/opencode/src/project/vcs.ts](../packages/opencode/src/project/vcs.ts) lance un probe fork-scoped (warm-up 30 s, interval 5 min) qui fait `git fetch --quiet --prune` + `rev-list --count HEAD..upstream` et `upstream..HEAD`. Publie quand la divergence change, déduplique par snapshot. UI handler : [packages/app/src/context/notification.tsx](../packages/app/src/context/notification.tsx) → `platform.notify()` (desktop + mobile natif).
- **`Pty.CreateInput.cols/rows`** — [packages/opencode/src/pty/index.ts](../packages/opencode/src/pty/index.ts) — le frontend ([`context/terminal.tsx::estimateTerminalSize`](../packages/app/src/context/terminal.tsx)) mesure `window.innerWidth/innerHeight` avant `pty.create()`, le shell démarre à sa taille finale (fix first-prompt invisible sur mobile mksh/bash).

---

## 9. Frontend SolidJS

[packages/app/src/](../packages/app/src/)

- **Pages** : `session`, `settings`, `model-manager`, `download`.
- **Components** : `dialog-local-llm.tsx`, `message-list.tsx`, `agent-badge.tsx`, etc.
- **Bus** : `createEventBus` (solid-primitives) pour les événements cross-component.
- **Store** : SolidJS stores + `localStorage` synchro.

---

## 10. Commandes CLI (yargs)

~30 commandes exposées par le sidecar [packages/opencode/src/index.ts:54-189](../packages/opencode/src/index.ts#L54-L189). Middleware global : `Log.init()`, `Heap.start()`, handlers unhandled rejection/exception (lines 42-52).

Exemples : `serve`, `auth login`, `models list`, `mcp add`, `agent create`, `session export`.

---

## 11. Pour aller plus loin

- Audits détaillés : [../AUDIT_REPORT.md](../AUDIT_REPORT.md), [../PERFORMANCE_REPORT.md](../PERFORMANCE_REPORT.md)
- Android : [./ANDROID_DEVELOPMENT.md](./ANDROID_DEVELOPMENT.md)
- Issues connues : [../KNOWN_ISSUES.md](../KNOWN_ISSUES.md)
