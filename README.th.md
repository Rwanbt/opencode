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

#### AI แบบ Local-First

OpenCode รันโมเดล AI แบบโลคัลบนฮาร์ดแวร์ผู้บริโภค (8 GB VRAM / 16 GB RAM) โดยไม่ต้องพึ่งพาระบบคลาวด์สำหรับโมเดล 4B-7B

**การเพิ่มประสิทธิภาพ Prompt (ลด 94%)**
- ~1K token system prompt สำหรับโมเดลโลคัล (เทียบกับ ~16K สำหรับคลาวด์)
- Skeleton tool schemas (ลายเซ็น 1 บรรทัด เทียบกับข้อความหลาย KB)
- 7-tool whitelist (bash, read, edit, write, glob, grep, question)
- ไม่มีส่วน skills, ข้อมูลสภาพแวดล้อมน้อยที่สุด

**เอนจินอนุมาน (llama.cpp b8731)**
- Vulkan GPU backend ดาวน์โหลดอัตโนมัติเมื่อโหลดโมเดลครั้งแรก
- **การกำหนดค่าแบบปรับตัวที่ runtime** (`packages/opencode/src/local-llm-server/auto-config.ts`): `n_gpu_layers`, threads, ขนาด batch/ubatch, การคำนวณ KV cache quantization และขนาดบริบท อนุมานจาก VRAM ที่ตรวจพบ, RAM ว่าง, การแบ่ง CPU big.LITTLE, GPU backend (CUDA/ROCm/Vulkan/Metal/OpenCL) และสถานะความร้อน ทดแทน `--n-gpu-layers 99` ที่ hardcode เดิม — Android 4 GB ตอนนี้ทำงานใน CPU fallback แทนที่จะถูก OOM-killed, desktop ระดับเรือธงได้รับ batch ที่ปรับแต่งแล้วแทนค่าเริ่มต้น 512
- `--flash-attn on` — Flash Attention เพื่อประสิทธิภาพหน่วยความจำ
- `--cache-type-k/v` — KV cache พร้อม Hadamard rotation; ระดับปรับตัว (f16 / q8_0 / q4_0) ตาม margin VRAM
- `--fit on` — การปรับ VRAM รองเฉพาะ fork (เลือกใช้ผ่าน `OPENCODE_LLAMA_ENABLE_FIT=1`)
- Speculative decoding (`--model-draft`) พร้อม VRAM Guard (ปิดอัตโนมัติหาก < 1.5 GB ว่าง)
- Single slot (`-np 1`) เพื่อลดการใช้หน่วยความจำ
- **Benchmark harness** (`bun run bench:llm`): การวัด FTL / TPS / จุดสูงสุด RSS / เวลาทั้งหมดที่ทำซ้ำได้ต่อโมเดลต่อครั้ง, เอาต์พุต JSONL สำหรับการเก็บถาวร CI

**เสียงเป็นข้อความ (Parakeet TDT 0.6B v3 INT8)**
- NVIDIA Parakeet ผ่าน ONNX Runtime — ~300ms สำหรับเสียง 5 วินาที (18x real-time)
- 25 ภาษายุโรป (อังกฤษ ฝรั่งเศส เยอรมัน สเปน ฯลฯ)
- VRAM เป็นศูนย์: CPU เท่านั้น (~700 MB RAM)
- ดาวน์โหลดโมเดลอัตโนมัติ (~460 MB) เมื่อกดไมโครโฟนครั้งแรก
- แอนิเมชันรูปคลื่นขณะบันทึก

**ข้อความเป็นเสียง (Kyutai Pocket TTS)**
- TTS ภาษาฝรั่งเศสสร้างโดย Kyutai (ปารีส) พารามิเตอร์ 100M
- 8 เสียงในตัว: Alba, Fantine, Cosette, Eponine, Azelma, Marius, Javert, Jean
- Zero-shot voice cloning: อัปโหลด WAV หรือบันทึกจากไมโครโฟน
- CPU เท่านั้น, ~6x real-time, HTTP server บนพอร์ต 14100
- Fallback: Kokoro TTS ONNX engine (54 เสียง, 9 ภาษา, CMUDict G2P)

**การจัดการโมเดล**
- ค้นหา HuggingFace พร้อมป้ายความเข้ากันได้ VRAM/RAM ต่อโมเดล
- ดาวน์โหลด, โหลด, ยกเลิกการโหลด, ลบโมเดล GGUF จาก UI
- แค็ตตาล็อกที่คัดสรร: Gemma 4 E4B, Qwen 3.5 (4B/2B/0.8B), Phi-4 Mini, Llama 3.2
- Output token แบบไดนามิกตามขนาดโมเดล
- ตรวจจับ draft model อัตโนมัติ (0.5B-0.8B) สำหรับ speculative decoding

**การตั้งค่า**
- พรีเซ็ต: Fast / Quality / Eco / Long Context (เพิ่มประสิทธิภาพด้วยคลิกเดียว)
- วิดเจ็ตตรวจสอบ VRAM พร้อมแถบการใช้งานรหัสสี (เขียว / เหลือง / แดง)
- KV cache type: auto / q8_0 / q4_0 / f16
- GPU offloading: auto / gpu-max / balanced
- Memory mapping: auto / on / off
- ค้นหาเว็บ (ไอคอนลูกโลกในแถบเครื่องมือ prompt)

