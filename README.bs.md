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
| Docker/E2B sandboxing | Not implemented | Git worktrees used instead |
| Vector DB / RAG | Not implemented | LSP + auto-compact covers needs |
| Dry run / command preview | Not implemented | Permission system validates pre-exec |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

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
