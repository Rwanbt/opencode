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

## Fork-funktioner

> Dette er en fork af [anomalyco/opencode](https://github.com/anomalyco/opencode) vedligeholdt af [Rwanbt](https://github.com/Rwanbt).
> Holdes synkroniseret med upstream. Se [dev-branch](https://github.com/Rwanbt/opencode/tree/dev) for seneste ændringer.

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
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

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

OpenCode findes også som desktop-app. Download direkte fra [releases-siden](https://github.com/anomalyco/opencode/releases) eller [opencode.ai/download](https://opencode.ai/download).

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
