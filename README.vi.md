<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Trợ lý lập trình AI mã nguồn mở.</p>
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

## Tính năng Fork

> Đây là một fork của [anomalyco/opencode](https://github.com/anomalyco/opencode) được duy trì bởi [Rwanbt](https://github.com/Rwanbt).
> Được đồng bộ với upstream. Xem [nhánh dev](https://github.com/Rwanbt/opencode/tree/dev) để biết các thay đổi mới nhất.

#### Tác vụ nền

Ủy thác công việc cho các subagent chạy bất đồng bộ. Đặt `mode: "background"` trên công cụ task và nó trả về `task_id` ngay lập tức trong khi agent làm việc ở nền. Các bus event (`TaskCreated`, `TaskCompleted`, `TaskFailed`) được phát hành để theo dõi vòng đời.

#### Nhóm Agent

Điều phối nhiều agent song song bằng công cụ `team`. Định nghĩa các tác vụ con với các cạnh phụ thuộc; `computeWaves()` xây dựng một DAG và thực thi các tác vụ độc lập đồng thời (tối đa 5 agent song song). Kiểm soát ngân sách qua `max_cost` (đô la) và `max_agents`. Ngữ cảnh từ các tác vụ đã hoàn thành tự động được chuyển cho các tác vụ phụ thuộc.

#### Cách ly Git Worktree

Mỗi tác vụ nền tự động nhận được git worktree riêng. Workspace được liên kết với phiên trong cơ sở dữ liệu. Nếu một tác vụ không tạo ra thay đổi tệp, worktree sẽ được dọn dẹp tự động. Điều này cung cấp cách ly ở cấp git mà không cần container.

#### API Quản lý Tác vụ

REST API đầy đủ cho quản lý vòng đời tác vụ:

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/task/` | Liệt kê tác vụ (lọc theo parent, status) |
| GET | `/task/:id` | Chi tiết tác vụ + status + thông tin worktree |
| GET | `/task/:id/messages` | Lấy tin nhắn phiên của tác vụ |
| POST | `/task/:id/cancel` | Hủy tác vụ đang chạy hoặc đang chờ |
| POST | `/task/:id/resume` | Tiếp tục tác vụ đã hoàn thành/thất bại/bị chặn |
| POST | `/task/:id/followup` | Gửi tin nhắn theo dõi cho tác vụ nhàn rỗi |
| POST | `/task/:id/promote` | Thăng cấp tác vụ nền lên tiền cảnh |
| GET | `/task/:id/team` | Tổng hợp nhóm (chi phí, diff theo thành viên) |

#### Bảng điều khiển Tác vụ TUI

Plugin thanh bên hiển thị các tác vụ nền đang hoạt động với biểu tượng trạng thái thời gian thực:

| Biểu tượng | Trạng thái |
|------------|------------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Hộp thoại với các hành động: mở phiên tác vụ, hủy, tiếp tục, gửi tin nhắn theo dõi, kiểm tra trạng thái.

#### Phạm vi Agent MCP

Danh sách cho phép/từ chối theo từng agent cho máy chủ MCP. Cấu hình trong `opencode.json` dưới trường `mcp` của mỗi agent. Hàm `toolsForAgent()` lọc các công cụ MCP khả dụng dựa trên phạm vi của agent đang gọi.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### Vòng đời Phiên 9 Trạng thái

Các phiên theo dõi một trong 9 trạng thái, được lưu trữ vào cơ sở dữ liệu:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Các trạng thái bền vững (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) tồn tại qua khởi động lại cơ sở dữ liệu. Các trạng thái trong bộ nhớ (`idle`, `busy`, `retry`) được đặt lại khi khởi động lại.

#### Agent Điều phối

Agent điều phối chỉ đọc (tối đa 50 bước). Có quyền truy cập các công cụ `task` và `team` nhưng tất cả công cụ chỉnh sửa đều bị từ chối. Ủy thác triển khai cho các agent build/general và tổng hợp kết quả.

## Kiến trúc Kỹ thuật

### Hỗ trợ Đa nhà cung cấp

21+ nhà cung cấp sẵn có: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, cùng bất kỳ endpoint tương thích OpenAI nào. Giá cả lấy từ [models.dev](https://models.dev).

### Hệ thống Agent

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

### Tích hợp LSP

Hỗ trợ đầy đủ Language Server Protocol với lập chỉ mục ký hiệu, chẩn đoán và hỗ trợ đa ngôn ngữ (TypeScript, Deno, Vue và có thể mở rộng). Agent điều hướng mã qua các ký hiệu LSP thay vì tìm kiếm văn bản, cho phép go-to-definition, find-references và phát hiện lỗi kiểu chính xác theo thời gian thực.

### Hỗ trợ MCP

Model Context Protocol client và server. Hỗ trợ stdio, HTTP/SSE và StreamableHTTP transports. Luồng xác thực OAuth cho máy chủ từ xa. Khả năng tool, prompt và resource. Phạm vi theo từng agent qua danh sách allow/deny.

### Kiến trúc Client/Server

REST API dựa trên Hono với typed routes và tạo OpenAPI spec. Hỗ trợ WebSocket cho PTY (pseudo-terminal). SSE cho streaming sự kiện thời gian thực. Basic auth, CORS, nén gzip. TUI là một frontend; server có thể được điều khiển từ bất kỳ HTTP client nào, web UI hoặc ứng dụng di động.

### Quản lý Ngữ cảnh

Auto-compact với tóm tắt do AI điều khiển khi sử dụng token tiến gần đến giới hạn ngữ cảnh của mô hình. Cắt tỉa nhận biết token với ngưỡng có thể cấu hình (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Đầu ra Skill tool được bảo vệ khỏi cắt tỉa.

### Engine Chỉnh sửa

Unified diff patching với xác minh hunk. Áp dụng hunk nhắm mục tiêu vào các vùng tệp cụ thể thay vì ghi đè toàn bộ tệp. Multi-edit tool cho các thao tác hàng loạt trên nhiều tệp.

### Hệ thống Quyền

Quyền 3 trạng thái (`allow` / `deny` / `ask`) với khớp mẫu wildcard. 100+ định nghĩa arity lệnh bash để kiểm soát chi tiết. Thực thi ranh giới dự án ngăn truy cập tệp bên ngoài workspace.

### Hoàn tác qua Git

Hệ thống snapshot ghi lại trạng thái tệp trước mỗi lần thực thi công cụ. Hỗ trợ `revert` và `unrevert` với tính toán diff. Các thay đổi có thể hoàn tác theo tin nhắn hoặc theo phiên.

### Theo dõi Chi phí

Chi phí mỗi tin nhắn với phân tích token đầy đủ (input, output, reasoning, cache read, cache write). Giới hạn ngân sách theo nhóm (`max_cost`). Lệnh `stats` với tổng hợp theo mô hình và theo ngày. Chi phí phiên thời gian thực hiển thị trong TUI. Dữ liệu giá từ models.dev.

### Hệ thống Plugin

SDK đầy đủ (`@opencode/plugin`) với kiến trúc hook. Tải động từ gói npm hoặc hệ thống tệp. Plugin tích hợp sẵn cho xác thực Codex, GitHub Copilot, GitLab và Poe.

---

## Những Hiểu lầm Phổ biến

Để tránh nhầm lẫn từ các bản tóm tắt do AI tạo về dự án này:

- **TUI là TypeScript** (SolidJS + @opentui cho rendering terminal), không phải Rust.
- **Tree-sitter** chỉ được sử dụng cho đánh dấu cú pháp TUI và phân tích lệnh bash, không phải cho phân tích mã cấp agent.
- **Không có Docker/E2B sandboxing** -- cách ly được cung cấp bởi git worktrees.
- **Không có cơ sở dữ liệu vector hoặc hệ thống RAG** -- ngữ cảnh được quản lý qua LSP symbol indexing + auto-compact.
- **Không có "watch mode" đề xuất sửa tự động** -- file watcher chỉ tồn tại cho mục đích cơ sở hạ tầng.
- **Tự sửa lỗi** sử dụng vòng lặp agent tiêu chuẩn (LLM nhìn thấy lỗi trong kết quả công cụ và thử lại), không phải cơ chế tự sửa chữa chuyên biệt.

## Ma trận Khả năng

| Khả năng | Status | Notes |
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
| Docker/E2B sandboxing | Not implemented | Git worktrees used instead |
| Vector DB / RAG | Not implemented | LSP + auto-compact covers needs |
| Dry run / command preview | Not implemented | Permission system validates pre-exec |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

---

### Cài đặt

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Các trình quản lý gói (Package managers)
npm i -g opencode-ai@latest        # hoặc bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS và Linux (khuyên dùng, luôn cập nhật)
brew install opencode              # macOS và Linux (công thức brew chính thức, ít cập nhật hơn)
sudo pacman -S opencode            # Arch Linux (Bản ổn định)
paru -S opencode-bin               # Arch Linux (Bản mới nhất từ AUR)
mise use -g opencode               # Mọi hệ điều hành
nix run nixpkgs#opencode           # hoặc github:anomalyco/opencode cho nhánh dev mới nhất
```

> [!TIP]
> Hãy xóa các phiên bản cũ hơn 0.1.x trước khi cài đặt.

### Ứng dụng Desktop (BETA)

OpenCode cũng có sẵn dưới dạng ứng dụng desktop. Tải trực tiếp từ [trang releases](https://github.com/anomalyco/opencode/releases) hoặc [opencode.ai/download](https://opencode.ai/download).

| Nền tảng              | Tải xuống                             |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, hoặc AppImage         |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Thư mục cài đặt

Tập lệnh cài đặt tuân theo thứ tự ưu tiên sau cho đường dẫn cài đặt:

1. `$OPENCODE_INSTALL_DIR` - Thư mục cài đặt tùy chỉnh
2. `$XDG_BIN_DIR` - Đường dẫn tuân thủ XDG Base Directory Specification
3. `$HOME/bin` - Thư mục nhị phân tiêu chuẩn của người dùng (nếu tồn tại hoặc có thể tạo)
4. `$HOME/.opencode/bin` - Mặc định dự phòng

```bash
# Ví dụ
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents (Đại diện)

OpenCode bao gồm hai agent được tích hợp sẵn mà bạn có thể chuyển đổi bằng phím `Tab`.

- **build** - Agent mặc định, có toàn quyền truy cập cho công việc lập trình
- **plan** - Agent chỉ đọc dùng để phân tích và khám phá mã nguồn
  - Mặc định từ chối việc chỉnh sửa tệp
  - Hỏi quyền trước khi chạy các lệnh bash
  - Lý tưởng để khám phá các codebase lạ hoặc lên kế hoạch thay đổi

Ngoài ra còn có một subagent **general** dùng cho các tìm kiếm phức tạp và tác vụ nhiều bước.
Agent này được sử dụng nội bộ và có thể gọi bằng cách dùng `@general` trong tin nhắn.

Tìm hiểu thêm về [agents](https://opencode.ai/docs/agents).

### Tài liệu

Để biết thêm thông tin về cách cấu hình OpenCode, [**hãy truy cập tài liệu của chúng tôi**](https://opencode.ai/docs).

### Đóng góp

Nếu bạn muốn đóng góp cho OpenCode, vui lòng đọc [tài liệu hướng dẫn đóng góp](./CONTRIBUTING.md) trước khi gửi pull request.

### Xây dựng trên nền tảng OpenCode

Nếu bạn đang làm việc trên một dự án liên quan đến OpenCode và sử dụng "opencode" như một phần của tên dự án, ví dụ "opencode-dashboard" hoặc "opencode-mobile", vui lòng thêm một ghi chú vào README của bạn để làm rõ rằng dự án đó không được xây dựng bởi đội ngũ OpenCode và không liên kết với chúng tôi dưới bất kỳ hình thức nào.

### Các câu hỏi thường gặp (FAQ)

#### OpenCode khác biệt thế nào so với Claude Code?

Về mặt tính năng, nó rất giống Claude Code. Dưới đây là những điểm khác biệt chính:

- 100% mã nguồn mở
- Không bị ràng buộc với bất kỳ nhà cung cấp nào. Mặc dù chúng tôi khuyên dùng các mô hình được cung cấp qua [OpenCode Zen](https://opencode.ai/zen), OpenCode có thể được sử dụng với Claude, OpenAI, Google, hoặc thậm chí các mô hình chạy cục bộ. Khi các mô hình phát triển, khoảng cách giữa chúng sẽ thu hẹp lại và giá cả sẽ giảm, vì vậy việc không phụ thuộc vào nhà cung cấp là rất quan trọng.
- Hỗ trợ LSP ngay từ đầu
- Tập trung vào TUI (Giao diện người dùng dòng lệnh). OpenCode được xây dựng bởi những người dùng neovim và đội ngũ tạo ra [terminal.shop](https://terminal.shop); chúng tôi sẽ đẩy giới hạn của những gì có thể làm được trên terminal lên mức tối đa.
- Kiến trúc client/server. Chẳng hạn, điều này cho phép OpenCode chạy trên máy tính của bạn trong khi bạn điều khiển nó từ xa qua một ứng dụng di động, nghĩa là frontend TUI chỉ là một trong những client có thể dùng.

---

**Tham gia cộng đồng của chúng tôi** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
