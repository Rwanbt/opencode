# AI_CONTEXT — packages/opencode

## Purpose
Cœur TypeScript du sidecar OpenCode : moteur agent, gestion des sessions de chat,
intégration des providers LLM (Anthropic, OpenAI, Gemini, Ollama, local…),
serveur REST/SSE local, outils (bash, edit, glob, grep…), MCP, LSP, RAG, partage.
Tourne dans un process Bun séparé ; communique avec l'UI via SSE et REST sur un port local.

## Thread model / Process model
| Composant | Process / Thread | Notes |
|---|---|---|
| Sidecar Bun | Process isolé | Lancé par Tauri desktop ou embarqué Android |
| Serveur HTTP/SSE | Main thread Bun | Hono + SSE broadcast via `server/broadcast.ts` |
| Agent loop | Async/await (Event loop) | `agent/agent.ts` — itération tool-use Claude |
| Session storage | SQL (better-sqlite3) | `session/` + `storage/sql.ts` — synchrone |
| LSP client | Worker async | `lsp/` — jsonrpc sur child process |
| PTY shell | Child process | `pty/` — node-pty, stream → SSE |
| Local LLM server | Child process | `local-llm-server/` → llama-server subprocess |

## Constraints
- Le sidecar doit démarrer en < 3 s (budget perf [docs/perf-baselines](docs/perf-baselines))
- `session/` est le seul module autorisé à écrire en base SQL
- Les clés API ne transitent jamais dans les logs (voir `observability/`)
- `tool/bash.ts` exécute du code arbitraire — la sandbox est gérée par `sandbox/`
- Sur mobile Android, `OPENCODE_CLIENT=mobile-embedded` désactive le spawn llama-server local

## Forbidden
- Jamais d'appel `fetch()` sans timeout (bug S1.V2 connu — pattern `AbortSignal.timeout()`)
- Jamais de log d'une clé API ou d'un token (même en DEBUG)
- Jamais d'écriture SQL depuis un module autre que `session/` ou `storage/`

## Common failure modes
- **Sidecar ne démarre pas** : port déjà occupé (`server/instance.ts` — vérifier le PID lock)
- **SSE dropped** : le client WebView/mobile ne reçoit plus les events — vérifier `server/broadcast.ts` keepalive
- **Tool bash schema mismatch** : le modèle envoie `dry_run` au lieu de `description` — voir [memory référence](~/.claude/projects/d--App-OpenCode/memory/reference_bash_tool_gemma_schema_bug.md)
- **Session SQL corruption** : migration manquante après upgrade — `storage/` versioning
- **Local LLM spawn dupliqué** : deux instances llama-server sur le même port 14097 — vérifier le PID avant spawn

## Hot files
- [packages/opencode/src/agent/agent.ts](src/agent/agent.ts) — boucle principale tool-use
- [packages/opencode/src/session/llm.ts](src/session/llm.ts) — appels LLM + streaming
- [packages/opencode/src/server/broadcast.ts](src/server/broadcast.ts) — SSE bus
- [packages/opencode/src/tool/bash.ts](src/tool/bash.ts) — outil le plus utilisé, schema critique
- [packages/opencode/src/local-llm-server/index.ts](src/local-llm-server/index.ts) — spawn llama-server
- [packages/opencode/src/provider/provider.ts](src/provider/provider.ts) — routing providers

## See also
- ADR-0001 (factory-deps pattern)
- ADR-0003 (fork strategy)
- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [docs/lock-hierarchy.md](../../docs/lock-hierarchy.md)
