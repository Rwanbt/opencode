<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Den open source AI-kodeagent.</p>
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
## Hvorfor dette fork?

> **Kort fortalt** — den eneste open source coding-agent, der leverer en DAG-baseret orkestrator, et REST-task-API, MCP-scoping pr. agent, en 9-tilstands-session-FSM, en indbygget sårbarhedsscanner *og* en førsteklasses Android-app med LLM-inferens på enheden. Intet andet CLI — proprietært eller åbent — kombinerer alt dette.

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

## Fork-funktioner

> Dette er en fork af [anomalyco/opencode](https://github.com/anomalyco/opencode) vedligeholdt af [Rwanbt](https://github.com/Rwanbt).
> Holdes synkroniseret med upstream. Se [dev-branch](https://github.com/Rwanbt/opencode/tree/dev) for seneste ændringer.

#### Lokal-først AI

OpenCode kører AI-modeller lokalt på forbrugerhardware (8 GB VRAM / 16 GB RAM), med nul cloud-afhængighed for 4B-7B modeller.

**Promptoptimering (94% reduktion)**
- ~1K token system prompt til lokale modeller (mod ~16K for cloud)
- Skelet-værktøjsskemaer (1-linje signaturer mod multi-KB prosa)
- 7-værktøjs whitelist (bash, read, edit, write, glob, grep, question)
- Ingen skills-sektion, minimal miljøinformation

**Inferensmotor (llama.cpp b8731)**
- Vulkan GPU-backend, auto-downloadet ved første modelindlæsning
- **Adaptiv runtime-konfiguration** (`packages/opencode/src/local-llm-server/auto-config.ts`): `n_gpu_layers`, tråde, batch/ubatch-størrelse, KV-cache-kvantisering og kontekststørrelse udledes fra detekteret VRAM, ledig RAM, big.LITTLE CPU-opdeling, GPU-backend (CUDA/ROCm/Vulkan/Metal/OpenCL) og termisk tilstand. Erstatter den gamle hardkodede `--n-gpu-layers 99` — en 4 GB Android kører nu i CPU-fallback i stedet for at blive OOM-dræbt, flagskib-desktops får et tunet batch i stedet for standard 512.
- `--flash-attn on` — Flash Attention for hukommelseseffektivitet
- `--cache-type-k/v` — KV-cache med -rotation; adaptivt niveau (f16 / q8_0 / q4_0) baseret på VRAM-margen
- `--fit on` — fork-kun sekundær VRAM-justering (opt-in via `OPENCODE_LLAMA_ENABLE_FIT=1`)
- Spekulativ dekodning (`--model-draft`) med VRAM Guard (auto-deaktiverer hvis < 1,5 GB ledig)
- Enkelt slot (`-np 1`) for at minimere hukommelsesfodaftryk
- **Benchmark-harness** (`bun run bench:llm`): reproducerbar måling af FTL / TPS / peak RSS / vægtid pr. model, pr. kørsel, JSONL-output til CI-arkivering

**Tale-til-tekst (Parakeet TDT 0.6B v3 INT8)**
- NVIDIA Parakeet via ONNX Runtime — ~300ms for 5s lyd (18x realtid)
- 25 europæiske sprog (engelsk, fransk, tysk, spansk osv.)
- Nul VRAM: kun CPU (~700 MB RAM)
- Auto-download model (~460 MB) ved første mikrofontryk
- Bølgeformsanimation under optagelse

**Tekst-til-tale (Kyutai Pocket TTS)**
- Fransksproget TTS skabt af Kyutai (Paris), 100M parametre
- 8 indbyggede stemmer: Alba, Fantine, Cosette, Eponine, Azelma, Marius, Javert, Jean
- Zero-shot stemmekloning: upload WAV eller optag fra mikrofon
- Kun CPU, ~6x realtid, HTTP-server på port 14100
- Fallback: Kokoro TTS ONNX-motor (54 stemmer, 9 sprog, CMUDict G2P)

**Modelstyring**
- HuggingFace-søgning med VRAM/RAM-kompatibilitetsmærker per model
- Download, indlæs, aflæs, slet GGUF-modeller fra brugergrænsefladen
- Forkureret katalog: Gemma 3 4B, Qwen3 4B/1.7B/0.6B
- Dynamiske output-tokens baseret på modelstørrelse
- Auto-detektering af draft-model (0.5B-0.8B) til spekulativ dekodning

**Konfiguration**
- Forudindstillinger: Fast / Quality / Eco / Long Context (ét-klik optimering)
- VRAM-overvågningswidget med farvekodede brugsbjælker (grøn / gul / rød)
- KV-cache type: auto / q8_0 / q4_0 / f16
- GPU-offloading: auto / gpu-max / balanced
- Memory mapping: auto / on / off
- Websøgning (globus-ikon i prompt-værktøjslinjen)

**Agent-pålidelighed (lokale modeller)**
- Pre-flight guards (kodeniveau, 0 tokens): fil-eksistens-tjek før redigering, old_string indholdsverifikation, læs-før-redigering håndhævelse, skriv-på-eksisterende forebyggelse
- Doom loop auto-break: 2x identiske værktøjskald → fejl injiceres (kodeniveau guard, ikke kun prompt)
- Værktøjstelemetri: per-session succes/fejlrate med per-værktøj nedbrydning, logges automatisk

**Tværplatform**: Windows (Vulkan), Linux, macOS, Android

#### Baggrundsopgaver

Deleger arbejde til underagenter, der kører asynkront. Sæt `mode: "background"` på task-værktøjet, og det returnerer straks et `task_id`, mens agenten arbejder i baggrunden. Bus-events (`TaskCreated`, `TaskCompleted`, `TaskFailed`) publiceres til livscyklussporing.

#### Agent-teams

Orkestrer flere agenter parallelt ved hjælp af `team`-værktøjet. Definer underopgaver med afhængighedskanter; `computeWaves()` bygger en DAG og eksekverer uafhængige opgaver samtidigt (op til 5 parallelle agenter). Budgetkontrol via `max_cost` (dollars) og `max_agents`. Kontekst fra fuldførte opgaver overføres automatisk til afhængige opgaver.

#### Git Worktree-isolation

Hver baggrundsopgave får automatisk sit eget git worktree. Workspace'et er knyttet til sessionen i databasen. Hvis en opgave ikke producerer filændringer, ryddes worktree'et automatisk op. Dette giver git-niveau isolation uden containere.

#### API til Opgavestyring

Fuld REST API til styring af opgavelivscyklus:

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

#### TUI-opgavepanel

Sidepanel-plugin, der viser aktive baggrundsopgaver med statusikoner i realtid:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Dialog med handlinger: åbn opgavesession, annuller, genoptag, send opfølgning, tjek status.

#### MCP-agentbegrænsning

Tillad/afvis-lister for MCP-servere per agent. Konfigurer i `opencode.json` under hver agents `mcp`-felt. Funktionen `toolsForAgent()` filtrerer tilgængelige MCP-værktøjer baseret på den kaldende agents omfang.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9-tilstands Sessionslivscyklus

Sessioner sporer en af 9 tilstande, gemt i databasen:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Persistente tilstande (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) overlever databasegenstarter. In-memory tilstande (`idle`, `busy`, `retry`) nulstilles ved genstart.

#### Orkestreringsagent

Skrivebeskyttet koordineringsagent (maks. 50 trin). Har adgang til `task`- og `team`-værktøjer, men alle redigeringsværktøjer er blokeret. Delegerer implementering til bygge-/generelle agenter og syntetiserer resultater.

---

## Teknisk Arkitektur

### Multi-Provider Understøttelse

21+ providere klar til brug: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, plus ethvert OpenAI-kompatibelt endpoint. Priser hentet fra [models.dev](https://models.dev).

### Agentsystem

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | Standard udviklingsagent |
| **plan** | primary | read-only | Analyse og kodeudforskning |
| **general** | subagent | full (no todowrite) | Komplekse flertrinsopgaver |
| **explore** | subagent | read-only | Hurtig kodebasesøgning |
| **orchestrator** | subagent | read-only + task/team | Multi-agent koordinator (50 trin) |
| **critic** | subagent | read-only + bash + LSP | Kodegennemgang: bugs, sikkerhed, ydeevne |
| **tester** | subagent | full (no todowrite) | Skriv og kør tests, verificer dækning |
| **documenter** | subagent | full (no todowrite) | JSDoc, README, inline dokumentation |
| compaction | hidden | none | AI-drevet kontekstopsummering |
| title | hidden | none | Sessionstitelgenerering |
| summary | hidden | none | Sessionsopsummering |

### LSP-Integration

Fuld understøttelse af Language Server Protocol med symbolindeksering, diagnostik og flersproglig understøttelse (TypeScript, Deno, Vue og udvidelig). Agenten navigerer kode via LSP-symboler i stedet for tekstsøgning, hvilket muliggør præcis go-to-definition, find-references og realtids typefejldetektering.

### MCP-Understøttelse

Model Context Protocol client og server. Understøtter stdio, HTTP/SSE og StreamableHTTP transporter. OAuth-godkendelsesflow for fjernservere. Tool-, prompt- og ressourcekapabiliteter. Per-agent scoping via allow/deny-lister.

### Client/Server-Arkitektur

Hono-baseret REST API med typede ruter og OpenAPI-specifikationsgenerering. WebSocket-understøttelse for PTY (pseudo-terminal). SSE for realtids event-streaming. Basic auth, CORS, gzip-komprimering. TUI'en er én frontend; serveren kan styres fra enhver HTTP-klient, web-UI'en eller en mobilapp.

### Kontekststyring

Auto-compact med AI-drevet opsummering når tokenforbrug nærmer sig modellens kontekstgrænse. Token-bevidst beskæring med konfigurerbare tærskler (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Skill-værktøjets output er beskyttet mod beskæring.

### Redigeringsmotor

Unified diff-patching med hunk-verifikation. Anvender målrettede hunks til specifikke filregioner i stedet for fuld filoverskrivning. Multi-edit-værktøj til batchoperationer på tværs af filer.

### Tilladelsessystem

3-tilstands tilladelser (`allow` / `deny` / `ask`) med wildcard-mønstermatchning. 100+ bash-kommando aritetsdefinitioner til finkornet kontrol. Projektgrænseovervågning forhindrer filadgang uden for workspace.

### Git-Baseret Rollback

Snapshot-system der registrerer filtilstand før hver værktøjsudførelse. Understøtter `revert` og `unrevert` med diff-beregning. Ændringer kan rulles tilbage per besked eller per session.

### Omkostningssporing

Pris per besked med fuld tokenopdeling (input, output, reasoning, cache read, cache write). Per-team budgetgrænser (`max_cost`). `stats`-kommando med per-model og per-dag aggregering. Realtids sessionsomkostninger vist i TUI. Prisdata hentet fra models.dev.

### Pluginsystem

Fuldt SDK (`@opencode/plugin`) med hook-arkitektur. Dynamisk indlæsning fra npm-pakker eller filsystem. Indbyggede plugins til Codex, GitHub Copilot, GitLab og Poe-godkendelse.

---

## Almindelige Misforståelser

For at undgå forvirring fra AI-genererede opsummeringer af dette projekt:

- **TUI'en er TypeScript** (SolidJS + @opentui til terminalrendering), ikke Rust.
- **Tree-sitter** bruges kun til syntaksfremhævning i TUI og bash-kommandoparsing, ikke til kodeanalyse på agentniveau.
- Der er **ingen Docker/E2B-sandboxing** -- isolation leveres af git worktrees.
- Der er **ingen vektordatabase eller RAG-system** -- kontekst styres via LSP-symbolindeksering + auto-compact.
- Der er **ingen "watch mode" der foreslår automatiske rettelser** -- file watcher eksisterer kun til infrastrukturformål.
- **Selvkorrektion** bruger den standard agentloop (LLM'en ser fejl i værktøjsresultater og prøver igen), ikke en specialiseret auto-reparationsmekanisme.

## Kapabilitetsmatrix

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
| Memory conflict resolution | Dead code | `rag/conflict.ts` is unit-tested but not invoked in production; treat as unimplemented |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

### Lokal AI (Desktop + Mobil)
| Kapacitet | Status | Noter |
|-----------|--------|-------|
| Local LLM (llama.cpp b8731) | Implemented | Vulkan GPU, auto-download runtime, `--fit` auto-VRAM |
| **Adaptiv runtime-konfiguration** | Implemented | `auto-config.ts`: n_gpu_layers / tråde / batch / KV-kvantisering udledes fra detekteret VRAM, RAM, big.LITTLE, GPU-backend, termisk tilstand |
| **Benchmark-harness** | Implemented | `bun run bench:llm` måler FTL, TPS, peak RSS, vægtid pr. model; JSONL-output |
| Flash Attention | Implemented | `--flash-attn on` on desktop and mobile |
| KV cache quantization | Implemented | q4_0 / q8_0 / f16 adaptive with standard llama.cpp quantization (~50% KV memory savings at q4_0) |
| Exact tokenizer (OpenAI) | Implemented | `js-tiktoken` til gpt-*/o1/o3/o4; empirisk 3,5 tegn/token til Llama/Qwen/Gemma |
| Speculative decoding | Implemented | VRAM Guard (desktop) / RAM Guard (mobile), draft model auto-detection |
| HuggingFace model search | Implemented | Zod-valideret respons, VRAM-badges, downloadmanager, 9 prækurerede modeller |
| **Genoptagelige GGUF-downloads** | Implemented | HTTP `Range`-header — en 4G-afbrydelse genstarter ikke en 4 GB-overførsel fra nul |
| Tool telemetry | Implemented | Per-session success/error rate logging with per-tool breakdown |
| Circuit breaker-genstart | Implemented | `ensureCorrectModel` afbryder efter 3 genstarter på 120 s for at undgå burn-cycle-løkker |

### Sikkerhed og Governance
| Kapacitet | Status | Noter |
|-----------|--------|-------|
| **Stram CSP (desktop + mobil)** | Implemented | `connect-src` begrænset til loopback + HuggingFace + HTTPS-udbydere; ingen `unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'` |
| **Android-release-hærdning** | Implemented | `isDebuggable=false`, `allowBackup=false`, `isShrinkResources=true`, `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` |
| **Desktop-release-hærdning** | Implemented | Devtools er ikke længere tvangsaktiveret — Tauri 2-standarden (kun i debug) er gendannet, så et XSS-fodfæste ikke kan koble sig til `__TAURI__` i produktion |
| **Validering af Tauri-kommandoinput** | Implemented | `download_model` / `load_llm_model` / `delete_model`-vagter: filnavn-charset, HTTPS-allowlist til `huggingface.co` / `hf.co` |
| **Rust-logging-kæde** | Implemented | `log` + `android_logger` på mobil; ingen `eprintln!` i release → ingen path/URL-læk til logcat |
| **Sikkerhedsauditsporing** | Implemented | [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — alle fund klassificeret som S1/S2/S3 med `path:line`, status og begrundelse for udskudt rettelse |

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

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Pakkehåndteringer
npm i -g opencode-ai@latest        # eller bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS og Linux (anbefalet, altid up to date)
brew install opencode              # macOS og Linux (officiel brew formula, opdateres sjældnere)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # alle OS
nix run nixpkgs#opencode           # eller github:anomalyco/opencode for nyeste dev-branch
```

> [!TIP]
> Fjern versioner ældre end 0.1.x før installation.

### Desktop-app (BETA)

OpenCode findes også som desktop-app. Download direkte fra [releases-siden](https://github.com/Rwanbt/opencode/releases) eller [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, eller AppImage        |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installationsmappe

Installationsscriptet bruger følgende prioriteringsrækkefølge for installationsstien:

1. `$OPENCODE_INSTALL_DIR` - Tilpasset installationsmappe
2. `$XDG_BIN_DIR` - Sti der følger XDG Base Directory Specification
3. `$HOME/bin` - Standard bruger-bin-mappe (hvis den findes eller kan oprettes)
4. `$HOME/.opencode/bin` - Standard fallback

```bash
# Eksempler
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode har to indbyggede agents, som du kan skifte mellem med `Tab`-tasten.

- **build** - Standard, agent med fuld adgang til udviklingsarbejde
- **plan** - Skrivebeskyttet agent til analyse og kodeudforskning
  - Afviser filredigering som standard
  - Spørger om tilladelse før bash-kommandoer
  - Ideel til at udforske ukendte kodebaser eller planlægge ændringer

Derudover findes der en **general**-subagent til komplekse søgninger og flertrinsopgaver.
Den bruges internt og kan kaldes via `@general` i beskeder.

Læs mere om [agents](https://opencode.ai/docs/agents).

### Dokumentation

For mere info om konfiguration af OpenCode, [**se vores docs**](https://opencode.ai/docs).

### Bidrag

Hvis du vil bidrage til OpenCode, så læs vores [contributing docs](./CONTRIBUTING.md) før du sender en pull request.

### Bygget på OpenCode

Hvis du arbejder på et projekt der er relateret til OpenCode og bruger "opencode" som en del af navnet; f.eks. "opencode-dashboard" eller "opencode-mobile", så tilføj en note i din README, der tydeliggør at projektet ikke er bygget af OpenCode-teamet og ikke er tilknyttet os på nogen måde.

### FAQ

#### Hvordan adskiller dette sig fra Claude Code?

Det minder meget om Claude Code i forhold til funktionalitet. Her er de vigtigste forskelle:

- 100% open source
- Ikke låst til en udbyder. Selvom vi anbefaler modellerne via [OpenCode Zen](https://opencode.ai/zen); kan OpenCode bruges med Claude, OpenAI, Google eller endda lokale modeller. Efterhånden som modeller udvikler sig vil forskellene mindskes og priserne falde, så det er vigtigt at være provider-agnostic.
- LSP-support out of the box
- Fokus på TUI. OpenCode er bygget af neovim-brugere og skaberne af [terminal.shop](https://terminal.shop); vi vil skubbe grænserne for hvad der er muligt i terminalen.
- Klient/server-arkitektur. Det kan f.eks. lade OpenCode køre på din computer, mens du styrer den eksternt fra en mobilapp. Det betyder at TUI-frontend'en kun er en af de mulige clients.

---

**Bliv en del af vores community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
