<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

## Fork Features

> This is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode) maintained by [Rwanbt](https://github.com/Rwanbt).
> Kept in sync with upstream. See [dev branch](https://github.com/Rwanbt/opencode/tree/dev) for latest changes.

#### Background Tasks

Delegate work to subagents that run asynchronously. Set `mode: "background"` on the task tool and it returns a `task_id` immediately while the agent works in the background. Bus events (`TaskCreated`, `TaskCompleted`, `TaskFailed`) are published for lifecycle tracking.

#### Agent Teams

Orchestrate multiple agents in parallel using the `team` tool. Define sub-tasks with dependency edges; `computeWaves()` builds a DAG and executes independent tasks concurrently (up to 5 parallel agents). Budget control via `max_cost` (dollars) and `max_agents`. Context from completed tasks is automatically passed to dependents.

#### Git Worktree Isolation

Each background task automatically gets its own git worktree. The workspace is linked to the session in the database. If a task produces no file changes, the worktree is cleaned up automatically. This provides git-level isolation without containers.

#### Task Management API

Full REST API for task lifecycle management:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/task/` | List tasks (filter by parent, status) |
| GET | `/task/:id` | Get task details + status + worktree info |
| GET | `/task/:id/messages` | Retrieve task session messages |
| POST | `/task/:id/cancel` | Cancel a running or queued task |
| POST | `/task/:id/resume` | Resume completed/failed/blocked task |
| POST | `/task/:id/followup` | Send follow-up message to idle task |
| POST | `/task/:id/promote` | Promote background task to foreground |
| GET | `/task/:id/team` | Aggregated team view (costs, diffs per member) |

#### TUI Task Dashboard

Sidebar plugin showing active background tasks with real-time status icons:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Dialog with actions: open task session, cancel, resume, send follow-up, check status.

#### MCP Agent Scoping

Per-agent allow/deny lists for MCP servers. Configure in `opencode.json` under each agent's `mcp` field. The `toolsForAgent()` function filters available MCP tools based on the calling agent's scope.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9-State Session Lifecycle

Sessions track one of 9 states, persisted to the database:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Persistent states (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) survive database restarts. In-memory states (`idle`, `busy`, `retry`) reset on restart.

#### Orchestrator Agent

Read-only coordinator agent (50 max steps). Has access to `task` and `team` tools but all edit tools are denied. Delegates implementation to build/general agents and synthesizes results.

---

## Technical Architecture

### Multi-Provider Support

21+ providers out of the box: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, plus any OpenAI-compatible endpoint. Pricing sourced from [models.dev](https://models.dev).

### Agent System

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | Default development agent |
| **plan** | primary | read-only | Analysis and code exploration |
| **general** | subagent | full (no todowrite) | Complex multi-step tasks |
| **explore** | subagent | read-only | Fast codebase search |
| **orchestrator** | subagent | read-only + task/team | Multi-agent coordinator (50 steps) |
| compaction | hidden | none | AI-driven context summarization |
| title | hidden | none | Session title generation |
| summary | hidden | none | Session summarization |

### LSP Integration

Full Language Server Protocol support with symbol indexing, diagnostics, and multi-language support (TypeScript, Deno, Vue, and extensible). The agent navigates code via LSP symbols rather than text search, enabling precise go-to-definition, find-references, and real-time type error detection.

### MCP Support

Model Context Protocol client and server. Supports stdio, HTTP/SSE, and StreamableHTTP transports. OAuth authentication flow for remote servers. Tool, prompt, and resource capabilities. Per-agent scoping via allow/deny lists.

### Client/Server Architecture

Hono-based REST API with typed routes and OpenAPI spec generation. WebSocket support for PTY (pseudo-terminal). SSE for real-time event streaming. Basic auth, CORS, gzip compression. The TUI is one frontend; the server can be driven from any HTTP client, the web UI, or a mobile app.

### Context Management

Auto-compact with AI-driven summarization when token usage approaches the model's context limit. Token-aware pruning with configurable thresholds (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Skill tool outputs are protected from pruning.

### Edit Engine

Unified diff patching with hunk verification. Applies targeted hunks to specific file regions rather than full-file overwrites. Multi-edit tool for batch operations across files.

### Permission System

3-state permissions (`allow` / `deny` / `ask`) with wildcard pattern matching. 100+ bash command arity definitions for fine-grained control. Project boundary enforcement prevents file access outside the workspace.

### Git-Backed Rollback

Snapshot system that records file state before each tool execution. Supports `revert` and `unrevert` with diff computation. Changes can be rolled back per-message or per-session.

### Cost Tracking

Per-message cost with full token breakdown (input, output, reasoning, cache read, cache write). Per-team budget limits (`max_cost`). `stats` command with per-model and per-day aggregation. Real-time session cost displayed in TUI. Pricing data fetched from models.dev.

### Plugin System

Full SDK (`@opencode/plugin`) with hook architecture. Dynamic loading from npm packages or filesystem. Built-in plugins for Codex, GitHub Copilot, GitLab, and Poe authentication.

---

## Common Misconceptions

To prevent confusion from AI-generated summaries of this project:

- The **TUI is TypeScript** (SolidJS + @opentui for terminal rendering), not Rust.
- **Tree-sitter** is used for TUI syntax highlighting and bash command parsing only, not for agent-level code analysis.
- There is **no Docker/E2B sandboxing** -- isolation is provided by git worktrees.
- There is **no vector database or RAG system** -- context is managed via LSP symbol indexing + auto-compact.
- There is **no "watch mode" that proposes automatic fixes** -- the file watcher exists for infrastructure purposes only.
- **Self-correction** uses the standard agent loop (the LLM sees errors in tool results and retries), not a specialized auto-repair mechanism.

## Capabilities Matrix

| Capability | Status | Notes |
|-----------|--------|-------|
| Background tasks | Implemented | `mode: "background"` on task tool |
| Agent teams (DAG) | Implemented | Wave-based parallel execution, budget control |
| Git worktree isolation | Implemented | Auto-created per background task |
| Task REST API | Implemented | 8 endpoints for full lifecycle |
| TUI task dashboard | Implemented | Sidebar + dialog actions |
| MCP agent scoping | Implemented | Per-agent allow/deny config |
| 9-state lifecycle | Implemented | Persistent to SQLite |
| Orchestrator agent | Implemented | Read-only coordinator |
| Multi-provider (21+) | Implemented | Including local models |
| LSP integration | Implemented | Symbols, diagnostics, multi-language |
| MCP protocol | Implemented | Client + server, 3 transports |
| Plugin system | Implemented | SDK + hook architecture |
| Cost tracking | Implemented | Per-message, per-team, per-model |
| Context auto-compact | Implemented | AI summarization + pruning |
| Git rollback/snapshots | Implemented | Revert/unrevert per message |
| Docker sandboxing | Implemented | Optional via `experimental.sandbox.type: "docker"` |
| Vector DB / RAG | Not implemented | LSP + auto-compact covers needs |
| Dry run / command preview | Not implemented | Permission system validates pre-exec |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

### FAQ

#### How is this different from Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although we recommend the models we provide through [OpenCode Zen](https://opencode.ai/zen), OpenCode can be used with Claude, OpenAI, Google, or even local models. As models evolve, the gaps between them will close and pricing will drop, so being provider-agnostic is important.
- Out-of-the-box LSP support
- A focus on TUI. OpenCode is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This, for example, can allow OpenCode to run on your computer while you drive it remotely from a mobile app, meaning that the TUI frontend is just one of the possible clients.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
