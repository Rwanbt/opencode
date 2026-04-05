<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">เอเจนต์การเขียนโค้ดด้วย AI แบบโอเพนซอร์ส</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="สถานะการสร้าง" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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

## คุณสมบัติของ Fork

> นี่คือ fork ของ [anomalyco/opencode](https://github.com/anomalyco/opencode) ที่ดูแลโดย [Rwanbt](https://github.com/Rwanbt)
> ซิงค์กับ upstream อยู่เสมอ ดู [สาขา dev](https://github.com/Rwanbt/opencode/tree/dev) สำหรับการเปลี่ยนแปลงล่าสุด

#### งานเบื้องหลัง

มอบหมายงานให้ subagent ที่ทำงานแบบอะซิงโครนัส ตั้งค่า `mode: "background"` บนเครื่องมือ task แล้วจะคืนค่า `task_id` ทันทีในขณะที่เอเจนต์ทำงานในเบื้องหลัง Bus event (`TaskCreated`, `TaskCompleted`, `TaskFailed`) จะถูกเผยแพร่สำหรับการติดตามวงจรชีวิต

#### ทีมเอเจนต์

ประสานงานเอเจนต์หลายตัวแบบขนานโดยใช้เครื่องมือ `team` กำหนดงานย่อยพร้อม dependency edge; `computeWaves()` สร้าง DAG และรันงานที่เป็นอิสระพร้อมกัน (สูงสุด 5 เอเจนต์ขนาน) ควบคุมงบประมาณผ่าน `max_cost` (ดอลลาร์) และ `max_agents` บริบทจากงานที่เสร็จแล้วจะถูกส่งต่อไปยังงานที่ขึ้นอยู่โดยอัตโนมัติ

#### การแยก Git Worktree

งานเบื้องหลังแต่ละงานจะได้รับ git worktree ของตัวเองโดยอัตโนมัติ workspace จะเชื่อมโยงกับเซสชันในฐานข้อมูล หากงานไม่มีการเปลี่ยนแปลงไฟล์ worktree จะถูกล้างโดยอัตโนมัติ ซึ่งให้การแยกระดับ git โดยไม่ต้องใช้ container

#### API จัดการงาน

REST API เต็มรูปแบบสำหรับการจัดการวงจรชีวิตของงาน:

| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/task/` | แสดงรายการงาน (กรองตาม parent, status) |
| GET | `/task/:id` | ดูรายละเอียดงาน + status + ข้อมูล worktree |
| GET | `/task/:id/messages` | ดึงข้อความเซสชันของงาน |
| POST | `/task/:id/cancel` | ยกเลิกงานที่กำลังทำหรืออยู่ในคิว |
| POST | `/task/:id/resume` | ดำเนินต่องานที่เสร็จ/ล้มเหลว/ถูกบล็อก |
| POST | `/task/:id/followup` | ส่งข้อความติดตามไปยังงานที่ว่าง |
| POST | `/task/:id/promote` | เลื่อนงานเบื้องหลังเป็นงานหน้า |
| GET | `/task/:id/team` | มุมมองทีมรวม (ต้นทุน, diff ต่อสมาชิก) |

#### แดชบอร์ดงาน TUI

ปลั๊กอินแถบด้านข้างแสดงงานเบื้องหลังที่กำลังทำงานพร้อมไอคอนสถานะแบบเรียลไทม์:

| ไอคอน | สถานะ |
|-------|-------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

กล่องโต้ตอบพร้อมการกระทำ: เปิดเซสชันงาน, ยกเลิก, ดำเนินต่อ, ส่งข้อความติดตาม, ตรวจสอบสถานะ

#### การกำหนดขอบเขตเอเจนต์ MCP

รายการอนุญาต/ปฏิเสธต่อเอเจนต์สำหรับเซิร์ฟเวอร์ MCP กำหนดค่าใน `opencode.json` ภายใต้ฟิลด์ `mcp` ของแต่ละเอเจนต์ ฟังก์ชัน `toolsForAgent()` กรองเครื่องมือ MCP ที่ใช้ได้ตามขอบเขตของเอเจนต์ที่เรียก

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### วงจรชีวิตเซสชัน 9 สถานะ

เซสชันติดตาม 1 ใน 9 สถานะ ที่บันทึกลงฐานข้อมูล:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

สถานะถาวร (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) คงอยู่หลังการรีสตาร์ทฐานข้อมูล สถานะในหน่วยความจำ (`idle`, `busy`, `retry`) จะรีเซ็ตเมื่อรีสตาร์ท

#### เอเจนต์ประสานงาน

เอเจนต์ผู้ประสานงานแบบอ่านอย่างเดียว (สูงสุด 50 ขั้นตอน) มีสิทธิ์เข้าถึงเครื่องมือ `task` และ `team` แต่เครื่องมือแก้ไขทั้งหมดถูกปฏิเสธ มอบหมายการดำเนินการให้เอเจนต์ build/general และสังเคราะห์ผลลัพธ์

## สถาปัตยกรรมทางเทคนิค

### การรองรับหลายผู้ให้บริการ

21+ ผู้ให้บริการพร้อมใช้งาน: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway รวมถึง endpoint ที่เข้ากันได้กับ OpenAI ข้อมูลราคามาจาก [models.dev](https://models.dev)

### ระบบเอเจนต์

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

### การรวม LSP

รองรับ Language Server Protocol อย่างสมบูรณ์พร้อมการจัดทำดัชนีสัญลักษณ์ การวินิจฉัย และการรองรับหลายภาษา (TypeScript, Deno, Vue และขยายได้) เอเจนต์นำทางโค้ดผ่านสัญลักษณ์ LSP แทนการค้นหาข้อความ ทำให้สามารถ go-to-definition, find-references และตรวจจับข้อผิดพลาดประเภทแบบเรียลไทม์ได้อย่างแม่นยำ

### การรองรับ MCP

Model Context Protocol ทั้งไคลเอนต์และเซิร์ฟเวอร์ รองรับ stdio, HTTP/SSE และ StreamableHTTP transports ขั้นตอนการยืนยันตัวตน OAuth สำหรับเซิร์ฟเวอร์ระยะไกล ความสามารถด้าน Tool, prompt และ resource การกำหนดขอบเขตต่อเอเจนต์ผ่าน allow/deny lists

### สถาปัตยกรรมไคลเอนต์/เซิร์ฟเวอร์

REST API ที่ใช้ Hono พร้อม typed routes และการสร้าง OpenAPI spec รองรับ WebSocket สำหรับ PTY (pseudo-terminal) SSE สำหรับการสตรีมเหตุการณ์แบบเรียลไทม์ Basic auth, CORS, gzip compression TUI เป็นเพียงหนึ่ง frontend; เซิร์ฟเวอร์สามารถควบคุมจาก HTTP client ใดก็ได้, web UI หรือแอปมือถือ

### การจัดการบริบท

Auto-compact พร้อมการสรุปที่ขับเคลื่อนด้วย AI เมื่อการใช้โทเค็นเข้าใกล้ขีดจำกัดบริบทของโมเดล การตัดแต่งที่คำนึงถึงโทเค็นพร้อมเกณฑ์ที่กำหนดค่าได้ (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB) ผลลัพธ์ของ Skill tool ได้รับการปกป้องจากการตัดแต่ง

### เอนจินแก้ไข

Unified diff patching พร้อมการตรวจสอบ hunk ใช้ hunk ที่กำหนดเป้าหมายกับพื้นที่เฉพาะของไฟล์แทนการเขียนทับทั้งไฟล์ Multi-edit tool สำหรับการดำเนินการแบบกลุ่มข้ามไฟล์

### ระบบสิทธิ์

สิทธิ์ 3 สถานะ (`allow` / `deny` / `ask`) พร้อมการจับคู่รูปแบบ wildcard คำจำกัดความ arity ของคำสั่ง bash มากกว่า 100 รายการสำหรับการควบคุมแบบละเอียด การบังคับใช้ขอบเขตโปรเจกต์ป้องกันการเข้าถึงไฟล์นอก workspace

### การย้อนกลับด้วย Git

ระบบ snapshot ที่บันทึกสถานะไฟล์ก่อนการทำงานของเครื่องมือแต่ละครั้ง รองรับ `revert` และ `unrevert` พร้อมการคำนวณ diff สามารถย้อนกลับการเปลี่ยนแปลงต่อข้อความหรือต่อเซสชัน

### การติดตามค่าใช้จ่าย

ค่าใช้จ่ายต่อข้อความพร้อมรายละเอียดโทเค็นทั้งหมด (input, output, reasoning, cache read, cache write) ขีดจำกัดงบประมาณต่อทีม (`max_cost`) คำสั่ง `stats` พร้อมการรวมต่อโมเดลและต่อวัน ค่าใช้จ่ายเซสชันแบบเรียลไทม์แสดงใน TUI ข้อมูลราคาดึงจาก models.dev

### ระบบปลั๊กอิน

SDK เต็มรูปแบบ (`@opencode/plugin`) พร้อมสถาปัตยกรรม hook โหลดแบบไดนามิกจากแพ็กเกจ npm หรือระบบไฟล์ ปลั๊กอินในตัวสำหรับการยืนยันตัวตน Codex, GitHub Copilot, GitLab และ Poe

---

## ความเข้าใจผิดที่พบบ่อย

เพื่อป้องกันความสับสนจากบทสรุปที่สร้างโดย AI ของโปรเจกต์นี้:

- **TUI เป็น TypeScript** (SolidJS + @opentui สำหรับการเรนเดอร์ในเทอร์มินัล) ไม่ใช่ Rust
- **Tree-sitter** ใช้สำหรับการเน้นไวยากรณ์ของ TUI และการแยกวิเคราะห์คำสั่ง bash เท่านั้น ไม่ใช่สำหรับการวิเคราะห์โค้ดระดับเอเจนต์
- **ไม่มี Docker/E2B sandboxing** -- การแยกส่วนทำผ่าน git worktrees
- **ไม่มีฐานข้อมูลเวกเตอร์หรือระบบ RAG** -- บริบทจัดการผ่าน LSP symbol indexing + auto-compact
- **ไม่มี "watch mode" ที่เสนอการแก้ไขอัตโนมัติ** -- file watcher มีเพื่อวัตถุประสงค์ด้านโครงสร้างพื้นฐานเท่านั้น
- **การแก้ไขตัวเอง** ใช้ลูปเอเจนต์มาตรฐาน (LLM เห็นข้อผิดพลาดในผลลัพธ์ของเครื่องมือและลองใหม่) ไม่ใช่กลไกซ่อมอัตโนมัติเฉพาะทาง

## เมทริกซ์ความสามารถ

| ความสามารถ | Status | Notes |
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

### การติดตั้ง

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# ตัวจัดการแพ็กเกจ
npm i -g opencode-ai@latest        # หรือ bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS และ Linux (แนะนำ อัปเดตเสมอ)
brew install opencode              # macOS และ Linux (brew formula อย่างเป็นทางการ อัปเดตน้อยกว่า)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # ระบบปฏิบัติการใดก็ได้
nix run nixpkgs#opencode           # หรือ github:anomalyco/opencode สำหรับสาขาพัฒนาล่าสุด
```

> [!TIP]
> ลบเวอร์ชันที่เก่ากว่า 0.1.x ก่อนติดตั้ง

### แอปพลิเคชันเดสก์ท็อป (เบต้า)

OpenCode มีให้ใช้งานเป็นแอปพลิเคชันเดสก์ท็อป ดาวน์โหลดโดยตรงจาก [หน้ารุ่น](https://github.com/anomalyco/opencode/releases) หรือ [opencode.ai/download](https://opencode.ai/download)

| แพลตฟอร์ม             | ดาวน์โหลด                             |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, หรือ AppImage         |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### ไดเรกทอรีการติดตั้ง

สคริปต์การติดตั้งจะใช้ลำดับความสำคัญตามเส้นทางการติดตั้ง:

1. `$OPENCODE_INSTALL_DIR` - ไดเรกทอรีการติดตั้งที่กำหนดเอง
2. `$XDG_BIN_DIR` - เส้นทางที่สอดคล้องกับ XDG Base Directory Specification
3. `$HOME/bin` - ไดเรกทอรีไบนารีผู้ใช้มาตรฐาน (หากมีอยู่หรือสามารถสร้างได้)
4. `$HOME/.opencode/bin` - ค่าสำรองเริ่มต้น

```bash
# ตัวอย่าง
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### เอเจนต์

OpenCode รวมเอเจนต์ในตัวสองตัวที่คุณสามารถสลับได้ด้วยปุ่ม `Tab`

- **build** - เอเจนต์เริ่มต้น มีสิทธิ์เข้าถึงแบบเต็มสำหรับงานพัฒนา
- **plan** - เอเจนต์อ่านอย่างเดียวสำหรับการวิเคราะห์และการสำรวจโค้ด
  - ปฏิเสธการแก้ไขไฟล์โดยค่าเริ่มต้น
  - ขอสิทธิ์ก่อนเรียกใช้คำสั่ง bash
  - เหมาะสำหรับสำรวจโค้ดเบสที่ไม่คุ้นเคยหรือวางแผนการเปลี่ยนแปลง

นอกจากนี้ยังมีเอเจนต์ย่อย **general** สำหรับการค้นหาที่ซับซ้อนและงานหลายขั้นตอน
ใช้ภายในและสามารถเรียกใช้ได้โดยใช้ `@general` ในข้อความ

เรียนรู้เพิ่มเติมเกี่ยวกับ [เอเจนต์](https://opencode.ai/docs/agents)

### เอกสารประกอบ

สำหรับข้อมูลเพิ่มเติมเกี่ยวกับวิธีกำหนดค่า OpenCode [**ไปที่เอกสารของเรา**](https://opencode.ai/docs)

### การมีส่วนร่วม

หากคุณสนใจที่จะมีส่วนร่วมใน OpenCode โปรดอ่าน [เอกสารการมีส่วนร่วม](./CONTRIBUTING.md) ก่อนส่ง Pull Request

### การสร้างบน OpenCode

หากคุณทำงานในโปรเจกต์ที่เกี่ยวข้องกับ OpenCode และใช้ "opencode" เป็นส่วนหนึ่งของชื่อ เช่น "opencode-dashboard" หรือ "opencode-mobile" โปรดเพิ่มหมายเหตุใน README ของคุณเพื่อชี้แจงว่าไม่ได้สร้างโดยทีม OpenCode และไม่ได้เกี่ยวข้องกับเราในทางใด

### คำถามที่พบบ่อย

#### ต่างจาก Claude Code อย่างไร?

คล้ายกับ Claude Code มากในแง่ความสามารถ นี่คือความแตกต่างหลัก:

- โอเพนซอร์ส 100%
- ไม่ผูกมัดกับผู้ให้บริการใดๆ แม้ว่าเราจะแนะนำโมเดลที่เราจัดหาให้ผ่าน [OpenCode Zen](https://opencode.ai/zen) OpenCode สามารถใช้กับ Claude, OpenAI, Google หรือแม้กระทั่งโมเดลในเครื่องได้ เมื่อโมเดลพัฒนาช่องว่างระหว่างพวกมันจะปิดลงและราคาจะลดลง ดังนั้นการไม่ผูกมัดกับผู้ให้บริการจึงสำคัญ
- รองรับ LSP ใช้งานได้ทันทีหลังการติดตั้งโดยไม่ต้องปรับแต่งหรือเปลี่ยนแปลงฟังก์ชันการทำงานใด ๆ
- เน้นที่ TUI OpenCode สร้างโดยผู้ใช้ neovim และผู้สร้าง [terminal.shop](https://terminal.shop) เราจะผลักดันขีดจำกัดของสิ่งที่เป็นไปได้ในเทอร์มินัล
- สถาปัตยกรรมไคลเอนต์/เซิร์ฟเวอร์ ตัวอย่างเช่น อาจอนุญาตให้ OpenCode ทำงานบนคอมพิวเตอร์ของคุณ ในขณะที่คุณสามารถขับเคลื่อนจากระยะไกลผ่านแอปมือถือ หมายความว่า TUI frontend เป็นหนึ่งในไคลเอนต์ที่เป็นไปได้เท่านั้น

---

**ร่วมชุมชนของเรา** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
