# AI_SUMMARY — opencode

> **Auto-generated 2026-05-27 17:45** — do not edit manually.
> Source: `tools/ai_docs/generate_ai_summary.py`
> For purpose, thread model and constraints, read `AI_CONTEXT.md`.

## Purpose
Cœur TypeScript du sidecar OpenCode : moteur agent, gestion des sessions de chat,
intégration des providers LLM (Anthropic, OpenAI, Gemini, Ollama, local…),
serveur REST/SSE local, outils (bash, edit, glob, grep…), MCP, LSP, RAG, partage.
Tourne dans un process Bun séparé ; communique avec l'UI via SSE et REST sur un port local.

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

## Files & LOC
| File | LOC | |
|------|-----|--|
| `drizzle.config.ts` | 9 | |
| `parsers-config.ts` | 259 | |
| `sst-env.d.ts` | 2 | |
| **Total** | **270** | |
