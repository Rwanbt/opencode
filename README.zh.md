<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">开源的 AI Coding Agent。</p>
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

## Fork 功能

> 这是 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的 fork，由 [Rwanbt](https://github.com/Rwanbt) 维护。
> 与上游保持同步。查看 [dev 分支](https://github.com/Rwanbt/opencode/tree/dev) 了解最新更改。

#### 后台任务

将工作委派给异步运行的子代理。在 task 工具上设置 `mode: "background"`，它会立即返回一个 `task_id`，同时代理在后台工作。发布总线事件（`TaskCreated`、`TaskCompleted`、`TaskFailed`）用于生命周期跟踪。

#### 代理团队

使用 `team` 工具并行编排多个代理。定义具有依赖边的子任务；`computeWaves()` 构建 DAG 并同时执行独立任务（最多 5 个并行代理）。通过 `max_cost`（美元）和 `max_agents` 进行预算控制。已完成任务的上下文会自动传递给依赖任务。

#### Git Worktree 隔离

每个后台任务自动获得独立的 git worktree。工作区与数据库中的会话关联。如果任务未产生文件更改，worktree 会自动清理。无需容器即可提供 git 级别的隔离。

#### 任务管理 API

用于任务生命周期管理的完整 REST API：

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

#### TUI 任务仪表板

侧边栏插件，使用实时状态图标显示活动的后台任务：

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

带操作的对话框：打开任务会话、取消、恢复、发送后续消息、检查状态。

#### MCP 代理作用域

按代理的 MCP 服务器允许/拒绝列表。在 `opencode.json` 中各代理的 `mcp` 字段进行配置。`toolsForAgent()` 函数根据调用代理的作用域过滤可用的 MCP 工具。

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9 状态会话生命周期

会话跟踪 9 种状态之一，持久化到数据库：

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

持久状态（`queued`、`blocked`、`awaiting_input`、`completed`、`failed`、`cancelled`）在数据库重启后保留。内存状态（`idle`、`busy`、`retry`）在重启时重置。

#### 编排代理

只读协调代理（最多 50 步）。可访问 `task` 和 `team` 工具，但所有编辑工具被拒绝。将实现委派给构建/通用代理并综合结果。

---

## 技术架构

### 多供应商支持

开箱即用支持 21+ 个供应商：Anthropic、OpenAI、Google Gemini、Azure、AWS Bedrock、Vertex AI、OpenRouter、GitHub Copilot、XAI、Mistral、Groq、DeepInfra、Cerebras、Cohere、TogetherAI、Perplexity、Vercel、Venice、GitLab、Gateway，以及任何 OpenAI 兼容端点。定价来源于 [models.dev](https://models.dev)。

### 代理系统

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | 默认开发代理 |
| **plan** | primary | read-only | 分析与代码探索 |
| **general** | subagent | full (no todowrite) | 复杂的多步任务 |
| **explore** | subagent | read-only | 快速代码库搜索 |
| **orchestrator** | subagent | read-only + task/team | 多代理协调器（50 步） |
| compaction | hidden | none | AI 驱动的上下文摘要 |
| title | hidden | none | 会话标题生成 |
| summary | hidden | none | 会话摘要 |

### LSP 集成

完整的 Language Server Protocol 支持，包括符号索引、诊断和多语言支持（TypeScript、Deno、Vue，可扩展）。代理通过 LSP 符号而非文本搜索来导航代码，实现精确的 go-to-definition、find-references 和实时类型错误检测。

### MCP 支持

Model Context Protocol 客户端与服务器。支持 stdio、HTTP/SSE 和 StreamableHTTP 传输。远程服务器的 OAuth 认证流程。工具、提示词和资源能力。通过允许/拒绝列表实现按代理作用域控制。

### 客户端/服务器架构

基于 Hono 的 REST API，带类型化路由和 OpenAPI 规范生成。用于 PTY（伪终端）的 WebSocket 支持。用于实时事件推送的 SSE。Basic 认证、CORS、gzip 压缩。TUI 只是一个前端；服务器可由任何 HTTP 客户端、Web UI 或移动应用驱动。

### 上下文管理

当 token 使用量接近模型上下文限制时，通过 AI 驱动的摘要进行自动压缩。可配置阈值的 token 感知裁剪（`PRUNE_MINIMUM` 20KB、`PRUNE_PROTECT` 40KB）。skill 工具输出受保护，不会被裁剪。

### 编辑引擎

带 hunk 验证的 unified diff 补丁。将目标 hunk 应用于文件的特定区域，而非整文件覆盖。用于跨文件批量操作的 multi-edit 工具。

### 权限系统

3 状态权限（`allow` / `deny` / `ask`），支持通配符模式匹配。100 多个 bash 命令粒度定义，实现精细控制。项目边界限制，防止访问工作区外的文件。

### 基于 Git 的回滚

快照系统，在每次工具执行前记录文件状态。支持 `revert` 和 `unrevert`，带 diff 计算。可按消息或按会话回滚更改。

### 成本跟踪

每条消息的成本及完整 token 明细（input、output、reasoning、cache read、cache write）。按团队的预算限额（`max_cost`）。`stats` 命令支持按模型和按天聚合。TUI 中实时显示会话成本。定价数据来自 models.dev。

### 插件系统

完整的 SDK（`@opencode/plugin`），带 hook 架构。支持从 npm 包或文件系统动态加载。内置 Codex、GitHub Copilot、GitLab 和 Poe 认证插件。

---

## 常见误解

为防止 AI 生成摘要对本项目造成的误导：

- **TUI 是 TypeScript** 编写的（SolidJS + @opentui 用于终端渲染），不是 Rust。
- **Tree-sitter** 仅用于 TUI 语法高亮和 bash 命令解析，不用于代理级别的代码分析。
- **没有 Docker/E2B 沙箱** -- 隔离由 git worktree 提供。
- **没有向量数据库或 RAG 系统** -- 上下文通过 LSP 符号索引 + 自动压缩进行管理。
- **没有会自动提出修复建议的"监听模式"** -- 文件监听器仅用于基础设施目的。
- **自我修正**使用标准代理循环（LLM 查看工具结果中的错误并重试），不是专门的自动修复机制。

## 能力矩阵

| 能力 | Status | Notes |
|------|--------|-------|
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
| Dry run / command preview | Implemented | `dry_run` param on bash/edit/write tools |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

---

### 安装

```bash
# 直接安装 (YOLO)
curl -fsSL https://opencode.ai/install | bash

# 软件包管理器
npm i -g opencode-ai@latest        # 也可使用 bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS 和 Linux（推荐，始终保持最新）
brew install opencode              # macOS 和 Linux（官方 brew formula，更新频率较低）
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # 任意系统
nix run nixpkgs#opencode           # 或用 github:anomalyco/opencode 获取最新 dev 分支
```

> [!TIP]
> 安装前请先移除 0.1.x 之前的旧版本。

### 桌面应用程序 (BETA)

OpenCode 也提供桌面版应用。可直接从 [发布页 (releases page)](https://github.com/anomalyco/opencode/releases) 或 [opencode.ai/download](https://opencode.ai/download) 下载。

| 平台                  | 下载文件                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`、`.rpm` 或 AppImage            |

```bash
# macOS (Homebrew Cask)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### 安装目录

安装脚本按照以下优先级决定安装路径：

1. `$OPENCODE_INSTALL_DIR` - 自定义安装目录
2. `$XDG_BIN_DIR` - 符合 XDG 基础目录规范的路径
3. `$HOME/bin` - 如果存在或可创建的用户二进制目录
4. `$HOME/.opencode/bin` - 默认备用路径

```bash
# 示例
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode 内置两种 Agent，可用 `Tab` 键快速切换：

- **build** - 默认模式，具备完整权限，适合开发工作
- **plan** - 只读模式，适合代码分析与探索
  - 默认拒绝修改文件
  - 运行 bash 命令前会询问
  - 便于探索未知代码库或规划改动

另外还包含一个 **general** 子 Agent，用于复杂搜索和多步任务，内部使用，也可在消息中输入 `@general` 调用。

了解更多 [Agents](https://opencode.ai/docs/agents) 相关信息。

### 文档

更多配置说明请查看我们的 [**官方文档**](https://opencode.ai/docs)。

### 参与贡献

如有兴趣贡献代码，请在提交 PR 前阅读 [贡献指南 (Contributing Docs)](./CONTRIBUTING.md)。

### 基于 OpenCode 进行开发

如果你在项目名中使用了 “opencode”（如 “opencode-dashboard” 或 “opencode-mobile”），请在 README 里注明该项目不是 OpenCode 团队官方开发，且不存在隶属关系。

### 常见问题 (FAQ)

#### 这和 Claude Code 有什么不同？

功能上很相似，关键差异：

- 100% 开源。
- 不绑定特定提供商。推荐使用 [OpenCode Zen](https://opencode.ai/zen) 的模型，但也可搭配 Claude、OpenAI、Google 甚至本地模型。模型迭代会缩小差异、降低成本，因此保持 provider-agnostic 很重要。
- 内置 LSP 支持。
- 聚焦终端界面 (TUI)。OpenCode 由 Neovim 爱好者和 [terminal.shop](https://terminal.shop) 的创建者打造，会持续探索终端的极限。
- 客户端/服务器架构。可在本机运行，同时用移动设备远程驱动。TUI 只是众多潜在客户端之一。

---

**加入我们的社区** [飞书](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=738j8655-cd59-4633-a30a-1124e0096789&qr_code=true) | [X.com](https://x.com/opencode)
