<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo OpenCode">
    </picture>
  </a>
</p>
<p align="center">L’agente di coding AI open source.</p>
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

## Funzionalità del Fork

> Questo è un fork di [anomalyco/opencode](https://github.com/anomalyco/opencode) mantenuto da [Rwanbt](https://github.com/Rwanbt).
> Sincronizzato con upstream. Vedi il [branch dev](https://github.com/Rwanbt/opencode/tree/dev) per le ultime modifiche.

#### Attività in Background

Delega il lavoro a sotto-agenti che vengono eseguiti in modo asincrono. Imposta `mode: "background"` sullo strumento task e restituisce immediatamente un `task_id` mentre l'agente lavora in background. Gli eventi bus (`TaskCreated`, `TaskCompleted`, `TaskFailed`) vengono pubblicati per il tracciamento del ciclo di vita.

#### Team di Agenti

Orchestrare più agenti in parallelo usando lo strumento `team`. Definisci sotto-attività con archi di dipendenza; `computeWaves()` costruisce un DAG ed esegue le attività indipendenti in modo concorrente (fino a 5 agenti paralleli). Controllo del budget tramite `max_cost` (dollari) e `max_agents`. Il contesto delle attività completate viene automaticamente passato ai dipendenti.

#### Isolamento Git Worktree

Ogni attività in background ottiene automaticamente il proprio git worktree. Il workspace è collegato alla sessione nel database. Se un'attività non produce modifiche ai file, il worktree viene ripulito automaticamente. Questo fornisce isolamento a livello git senza container.

#### API di Gestione Attività

API REST completa per la gestione del ciclo di vita delle attività:

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

#### Dashboard Attività TUI

Plugin nella barra laterale che mostra le attività in background attive con icone di stato in tempo reale:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Dialogo con azioni: aprire la sessione dell'attività, annullare, riprendere, inviare follow-up, verificare lo stato.

#### Scoping MCP per Agente

Liste di consentire/negare per server MCP per ogni agente. Configura in `opencode.json` sotto il campo `mcp` di ciascun agente. La funzione `toolsForAgent()` filtra gli strumenti MCP disponibili in base all'ambito dell'agente chiamante.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### Ciclo di Vita della Sessione a 9 Stati

Le sessioni tracciano uno dei 9 stati, persistiti nel database:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Gli stati persistenti (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) sopravvivono ai riavvii del database. Gli stati in memoria (`idle`, `busy`, `retry`) vengono reimpostati al riavvio.

#### Agente Orchestratore

Agente coordinatore in sola lettura (massimo 50 passaggi). Ha accesso agli strumenti `task` e `team` ma tutti gli strumenti di modifica sono negati. Delega l'implementazione agli agenti di build/generali e sintetizza i risultati.

---

## Architettura Tecnica

### Supporto Multi-Provider

21+ provider pronti all'uso: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, più qualsiasi endpoint compatibile con OpenAI. Prezzi provenienti da [models.dev](https://models.dev).

### Sistema di Agenti

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | Agente di sviluppo predefinito |
| **plan** | primary | read-only | Analisi ed esplorazione del codice |
| **general** | subagent | full (no todowrite) | Attività complesse multi-step |
| **explore** | subagent | read-only | Ricerca rapida nel codebase |
| **orchestrator** | subagent | read-only + task/team | Coordinatore multi-agente (50 passaggi) |
| **critic** | subagent | read-only + bash + LSP | Revisione codice: bug, sicurezza, prestazioni |
| **tester** | subagent | full (no todowrite) | Scrivere ed eseguire test, verificare copertura |
| **documenter** | subagent | full (no todowrite) | JSDoc, README, documentazione inline |
| compaction | hidden | none | Riassunto del contesto guidato dall'IA |
| title | hidden | none | Generazione del titolo della sessione |
| summary | hidden | none | Riassunto della sessione |

### Integrazione LSP

Supporto completo del Language Server Protocol con indicizzazione dei simboli, diagnostica e supporto multi-linguaggio (TypeScript, Deno, Vue ed estensibile). L'agente naviga il codice tramite simboli LSP anziché ricerca testuale, abilitando go-to-definition preciso, find-references e rilevamento errori di tipo in tempo reale.

### Supporto MCP

Client e server Model Context Protocol. Supporta trasporti stdio, HTTP/SSE e StreamableHTTP. Flusso di autenticazione OAuth per server remoti. Capacità di tool, prompt e risorse. Scoping per agente tramite liste allow/deny.

### Architettura Client/Server

API REST basata su Hono con route tipizzate e generazione di specifiche OpenAPI. Supporto WebSocket per PTY (pseudo-terminale). SSE per streaming di eventi in tempo reale. Autenticazione di base, CORS, compressione gzip. La TUI è un frontend; il server può essere gestito da qualsiasi client HTTP, l'interfaccia web o un'app mobile.

### Gestione del Contesto

Auto-compact con riassunto guidato dall'IA quando l'utilizzo dei token si avvicina al limite del contesto del modello. Potatura consapevole dei token con soglie configurabili (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Gli output dello strumento Skill sono protetti dalla potatura.

### Motore di Modifica

Patching diff unificato con verifica degli hunk. Applica hunk mirati a regioni specifiche del file anziché sovrascritture complete del file. Strumento multi-edit per operazioni batch su più file.

### Sistema di Permessi

Permessi a 3 stati (`allow` / `deny` / `ask`) con corrispondenza di pattern con caratteri jolly. 100+ definizioni di arità dei comandi bash per un controllo granulare. L'applicazione dei confini del progetto impedisce l'accesso ai file al di fuori del workspace.

### Rollback Basato su Git

Sistema di snapshot che registra lo stato dei file prima di ogni esecuzione di strumento. Supporta `revert` e `unrevert` con calcolo delle differenze. Le modifiche possono essere annullate per messaggio o per sessione.

### Tracciamento dei Costi

Costo per messaggio con dettaglio completo dei token (input, output, reasoning, cache read, cache write). Limiti di budget per team (`max_cost`). Comando `stats` con aggregazione per modello e per giorno. Costo della sessione in tempo reale visualizzato nella TUI. Dati di prezzo recuperati da models.dev.

### Sistema di Plugin

SDK completo (`@opencode/plugin`) con architettura a hook. Caricamento dinamico da pacchetti npm o filesystem. Plugin integrati per l'autenticazione Codex, GitHub Copilot, GitLab e Poe.

---

## Idee Sbagliate Comuni

Per evitare confusione da riassunti generati dall'IA di questo progetto:

- La **TUI è in TypeScript** (SolidJS + @opentui per il rendering nel terminale), non Rust.
- **Tree-sitter** è usato solo per l'evidenziazione della sintassi nella TUI e il parsing dei comandi bash, non per l'analisi del codice a livello di agente.
- **Non c'è sandboxing Docker/E2B** -- l'isolamento è fornito dai git worktree.
- **Non c'è database vettoriale o sistema RAG** -- il contesto è gestito tramite indicizzazione dei simboli LSP + auto-compact.
- **Non c'è una "modalità watch" che propone correzioni automatiche** -- il file watcher esiste solo per scopi infrastrutturali.
- L'**auto-correzione** usa il loop standard dell'agente (l'LLM vede gli errori nei risultati degli strumenti e riprova), non un meccanismo specializzato di auto-riparazione.

## Matrice delle Capacità

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

### Installazione

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package manager
npm i -g opencode-ai@latest        # oppure bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS e Linux (consigliato, sempre aggiornato)
brew install opencode              # macOS e Linux (formula brew ufficiale, aggiornata meno spesso)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Qualsiasi OS
nix run nixpkgs#opencode           # oppure github:anomalyco/opencode per l’ultima branch di sviluppo
```

> [!TIP]
> Rimuovi le versioni precedenti alla 0.1.x prima di installare.

### App Desktop (BETA)

OpenCode è disponibile anche come applicazione desktop. Puoi scaricarla direttamente dalla [pagina delle release](https://github.com/anomalyco/opencode/releases) oppure da [opencode.ai/download](https://opencode.ai/download).

| Piattaforma           | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, oppure AppImage       |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Directory di installazione

Lo script di installazione rispetta il seguente ordine di priorità per il percorso di installazione:

1. `$OPENCODE_INSTALL_DIR` – Directory di installazione personalizzata
2. `$XDG_BIN_DIR` – Percorso conforme alla XDG Base Directory Specification
3. `$HOME/bin` – Directory binaria standard dell’utente (se esiste o può essere creata)
4. `$HOME/.opencode/bin` – Fallback predefinito

```bash
# Esempi
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agenti

OpenCode include due agenti integrati tra cui puoi passare usando il tasto `Tab`.

- **build** – Predefinito, agente con accesso completo per il lavoro di sviluppo
- **plan** – Agente in sola lettura per analisi ed esplorazione del codice
  - Nega le modifiche ai file per impostazione predefinita
  - Chiede il permesso prima di eseguire comandi bash
  - Ideale per esplorare codebase sconosciute o pianificare modifiche

È inoltre incluso un sotto-agente **general** per ricerche complesse e attività multi-step.
Viene utilizzato internamente e può essere invocato usando `@general` nei messaggi.

Scopri di più sugli [agenti](https://opencode.ai/docs/agents).

### Documentazione

Per maggiori informazioni su come configurare OpenCode, [**consulta la nostra documentazione**](https://opencode.ai/docs).

### Contribuire

Se sei interessato a contribuire a OpenCode, leggi la nostra [guida alla contribuzione](./CONTRIBUTING.md) prima di inviare una pull request.

### Costruire su OpenCode

Se stai lavorando a un progetto correlato a OpenCode e che utilizza “opencode” come parte del nome (ad esempio “opencode-dashboard” o “opencode-mobile”), aggiungi una nota nel tuo README per chiarire che non è sviluppato dal team OpenCode e che non è affiliato in alcun modo con noi.

### FAQ

#### In cosa è diverso da Claude Code?

È molto simile a Claude Code in termini di funzionalità. Ecco le principali differenze:

- 100% open source
- Non è legato a nessun provider. Anche se consigliamo i modelli forniti tramite [OpenCode Zen](https://opencode.ai/zen), OpenCode può essere utilizzato con Claude, OpenAI, Google o persino modelli locali. Con l’evoluzione dei modelli, le differenze tra di essi si ridurranno e i prezzi scenderanno, quindi essere indipendenti dal provider è importante.
- Supporto LSP pronto all’uso
- Forte attenzione alla TUI. OpenCode è sviluppato da utenti neovim e dai creatori di [terminal.shop](https://terminal.shop); spingeremo al limite ciò che è possibile fare nel terminale.
- Architettura client/server. Questo, ad esempio, permette a OpenCode di girare sul tuo computer mentre lo controlli da remoto tramite un’app mobile. La frontend TUI è quindi solo uno dei possibili client.

---

**Unisciti alla nostra community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