**ความน่าเชื่อถือของเอเจนต์ (โมเดลโลคัล)**
- Pre-flight guards (ระดับโค้ด, 0 token): ตรวจสอบไฟล์มีอยู่ก่อนแก้ไข, ตรวจสอบเนื้อหา old_string, บังคับอ่านก่อนแก้ไข, ป้องกันเขียนทับไฟล์ที่มีอยู่
- Doom loop auto-break: เรียกเครื่องมือซ้ำ 2 ครั้ง → ฉีดข้อผิดพลาด (guard ระดับโค้ด ไม่ใช่แค่ prompt)
- Tool telemetry: อัตราสำเร็จ/ข้อผิดพลาดต่อเซสชันพร้อมรายละเอียดต่อเครื่องมือ บันทึกอัตโนมัติ
- เป้าหมาย: >85% อัตราความสำเร็จของเครื่องมือบนโมเดล 4B

**ข้ามแพลตฟอร์ม**: Windows (Vulkan), Linux, macOS, Android

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
| **critic** | subagent | read-only + bash + LSP | Code review: bugs, security, performance |
| **tester** | subagent | full (no todowrite) | Write and run tests, verify coverage |
| **documenter** | subagent | full (no todowrite) | JSDoc, README, inline documentation |
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

### AI ในเครื่อง (Desktop + Mobile)
| ความสามารถ | สถานะ | หมายเหตุ |
|-----------|-------|---------|
| Local LLM (llama.cpp b8731) | Implemented | Vulkan GPU, auto-download runtime, `--fit` auto-VRAM |
| **การกำหนดค่าแบบปรับตัวที่ runtime** | Implemented | `auto-config.ts`: n_gpu_layers / threads / batch / KV quantization อนุมานจาก VRAM ที่ตรวจพบ, RAM, big.LITTLE, GPU backend, สถานะความร้อน |
| **Benchmark harness** | Implemented | `bun run bench:llm` วัด FTL, TPS, จุดสูงสุด RSS, เวลาทั้งหมดต่อโมเดล; เอาต์พุต JSONL |
| Flash Attention | Implemented | `--flash-attn on` on desktop and mobile |
| KV cache quantization | Implemented | q4_0 / q8_0 / f16 adaptive with Hadamard rotation (72% memory savings) |
| Exact tokenizer (OpenAI) | Implemented | `js-tiktoken` สำหรับ gpt-*/o1/o3/o4; เชิงประจักษ์ 3.5 ตัวอักษร/token สำหรับ Llama/Qwen/Gemma |
| Speculative decoding | Implemented | VRAM Guard (desktop) / RAM Guard (mobile), draft model auto-detection |
| HuggingFace model search | Implemented | การตอบกลับที่ตรวจสอบด้วย Zod, ป้าย VRAM, ตัวจัดการดาวน์โหลด, 9 โมเดลที่คัดสรรล่วงหน้า |
| **การดาวน์โหลด GGUF ที่กลับมาทำต่อได้** | Implemented | HTTP `Range` header — การขาดการเชื่อมต่อ 4G ไม่เริ่มต้นการถ่ายโอน 4 GB ใหม่จากศูนย์ |
| Tool telemetry | Implemented | Per-session success/error rate logging with per-tool breakdown |
| Circuit breaker restart | Implemented | `ensureCorrectModel` ยกเลิกหลัง 3 ครั้งใน 120 วินาทีเพื่อหลีกเลี่ยงลูป burn-cycle |

### ความปลอดภัยและการกำกับดูแล
| ความสามารถ | สถานะ | หมายเหตุ |
|-----------|-------|---------|
| **CSP เข้มงวด (desktop + mobile)** | Implemented | `connect-src` จำกัดเฉพาะ loopback + HuggingFace + ผู้ให้บริการ HTTPS; ไม่มี `unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'` |
| **การเสริมความแข็งแกร่ง release Android** | Implemented | `isDebuggable=false`, `allowBackup=false`, `isShrinkResources=true`, `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` |
| **การเสริมความแข็งแกร่ง release เดสก์ท็อป** | Implemented | Devtools ไม่ถูกเปิดใช้งานโดยบังคับอีกต่อไป — คืนค่าดีฟอลต์ของ Tauri 2 (เฉพาะในโหมด debug) เพื่อให้จุดเริ่มของ XSS ไม่สามารถเกาะเข้ากับ `__TAURI__` ในโปรดักชันได้ |
| **การตรวจสอบอินพุตคำสั่ง Tauri** | Implemented | การ์ด `download_model` / `load_llm_model` / `delete_model`: charset ชื่อไฟล์, HTTPS allowlist สำหรับ `huggingface.co` / `hf.co` |
| **Rust logging chain** | Implemented | `log` + `android_logger` บนมือถือ; ไม่มี `eprintln!` ใน release → ไม่มีการรั่วไหล path/URL ไปยัง logcat |
| **ตัวติดตามการตรวจสอบความปลอดภัย** | Implemented | [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — การค้นพบทั้งหมดจัดประเภทเป็น S1/S2/S3 พร้อม `path:line`, สถานะ และเหตุผลของการแก้ไขที่เลื่อน |

---

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
