# @opencode/opencode — Sidecar TypeScript

Moteur agent du fork OpenCode. Ce package expose :
- La CLI `opencode` (yargs, ~30 commandes)
- Le serveur HTTP/SSE local consommé par les UI (desktop, mobile, web, TUI)
- L'orchestration des providers LLM (cloud + local)
- La gestion de sessions, messages, compaction, tool calls
- La supervision de `llama-server` (port 14097)

Voir [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) pour la vue d'ensemble du monorepo.

---

## Prérequis

- **Bun** 1.3.11+
- **Node** 20+ (compat SDK)
- Pour l'inference locale : `llama-server` binaire (bundlé côté desktop) OU modèle GGUF accessible

---

## Installation (dev)

```bash
cd packages/opencode
bun install
```

---

## Lancement

### CLI (entry principal)

```bash
bun run src/index.ts --help
```

Commandes fréquentes :

| Commande | Rôle |
|---|---|
| `serve` | Démarre le serveur HTTP/SSE local |
| `auth login <provider>` | OAuth/API key pour un provider cloud |
| `models list` | Liste les modèles disponibles |
| `mcp add <name> <url>` | Enregistre un serveur MCP |
| `agent create <name>` | Crée un agent custom |
| `session export` | Export d'une session |

### Build binaire standalone

```bash
bun run build --single
```

Produit un binaire Bun compilé. **Obligatoire avant `bun tauri build`** côté desktop ou mobile : le sidecar TS doit être compilé à part, `tauri build` ne le recompile **pas** automatiquement.

### Benchmarks (`bench/harness.ts`)

```bash
bun run bench:llm --model qwen3.5-4b --runs 3
```

Lance `llama-server` sur chaque modèle GGUF détecté sous `~/.opencode/models`, mesure **4 métriques** reproductibles par run (first-token latency en ms, TPS sustained, peak RSS en MB, wall seconds). Sortie JSONL, à piper dans `bench/results/<date>-<sha>.jsonl` pour archivage.

Flags : `--model <id>`, `--model-dir <path>`, `--runs <n>`, `--n-predict <n>`. Nécessite un binaire `llama-server` accessible via `$LLAMA_SERVER`, `~/.opencode/bin/llama-server`, ou sur le `PATH`.

---

## Structure du code

```
src/
├── index.ts                 # CLI entry (yargs, middleware, handlers)
├── server.ts                # HTTP/SSE server (consumed by UIs)
├── provider/                # Providers LLM (cloud + local)
│   ├── provider.ts          # Service + layer Effect
│   ├── transform.ts         # Adaptation options per provider (monolithe)
│   └── sdk/                 # SDKs bundlés (copilot, etc.)
├── session/                 # Session logic
│   ├── session.ts           # Storage, events, messages
│   ├── llm.ts               # streamText principal, adaptive limits
│   ├── compaction.ts        # Pruning part-wise, gated clone via plugin.has()
│   ├── processor.ts         # Tool call loop, DOOM_LOOP_THRESHOLD
│   └── message-v2.ts        # Schéma messages + parts
├── local-llm-server/        # Orchestration llama-server local
│   ├── index.ts             # ensureRunning, health poll, owner.pid, buildArgs
│   └── auto-config.ts       # detectProfile() + deriveConfig() — runtime device tuning
├── agent/                   # Agents définition + registry
├── auth/                    # OAuth / API key storage
├── config/                  # Config cascade (MDM → user → project)
├── tool/                    # Tools intégrés (bash, edit, read, etc.)
├── mcp/                     # Model Context Protocol clients
├── plugin/                  # Hook system (experimental.*) + has(name) lookup
├── storage/                 # DB + migrations
└── util/                    # Token (tiktoken OpenAI + estimate 3.5), Log, fn helpers
bench/
└── harness.ts               # llama-server benchmark runner (FTL + TPS + RSS + wall)
```

---

## Configuration

Cascade (précédence décroissante) :

1. **Project** : `./opencode.json` dans le répertoire courant
2. **User** : `~/.opencode/config.json`
3. **Managed** (macOS uniquement) : `/Library/Managed Preferences/ai.opencode.plist` (MDM admin)

