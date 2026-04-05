<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">AI-kodeagent med åpen kildekode.</p>
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

## Fork-funksjoner

> Dette er en fork av [anomalyco/opencode](https://github.com/anomalyco/opencode) vedlikeholdt av [Rwanbt](https://github.com/Rwanbt).
> Holdes synkronisert med upstream. Se [dev-branch](https://github.com/Rwanbt/opencode/tree/dev) for siste endringer.

#### Bakgrunnsoppgaver

Deleger arbeid til underagenter som kjører asynkront. Sett `mode: "background"` på task-verktøyet og det returnerer en `task_id` umiddelbart mens agenten jobber i bakgrunnen. Bus-hendelser (`TaskCreated`, `TaskCompleted`, `TaskFailed`) publiseres for livssyklussporing.

#### Agent-team

Orkestrer flere agenter parallelt ved hjelp av `team`-verktøyet. Definer deloppgaver med avhengighetskanter; `computeWaves()` bygger en DAG og kjører uavhengige oppgaver samtidig (opptil 5 parallelle agenter). Budsjettkontroll via `max_cost` (dollar) og `max_agents`. Kontekst fra fullforte oppgaver sendes automatisk videre til avhengige oppgaver.

#### Git worktree-isolasjon

Hver bakgrunnsoppgave far automatisk sitt eget git worktree. Arbeidsomradet er knyttet til sesjonen i databasen. Hvis en oppgave ikke produserer filendringer, ryddes worktree-et opp automatisk. Dette gir isolasjon pa git-niva uten containere.

#### API for oppgavestyring

Fullt REST API for livssyklusstyring av oppgaver:

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

#### TUI-oppgavepanel

Sidepanel-tillegg som viser aktive bakgrunnsoppgaver med sanntids statusikoner:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Dialog med handlinger: apne oppgavesesjon, avbryt, gjenoppta, send oppfolging, sjekk status.

#### MCP-agentbegrensning

Tillat/nekt-lister for MCP-servere per agent. Konfigureres i `opencode.json` under hvert agents `mcp`-felt. Funksjonen `toolsForAgent()` filtrerer tilgjengelige MCP-verktoy basert pa den kallende agentens omfang.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9-tilstands sesjonslivssyklus

Sesjoner sporer en av 9 tilstander, lagret i databasen:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Vedvarende tilstander (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) overlever databaseomstarter. Tilstander i minnet (`idle`, `busy`, `retry`) tilbakestilles ved omstart.

#### Orkestreringsagent

Skrivebeskyttet koordineringsagent (maks 50 steg). Har tilgang til `task`- og `team`-verktoy, men alle redigeringsverktoy er nektet. Delegerer implementasjon til bygge-/generelle agenter og sammenstiller resultater.

---

## Teknisk arkitektur

### Stotte for flere leverandorer

21+ leverandorer inkludert: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, pluss alle OpenAI-kompatible endepunkter. Priser hentet fra [models.dev](https://models.dev).

### Agentsystem

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

### LSP-integrasjon

Full stotte for Language Server Protocol med symbolindeksering, diagnostikk og flersprakstotte (TypeScript, Deno, Vue, og utvidbart). Agenten navigerer kode via LSP-symboler i stedet for tekstsok, noe som muliggjor presis go-to-definition, find-references og sanntids typefeildeteksjon.

### MCP-stotte

Model Context Protocol klient og server. Stotter stdio, HTTP/SSE og StreamableHTTP-transporter. OAuth-autentiseringsflyt for eksterne servere. Verktoy-, prompt- og ressursfunksjonalitet. Agentspesifikk begrensning via tillat/nekt-lister.

### Klient/server-arkitektur

Hono-basert REST API med typede ruter og OpenAPI-spesifikasjonsgenerering. WebSocket-stotte for PTY (pseudo-terminal). SSE for sanntids hendelses-streaming. Basic auth, CORS, gzip-kompresjon. TUI er en frontend; serveren kan styres fra enhver HTTP-klient, web-UI-et eller en mobilapp.

### Kontekststyring

Automatisk kompaktering med AI-drevet oppsummering nar tokenbruk narmer seg modellens kontekstgrense. Token-bevisst beskjaring med konfigurerbare terskler (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Skill-verktoyutdata er beskyttet mot beskjaring.

### Redigeringsmotor

Unified diff-patching med hunk-verifisering. Anvender malrettede hunker pa spesifikke filomrader i stedet for fullstendig filoverskriving. Multi-edit-verktoy for batchoperasjoner pa tvers av filer.

### Tillatelsessystem

3-tilstands tillatelser (`allow` / `deny` / `ask`) med wildcard-monstermatch. 100+ bash-kommando aritetdefinisjoner for finkornet kontroll. Prosjektgrensehavdheving forhindrer filtilgang utenfor arbeidsomradet.

### Git-stottet tilbakerulling

Oieblikksbildesystem som registrerer filtilstand for hver verktoyutforelse. Stotter `revert` og `unrevert` med diff-beregning. Endringer kan tilbakerulles per melding eller per sesjon.

### Kostnadssporing

Kostnad per melding med full tokenoversikt (input, output, reasoning, cache read, cache write). Budsjettgrenser per team (`max_cost`). `stats`-kommando med per-modell og per-dag aggregering. Sanntids sesjonskostnad vist i TUI. Prisdata hentet fra models.dev.

### Tilleggssystem

Fullt SDK (`@opencode/plugin`) med hook-arkitektur. Dynamisk lasting fra npm-pakker eller filsystem. Innebygde tillegg for Codex, GitHub Copilot, GitLab og Poe-autentisering.

---

## Vanlige misforstaelser

For a forhindre forvirring fra AI-genererte sammendrag av dette prosjektet:

- **TUI er TypeScript** (SolidJS + @opentui for terminalrendering), ikke Rust.
- **Tree-sitter** brukes kun for TUI-syntaksuthevning og bash-kommandoparsing, ikke for kodanalyse pa agentniva.
- Det finnes **ingen Docker/E2B-sandboxing** -- isolasjon gis av git worktrees.
- Det finnes **ingen vektordatabase eller RAG-system** -- kontekst styres via LSP-symbolindeksering + auto-compact.
- Det finnes **ingen "watch mode" som foreslar automatiske fikser** -- filvakteren eksisterer kun for infrastrukturformaal.
- **Selvkorrigering** bruker standard agentlokke (LLM ser feil i verktoyresultater og forsoker pa nytt), ikke en spesialisert automatisk reparasjonsmekanisme.

## Kapabilitetsmatrise

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
| Docker/E2B sandboxing | Not implemented | Git worktrees used instead |
| Vector DB / RAG | Not implemented | LSP + auto-compact covers needs |
| Dry run / command preview | Not implemented | Permission system validates pre-exec |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

---

### Installasjon

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Pakkehåndterere
npm i -g opencode-ai@latest        # eller bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS og Linux (anbefalt, alltid oppdatert)
brew install opencode              # macOS og Linux (offisiell brew-formel, oppdateres sjeldnere)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # alle OS
nix run nixpkgs#opencode           # eller github:anomalyco/opencode for nyeste dev-branch
```

> [!TIP]
> Fjern versjoner eldre enn 0.1.x før du installerer.

### Desktop-app (BETA)

OpenCode er også tilgjengelig som en desktop-app. Last ned direkte fra [releases-siden](https://github.com/anomalyco/opencode/releases) eller [opencode.ai/download](https://opencode.ai/download).

| Plattform             | Nedlasting                            |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` eller AppImage         |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installasjonsmappe

Installasjonsskriptet bruker følgende prioritet for installasjonsstien:

1. `$OPENCODE_INSTALL_DIR` - Egendefinert installasjonsmappe
2. `$XDG_BIN_DIR` - Sti som følger XDG Base Directory Specification
3. `$HOME/bin` - Standard brukerbinar-mappe (hvis den finnes eller kan opprettes)
4. `$HOME/.opencode/bin` - Standard fallback

```bash
# Eksempler
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode har to innebygde agents du kan bytte mellom med `Tab`-tasten.

- **build** - Standard, agent med full tilgang for utviklingsarbeid
- **plan** - Skrivebeskyttet agent for analyse og kodeutforsking
  - Nekter filendringer som standard
  - Spør om tillatelse før bash-kommandoer
  - Ideell for å utforske ukjente kodebaser eller planlegge endringer

Det finnes også en **general**-subagent for komplekse søk og flertrinnsoppgaver.
Den brukes internt og kan kalles via `@general` i meldinger.

Les mer om [agents](https://opencode.ai/docs/agents).

### Dokumentasjon

For mer info om hvordan du konfigurerer OpenCode, [**se dokumentasjonen**](https://opencode.ai/docs).

### Bidra

Hvis du vil bidra til OpenCode, les [contributing docs](./CONTRIBUTING.md) før du sender en pull request.

### Bygge på OpenCode

Hvis du jobber med et prosjekt som er relatert til OpenCode og bruker "opencode" som en del av navnet; for eksempel "opencode-dashboard" eller "opencode-mobile", legg inn en merknad i README som presiserer at det ikke er bygget av OpenCode-teamet og ikke er tilknyttet oss på noen måte.

### FAQ

#### Hvordan er dette forskjellig fra Claude Code?

Det er veldig likt Claude Code når det gjelder funksjonalitet. Her er de viktigste forskjellene:

- 100% open source
- Ikke knyttet til en bestemt leverandør. Selv om vi anbefaler modellene vi tilbyr gjennom [OpenCode Zen](https://opencode.ai/zen); kan OpenCode brukes med Claude, OpenAI, Google eller til og med lokale modeller. Etter hvert som modellene utvikler seg vil gapene lukkes og prisene gå ned, så det er viktig å være provider-agnostic.
- LSP-støtte rett ut av boksen
- Fokus på TUI. OpenCode er bygget av neovim-brukere og skaperne av [terminal.shop](https://terminal.shop); vi kommer til å presse grensene for hva som er mulig i terminalen.
- Klient/server-arkitektur. Dette kan for eksempel la OpenCode kjøre på maskinen din, mens du styrer den eksternt fra en mobilapp. Det betyr at TUI-frontend'en bare er en av de mulige klientene.

---

**Bli med i fellesskapet** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
