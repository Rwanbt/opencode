<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">オープンソースのAIコーディングエージェント。</p>
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

## フォーク機能

> これは [anomalyco/opencode](https://github.com/anomalyco/opencode) のフォークで、[Rwanbt](https://github.com/Rwanbt) がメンテナンスしています。
> アップストリームと同期を維持。最新の変更は [dev ブランチ](https://github.com/Rwanbt/opencode/tree/dev) をご覧ください。

#### バックグラウンドタスク

非同期に実行されるサブエージェントに作業を委任します。task ツールで `mode: "background"` を設定すると、エージェントがバックグラウンドで動作している間に `task_id` が即座に返されます。ライフサイクル追跡のためにバスイベント（`TaskCreated`、`TaskCompleted`、`TaskFailed`）が発行されます。

#### エージェントチーム

`team` ツールを使用して複数のエージェントを並列にオーケストレーションします。依存関係のエッジを持つサブタスクを定義し、`computeWaves()` が DAG を構築して独立したタスクを同時に実行します（最大5つの並列エージェント）。`max_cost`（ドル）と `max_agents` によるバジェット制御。完了したタスクのコンテキストは依存タスクに自動的に渡されます。

#### Git Worktree 分離

各バックグラウンドタスクは自動的に独自の git worktree を取得します。ワークスペースはデータベース内のセッションにリンクされます。タスクがファイル変更を生成しない場合、worktree は自動的にクリーンアップされます。コンテナなしで git レベルの分離を提供します。

#### タスク管理 API

タスクライフサイクル管理のための完全な REST API：

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

#### TUI タスクダッシュボード

アクティブなバックグラウンドタスクをリアルタイムのステータスアイコンで表示するサイドバープラグイン：

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

アクション付きダイアログ：タスクセッションを開く、キャンセル、再開、フォローアップ送信、ステータス確認。

#### MCP エージェントスコーピング

エージェントごとの MCP サーバー許可/拒否リスト。`opencode.json` の各エージェントの `mcp` フィールドで設定します。`toolsForAgent()` 関数が呼び出し元エージェントのスコープに基づいて利用可能な MCP ツールをフィルタリングします。

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9状態セッションライフサイクル

セッションは9つの状態のいずれかを追跡し、データベースに永続化されます：

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

永続状態（`queued`、`blocked`、`awaiting_input`、`completed`、`failed`、`cancelled`）はデータベース再起動後も保持されます。インメモリ状態（`idle`、`busy`、`retry`）は再起動時にリセットされます。

#### オーケストレーターエージェント

読み取り専用のコーディネーターエージェント（最大50ステップ）。`task` と `team` ツールにアクセスできますが、すべての編集ツールは拒否されます。実装をビルド/汎用エージェントに委任し、結果を統合します。

---

## 技術アーキテクチャ

### マルチプロバイダー対応

21以上のプロバイダーをすぐに利用可能：Anthropic、OpenAI、Google Gemini、Azure、AWS Bedrock、Vertex AI、OpenRouter、GitHub Copilot、XAI、Mistral、Groq、DeepInfra、Cerebras、Cohere、TogetherAI、Perplexity、Vercel、Venice、GitLab、Gateway、およびすべての OpenAI 互換エンドポイント。料金は [models.dev](https://models.dev) から取得。

### エージェントシステム

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | デフォルトの開発エージェント |
| **plan** | primary | read-only | 分析とコード探索 |
| **general** | subagent | full (no todowrite) | 複雑なマルチステップタスク |
| **explore** | subagent | read-only | 高速なコードベース検索 |
| **orchestrator** | subagent | read-only + task/team | マルチエージェントコーディネーター（50ステップ） |
| **critic** | subagent | read-only + bash + LSP | コードレビュー：バグ、セキュリティ、パフォーマンス |
| **tester** | subagent | full (no todowrite) | テスト作成・実行、カバレッジ確認 |
| **documenter** | subagent | full (no todowrite) | JSDoc、README、インラインドキュメント |
| compaction | hidden | none | AI駆動のコンテキスト要約 |
| title | hidden | none | セッションタイトル生成 |
| summary | hidden | none | セッション要約 |

### LSP 統合

完全な Language Server Protocol サポート。シンボルインデックス、診断機能、マルチ言語対応（TypeScript、Deno、Vue、拡張可能）。エージェントはテキスト検索ではなく LSP シンボルを使ってコードをナビゲートし、正確な go-to-definition、find-references、リアルタイムの型エラー検出を実現します。

### MCP サポート

Model Context Protocol クライアントおよびサーバー。stdio、HTTP/SSE、StreamableHTTP トランスポートに対応。リモートサーバー向け OAuth 認証フロー。ツール、プロンプト、リソース機能。エージェントごとの許可/拒否リストによるスコーピング。

### クライアント/サーバーアーキテクチャ

Hono ベースの REST API（型付きルートと OpenAPI 仕様生成）。PTY（疑似端末）用 WebSocket サポート。リアルタイムイベントストリーミング用 SSE。Basic 認証、CORS、gzip 圧縮。TUI は1つのフロントエンド。サーバーは任意の HTTP クライアント、Web UI、モバイルアプリから操作可能。

### コンテキスト管理

トークン使用量がモデルのコンテキスト制限に近づくと、AI駆動の要約による自動コンパクション。設定可能なしきい値によるトークン対応プルーニング（`PRUNE_MINIMUM` 20KB、`PRUNE_PROTECT` 40KB）。skill ツールの出力はプルーニングから保護されます。

### 編集エンジン

hunk 検証付きの unified diff パッチ。ファイル全体の上書きではなく、ファイルの特定領域にターゲットした hunk を適用。複数ファイルにわたるバッチ操作用の multi-edit ツール。

### パーミッションシステム

ワイルドカードパターンマッチング付きの3状態パーミッション（`allow` / `deny` / `ask`）。きめ細かな制御のための100以上の bash コマンドアリティ定義。ワークスペース外のファイルアクセスを防止するプロジェクト境界強制。

### Git ベースのロールバック

各ツール実行前のファイル状態を記録するスナップショットシステム。diff 計算付きの `revert` と `unrevert` をサポート。メッセージ単位またはセッション単位で変更をロールバック可能。

### コスト追跡

メッセージごとのコストと完全なトークン内訳（input、output、reasoning、cache read、cache write）。チームごとの予算制限（`max_cost`）。モデル別・日別の集計が可能な `stats` コマンド。TUI にセッションコストをリアルタイム表示。料金データは models.dev から取得。

### プラグインシステム

フック構造を持つ完全な SDK（`@opencode/plugin`）。npm パッケージまたはファイルシステムからの動的ロード。Codex、GitHub Copilot、GitLab、Poe 認証用の組み込みプラグイン。

---

## よくある誤解

本プロジェクトに関する AI 生成の要約による混乱を防ぐために：

- **TUI は TypeScript** で構築されています（SolidJS + @opentui によるターミナルレンダリング）。Rust ではありません。
- **Tree-sitter** は TUI のシンタックスハイライトと bash コマンドパースにのみ使用されており、エージェントレベルのコード分析には使われていません。
- **Docker/E2B サンドボックスはありません** -- 分離は git worktree によって提供されます。
- **ベクトルデータベースや RAG システムはありません** -- コンテキストは LSP シンボルインデックス + 自動コンパクションで管理されます。
- **自動修正を提案する「ウォッチモード」はありません** -- ファイルウォッチャーはインフラ目的でのみ存在します。
- **自己修正**は標準的なエージェントループ（LLM がツール結果のエラーを見てリトライ）を使用しており、専用の自動修復メカニズムではありません。

## 機能マトリックス

| 機能 | Status | Notes |
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
| Vector DB / RAG | Implemented | `experimental.rag.enabled: true`, SQLite + cosine similarity |
| Dry run / command preview | Implemented | `dry_run` param on bash/edit/write tools |
| Specialized agents | Implemented | critic, tester, documenter subagents |
| Auto-learn | Implemented | Post-session lesson extraction to `.opencode/learnings/` |
| Vulnerability scanner | Implemented | Auto-scan on edit/write for secrets, injections, unsafe patterns |
| DLP / AgentShield | Implemented | `experimental.dlp.enabled: true`, redacts secrets before LLM calls |
| Policy engine | Implemented | `experimental.policy.enabled: true`, conditional rules + custom policies |
| Confidence/decay | Implemented | Time-based scoring for RAG embeddings, exponential decay |
| Memory conflict resolution | Implemented | Detects and resolves duplicate/contradictory embeddings |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

---

### インストール

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# パッケージマネージャー
npm i -g opencode-ai@latest        # bun/pnpm/yarn でもOK
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS と Linux（推奨。常に最新）
brew install opencode              # macOS と Linux（公式 brew formula。更新頻度は低め）
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # どのOSでも
nix run nixpkgs#opencode           # または github:anomalyco/opencode で最新 dev ブランチ
```

> [!TIP]
> インストール前に 0.1.x より古いバージョンを削除してください。

### デスクトップアプリ (BETA)

OpenCode はデスクトップアプリとしても利用できます。[releases page](https://github.com/anomalyco/opencode/releases) から直接ダウンロードするか、[opencode.ai/download](https://opencode.ai/download) を利用してください。

| プラットフォーム      | ダウンロード                          |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`、`.rpm`、または AppImage       |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### インストールディレクトリ

インストールスクリプトは、インストール先パスを次の優先順位で決定します。

1. `$OPENCODE_INSTALL_DIR` - カスタムのインストールディレクトリ
2. `$XDG_BIN_DIR` - XDG Base Directory Specification に準拠したパス
3. `$HOME/bin` - 標準のユーザー用バイナリディレクトリ（存在する場合、または作成できる場合）
4. `$HOME/.opencode/bin` - デフォルトのフォールバック

```bash
# 例
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode には組み込みの Agent が2つあり、`Tab` キーで切り替えられます。

- **build** - デフォルト。開発向けのフルアクセス Agent
- **plan** - 分析とコード探索向けの読み取り専用 Agent
  - デフォルトでファイル編集を拒否
  - bash コマンド実行前に確認
  - 未知のコードベース探索や変更計画に最適

また、複雑な検索やマルチステップのタスク向けに **general** サブ Agent も含まれています。
内部的に使用されており、メッセージで `@general` と入力して呼び出せます。

[agents](https://opencode.ai/docs/agents) の詳細はこちら。

### ドキュメント

OpenCode の設定については [**ドキュメント**](https://opencode.ai/docs) を参照してください。

### コントリビュート

OpenCode に貢献したい場合は、Pull Request を送る前に [contributing docs](./CONTRIBUTING.md) を読んでください。

### OpenCode の上に構築する

OpenCode に関連するプロジェクトで、名前に "opencode"（例: "opencode-dashboard" や "opencode-mobile"）を含める場合は、そのプロジェクトが OpenCode チームによって作られたものではなく、いかなる形でも関係がないことを README に明記してください。

### FAQ

#### Claude Code との違いは？

機能面では Claude Code と非常に似ています。主な違いは次のとおりです。

- 100% オープンソース
- 特定のプロバイダーに依存しません。[OpenCode Zen](https://opencode.ai/zen) で提供しているモデルを推奨しますが、OpenCode は Claude、OpenAI、Google、またはローカルモデルでも利用できます。モデルが進化すると差は縮まり価格も下がるため、provider-agnostic であることが重要です。
- そのまま使える LSP サポート
- TUI にフォーカス。OpenCode は neovim ユーザーと [terminal.shop](https://terminal.shop) の制作者によって作られており、ターミナルで可能なことの限界を押し広げます。
- クライアント/サーバー構成。例えば OpenCode をあなたのPCで動かし、モバイルアプリからリモート操作できます。TUI フロントエンドは複数あるクライアントの1つにすぎません。

---

**コミュニティに参加** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
