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
## কেন এই ফর্ক?

> **সংক্ষেপে** — একমাত্র ওপেন-সোর্স কোডিং এজেন্ট যা DAG-ভিত্তিক অর্কেস্ট্রেটর, REST টাস্ক API, প্রতি-এজেন্ট MCP স্কোপিং, ৯-স্টেট সেশন FSM, বিল্ট-ইন ভালনারেবিলিটি স্ক্যানার *এবং* অন-ডিভাইস LLM ইনফারেন্সসহ ফার্স্ট-ক্লাস Android অ্যাপ সরবরাহ করে। অন্য কোনো CLI — মালিকানাধীন হোক বা ওপেন — এই সবকিছু একসাথে দেয় না।

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
| **9-state session FSM (persistent)**   | ✅ **unique**  |      ❌      |     ❌     |      ❌     |        basic        |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Built-in **vulnerability scanner**     | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **DLP / secret redaction** before LLM call | ✅         |   partial    |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Per-agent tool allow/deny**          |       ✅       |   partial    |     ❌     |      ❌     |        basic        |   ❌   |   ❌   |   ❌   |  partial  |    ❌    |     ❌     |   ❌   |     ❌     |
| Docker sandboxing (opt-in)             |       ✅       |      ❌      |     ✅     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Git auto-commits / rollback            |       ✅       |      ✅      |     ✅     |      ✅     |      ✅ (signed)     |   ✅   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     |   ✅   |     ✅     |

#### Intelligence, context, developer UX

| Capability                             | **This fork** | Claude Code | Codex CLI | Gemini CLI | opencode (upstream) | Aider | Goose | Cline | Roo Code | Cursor | Continue | Crush | Qwen Code |
| -------------------------------------- | :-----------: | :---------: | :-------: | :--------: | :-----------------: | :---: | :---: | :---: | :------: | :----: | :------: | :---: | :-------: |
| LSP integration (go-to-def, diagnostics) | ✅           |   partial    |  partial  |   partial   |          ✅          | partial | partial | ✅   |    ✅     |    ✅    |     ✅     | partial |  partial  |
| Plugin SDK (`@opencode/plugin`)        |       ✅       |   partial    |     ❌     |      ❌     |          ✅          |   ❌   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     |   ❌   |     ❌     |
| Prompt caching (cloud + local KV)      |       ✅       |      ✅      |     ✅     |      ✅     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     |   ✅   |     ✅     |
| **Hybrid RAG (BM25 + vector + decay)** | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   | partial | ❌      |  vector only |  vector only |  ❌   |     ❌     |
| **Memory conflict resolution**         | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Auto-learn** (lesson extraction)     | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Auto-compact (AI summarization)        |       ✅       |      ✅      |     ✅     |      ✅     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     | partial |     ✅     |
| Unified-diff edit engine               |       ✅       |      ✅      |     ✅     |   partial   |          ✅          |   ✅   | partial | partial |    ✅     | partial |  partial  | partial |  partial  |
| ACP (Agent Client Protocol) layer      |       ✅       |      ❌      |     ❌     |      ❌     |        basic        |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |

#### Platform reach & multimodal

| Capability                             | **This fork** | Claude Code | Codex CLI | Gemini CLI | opencode (upstream) | Aider | Goose | Cline | Roo Code | Cursor | Continue | Crush | Qwen Code |
| -------------------------------------- | :-----------: | :---------: | :-------: | :--------: | :-----------------: | :---: | :---: | :---: | :------: | :----: | :------: | :---: | :-------: |
| First-class **Android app**            | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| iOS (remote mode)                      |       ✅       |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Adaptive runtime (VRAM/CPU/thermal)    | ✅ **unique**  |      ❌      |     ❌     |      ❌     |      hardcoded      | hardcoded | hardcoded | hardcoded | hardcoded | n/a | hardcoded | hardcoded | hardcoded |
| **STT** (voice-to-text, built-in)      | ✅ (Parakeet)  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   | partial  |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **TTS** (text-to-speech + voice clone) | ✅ (Pocket/Kokoro) |  ❌       |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **OAuth deep-link callback**           |       ✅       |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **mDNS service discovery**             | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Upstream branch watcher** (`vcs.branch.behind`) | ✅ **unique** | ❌ |    ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Collaborative mode** (JWT + presence + file-lock) | ✅ | ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     | partial |     ❌     |   ❌   |     ❌     |
| **AnythingLLM bridge**                 | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **GDPR export/erasure route**          | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Price                                  |  free + BYOM  |  $20/mo sub |$20/mo sub |  1000/day free | free + BYOM    | free + BYOM | free + BYOM | free + BYOM | free + BYOM | $20/mo sub | free + BYOM | free + BYOM | free + BYOM |

