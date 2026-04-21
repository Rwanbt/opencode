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
  <a href="https://github.com/Rwanbt/opencode/actions/workflows/fork-release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/Rwanbt/opencode/fork-release.yml?style=flat-square&branch=main" /></a>
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

<!-- WHY-FORK-MATRIX -->
## Tại sao chọn fork này?

> **Tóm tắt** — tác nhân lập trình mã nguồn mở duy nhất cung cấp bộ điều phối dựa trên DAG, REST task API, phạm vi MCP theo từng agent, FSM phiên 9 trạng thái, trình quét lỗ hổng tích hợp *và* ứng dụng Android hạng nhất với suy luận LLM trên thiết bị. Không CLI nào khác — độc quyền hay mã mở — kết hợp được tất cả những thứ này.

> See the English [README.md](README.md) for the full positioning prose (vs. vendor-locked CLIs, vs. BYOM peers, vs. specialized CLIs) and architecture diagram.

### Capability matrix — this fork vs. the 2026 landscape

Legend: ✅ shipped · ❌ absent · *partial* limited/incomplete · *plugin* via community add-on · *paid* behind a subscription tier.

#### Orchestration, API surface, governance

| Capability                             | **This fork** | Claude Code | Codex CLI | Gemini CLI | opencode (upstream) | Aider | Goose | Cline | Roo Code | Cursor | Continue | Crush | Qwen Code |
| -------------------------------------- | :-----------: | :---------: | :-------: | :--------: | :-----------------: | :---: | :---: | :---: | :------: | :----: | :------: | :---: | :-------: |
| Open source                            |       ✅       |      ❌      |  partial  |      ✅     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ❌    |     ✅     |   ✅   |     ✅     |
| BYOM (bring your own model)            |       ✅       |      ❌      |     ❌     |      ❌     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |  partial |     ✅     |   ✅   |   partial  |
| Local models (llama.cpp / Ollama)      |       ✅       |      ❌      |     ❌     |      ❌     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ❌    |     ✅     |   ✅   |     ✅     |
| Parallel agents in isolated worktrees  |    ✅ native   |  ✅ (Teams)  |  partial  |      ❌     |      via plugin     |   ❌   | partial | ✅ (v3.58) | partial | ❌ | ❌ | ❌ |     ❌     |
| Explicit **DAG orchestration**         | ✅ **unique**  |    ad-hoc   |     ❌     |      ❌     |          ❌          |   ❌   | recipes (linear) | ❌ | ❌ | ❌ |     ❌     |   ❌   |     ❌     |
| **REST task API** (programmable)       | ✅ **unique**  | partial (SDK) |  ❌    |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **TUI task dashboard**                 |       ✅       |      ❌      |     ❌     |      ❌     |       partial       |   ❌   |   ❌   |   ❌   |    ❌     |   n/a   |    n/a    |   ❌   |   partial  |
| MCP support                            | ✅ + **per-agent scoping** | ✅ | ✅ | ✅ | ✅ | via plugins | ✅ | ✅ | ✅ | partial | ✅ |   ❌   |     ✅     |
| **9-state session FSM**                | ✅ **unique** (6/9 persisted) | ❌ |     ❌     |      ❌     |        basic        |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Built-in **vulnerability scanner**     | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **DLP / secret redaction** before LLM call | ✅         |   partial    |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Per-agent tool allow/deny**          |       ✅       |   partial    |     ❌     |      ❌     |        basic        |   ❌   |   ❌   |   ❌   |  partial  |    ❌    |     ❌     |   ❌   |     ❌     |
| Docker sandboxing (bash only) | ✅ bash-only | ❌         |     ✅     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Git auto-commits / rollback            |       ✅       |      ✅      |     ✅     |      ✅     |      ✅ (signed)     |   ✅   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     |   ✅   |     ✅     |

#### Intelligence, context, developer UX

