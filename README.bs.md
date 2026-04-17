<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">OpenCode je open source AI agent za programiranje.</p>
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

## Funkcionalnosti forka

> Ovo je fork projekta [anomalyco/opencode](https://github.com/anomalyco/opencode) koji održava [Rwanbt](https://github.com/Rwanbt).
> Sinhronizovano sa upstream-om. Pogledajte [dev granu](https://github.com/Rwanbt/opencode/tree/dev) za najnovije promjene.

#### Lokalna AI

OpenCode pokrece AI modele lokalno na potrosackom hardveru (8 GB VRAM / 16 GB RAM), sa nula zavisnosti od oblaka za 4B-7B modele.

**Optimizacija promptova (94% smanjenje)**
- ~1K token system prompt za lokalne modele (naspram ~16K za oblak)
- Skeletni alat-sheme (1-linijske signature naspram multi-KB proze)
- 7-alatna bijela lista (bash, read, edit, write, glob, grep, question)
- Bez sekcije skills, minimalne informacije o okruzenju

**Motor za inferenciju (llama.cpp b8731)**
- Vulkan GPU backend, automatski preuzet pri prvom ucitavanju modela
- **Adaptivna runtime konfiguracija** (`packages/opencode/src/local-llm-server/auto-config.ts`): `n_gpu_layers`, niti, velicina batch/ubatch, kvantizacija KV cache-a i velicina konteksta izvedeni iz detektovanog VRAM-a, slobodnog RAM-a, big.LITTLE CPU podjele, GPU backend-a (CUDA/ROCm/Vulkan/Metal/OpenCL) i termalnog stanja. Zamjenjuje stari hardkodirani `--n-gpu-layers 99` — 4 GB Android sada radi u CPU fallback-u umjesto da bude ubijen OOM-om, vrhunski desktopi dobijaju podeseni batch umjesto podrazumijevanog 512.
- `--flash-attn on` — Flash Attention za efikasnost memorije
- `--cache-type-k/v` — KV cache sa Hadamard rotacijom; adaptivni nivo (f16 / q8_0 / q4_0) na osnovu VRAM rezerve
- `--fit on` — sekundarno VRAM podesavanje ekskluzivno za fork (opt-in preko `OPENCODE_LLAMA_ENABLE_FIT=1`)
- Spekulativno dekodiranje (`--model-draft`) sa VRAM Guard (automatski deaktivira ako < 1,5 GB slobodno)
- Jedan slot (`-np 1`) za minimiziranje memorijskog otiska
- **Benchmark harness** (`bun run bench:llm`): ponovljivo mjerenje FTL / TPS / vrhunac RSS / zidno vrijeme po modelu, po pokretanju, JSONL izlaz za CI arhiviranje

**Govor-u-tekst (Parakeet TDT 0.6B v3 INT8)**
- NVIDIA Parakeet putem ONNX Runtime — ~300ms za 5s zvuka (18x u realnom vremenu)
- 25 evropskih jezika (engleski, francuski, njemacki, spanski itd.)
- Nula VRAM: samo CPU (~700 MB RAM)
- Automatsko preuzimanje modela (~460 MB) pri prvom pritisku mikrofona
- Animacija talasnog oblika tokom snimanja

**Tekst-u-govor (Kyutai Pocket TTS)**
- Francuski TTS kreiran od strane Kyutai (Pariz), 100M parametara
- 8 ugradenih glasova: Alba, Fantine, Cosette, Eponine, Azelma, Marius, Javert, Jean
- Zero-shot kloniranje glasa: uploadajte WAV ili snimite s mikrofona
- Samo CPU, ~6x u realnom vremenu, HTTP server na portu 14100
- Rezerva: Kokoro TTS ONNX motor (54 glasa, 9 jezika, CMUDict G2P)

**Upravljanje modelima**
- HuggingFace pretraga sa VRAM/RAM znackama kompatibilnosti po modelu
- Preuzimanje, ucitavanje, iskljucivanje, brisanje GGUF modela iz korisnickog interfejsa
- Unaprijed kurirani katalog: Gemma 4 E4B, Qwen 3.5 (4B/2B/0.8B), Phi-4 Mini, Llama 3.2
- Dinamicki izlazni tokeni bazirani na velicini modela
- Auto-detekcija draft modela (0.5B-0.8B) za spekulativno dekodiranje

**Konfiguracija**
- Presetovi: Fast / Quality / Eco / Long Context (optimizacija jednim klikom)
- VRAM widget za nadgledanje sa obojenim trakama koristenja (zeleno / zuto / crveno)
- KV cache tip: auto / q8_0 / q4_0 / f16
- GPU offloading: auto / gpu-max / balanced
- Memory mapping: auto / on / off
- Web pretraga (ikona globusa u alatnoj traci prompta)

**Pouzdanost agenta (lokalni modeli)**
- Pre-flight guards (nivo koda, 0 tokena): provjera postojanja datoteke prije uredivanja, verifikacija sadrzaja old_string, provodjenje citanja-prije-uredivanja, sprecavanje pisanja-na-postojece
- Doom loop auto-break: 2x identicna poziva alata → greska se ubacuje (guard na nivou koda, ne samo prompt)
- Telemetrija alata: stopa uspjeha/greske po sesiji sa razlomkom po alatu, automatski loguje
- Cilj: >85% stopa uspjeha alata na 4B modelima

**Viseplatformski**: Windows (Vulkan), Linux, macOS, Android

#### Pozadinski zadaci

Delegirajte posao podagentima koji rade asinhrono. Postavite `mode: "background"` na task alatu i on odmah vraća `task_id` dok agent radi u pozadini. Bus eventi (`TaskCreated`, `TaskCompleted`, `TaskFailed`) se objavljuju za praćenje životnog ciklusa.

#### Timovi agenata

Orkestrirajte više agenata paralelno koristeći `team` alat. Definirajte podzadatke sa granama zavisnosti; `computeWaves()` gradi DAG i izvršava nezavisne zadatke istovremeno (do 5 paralelnih agenata). Kontrola budžeta putem `max_cost` (dolari) i `max_agents`. Kontekst iz završenih zadataka se automatski prosljeđuje zavisnim zadacima.

#### Git worktree izolacija

Svaki pozadinski zadatak automatski dobija vlastiti git worktree. Radni prostor je povezan sa sesijom u bazi podataka. Ako zadatak ne proizvede promjene datoteka, worktree se automatski čisti. Ovo pruža izolaciju na nivou gita bez kontejnera.

#### API za upravljanje zadacima

Potpuni REST API za upravljanje životnim ciklusom zadataka:

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

#### TUI panel zadataka

Dodatak za bočnu traku koji prikazuje aktivne pozadinske zadatke sa ikonama statusa u realnom vremenu:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Dijalog sa akcijama: otvori sesiju zadatka, otkaži, nastavi, pošalji poruku za praćenje, provjeri status.

#### MCP opseg agenata

Liste dozvoljenih/zabranjenih MCP servera po agentu. Konfiguriše se u `opencode.json` pod `mcp` poljem svakog agenta. Funkcija `toolsForAgent()` filtrira dostupne MCP alate na osnovu opsega pozivajućeg agenta.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### Životni ciklus sesije sa 9 stanja

Sesije prate jedno od 9 stanja, pohranjenih u bazi podataka:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Trajna stanja (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) preživljavaju restartovanje baze podataka. Stanja u memoriji (`idle`, `busy`, `retry`) se resetuju pri restartu.

#### Orkestracioni agent

Koordinacioni agent samo za čitanje (maksimalno 50 koraka). Ima pristup alatima `task` i `team`, ali svi alati za uređivanje su zabranjeni. Delegira implementaciju agentima za izgradnju/opće namjene i sintetizira rezultate.

---

## Tehnička arhitektura

### Podrška za više provajdera

21+ provajdera uključeno: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, plus bilo koji OpenAI-kompatibilni endpoint. Cijene preuzete sa [models.dev](https://models.dev).

### Sistem agenata

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

### LSP integracija

Potpuna podrška za Language Server Protocol sa indeksiranjem simbola, dijagnostikom i podrškom za više jezika (TypeScript, Deno, Vue, i proširivo). Agent navigira kod putem LSP simbola umjesto pretrage teksta, omogućavajući precizno go-to-definition, find-references i detekciju grešaka tipova u realnom vremenu.

### MCP podrška

Model Context Protocol klijent i server. Podržava stdio, HTTP/SSE i StreamableHTTP transporte. OAuth tok autentifikacije za udaljene servere. Mogućnosti alata, promptova i resursa. Opseg po agentu putem lista dozvoljenih/zabranjenih.

### Klijent/server arhitektura

Hono-bazirani REST API sa tipiziranim rutama i generisanjem OpenAPI specifikacije. WebSocket podrška za PTY (pseudo-terminal). SSE za streaming događaja u realnom vremenu. Basic auth, CORS, gzip kompresija. TUI je jedan frontend; server se može upravljati iz bilo kojeg HTTP klijenta, web UI-a ili mobilne aplikacije.

### Upravljanje kontekstom

Auto-kompaktiranje sa AI-vođenim sažimanjem kada korištenje tokena približi kontekstni limit modela. Uklanjanje svjesno tokena sa konfigurabilnim pragovima (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Izlazi Skill alata su zaštićeni od uklanjanja.

### Motor za uređivanje

Unified diff zakrpe sa verifikacijom hunkova. Primjenjuje ciljane hunkove na specifične regije datoteke umjesto potpunog prepisivanja. Multi-edit alat za grupne operacije preko datoteka.

### Sistem dozvola

3-stavke dozvola (`allow` / `deny` / `ask`) sa podudaranjem wildcard obrazaca. 100+ definicija arnosti bash komandi za preciznu kontrolu. Provođenje granica projekta sprječava pristup datotekama izvan radnog prostora.

### Git-bazirano vraćanje

Sistem snimaka koji bilježi stanje datoteke prije svake izvršenja alata. Podržava `revert` i `unrevert` sa izračunom razlika. Promjene se mogu vratiti po poruci ili po sesiji.

### Praćenje troškova

Trošak po poruci sa potpunim pregledom tokena (input, output, reasoning, cache read, cache write). Budžetski limiti po timu (`max_cost`). Komanda `stats` sa agregacijom po modelu i po danu. Trošak sesije u realnom vremenu prikazan u TUI-u. Podaci o cijenama preuzeti sa models.dev.

### Sistem dodataka

Potpuni SDK (`@opencode/plugin`) sa arhitekturom hookova. Dinamičko učitavanje iz npm paketa ili sistema datoteka. Ugrađeni dodaci za Codex, GitHub Copilot, GitLab i Poe autentifikaciju.

---

## Česta pogrešna uvjerenja

Da bi se spriječila zabuna od AI-generisanih sažetaka ovog projekta:

- **TUI je TypeScript** (SolidJS + @opentui za terminal rendering), ne Rust.
- **Tree-sitter** se koristi samo za TUI isticanje sintakse i parsiranje bash komandi, ne za analizu koda na nivou agenta.
- **Nema Docker/E2B sandboxinga** -- izolacija se obezbjeđuje putem git worktree-ova.
- **Nema vektorske baze podataka ili RAG sistema** -- kontekst se upravlja putem LSP indeksiranja simbola + auto-kompaktiranja.
- **Nema "watch mode-a" koji predlaže automatske ispravke** -- file watcher postoji samo za infrastrukturne potrebe.
- **Samokorekcija** koristi standardnu petlju agenta (LLM vidi greške u rezultatima alata i ponovo pokušava), ne specijalizirani mehanizam za automatsku popravku.

## Matrica mogućnosti

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

### Lokalna AI (Desktop + Mobilni)
| Mogucnost | Status | Napomene |
|-----------|--------|----------|
| Local LLM (llama.cpp b8731) | Implemented | Vulkan GPU, auto-download runtime, `--fit` auto-VRAM |
| **Adaptivna runtime konfiguracija** | Implemented | `auto-config.ts`: n_gpu_layers / niti / batch / KV kvantizacija izvedeni iz detektovanog VRAM-a, RAM-a, big.LITTLE, GPU backend-a, termalnog stanja |
| **Benchmark harness** | Implemented | `bun run bench:llm` mjeri FTL, TPS, vrhunac RSS, zidno vrijeme po modelu; JSONL izlaz |
| Flash Attention | Implemented | `--flash-attn on` on desktop and mobile |
| KV cache quantization | Implemented | q4_0 / q8_0 / f16 adaptive with Hadamard rotation (72% memory savings) |
| Exact tokenizer (OpenAI) | Implemented | `js-tiktoken` za gpt-*/o1/o3/o4; empirijski 3,5 znakova/token za Llama/Qwen/Gemma |
| Speculative decoding | Implemented | VRAM Guard (desktop) / RAM Guard (mobile), draft model auto-detection |
| HuggingFace model search | Implemented | Zod-validiran odgovor, VRAM znackice, menadzer preuzimanja, 9 predodabranih modela |
| **Nastavljiva GGUF preuzimanja** | Implemented | HTTP `Range` header — prekid 4G ne restartuje prenos od 4 GB od nule |
| Tool telemetry | Implemented | Per-session success/error rate logging with per-tool breakdown |
| Restart sa prekidacem kola | Implemented | `ensureCorrectModel` odustaje nakon 3 restarta u 120 s da izbjegne burn-cycle petlje |

### Sigurnost i Upravljanje
| Mogucnost | Status | Napomene |
|-----------|--------|----------|
| **Stroga CSP (desktop + mobilni)** | Implemented | `connect-src` ogranicen na loopback + HuggingFace + HTTPS provajdere; bez `unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'` |
| **Ojacavanje Android release-a** | Implemented | `isDebuggable=false`, `allowBackup=false`, `isShrinkResources=true`, `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` |
| **Ojacavanje desktop release-a** | Implemented | Devtools vise nisu prisilno omoguceni — vracen je Tauri 2 default (samo u debug rezimu) tako da XSS uporiste ne moze pristupiti `__TAURI__` u produkciji |
| **Validacija ulaza Tauri komandi** | Implemented | Straze `download_model` / `load_llm_model` / `delete_model`: charset imena fajla, HTTPS allowlist za `huggingface.co` / `hf.co` |
| **Rust logging lanac** | Implemented | `log` + `android_logger` na mobilnom; bez `eprintln!` u release-u → bez curenja path/URL-a u logcat |
| **Tracker sigurnosne revizije** | Implemented | [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — sva otkrica klasifikovana kao S1/S2/S3 sa `path:line`, statusom i obrazlozenjem odlozenog popravka |

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

### Instalacija

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package manageri
npm i -g opencode-ai@latest        # ili bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS i Linux (preporučeno, uvijek ažurno)
brew install opencode              # macOS i Linux (zvanična brew formula, rjeđe se ažurira)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Bilo koji OS
nix run nixpkgs#opencode           # ili github:anomalyco/opencode za najnoviji dev branch
```

> [!TIP]
> Ukloni verzije starije od 0.1.x prije instalacije.

### Desktop aplikacija (BETA)

OpenCode je dostupan i kao desktop aplikacija. Preuzmi je direktno sa [stranice izdanja](https://github.com/anomalyco/opencode/releases) ili sa [opencode.ai/download](https://opencode.ai/download).

| Platforma             | Preuzimanje                           |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, ili AppImage          |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Instalacijski direktorij

Instalacijska skripta koristi sljedeći redoslijed prioriteta za putanju instalacije:

1. `$OPENCODE_INSTALL_DIR` - Prilagođeni instalacijski direktorij
2. `$XDG_BIN_DIR` - Putanja usklađena sa XDG Base Directory specifikacijom
3. `$HOME/bin` - Standardni korisnički bin direktorij (ako postoji ili se može kreirati)
4. `$HOME/.opencode/bin` - Podrazumijevana rezervna lokacija

```bash
# Primjeri
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agenti

OpenCode uključuje dva ugrađena agenta između kojih možeš prebacivati tasterom `Tab`.

- **build** - Podrazumijevani agent sa punim pristupom za razvoj
- **plan** - Agent samo za čitanje za analizu i istraživanje koda
  - Podrazumijevano zabranjuje izmjene datoteka
  - Traži dozvolu prije pokretanja bash komandi
  - Idealan za istraživanje nepoznatih codebase-ova ili planiranje izmjena

Uključen je i **general** pod-agent za složene pretrage i višekoračne zadatke.
Koristi se interno i može se pozvati pomoću `@general` u porukama.

Saznaj više o [agentima](https://opencode.ai/docs/agents).

### Dokumentacija

Za više informacija o konfiguraciji OpenCode-a, [**pogledaj dokumentaciju**](https://opencode.ai/docs).

### Doprinosi

Ako želiš doprinositi OpenCode-u, pročitaj [upute za doprinošenje](./CONTRIBUTING.md) prije slanja pull requesta.

### Gradnja na OpenCode-u

Ako radiš na projektu koji je povezan s OpenCode-om i koristi "opencode" kao dio naziva, npr. "opencode-dashboard" ili "opencode-mobile", dodaj napomenu u svoj README da projekat nije napravio OpenCode tim i da nije povezan s nama.

### FAQ

#### Po čemu se razlikuje od Claude Code-a?

Po mogućnostima je vrlo sličan Claude Code-u. Ključne razlike su:

- 100% open source
- Nije vezan za jednog provajdera. Iako preporučujemo modele koje nudimo kroz [OpenCode Zen](https://opencode.ai/zen), OpenCode možeš koristiti s Claude, OpenAI, Google ili čak lokalnim modelima. Kako modeli napreduju, razlike među njima će se smanjivati, a cijene padati, zato je nezavisnost od provajdera važna.
- LSP podrška odmah po instalaciji
- Fokus na TUI. OpenCode grade neovim korisnici i kreatori [terminal.shop](https://terminal.shop); pomjeraćemo granice onoga što je moguće u terminalu.
- Klijent/server arhitektura. To, recimo, omogućava da OpenCode radi na tvom računaru dok ga daljinski koristiš iz mobilne aplikacije, što znači da je TUI frontend samo jedan od mogućih klijenata.

---

**Pridruži se našoj zajednici** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