Variables d'environnement utiles :

| Variable | Rôle |
|---|---|
| `OPENCODE_LOG_DIR` | Dossier logs (défaut : `~/.opencode/logs/`) |
| `OPENCODE_HEAP` | Active les heap snapshots périodiques |
| `LLAMA_SERVER_PORT` | Override du port par défaut 14097 |
| `OPENCODE_CLIENT` | Identifiant client (telemetry) |

---

## Points d'attention

- **Tokenizer** : `Token.count()` utilise `js-tiktoken` exact pour les familles OpenAI (`gpt-*`, `o1/o3/o4`, `davinci`…), fallback heuristique `length/3.5` pour Llama/Qwen/Gemma/Mistral (erreur ~15 %, bien mieux que `cl100k_base` ~30 % off) — voir [`src/util/token.ts`](src/util/token.ts).
- **Reasoning budget** : `getThinkingCap()` dans [`src/session/llm.ts`](src/session/llm.ts) retourne 8192 pour Qwen/DeepSeek thinking, 2048 par défaut. Fraction du budget max : 0.15.
- **Compaction** : part-wise, ne coupe jamais dans une part (vérifié). Le `structuredClone(messages)` est **conditionnel** sur `plugin.has("experimental.chat.messages.transform")` — évite multi-MB d'allocations sur sessions longues sans plugin.
- **llama-server lifecycle** : atomic lock + single-flight, orphan recovery, **circuit breaker** (3 restarts max en 120 s) sur model mismatch.
- **Configuration llama.cpp adaptative** : [`src/local-llm-server/auto-config.ts`](src/local-llm-server/auto-config.ts) dérive `n_gpu_layers`, `threads`, `batch`/`ubatch`, KV quant et context size selon VRAM/RAM/thermal. Tests dans [`test/local-llm-server/auto-config.test.ts`](test/local-llm-server/auto-config.test.ts). Env overrides : `OPENCODE_N_GPU_LAYERS`, `OPENCODE_KV_CACHE_TYPE`.
- **Observabilité** : `SessionLearn` erreurs sont loggées via `Effect.catch` (plus de `Effect.ignore` silencieux). Coûts clampés à ≥ 0 quand `cacheTokens > inputTokens` (warn loggé).
- **Git upstream watcher** : [`src/git/index.ts`](src/git/index.ts) expose `Git.fetch`, `Git.upstream` et `Git.revCount`. [`src/project/vcs.ts`](src/project/vcs.ts) lance un probe fork-scoped (30 s de warm-up puis `Schedule.spaced(5min)`) qui détecte la divergence avec le remote et publie `Event.BranchBehind` sur le bus ; l'UI (`context/notification.tsx`) déclenche alors `platform.notify()`. La loop swallow les erreurs transitoires (offline, detached HEAD) via `Effect.catchCause` sans tuer le service VCS.
- **PTY cols/rows au spawn** : [`src/pty/index.ts`](src/pty/index.ts) — `CreateInput` accepte `cols`/`rows` optionnels, forwardés à `spawn()` (supporté par bun-pty et android-pty). Le frontend estime la taille avant le create pour éviter la resize storm 80×24→target qui faisait disparaître le premier prompt mksh/bash sur mobile.

---

## Tests

```bash
bun test                # tous les tests
bun test src/session    # scope
bun test --coverage     # avec couverture
```

Dossier `test/` structuré par domaine (`provider/`, `session/`, `tool/`, etc.). Fixtures dans `test/fixtures/`.

Tests d'évaluation locale (LLM réels) : `test/tool/eval-results/` (gitignored).

---

## Liens

- [../../AUDIT_REPORT.md](../../AUDIT_REPORT.md) — audit bugs et sécurité
- [../../PERFORMANCE_REPORT.md](../../PERFORMANCE_REPORT.md) — hot paths, benchmarks
- [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) — architecture monorepo
- [../../CLAUDE.md](../../CLAUDE.md) — règles de contribution IA