| Capability                             | **This fork** | Claude Code | Codex CLI | Gemini CLI | opencode (upstream) | Aider | Goose | Cline | Roo Code | Cursor | Continue | Crush | Qwen Code |
| -------------------------------------- | :-----------: | :---------: | :-------: | :--------: | :-----------------: | :---: | :---: | :---: | :------: | :----: | :------: | :---: | :-------: |
| LSP integration (go-to-def, diagnostics) | ✅           |   partial    |  partial  |   partial   |          ✅          | partial | partial | ✅   |    ✅     |    ✅    |     ✅     | partial |  partial  |
| Plugin SDK (`@opencode/plugin`)        |       ✅       |   partial    |     ❌     |      ❌     |          ✅          |   ❌   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     |   ❌   |     ❌     |
| Prompt caching (cloud + local KV)      |       ✅       |      ✅      |     ✅     |      ✅     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     |   ✅   |     ✅     |
| **RAG: BM25 or vector (selectable)** + exponential decay | ✅ | ❌  |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   | vector only | ❌      |  vector only |  vector only |  ❌   |     ❌     |
| **Auto-learn** (requires `learner` agent configured) | opt-in | ❌  |  ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Auto-compact (AI summarization)        |       ✅       |      ✅      |     ✅     |      ✅     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     | partial |     ✅     |
| Unified-diff edit engine               |       ✅       |      ✅      |     ✅     |   partial   |          ✅          |   ✅   | partial | partial |    ✅     | partial |  partial  | partial |  partial  |
| ACP (Agent Client Protocol) layer      |       ✅       |      ❌      |     ❌     |      ❌     |        basic        |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |

#### Platform reach & multimodal

| Capability                             | **This fork** | Claude Code | Codex CLI | Gemini CLI | opencode (upstream) | Aider | Goose | Cline | Roo Code | Cursor | Continue | Crush | Qwen Code |
| -------------------------------------- | :-----------: | :---------: | :-------: | :--------: | :-----------------: | :---: | :---: | :---: | :------: | :----: | :------: | :---: | :-------: |
| First-class **Android app**            | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| iOS (remote mode)                      |       ✅       |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Adaptive runtime (VRAM/CPU, thermal Android-only) | ✅ partial | ❌ |  ❌     |      ❌     |      hardcoded      | hardcoded | hardcoded | hardcoded | hardcoded | n/a | hardcoded | hardcoded | hardcoded |
| **STT** (voice-to-text, Parakeet) | ✅ desktop + mobile | ❌ |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   | partial  |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **TTS** (Kokoro desktop + mobile; Pocket desktop only + voice clone) | ✅ | ❌ |    ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **OAuth deep-link callback** (Tauri)   |       ✅       |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **mDNS service discovery** (CLI flag `--mdns`) | opt-in | ❌ |   ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Upstream branch watcher** (`vcs.branch.behind`) | ✅ **unique** | ❌ |    ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Collaborative mode** (JWT + presence + file-lock) | ✅ | ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     | partial |     ❌     |   ❌   |     ❌     |
| **AnythingLLM bridge**                 | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **GDPR export/erasure route**          | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Price                                  |  free + BYOM  |  $20/mo sub |$20/mo sub |  1000/day free | free + BYOM    | free + BYOM | free + BYOM | free + BYOM | free + BYOM | $20/mo sub | free + BYOM | free + BYOM | free + BYOM |

---

<!-- ACCORDION-APPLIED -->

<details>
<summary><b>⚡ Nhìn tổng quan</b></summary>
<br>

## ⚡ Nhìn tổng quan

