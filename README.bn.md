<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">ওপেন সোর্স এআই কোডিং এজেন্ট।</p>
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

## ফর্কের বৈশিষ্ট্যসমূহ

> এটি [anomalyco/opencode](https://github.com/anomalyco/opencode)-এর একটি ফর্ক যা [Rwanbt](https://github.com/Rwanbt) দ্বারা রক্ষণাবেক্ষণ করা হয়।
> আপস্ট্রিমের সাথে সিঙ্ক রাখা হয়। সর্বশেষ পরিবর্তনের জন্য [dev ব্রাঞ্চ](https://github.com/Rwanbt/opencode/tree/dev) দেখুন।

#### ব্যাকগ্রাউন্ড টাস্ক

অ্যাসিঙ্ক্রোনাসভাবে চলা সাবএজেন্টদের কাজ অর্পণ করুন। Task টুলে `mode: "background"` সেট করুন এবং এটি তৎক্ষণাৎ একটি `task_id` ফেরত দেবে যখন এজেন্ট ব্যাকগ্রাউন্ডে কাজ করে। লাইফসাইকেল ট্র্যাকিংয়ের জন্য bus event (`TaskCreated`, `TaskCompleted`, `TaskFailed`) প্রকাশিত হয়।

#### এজেন্ট টিম

`team` টুল ব্যবহার করে একাধিক এজেন্টকে সমান্তরালে পরিচালনা করুন। ডিপেন্ডেন্সি এজ সহ সাব-টাস্ক নির্ধারণ করুন; `computeWaves()` একটি DAG তৈরি করে এবং স্বতন্ত্র টাস্কগুলো একযোগে চালায় (সর্বোচ্চ ৫টি সমান্তরাল এজেন্ট)। `max_cost` (ডলার) এবং `max_agents` এর মাধ্যমে বাজেট নিয়ন্ত্রণ। সম্পন্ন টাস্কের কনটেক্সট স্বয়ংক্রিয়ভাবে নির্ভরশীল টাস্কে পাঠানো হয়।

#### Git Worktree আইসোলেশন

প্রতিটি ব্যাকগ্রাউন্ড টাস্ক স্বয়ংক্রিয়ভাবে নিজস্ব git worktree পায়। ওয়ার্কস্পেস ডাটাবেসে সেশনের সাথে সংযুক্ত থাকে। যদি কোনো টাস্ক ফাইল পরিবর্তন না করে, worktree স্বয়ংক্রিয়ভাবে পরিষ্কার হয়ে যায়। এটি কন্টেইনার ছাড়াই git-স্তরের আইসোলেশন প্রদান করে।

#### টাস্ক ম্যানেজমেন্ট API

টাস্ক লাইফসাইকেল পরিচালনার জন্য সম্পূর্ণ REST API:

| Method | Path | বিবরণ |
|--------|------|-------|
| GET | `/task/` | টাস্কের তালিকা (parent, status অনুযায়ী ফিল্টার) |
| GET | `/task/:id` | টাস্কের বিবরণ + status + worktree তথ্য |
| GET | `/task/:id/messages` | টাস্ক সেশনের বার্তা পুনরুদ্ধার |
| POST | `/task/:id/cancel` | চলমান বা সারিবদ্ধ টাস্ক বাতিল |
| POST | `/task/:id/resume` | সম্পন্ন/ব্যর্থ/অবরুদ্ধ টাস্ক পুনরায় শুরু |
| POST | `/task/:id/followup` | নিষ্ক্রিয় টাস্কে ফলো-আপ বার্তা পাঠান |
| POST | `/task/:id/promote` | ব্যাকগ্রাউন্ড টাস্ককে ফোরগ্রাউন্ডে প্রমোট করুন |
| GET | `/task/:id/team` | সমষ্টিগত টিম ভিউ (খরচ, সদস্য প্রতি diff) |

#### TUI টাস্ক ড্যাশবোর্ড

রিয়েল-টাইম স্ট্যাটাস আইকন সহ সক্রিয় ব্যাকগ্রাউন্ড টাস্ক দেখানো সাইডবার প্লাগইন:

| আইকন | স্ট্যাটাস |
|-------|----------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

অ্যাকশন সহ ডায়ালগ: টাস্ক সেশন খুলুন, বাতিল করুন, পুনরায় শুরু করুন, ফলো-আপ পাঠান, স্ট্যাটাস পরীক্ষা করুন।

#### MCP এজেন্ট স্কোপিং

MCP সার্ভারের জন্য প্রতি এজেন্টে অনুমতি/নিষেধ তালিকা। `opencode.json`-এ প্রতিটি এজেন্টের `mcp` ফিল্ডের অধীনে কনফিগার করুন। `toolsForAgent()` ফাংশন কলিং এজেন্টের স্কোপের উপর ভিত্তি করে উপলব্ধ MCP টুল ফিল্টার করে।

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### ৯-স্টেট সেশন লাইফসাইকেল

সেশনগুলো ৯টি স্টেটের একটি ট্র্যাক করে, যা ডাটাবেসে সংরক্ষিত থাকে:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

স্থায়ী স্টেট (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) ডাটাবেস রিস্টার্টে টিকে থাকে। মেমরি-মধ্যস্থ স্টেট (`idle`, `busy`, `retry`) রিস্টার্টে রিসেট হয়।

#### অর্কেস্ট্রেটর এজেন্ট

রিড-অনলি কোঅর্ডিনেটর এজেন্ট (সর্বোচ্চ ৫০ ধাপ)। `task` এবং `team` টুলে অ্যাক্সেস আছে কিন্তু সমস্ত এডিট টুল নিষিদ্ধ। বাস্তবায়ন build/general এজেন্টদের কাছে অর্পণ করে এবং ফলাফল সংশ্লেষণ করে।

## প্রযুক্তিগত স্থাপত্য

### মাল্টি-প্রোভাইডার সাপোর্ট

21+ প্রোভাইডার তৈরি অবস্থায় পাওয়া যায়: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, এবং যেকোনো OpenAI-সামঞ্জস্যপূর্ণ endpoint। মূল্য তথ্য [models.dev](https://models.dev) থেকে সংগৃহীত।

### এজেন্ট সিস্টেম

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

### LSP ইন্টিগ্রেশন

সিম্বল ইনডেক্সিং, ডায়াগনস্টিকস এবং মাল্টি-ল্যাঙ্গুয়েজ সাপোর্ট (TypeScript, Deno, Vue, এবং এক্সটেনসিবল) সহ সম্পূর্ণ Language Server Protocol সাপোর্ট। এজেন্ট টেক্সট সার্চের পরিবর্তে LSP সিম্বলের মাধ্যমে কোড নেভিগেট করে, যা সুনির্দিষ্ট go-to-definition, find-references এবং রিয়েল-টাইম টাইপ এরর ডিটেকশন সক্ষম করে।

### MCP সাপোর্ট

Model Context Protocol ক্লায়েন্ট এবং সার্ভার। stdio, HTTP/SSE, এবং StreamableHTTP ট্রান্সপোর্ট সাপোর্ট করে। রিমোট সার্ভারের জন্য OAuth অথেন্টিকেশন ফ্লো। Tool, prompt, এবং resource ক্যাপাবিলিটি। Allow/deny লিস্টের মাধ্যমে প্রতি-এজেন্ট স্কোপিং।

### ক্লায়েন্ট/সার্ভার আর্কিটেকচার

Typed routes এবং OpenAPI spec জেনারেশন সহ Hono-ভিত্তিক REST API। PTY (pseudo-terminal) এর জন্য WebSocket সাপোর্ট। রিয়েল-টাইম ইভেন্ট স্ট্রিমিংয়ের জন্য SSE। Basic auth, CORS, gzip কম্প্রেশন। TUI হলো একটি frontend; সার্ভারটি যেকোনো HTTP ক্লায়েন্ট, web UI, বা মোবাইল অ্যাপ থেকে পরিচালনা করা যায়।

### কনটেক্সট ম্যানেজমেন্ট

টোকেন ব্যবহার মডেলের কনটেক্সট সীমার কাছে পৌঁছালে AI-চালিত সারাংশ সহ Auto-compact। কনফিগারযোগ্য থ্রেশহোল্ড সহ টোকেন-সচেতন প্রুনিং (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB)। Skill tool আউটপুট প্রুনিং থেকে সুরক্ষিত।

### এডিট ইঞ্জিন

Hunk ভেরিফিকেশন সহ Unified diff প্যাচিং। সম্পূর্ণ ফাইল ওভাররাইটের পরিবর্তে নির্দিষ্ট ফাইল অঞ্চলে টার্গেটেড hunk প্রয়োগ করে। ফাইল জুড়ে ব্যাচ অপারেশনের জন্য Multi-edit tool।

### পারমিশন সিস্টেম

Wildcard প্যাটার্ন ম্যাচিং সহ ৩-স্টেট পারমিশন (`allow` / `deny` / `ask`)। সূক্ষ্ম নিয়ন্ত্রণের জন্য 100+ bash কমান্ড arity সংজ্ঞা। প্রজেক্ট বাউন্ডারি এনফোর্সমেন্ট workspace-এর বাইরে ফাইল অ্যাক্সেস প্রতিরোধ করে।

### Git-ভিত্তিক রোলব্যাক

প্রতিটি টুল এক্সিকিউশনের আগে ফাইলের অবস্থা রেকর্ড করা Snapshot সিস্টেম। Diff গণনা সহ `revert` এবং `unrevert` সাপোর্ট করে। প্রতি-মেসেজ বা প্রতি-সেশন পরিবর্তন রোলব্যাক করা যায়।

### খরচ ট্র্যাকিং

সম্পূর্ণ টোকেন ব্রেকডাউন সহ প্রতি-মেসেজ খরচ (input, output, reasoning, cache read, cache write)। প্রতি-টিম বাজেট সীমা (`max_cost`)। প্রতি-মডেল এবং প্রতি-দিন অ্যাগ্রিগেশন সহ `stats` কমান্ড। TUI-তে রিয়েল-টাইম সেশন খরচ প্রদর্শন। মূল্য তথ্য models.dev থেকে আনা হয়।

### প্লাগইন সিস্টেম

Hook আর্কিটেকচার সহ সম্পূর্ণ SDK (`@opencode/plugin`)। npm প্যাকেজ বা ফাইলসিস্টেম থেকে ডাইনামিক লোডিং। Codex, GitHub Copilot, GitLab, এবং Poe অথেন্টিকেশনের জন্য বিল্ট-ইন প্লাগইন।

---

## সাধারণ ভুল ধারণা

এই প্রজেক্টের AI-জেনারেটেড সারাংশ থেকে বিভ্রান্তি রোধ করতে:

- **TUI হলো TypeScript** (টার্মিনাল রেন্ডারিংয়ের জন্য SolidJS + @opentui), Rust নয়।
- **Tree-sitter** শুধুমাত্র TUI সিনট্যাক্স হাইলাইটিং এবং bash কমান্ড পার্সিংয়ের জন্য ব্যবহৃত হয়, এজেন্ট-লেভেল কোড বিশ্লেষণের জন্য নয়।
- **কোনো Docker/E2B sandboxing নেই** -- আইসোলেশন git worktrees দ্বারা সরবরাহ করা হয়।
- **কোনো ভেক্টর ডাটাবেস বা RAG সিস্টেম নেই** -- কনটেক্সট LSP symbol indexing + auto-compact দ্বারা পরিচালিত হয়।
- **স্বয়ংক্রিয় ফিক্স প্রস্তাব করে এমন কোনো "watch mode" নেই** -- file watcher শুধুমাত্র ইনফ্রাস্ট্রাকচার উদ্দেশ্যে বিদ্যমান।
- **সেলফ-কারেকশন** স্ট্যান্ডার্ড এজেন্ট লুপ ব্যবহার করে (LLM টুল ফলাফলে ত্রুটি দেখে এবং পুনরায় চেষ্টা করে), কোনো বিশেষায়িত অটো-রিপেয়ার মেকানিজম নয়।

## সক্ষমতা ম্যাট্রিক্স

| সক্ষমতা | Status | Notes |
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

### ইনস্টলেশন (Installation)

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
> ইনস্টল করার আগে ০.১.x এর চেয়ে পুরোনো ভার্সনগুলো মুছে ফেলুন।

### ডেস্কটপ অ্যাপ (BETA)

OpenCode ডেস্কটপ অ্যাপ্লিকেশন হিসেবেও উপলব্ধ। সরাসরি [রিলিজ পেজ](https://github.com/anomalyco/opencode/releases) অথবা [opencode.ai/download](https://opencode.ai/download) থেকে ডাউনলোড করুন।

| প্ল্যাটফর্ম           | ডাউনলোড                               |
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

#### ইনস্টলেশন ডিরেক্টরি (Installation Directory)

ইনস্টল স্ক্রিপ্টটি ইনস্টলেশন পাতের জন্য নিম্নলিখিত অগ্রাধিকার ক্রম মেনে চলে:

1. `$OPENCODE_INSTALL_DIR` - কাস্টম ইনস্টলেশন ডিরেক্টরি
2. `$XDG_BIN_DIR` - XDG বেস ডিরেক্টরি স্পেসিফিকেশন সমর্থিত পাথ
3. `$HOME/bin` - সাধারণ ব্যবহারকারী বাইনারি ডিরেক্টরি (যদি বিদ্যমান থাকে বা তৈরি করা যায়)
4. `$HOME/.opencode/bin` - ডিফল্ট ফলব্যাক

```bash
# উদাহরণ
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### এজেন্টস (Agents)

OpenCode এ দুটি বিল্ট-ইন এজেন্ট রয়েছে যা আপনি `Tab` কি(key) দিয়ে পরিবর্তন করতে পারবেন।

- **build** - ডিফল্ট, ডেভেলপমেন্টের কাজের জন্য সম্পূর্ণ অ্যাক্সেসযুক্ত এজেন্ট
- **plan** - বিশ্লেষণ এবং কোড এক্সপ্লোরেশনের জন্য রিড-ওনলি এজেন্ট
  - ডিফল্টভাবে ফাইল এডিট করতে দেয় না
  - ব্যাশ কমান্ড চালানোর আগে অনুমতি চায়
  - অপরিচিত কোডবেস এক্সপ্লোর করা বা পরিবর্তনের পরিকল্পনা করার জন্য আদর্শ

এছাড়াও জটিল অনুসন্ধান এবং মাল্টিস্টেপ টাস্কের জন্য একটি **general** সাবএজেন্ট অন্তর্ভুক্ত রয়েছে।
এটি অভ্যন্তরীণভাবে ব্যবহৃত হয় এবং মেসেজে `@general` লিখে ব্যবহার করা যেতে পারে।

এজেন্টদের সম্পর্কে আরও জানুন: [docs](https://opencode.ai/docs/agents)।

### ডকুমেন্টেশন (Documentation)

কিভাবে OpenCode কনফিগার করবেন সে সম্পর্কে আরও তথ্যের জন্য, [**আমাদের ডকস দেখুন**](https://opencode.ai/docs)।

### অবদান (Contributing)

আপনি যদি OpenCode এ অবদান রাখতে চান, অনুগ্রহ করে একটি পুল রিকোয়েস্ট সাবমিট করার আগে আমাদের [কন্ট্রিবিউটিং ডকস](./CONTRIBUTING.md) পড়ে নিন।

### OpenCode এর উপর বিল্ডিং (Building on OpenCode)

আপনি যদি এমন প্রজেক্টে কাজ করেন যা OpenCode এর সাথে সম্পর্কিত এবং প্রজেক্টের নামের অংশ হিসেবে "opencode" ব্যবহার করেন, উদাহরণস্বরূপ "opencode-dashboard" বা "opencode-mobile", তবে দয়া করে আপনার README তে একটি নোট যোগ করে স্পষ্ট করুন যে এই প্রজেক্টটি OpenCode দল দ্বারা তৈরি হয়নি এবং আমাদের সাথে এর কোনো সরাসরি সম্পর্ক নেই।

### সচরাচর জিজ্ঞাসিত প্রশ্নাবলী (FAQ)

#### এটি ক্লড কোড (Claude Code) থেকে কীভাবে আলাদা?

ক্যাপাবিলিটির দিক থেকে এটি ক্লড কোডের (Claude Code) মতই। এখানে মূল পার্থক্যগুলো দেওয়া হলো:

- ১০০% ওপেন সোর্স
- কোনো প্রোভাইডারের সাথে আবদ্ধ নয়। যদিও আমরা [OpenCode Zen](https://opencode.ai/zen) এর মাধ্যমে মডেলসমূহ ব্যবহারের পরামর্শ দিই, OpenCode ক্লড (Claude), ওপেনএআই (OpenAI), গুগল (Google), অথবা লোকাল মডেলগুলোর সাথেও ব্যবহার করা যেতে পারে। যেমন যেমন মডেলগুলো উন্নত হবে, তাদের মধ্যকার পার্থক্য কমে আসবে এবং দামও কমবে, তাই প্রোভাইডার-অজ্ঞাস্টিক হওয়া খুবই গুরুত্বপূর্ণ।
- আউট-অফ-দ্য-বক্স LSP সাপোর্ট
- TUI এর উপর ফোকাস। OpenCode নিওভিম (neovim) ব্যবহারকারী এবং [terminal.shop](https://terminal.shop) এর নির্মাতাদের দ্বারা তৈরি; আমরা টার্মিনালে কী কী সম্ভব তার সীমাবদ্ধতা ছাড়িয়ে যাওয়ার চেষ্টা করছি।
- ক্লায়েন্ট/সার্ভার আর্কিটেকচার। এটি যেমন OpenCode কে আপনার কম্পিউটারে চালানোর সুযোগ দেয়, তেমনি আপনি মোবাইল অ্যাপ থেকে রিমোটলি এটি নিয়ন্ত্রণ করতে পারবেন, অর্থাৎ TUI ফ্রন্টএন্ড কেবল সম্ভাব্য ক্লায়েন্টগুলোর মধ্যে একটি।

---

**আমাদের কমিউনিটিতে যুক্ত হোন** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