---

## ফর্কের বৈশিষ্ট্যসমূহ

> এটি [anomalyco/opencode](https://github.com/anomalyco/opencode)-এর একটি ফর্ক যা [Rwanbt](https://github.com/Rwanbt) দ্বারা রক্ষণাবেক্ষণ করা হয়।
> আপস্ট্রিমের সাথে সিঙ্ক রাখা হয়। সর্বশেষ পরিবর্তনের জন্য [dev ব্রাঞ্চ](https://github.com/Rwanbt/opencode/tree/dev) দেখুন।

#### লোকাল-ফার্স্ট AI

OpenCode ভোক্তা হার্ডওয়্যারে (8 GB VRAM / 16 GB RAM) স্থানীয়ভাবে AI মডেল চালায়, 4B-7B মডেলের জন্য শূন্য ক্লাউড নির্ভরতা সহ।

**প্রম্পট অপটিমাইজেশন (94% হ্রাস)**
- লোকাল মডেলের জন্য ~1K টোকেন সিস্টেম প্রম্পট (ক্লাউডের ~16K এর বিপরীতে)
- স্কেলেটন টুল স্কিমা (মাল্টি-KB প্রোজের বিপরীতে 1-লাইন সিগনেচার)
- 7-টুল হোয়াইটলিস্ট (bash, read, edit, write, glob, grep, question)
- কোনো skills সেকশন নেই, ন্যূনতম এনভায়রনমেন্ট তথ্য

**ইনফারেন্স ইঞ্জিন (llama.cpp b8731)**
- Vulkan GPU ব্যাকএন্ড, প্রথম মডেল লোডে স্বয়ংক্রিয় ডাউনলোড
- **রানটাইম অভিযোজিত কনফিগারেশন** (`packages/opencode/src/local-llm-server/auto-config.ts`): `n_gpu_layers`, থ্রেড, batch/ubatch সাইজ, KV ক্যাশ কোয়ান্টাইজেশন এবং কনটেক্সট সাইজ সনাক্তকৃত VRAM, ফ্রি RAM, big.LITTLE CPU বিভাজন, GPU ব্যাকএন্ড (CUDA/ROCm/Vulkan/Metal/OpenCL) এবং থার্মাল স্টেট থেকে নির্ণীত হয়। পুরানো হার্ডকোড করা `--n-gpu-layers 99`-কে প্রতিস্থাপন করে — 4 GB Android এখন OOM-কিল হওয়ার পরিবর্তে CPU ফলব্যাকে চলে, ফ্ল্যাগশিপ ডেস্কটপ ডিফল্ট 512-এর পরিবর্তে টিউন করা batch পায়।
- `--flash-attn on` — মেমরি দক্ষতার জন্য Flash Attention
- `--cache-type-k/v` — Hadamard রোটেশন সহ KV ক্যাশ; VRAM মার্জিনের উপর নির্ভর করে অভিযোজিত স্তর (f16 / q8_0 / q4_0)
- `--fit on` — কেবল ফর্কে দ্বিতীয় VRAM সমন্বয় (`OPENCODE_LLAMA_ENABLE_FIT=1` এর মাধ্যমে অপ্ট-ইন)
- স্পেকুলেটিভ ডিকোডিং (`--model-draft`) VRAM Guard সহ (< 1.5 GB ফ্রি হলে স্বয়ংক্রিয় নিষ্ক্রিয়)
- একক স্লট (`-np 1`) মেমরি ফুটপ্রিন্ট কমাতে
- **বেঞ্চমার্ক হার্নেস** (`bun run bench:llm`): প্রতি মডেল, প্রতি রানে FTL / TPS / পিক RSS / ওয়াল টাইমের পুনরুৎপাদনযোগ্য পরিমাপ, CI আর্কাইভের জন্য JSONL আউটপুট

**স্পিচ-টু-টেক্সট (Parakeet TDT 0.6B v3 INT8)**
- ONNX Runtime-এর মাধ্যমে NVIDIA Parakeet — 5 সেকেন্ড অডিওর জন্য ~300ms (18x রিয়েল-টাইম)
- 25টি ইউরোপীয় ভাষা (ইংরেজি, ফরাসি, জার্মান, স্প্যানিশ ইত্যাদি)
- শূন্য VRAM: শুধুমাত্র CPU (~700 MB RAM)
- প্রথম মাইক্রোফোন প্রেসে মডেল স্বয়ংক্রিয় ডাউনলোড (~460 MB)
- রেকর্ডিংয়ের সময় ওয়েভফর্ম অ্যানিমেশন

**টেক্সট-টু-স্পিচ (Kyutai Pocket TTS)**
- Kyutai (প্যারিস) দ্বারা তৈরি ফরাসি-নেটিভ TTS, 100M প্যারামিটার
- 8টি বিল্ট-ইন ভয়েস: Alba, Fantine, Cosette, Eponine, Azelma, Marius, Javert, Jean
- Zero-shot ভয়েস ক্লোনিং: WAV আপলোড করুন বা মাইক্রোফোন থেকে রেকর্ড করুন
- শুধুমাত্র CPU, ~6x রিয়েল-টাইম, পোর্ট 14100-এ HTTP সার্ভার
- ফলব্যাক: Kokoro TTS ONNX ইঞ্জিন (54 ভয়েস, 9 ভাষা, CMUDict G2P)

**মডেল ম্যানেজমেন্ট**
- প্রতি মডেলে VRAM/RAM সামঞ্জস্যতা ব্যাজ সহ HuggingFace সার্চ
- UI থেকে GGUF মডেল ডাউনলোড, লোড, আনলোড, ডিলিট
- প্রি-কিউরেটেড ক্যাটালগ: Gemma 4 E4B, Qwen 3.5 (4B/2B/0.8B), Phi-4 Mini, Llama 3.2
- মডেল সাইজের উপর ভিত্তি করে ডাইনামিক আউটপুট টোকেন
- স্পেকুলেটিভ ডিকোডিংয়ের জন্য ড্রাফট মডেল অটো-ডিটেকশন (0.5B-0.8B)

**কনফিগারেশন**
- প্রিসেট: Fast / Quality / Eco / Long Context (এক-ক্লিক অপটিমাইজেশন)
- রঙ-কোডেড ব্যবহার বার সহ VRAM মনিটরিং উইজেট (সবুজ / হলুদ / লাল)
- KV cache type: auto / q8_0 / q4_0 / f16
- GPU offloading: auto / gpu-max / balanced
- Memory mapping: auto / on / off
- ওয়েব সার্চ টগল (প্রম্পট টুলবারে গ্লোব আইকন)

**এজেন্ট নির্ভরযোগ্যতা (লোকাল মডেল)**
- Pre-flight guards (কোড-লেভেল, 0 টোকেন): এডিটের আগে ফাইল-এক্সিস্ট চেক, old_string কনটেন্ট ভেরিফিকেশন, read-before-edit এনফোর্সমেন্ট, write-on-existing প্রিভেনশন
- Doom loop auto-break: 2x অভিন্ন টুল কল → এরর ইনজেক্ট করা হয় (কোড-লেভেল গার্ড, শুধু প্রম্পট নয়)
- টুল টেলিমেট্রি: প্রতি-টুল ব্রেকডাউন সহ প্রতি-সেশন সাকসেস/এরর রেট, স্বয়ংক্রিয়ভাবে লগ হয়
- লক্ষ্য: 4B মডেলে >85% টুল সাকসেস রেট

**ক্রস-প্ল্যাটফর্ম**: Windows (Vulkan), Linux, macOS, Android

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

### স্থানীয় AI (ডেস্কটপ + মোবাইল)
| ক্ষমতা | স্ট্যাটাস | নোট |
|--------|----------|-----|
| Local LLM (llama.cpp b8731) | Implemented | Vulkan GPU, auto-download runtime, `--fit` auto-VRAM |
| **রানটাইম অভিযোজিত কনফিগারেশন** | Implemented | `auto-config.ts`: n_gpu_layers / থ্রেড / batch / KV কোয়ান্টাইজেশন সনাক্তকৃত VRAM, RAM, big.LITTLE, GPU ব্যাকএন্ড, থার্মাল স্টেট থেকে নির্ণীত |
| **বেঞ্চমার্ক হার্নেস** | Implemented | `bun run bench:llm` প্রতি মডেলে FTL, TPS, পিক RSS, ওয়াল টাইম পরিমাপ করে; JSONL আউটপুট |
| Flash Attention | Implemented | `--flash-attn on` on desktop and mobile |
| KV cache quantization | Implemented | q4_0 / q8_0 / f16 adaptive with Hadamard rotation (72% memory savings) |
| Exact tokenizer (OpenAI) | Implemented | gpt-*/o1/o3/o4 এর জন্য `js-tiktoken`; Llama/Qwen/Gemma এর জন্য পরীক্ষামূলক 3.5 অক্ষর/টোকেন |
| Speculative decoding | Implemented | VRAM Guard (desktop) / RAM Guard (mobile), draft model auto-detection |
| HuggingFace model search | Implemented | Zod-যাচাইকৃত প্রতিক্রিয়া, VRAM ব্যাজ, ডাউনলোড ম্যানেজার, 9টি প্রাক-কিউরেটেড মডেল |
| **পুনরায় শুরু করা যায় এমন GGUF ডাউনলোড** | Implemented | HTTP `Range` হেডার — 4G বিঘ্ন 4 GB ট্রান্সফার শূন্য থেকে পুনরায় শুরু করে না |
| Tool telemetry | Implemented | Per-session success/error rate logging with per-tool breakdown |
| সার্কিট ব্রেকার পুনরায় শুরু | Implemented | `ensureCorrectModel` burn-cycle লুপ এড়াতে 120 সেকেন্ডে 3 বার পুনরায় শুরু করার পরে থামে |

### নিরাপত্তা ও শাসন
| ক্ষমতা | স্ট্যাটাস | নোট |
|--------|----------|-----|
| **কঠোর CSP (ডেস্কটপ + মোবাইল)** | Implemented | `connect-src` loopback + HuggingFace + HTTPS প্রদানকারীদের মধ্যে সীমাবদ্ধ; `unsafe-eval` নেই, `object-src 'none'`, `frame-ancestors 'none'` |
| **Android রিলিজ হার্ডেনিং** | Implemented | `isDebuggable=false`, `allowBackup=false`, `isShrinkResources=true`, `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` |
| **ডেস্কটপ রিলিজ হার্ডেনিং** | Implemented | Devtools আর জোরপূর্বক সক্ষম নয় — Tauri 2 ডিফল্ট (শুধু ডিবাগ মোডে) পুনরুদ্ধার করা হয়েছে যাতে একটি XSS ফুটহোল্ড প্রোডাকশনে `__TAURI__`-তে সংযুক্ত হতে না পারে |
| **Tauri কমান্ড ইনপুট যাচাইকরণ** | Implemented | `download_model` / `load_llm_model` / `delete_model` গার্ড: ফাইল নামের charset, `huggingface.co` / `hf.co` এর জন্য HTTPS অ্যালোলিস্ট |
| **Rust লগিং চেইন** | Implemented | মোবাইলে `log` + `android_logger`; রিলিজে `eprintln!` নেই → logcat-এ পাথ/URL ফাঁস নেই |
| **নিরাপত্তা অডিট ট্র্যাকার** | Implemented | [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — সমস্ত অনুসন্ধান S1/S2/S3 হিসাবে শ্রেণীবদ্ধ, `path:line`, স্ট্যাটাস এবং স্থগিত ফিক্সের যুক্তি সহ |

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

OpenCode ডেস্কটপ অ্যাপ্লিকেশন হিসেবেও উপলব্ধ। সরাসরি [রিলিজ পেজ](https://github.com/Rwanbt/opencode/releases) অথবা [opencode.ai/download](https://opencode.ai/download) থেকে ডাউনলোড করুন।

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