OpenCode (fork) — một tác nhân lập trình AI được điều phối, chạy trên **máy tính để bàn, máy chủ và điện thoại**, với các mô hình cục bộ từ đầu đến cuối, không phụ thuộc đám mây, và tích hợp sẵn các nguyên tắc quản trị cấp doanh nghiệp. Fork của [anomalyco/opencode](https://github.com/anomalyco/opencode) được duy trì bởi [Rwanbt](https://github.com/Rwanbt).

### Install

```bash
# CLI (macOS / Linux / Windows)
curl -fsSL https://opencode.ai/install | bash

# Desktop app + Android APK
# → https://github.com/Rwanbt/opencode/releases/latest
```

### 8 điều chỉ fork này gói gọn

|   |   |
| - | - |
| 🤖 **DAG orchestration** | Wave-based parallel agents, up to 5 concurrent |
| 🧠 **Local LLM end-to-end** | llama.cpp + runtime that auto-tunes to your VRAM / CPU |
| 📱 **Android app** | On-device inference, terminal, PTY — single APK |
| 🎙️ **Voice STT / TTS** | Parakeet (25 languages) + Kokoro desktop+mobile / Pocket TTS desktop |
| 🔒 **9-state session FSM** | 6 of 9 states persist to SQLite, audit log survives restart |
| 🔌 **REST task API** | 8 endpoints — drive the agent from cron, Temporal, Airflow |
| 🛡️ **Vulnerability scanner** | Auto-scans every edit / write for secrets & injection sinks |
| 🔍 **RAG: BM25 or vector** | Selectable at index time + exponential confidence decay |

### Chạy tác vụ đầu tiên

```bash
opencode                                  # TUI
opencode run "fix the failing test in src/"   # one-shot
```

> 💡 Cần chi tiết? Mỗi phần bên dưới đang được thu gọn — nhấn để mở chỉ phần bạn quan tâm.

---


</details>

<details>
<summary><b>Tính năng Fork</b></summary>
<br>

## Tính năng Fork

> Đây là một fork của [anomalyco/opencode](https://github.com/anomalyco/opencode) được duy trì bởi [Rwanbt](https://github.com/Rwanbt).
> Được đồng bộ với upstream. Xem [nhánh dev](https://github.com/Rwanbt/opencode/tree/dev) để biết các thay đổi mới nhất.

#### AI Ưu tiên Cục bộ

OpenCode chạy các mô hình AI cục bộ trên phần cứng tiêu dùng (8 GB VRAM / 16 GB RAM), không phụ thuộc cloud cho các mô hình 4B-7B.

**Tối ưu hóa Prompt (giảm 94%)**
- ~1K token system prompt cho mô hình cục bộ (so với ~16K cho cloud)
- Skeleton tool schemas (chữ ký 1 dòng thay vì nhiều KB văn bản)
- 7-tool whitelist (bash, read, edit, write, glob, grep, question)
- Không có phần skills, thông tin môi trường tối thiểu

**Engine Suy luận (llama.cpp b8731)**
- Vulkan GPU backend, tự động tải về lần đầu nạp mô hình
- **Cấu hình thích ứng lúc runtime** (`packages/opencode/src/local-llm-server/auto-config.ts`): `n_gpu_layers`, thread, kích thước batch/ubatch, lượng tử hóa KV cache và kích thước ngữ cảnh suy ra từ VRAM phát hiện được, RAM rảnh, phân chia CPU big.LITTLE, GPU backend (CUDA/ROCm/Vulkan/Metal/OpenCL) và trạng thái nhiệt. Thay thế `--n-gpu-layers 99` hardcode cũ — Android 4 GB nay chạy ở chế độ CPU fallback thay vì bị OOM giết, desktop flagship nhận batch được điều chỉnh thay vì mặc định 512.
- `--flash-attn on` — Flash Attention cho hiệu quả bộ nhớ
- `--cache-type-k/v` — KV cache với  rotation; cấp thích ứng (f16 / q8_0 / q4_0) dựa trên dư địa VRAM
- `--fit on` — điều chỉnh VRAM phụ chỉ có trong fork (opt-in qua `OPENCODE_LLAMA_ENABLE_FIT=1`)
- Speculative decoding (`--model-draft`) với VRAM Guard (tự động tắt nếu < 4 GB trống)
- Single slot (`-np 1`) để giảm thiểu dấu chân bộ nhớ
- **Benchmark harness** (`bun run bench:llm`): đo lường có thể tái lập FTL / TPS / đỉnh RSS / thời gian tường cho mỗi mô hình, mỗi lần chạy, đầu ra JSONL để lưu trữ CI

**Giọng nói thành Văn bản (Parakeet TDT 0.6B v3 INT8)**
- NVIDIA Parakeet qua ONNX Runtime — ~300ms cho 5s âm thanh (18x thời gian thực)
- 25 ngôn ngữ châu Âu (tiếng Anh, Pháp, Đức, Tây Ban Nha, v.v.)
- Không cần VRAM: chỉ CPU (~700 MB RAM)
- Tự động tải mô hình (~460 MB) khi nhấn micro lần đầu
- Hoạt ảnh dạng sóng khi ghi âm

**Văn bản thành Giọng nói (Kyutai Pocket TTS)**
- TTS tiếng Pháp bản địa do Kyutai (Paris) tạo, 100M tham số
- 8 giọng tích hợp: Alba, Fantine, Cosette, Eponine, Azelma, Marius, Javert, Jean
- Zero-shot nhân bản giọng nói: tải lên WAV hoặc ghi từ micro
- Chỉ CPU, ~6x thời gian thực, HTTP server trên cổng 14100
- Dự phòng: Kokoro TTS ONNX engine (54 giọng, 9 ngôn ngữ, CMUDict G2P)

**Quản lý Mô hình**
- Tìm kiếm HuggingFace với huy hiệu tương thích VRAM/RAM theo mô hình
- Tải xuống, nạp, gỡ, xóa mô hình GGUF từ giao diện
- Danh mục được tuyển chọn: Gemma 3 4B, Qwen3 4B/1.7B/0.6B
- Output token động dựa trên kích thước mô hình
- Tự động phát hiện draft model (0.5B-0.8B) cho speculative decoding

**Cấu hình**
- Preset: Fast / Quality / Eco / Long Context (tối ưu hóa một cú nhấp)
- Widget giám sát VRAM với thanh sử dụng mã màu (xanh / vàng / đỏ)
- KV cache type: auto / q8_0 / q4_0 / f16
- GPU offloading: auto / gpu-max / balanced
- Memory mapping: auto / on / off
- Chuyển đổi tìm kiếm web (biểu tượng quả cầu trên thanh công cụ prompt)

**Độ tin cậy Agent (mô hình cục bộ)**
- Pre-flight guards (cấp mã, 0 token): kiểm tra tệp tồn tại trước khi chỉnh sửa, xác minh nội dung old_string, bắt buộc đọc-trước-chỉnh-sửa, ngăn ghi-đè-tệp-có-sẵn
- Doom loop auto-break: 2x cuộc gọi công cụ giống hệt → tiêm lỗi (guard cấp mã, không chỉ prompt)
- Đo lường công cụ: tỷ lệ thành công/lỗi theo phiên với phân tích theo công cụ, ghi log tự động

**Đa nền tảng**: Windows (Vulkan), Linux, macOS, Android

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


</details>

<details>
<summary><b>Kiến trúc Kỹ thuật</b></summary>
<br>

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
| **critic** | subagent | read-only + bash + LSP | Code review: lỗi, bảo mật, hiệu suất |
| **tester** | subagent | full (no todowrite) | Viết và chạy test, kiểm tra coverage |
| **documenter** | subagent | full (no todowrite) | JSDoc, README, tài liệu inline |
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


</details>

<details>
<summary><b>Những Hiểu lầm Phổ biến</b></summary>
<br>

## Những Hiểu lầm Phổ biến

Để tránh nhầm lẫn từ các bản tóm tắt do AI tạo về dự án này:

- **TUI là TypeScript** (SolidJS + @opentui cho rendering terminal), không phải Rust.
- **Tree-sitter** chỉ được sử dụng cho đánh dấu cú pháp TUI và phân tích lệnh bash, không phải cho phân tích mã cấp agent.
- **Không có Docker/E2B sandboxing** -- cách ly được cung cấp bởi git worktrees.
- **Không có cơ sở dữ liệu vector hoặc hệ thống RAG** -- ngữ cảnh được quản lý qua LSP symbol indexing + auto-compact.
- **Không có "watch mode" đề xuất sửa tự động** -- file watcher chỉ tồn tại cho mục đích cơ sở hạ tầng.
- **Tự sửa lỗi** sử dụng vòng lặp agent tiêu chuẩn (LLM nhìn thấy lỗi trong kết quả công cụ và thử lại), không phải cơ chế tự sửa chữa chuyên biệt.


</details>

<details>
<summary><b>Ma trận Khả năng</b></summary>
<br>

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
| Docker sandboxing | Implemented | Optional via `experimental.sandbox.type: "docker"` |
| Vector DB / RAG | Implemented | `experimental.rag.enabled: true`, SQLite + cosine similarity |
| Dry run / command preview | Implemented | `dry_run` param on bash/edit/write tools |
| Specialized agents | Implemented | critic, tester, documenter subagents |
| Auto-learn | Implemented | Post-session lesson extraction to `.opencode/learnings/` |
| Vulnerability scanner | Implemented | Auto-scan on edit/write for secrets, injections, unsafe patterns |
| DLP / AgentShield | Implemented | `experimental.dlp.enabled: true`, redacts secrets before LLM calls |
| Policy engine | Implemented | `experimental.policy.enabled: true`, conditional rules + custom policies |
| Confidence/decay | Implemented | Time-based scoring for RAG embeddings, exponential decay |
| Memory conflict resolution | Dead code | `rag/conflict.ts` is unit-tested but not invoked in production; treat as unimplemented |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

### AI Cục bộ (Desktop + Mobile)
| Năng lực | Trạng thái | Ghi chú |
|---------|-----------|---------|
| Local LLM (llama.cpp b8731) | Implemented | Vulkan GPU, auto-download runtime, `--fit` auto-VRAM |
| **Cấu hình thích ứng lúc runtime** | Implemented | `auto-config.ts`: n_gpu_layers / thread / batch / lượng tử hóa KV suy ra từ VRAM phát hiện, RAM, big.LITTLE, GPU backend, trạng thái nhiệt |
| **Benchmark harness** | Implemented | `bun run bench:llm` đo FTL, TPS, đỉnh RSS, thời gian tường mỗi mô hình; đầu ra JSONL |
| Flash Attention | Implemented | `--flash-attn on` on desktop and mobile |
| KV cache quantization | Implemented | q4_0 / q8_0 / f16 adaptive with standard llama.cpp quantization (~50% KV memory savings at q4_0) |
| Exact tokenizer (OpenAI) | Implemented | `js-tiktoken` cho gpt-*/o1/o3/o4; thực nghiệm 3,5 ký tự/token cho Llama/Qwen/Gemma |
| Speculative decoding | Implemented | VRAM Guard (desktop) / RAM Guard (mobile), draft model auto-detection |
| HuggingFace model search | Implemented | Phản hồi được xác thực bằng Zod, huy hiệu VRAM, trình quản lý tải xuống, 9 mô hình được tuyển chọn trước |
| **Tải GGUF tiếp tục được** | Implemented | Tiêu đề HTTP `Range` — gián đoạn 4G không khởi động lại chuyển 4 GB từ số 0 |
| Tool telemetry | Implemented | Per-session success/error rate logging with per-tool breakdown |
| Khởi động lại cầu dao | Implemented | `ensureCorrectModel` dừng sau 3 lần khởi động lại trong 120 s để tránh vòng lặp burn-cycle |

### Bảo mật và Quản trị
| Năng lực | Trạng thái | Ghi chú |
|---------|-----------|---------|
| **CSP nghiêm ngặt (desktop + mobile)** | Implemented | `connect-src` giới hạn ở loopback + HuggingFace + nhà cung cấp HTTPS; không `unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'` |
| **Tăng cường release Android** | Implemented | `isDebuggable=false`, `allowBackup=false`, `isShrinkResources=true`, `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` |
| **Tăng cường release desktop** | Implemented | Devtools không còn bị bật cưỡng bức — khôi phục mặc định của Tauri 2 (chỉ trong debug) để điểm tựa XSS không thể gắn vào `__TAURI__` ở môi trường sản xuất |
| **Xác thực đầu vào lệnh Tauri** | Implemented | Bảo vệ `download_model` / `load_llm_model` / `delete_model`: charset tên file, danh sách cho phép HTTPS đến `huggingface.co` / `hf.co` |
| **Chuỗi logging Rust** | Implemented | `log` + `android_logger` trên mobile; không `eprintln!` trong release → không rò rỉ path/URL vào logcat |
| **Bộ theo dõi kiểm toán bảo mật** | Implemented | [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — tất cả phát hiện được phân loại S1/S2/S3 với `path:line`, trạng thái và lý do hoãn khắc phục |

---


</details>

<details>
<summary><b>Future Roadmap</b></summary>
<br>

## Future Roadmap

Three major initiatives are planned on dedicated feature branches. Each is designed to be modular — they can be developed independently and merged when ready.

### 🤝 Collaborative Mode ()

**Goal**: Multiple developers interacting with agents simultaneously in real-time.

| Component | Description |
|-----------|-------------|
| Multi-user auth | JWT-based authentication on the Hono server, user sessions, role-based access |
| WebSocket broadcast | Real-time event streaming to all connected clients (agent activity, file changes, task status) |
| File concurrency | Lock-based or CRDT-based conflict resolution when multiple agents/users edit the same file |
| Presence UI | See who is connected, what they're working on, which agents are assigned to whom |
| Shared context | Cross-user session history, shared learnings, team-wide RAG index |

**Scale**: ~3000+ LOC, major architectural change. Requires refactoring the server for multi-tenant support.

### 📱 Mobile Version ()

**Goal**: Run OpenCode as a native mobile app on Android and iOS, with full agent capabilities.

| Component | Description |
|-----------|-------------|
| **Tauri 2.0 migration** | Leverage Tauri's mobile targets (Android/iOS) to package the existing SolidJS frontend as a native app |
| **Runtime adaptation** | Bundle the TypeScript agent core with Vite for WebView execution; delegate performance-critical tasks to Tauri's Rust layer |
| **isomorphic-git** | Replace system  calls with isomorphic-git for pure-JS git operations within the mobile sandbox |
| **File system access** | Use  for sandboxed file access + Document Picker integration |
| **Remote mode** | Connect to a desktop OpenCode instance over a secure tunnel (Tailscale/Cloudflare) for full capability without local execution |
| **Mobile-optimized UI** | Conversational interface that hides terminal complexity; swipe-based diff review; virtual keyboard optimizations |

**Platform comparison**:
- **Android** (via Termux or Tauri): Full Node.js support, broad file access, excellent performance
- **iOS** (via Tauri/a-Shell): Sandbox restrictions, limited native packages, but strong Apple Silicon performance for local models

**Scale**: ~2000+ LOC for the Tauri mobile shell, ~500 LOC for isomorphic-git adapter, ~300 LOC for remote mode.

### 🔗 AnythingLLM Fusion ()

**Goal**: Merge OpenCode's agentic coding capabilities with [AnythingLLM](https://github.com/mintplex-labs/anything-llm)'s document RAG and multi-user chat platform.

| Component | Description |
|-----------|-------------|
| **Context bridge** | Pipe AnythingLLM's indexed documents (PDFs, wikis, Confluence, etc.) into OpenCode's system prompt as additional context |
| **Agent skill plugin** | Expose OpenCode's core commands (, , edit, bash) as an AnythingLLM Agent Skill via HTTP API |
| **Unified vector store** | Merge OpenCode's SQLite RAG with AnythingLLM's vector DB backends (LanceDB, Pinecone, Chroma) for a single knowledge layer |
| **Multi-user workspace** | Leverage AnythingLLM's existing multi-user and workspace management for team environments |
| **Containerized deployment** | Docker Compose setup running both backends, with shared auth and a unified API gateway |

**Synergy**: AnythingLLM excels at document ingestion and RAG over non-code content. OpenCode excels at code manipulation, agentic tool use, and multi-provider LLM orchestration. Combined, they create a full-stack AI development platform that can reason over documentation AND write/execute code.

**Scale**: ~1500+ LOC for the bridge layer, ~500 LOC for the Agent Skill adapter, ~300 LOC for vector store unification.

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

OpenCode cũng có sẵn dưới dạng ứng dụng desktop. Tải trực tiếp từ [trang releases](https://github.com/Rwanbt/opencode/releases) hoặc [opencode.ai/download](https://opencode.ai/download).

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


</details>