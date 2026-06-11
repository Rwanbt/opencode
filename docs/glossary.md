# Glossaire OpenCode

Définitions opérationnelles des termes utilisés dans le code. Pour chaque terme, la définition précise dans le contexte OpenCode, pas une définition générique.

## Session

Une conversation agent ↔ LLM dans un répertoire donné. Identifiée par un UUID. Stockée dans SQLite via Drizzle ORM. Une session a un `directory`, un `title` autogénéré, et un état (`idle | running | error`).

**Module** : `packages/opencode/src/session/session.ts`

## Workspace / Worktree

Un répertoire de travail git worktree associé à un projet. Le workspace racine est le dépôt principal ; les workspaces enfants sont des branches checkout séparées. Dans l'UI, chaque workspace a sa propre liste de sessions.

**Module** : `packages/app/src/utils/worktree.ts`

## Provider

Un service LLM (Anthropic, OpenAI, Gemini, local-llm, etc.) configuré par l'utilisateur. Résolu à l'exécution depuis la config cascade. Le pseudo-provider `local-llm` gère le lifecycle du processus llama-server.

**Module** : `packages/opencode/src/provider/provider.ts`

## Session Key

Clé stable pour identifier un workspace dans l'UI, normalisée pour comparer des paths avec/sans slash final. `workspaceKey(path)` = `path.replace(/\/$/, "")`.

**Module** : `packages/app/src/pages/layout/helpers.ts`

## Coordinator Component

Composant SolidJS dont le rôle est d'orchestrer état, hooks et effects. Structurellement ne peut pas être réduit sous un certain plancher LOC (voir ADR-0002). Ne contient pas de logique métier — délègue via Factory with Deps (ADR-0001).

## Factory with Deps

Pattern d'extraction : `createXxx(deps: XxxDeps)` installe ses propres effects et retourne des accesseurs. Voir ADR-0001.

## MCP

Model Context Protocol — protocole JSON-RPC permettant aux LLMs d'appeler des outils externes via des serveurs MCP. OpenCode agit comme client MCP.

**Module** : `packages/opencode/src/mcp/`

## Sidecar

Le binaire TypeScript `opencode-cli` compilé avec Bun (`bun run build --single --baseline`). Embarqué dans l'application Tauri, expose l'API REST + SSE sur le port local.
