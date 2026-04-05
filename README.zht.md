<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">開源的 AI Coding Agent。</p>
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

> 這是 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的 fork，由 [Rwanbt](https://github.com/Rwanbt) 維護。
> 與上游保持同步。查看 [dev 分支](https://github.com/Rwanbt/opencode/tree/dev) 了解最新變更。

#### 背景任務

將工作委派給非同步執行的子代理。在 task 工具上設定 `mode: "background"`，它會立即回傳 `task_id`，同時代理在背景中工作。發布匯流排事件（`TaskCreated`、`TaskCompleted`、`TaskFailed`）用於生命週期追蹤。

#### 代理團隊

使用 `team` 工具並行協調多個代理。定義具有相依邊的子任務；`computeWaves()` 建構 DAG 並同時執行獨立任務（最多 5 個並行代理）。透過 `max_cost`（美元）和 `max_agents` 進行預算控制。已完成任務的上下文會自動傳遞給相依任務。

#### Git Worktree 隔離

每個背景任務自動取得獨立的 git worktree。工作區與資料庫中的工作階段關聯。若任務未產生檔案變更，worktree 會自動清理。無需容器即可提供 git 層級的隔離。

#### 任務管理 API

用於任務生命週期管理的完整 REST API：

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

#### TUI 任務儀表板

側邊欄外掛，使用即時狀態圖示顯示活動的背景任務：

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

帶操作的對話框：開啟任務工作階段、取消、恢復、傳送後續訊息、檢查狀態。

#### MCP 代理範圍

按代理的 MCP 伺服器允許/拒絕清單。在 `opencode.json` 中各代理的 `mcp` 欄位進行設定。`toolsForAgent()` 函式根據呼叫代理的範圍篩選可用的 MCP 工具。

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9 狀態工作階段生命週期

工作階段追蹤 9 種狀態之一，持久化到資料庫：

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

持久狀態（`queued`、`blocked`、`awaiting_input`、`completed`、`failed`、`cancelled`）在資料庫重啟後保留。記憶體狀態（`idle`、`busy`、`retry`）在重啟時重設。

#### 協調代理

唯讀協調代理（最多 50 步）。可存取 `task` 和 `team` 工具，但所有編輯工具被拒絕。將實作委派給建置/通用代理並彙整結果。

---

## 技術架構

### 多供應商支援

開箱即用支援 21+ 個供應商：Anthropic、OpenAI、Google Gemini、Azure、AWS Bedrock、Vertex AI、OpenRouter、GitHub Copilot、XAI、Mistral、Groq、DeepInfra、Cerebras、Cohere、TogetherAI、Perplexity、Vercel、Venice、GitLab、Gateway，以及任何 OpenAI 相容端點。定價來源於 [models.dev](https://models.dev)。

### 代理系統

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | 預設開發代理 |
| **plan** | primary | read-only | 分析與程式碼探索 |
| **general** | subagent | full (no todowrite) | 複雜的多步任務 |
| **explore** | subagent | read-only | 快速程式碼庫搜尋 |
| **orchestrator** | subagent | read-only + task/team | 多代理協調器（50 步） |
| compaction | hidden | none | AI 驅動的上下文摘要 |
| title | hidden | none | 工作階段標題產生 |
| summary | hidden | none | 工作階段摘要 |

### LSP 整合

完整的 Language Server Protocol 支援，包含符號索引、診斷與多語言支援（TypeScript、Deno、Vue，可擴充）。代理透過 LSP 符號而非文字搜尋來瀏覽程式碼，實現精確的 go-to-definition、find-references 與即時型別錯誤偵測。

### MCP 支援

Model Context Protocol 用戶端與伺服器。支援 stdio、HTTP/SSE 和 StreamableHTTP 傳輸。遠端伺服器的 OAuth 認證流程。工具、提示詞與資源功能。透過允許/拒絕清單實現按代理範圍控制。

### 用戶端/伺服器架構

基於 Hono 的 REST API，帶型別化路由與 OpenAPI 規範產生。用於 PTY（虛擬終端）的 WebSocket 支援。用於即時事件串流的 SSE。Basic 認證、CORS、gzip 壓縮。TUI 只是一個前端；伺服器可由任何 HTTP 用戶端、Web UI 或行動應用程式驅動。

### 上下文管理

當 token 使用量接近模型上下文限制時，透過 AI 驅動的摘要進行自動壓縮。可設定閾值的 token 感知修剪（`PRUNE_MINIMUM` 20KB、`PRUNE_PROTECT` 40KB）。skill 工具輸出受保護，不會被修剪。

### 編輯引擎

帶 hunk 驗證的 unified diff 修補。將目標 hunk 套用於檔案的特定區域，而非整檔覆寫。用於跨檔案批次操作的 multi-edit 工具。

### 權限系統

3 狀態權限（`allow` / `deny` / `ask`），支援萬用字元模式比對。100 多個 bash 指令粒度定義，實現精細控制。專案邊界限制，防止存取工作區外的檔案。

### 基於 Git 的回滾

快照系統，在每次工具執行前記錄檔案狀態。支援 `revert` 和 `unrevert`，帶 diff 計算。可按訊息或按工作階段回滾變更。

### 成本追蹤

每則訊息的成本及完整 token 明細（input、output、reasoning、cache read、cache write）。按團隊的預算限額（`max_cost`）。`stats` 指令支援按模型和按天彙總。TUI 中即時顯示工作階段成本。定價資料來自 models.dev。

### 外掛系統

完整的 SDK（`@opencode/plugin`），帶 hook 架構。支援從 npm 套件或檔案系統動態載入。內建 Codex、GitHub Copilot、GitLab 和 Poe 認證外掛。

---

## 常見誤解

為防止 AI 產生的摘要對本專案造成的誤導：

- **TUI 是 TypeScript** 撰寫的（SolidJS + @opentui 用於終端機渲染），不是 Rust。
- **Tree-sitter** 僅用於 TUI 語法高亮與 bash 指令解析，不用於代理層級的程式碼分析。
- **沒有 Docker/E2B 沙箱** -- 隔離由 git worktree 提供。
- **沒有向量資料庫或 RAG 系統** -- 上下文透過 LSP 符號索引 + 自動壓縮進行管理。
- **沒有會自動提出修正建議的「監聽模式」** -- 檔案監聽器僅用於基礎設施目的。
- **自我修正**使用標準代理迴圈（LLM 查看工具結果中的錯誤並重試），不是專門的自動修復機制。

## 能力矩陣

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
| Docker/E2B sandboxing | Not implemented | Git worktrees used instead |
| Vector DB / RAG | Not implemented | LSP + auto-compact covers needs |
| Dry run / command preview | Not implemented | Permission system validates pre-exec |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

---

### 安裝

```bash
# 直接安裝 (YOLO)
curl -fsSL https://opencode.ai/install | bash

# 套件管理員
npm i -g opencode-ai@latest        # 也可使用 bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS 與 Linux（推薦，始終保持最新）
brew install opencode              # macOS 與 Linux（官方 brew formula，更新頻率較低）
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # 任何作業系統
nix run nixpkgs#opencode           # 或使用 github:anomalyco/opencode 以取得最新開發分支
```

> [!TIP]
> 安裝前請先移除 0.1.x 以前的舊版本。

### 桌面應用程式 (BETA)

OpenCode 也提供桌面版應用程式。您可以直接從 [發佈頁面 (releases page)](https://github.com/anomalyco/opencode/releases) 或 [opencode.ai/download](https://opencode.ai/download) 下載。

| 平台                  | 下載連結                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, 或 AppImage           |

```bash
# macOS (Homebrew Cask)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### 安裝目錄

安裝腳本會依據以下優先順序決定安裝路徑：

1. `$OPENCODE_INSTALL_DIR` - 自定義安裝目錄
2. `$XDG_BIN_DIR` - 符合 XDG 基礎目錄規範的路徑
3. `$HOME/bin` - 標準使用者執行檔目錄 (若存在或可建立)
4. `$HOME/.opencode/bin` - 預設備用路徑

```bash
# 範例
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode 內建了兩種 Agent，您可以使用 `Tab` 鍵快速切換。

- **build** - 預設模式，具備完整權限的 Agent，適用於開發工作。
- **plan** - 唯讀模式，適用於程式碼分析與探索。
  - 預設禁止修改檔案。
  - 執行 bash 指令前會詢問權限。
  - 非常適合用來探索陌生的程式碼庫或規劃變更。

此外，OpenCode 還包含一個 **general** 子 Agent，用於處理複雜搜尋與多步驟任務。此 Agent 供系統內部使用，亦可透過在訊息中輸入 `@general` 來呼叫。

了解更多關於 [Agents](https://opencode.ai/docs/agents) 的資訊。

### 線上文件

關於如何設定 OpenCode 的詳細資訊，請參閱我們的 [**官方文件**](https://opencode.ai/docs)。

### 參與貢獻

如果您有興趣參與 OpenCode 的開發，請在提交 Pull Request 前先閱讀我們的 [貢獻指南 (Contributing Docs)](./CONTRIBUTING.md)。

### 基於 OpenCode 進行開發

如果您正在開發與 OpenCode 相關的專案，並在名稱中使用了 "opencode"（例如 "opencode-dashboard" 或 "opencode-mobile"），請在您的 README 中加入聲明，說明該專案並非由 OpenCode 團隊開發，且與我們沒有任何隸屬關係。

### 常見問題 (FAQ)

#### 這跟 Claude Code 有什麼不同？

在功能面上與 Claude Code 非常相似。以下是關鍵差異：

- 100% 開源。
- 不綁定特定的服務提供商。雖然我們推薦使用透過 [OpenCode Zen](https://opencode.ai/zen) 提供的模型，但 OpenCode 也可搭配 Claude, OpenAI, Google 甚至本地模型使用。隨著模型不斷演進，彼此間的差距會縮小且價格會下降，因此具備「不限廠商 (provider-agnostic)」的特性至關重要。
- 內建 LSP (語言伺服器協定) 支援。
- 專注於終端機介面 (TUI)。OpenCode 由 Neovim 愛好者與 [terminal.shop](https://terminal.shop) 的創作者打造。我們將不斷挑戰終端機介面的極限。
- 客戶端/伺服器架構 (Client/Server Architecture)。這讓 OpenCode 能夠在您的電腦上運行的同時，由行動裝置進行遠端操控。這意味著 TUI 前端只是眾多可能的客戶端之一。

---

**加入我們的社群** [飞书](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=738j8655-cd59-4633-a30a-1124e0096789&qr_code=true) | [X.com](https://x.com/opencode)
