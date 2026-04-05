<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Der Open-Source KI-Coding-Agent.</p>
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

## Fork-Funktionen

> Dies ist ein Fork von [anomalyco/opencode](https://github.com/anomalyco/opencode), gepflegt von [Rwanbt](https://github.com/Rwanbt).
> Synchron mit Upstream gehalten. Siehe [Dev-Branch](https://github.com/Rwanbt/opencode/tree/dev) für die neuesten Änderungen.

#### Hintergrundaufgaben

Delegieren Sie Arbeit an Subagenten, die asynchron arbeiten. Setzen Sie `mode: "background"` beim task-Tool und es gibt sofort eine `task_id` zurück, während der Agent im Hintergrund arbeitet. Bus-Events (`TaskCreated`, `TaskCompleted`, `TaskFailed`) werden für die Lebenszyklusverfolgung veröffentlicht.

#### Agenten-Teams

Orchestrieren Sie mehrere Agenten parallel mit dem `team`-Tool. Definieren Sie Unteraufgaben mit Abhängigkeitskanten; `computeWaves()` erstellt einen DAG und führt unabhängige Aufgaben gleichzeitig aus (bis zu 5 parallele Agenten). Budgetkontrolle über `max_cost` (Dollar) und `max_agents`. Kontext von abgeschlossenen Aufgaben wird automatisch an abhängige Aufgaben weitergegeben.

#### Git worktree-Isolation

Jede Hintergrundaufgabe erhält automatisch ihren eigenen git worktree. Der Arbeitsbereich wird in der Datenbank mit der Sitzung verknüpft. Wenn eine Aufgabe keine Dateiänderungen erzeugt, wird der worktree automatisch bereinigt. Dies bietet Isolation auf git-Ebene ohne Container.

#### Aufgabenverwaltungs-API

Vollständige REST API für die Verwaltung des Aufgaben-Lebenszyklus:

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET | `/task/` | Aufgaben auflisten (nach Parent, Status filtern) |
| GET | `/task/:id` | Aufgabendetails + Status + Worktree-Info |
| GET | `/task/:id/messages` | Nachrichten der Aufgabensitzung abrufen |
| POST | `/task/:id/cancel` | Laufende oder wartende Aufgabe abbrechen |
| POST | `/task/:id/resume` | Abgeschlossene/fehlgeschlagene/blockierte Aufgabe fortsetzen |
| POST | `/task/:id/followup` | Folgenachricht an inaktive Aufgabe senden |
| POST | `/task/:id/promote` | Hintergrundaufgabe in den Vordergrund befördern |
| GET | `/task/:id/team` | Aggregierte Team-Ansicht (Kosten, Diffs pro Mitglied) |

#### TUI-Aufgaben-Dashboard

Seitenleisten-Plugin mit aktiven Hintergrundaufgaben und Echtzeit-Statusicons:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Dialog mit Aktionen: Aufgabensitzung öffnen, abbrechen, fortsetzen, Folgenachricht senden, Status prüfen.

#### MCP-Agenten-Scoping

Erlauben/Verweigern-Listen pro Agent für MCP-Server. Konfigurieren Sie in `opencode.json` unter dem `mcp`-Feld jedes Agenten. Die Funktion `toolsForAgent()` filtert verfügbare MCP-Tools basierend auf dem Geltungsbereich des aufrufenden Agenten.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9-Zustands-Sitzungslebenszyklus

Sitzungen verfolgen einen von 9 Zuständen, die in der Datenbank persistiert werden:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Persistente Zustände (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) überleben Datenbank-Neustarts. In-Memory-Zustände (`idle`, `busy`, `retry`) werden beim Neustart zurückgesetzt.

#### Orchestrator-Agent

Schreibgeschützter Koordinator-Agent (maximal 50 Schritte). Hat Zugriff auf `task`- und `team`-Tools, aber alle Bearbeitungstools sind gesperrt. Delegiert die Implementierung an Build/General-Agenten und fasst Ergebnisse zusammen.

---

## Technische Architektur

### Multi-Anbieter-Unterstützung

Über 21 Anbieter sofort einsatzbereit: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway sowie jeder OpenAI-kompatible Endpunkt. Preisdaten von [models.dev](https://models.dev).

### Agenten-System

| Agent | Modus | Zugriff | Beschreibung |
|-------|-------|---------|--------------|
| **build** | primary | full | Standard-Entwicklungsagent |
| **plan** | primary | read-only | Analyse und Code-Exploration |
| **general** | subagent | full (no todowrite) | Komplexe mehrstufige Aufgaben |
| **explore** | subagent | read-only | Schnelle Codebase-Suche |
| **orchestrator** | subagent | read-only + task/team | Multi-Agenten-Koordinator (50 Schritte) |
| **critic** | subagent | read-only + bash + LSP | Code-Review: Bugs, Sicherheit, Performance |
| **tester** | subagent | full (no todowrite) | Tests schreiben und ausführen, Abdeckung prüfen |
| **documenter** | subagent | full (no todowrite) | JSDoc, README, Inline-Dokumentation |
| compaction | hidden | none | KI-gesteuerte Kontextzusammenfassung |
| title | hidden | none | Sitzungstitel-Generierung |
| summary | hidden | none | Sitzungszusammenfassung |

### LSP-Integration

Vollständige Language Server Protocol-Unterstützung mit Symbolindexierung, Diagnosen und Mehrsprachunterstützung (TypeScript, Deno, Vue, und erweiterbar). Der Agent navigiert im Code über LSP-Symbole statt Textsuche, was präzises Go-to-Definition, Find-References und Echtzeit-Typfehlererkennung ermöglicht.

### MCP-Unterstützung

Model Context Protocol Client und Server. Unterstützt stdio, HTTP/SSE und StreamableHTTP-Transporte. OAuth-Authentifizierungsfluss für entfernte Server. Tool-, Prompt- und Resource-Fähigkeiten. Agenten-spezifischer Geltungsbereich über Erlauben/Verweigern-Listen.

### Client/Server-Architektur

Hono-basierte REST API mit typisierten Routen und OpenAPI-Spezifikationsgenerierung. WebSocket-Unterstützung für PTY (Pseudo-Terminal). SSE für Echtzeit-Event-Streaming. Basic Auth, CORS, gzip-Komprimierung. Das TUI ist ein Frontend; der Server kann von jedem HTTP-Client, der Web-Oberfläche oder einer mobilen App gesteuert werden.

### Kontextverwaltung

Auto-Kompaktierung mit KI-gesteuerter Zusammenfassung, wenn die Token-Nutzung sich der Kontextgrenze des Modells nähert. Token-bewusstes Pruning mit konfigurierbaren Schwellenwerten (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Ausgaben des Skill-Tools sind vor dem Pruning geschützt.

### Bearbeitungs-Engine

Unified-Diff-Patching mit Hunk-Verifizierung. Wendet gezielte Hunks auf bestimmte Dateibereiche an statt kompletter Dateiüberschreibungen. Multi-Edit-Tool für Batch-Operationen über mehrere Dateien.

### Berechtigungssystem

3-Zustands-Berechtigungen (`allow` / `deny` / `ask`) mit Wildcard-Musterabgleich. Über 100 Bash-Befehl-Aritätsdefinitionen für feingranulare Kontrolle. Projektgrenzen-Durchsetzung verhindert Dateizugriff außerhalb des Arbeitsbereichs.

### Git-basiertes Rollback

Snapshot-System, das den Dateistatus vor jeder Tool-Ausführung aufzeichnet. Unterstützt `revert` und `unrevert` mit Diff-Berechnung. Änderungen können pro Nachricht oder pro Sitzung zurückgesetzt werden.

### Kostenverfolgung

Kosten pro Nachricht mit vollständiger Token-Aufschlüsselung (Input, Output, Reasoning, Cache Read, Cache Write). Budget-Limits pro Team (`max_cost`). `stats`-Befehl mit Aggregation pro Modell und pro Tag. Echtzeit-Sitzungskosten im TUI angezeigt. Preisdaten von models.dev.

### Plugin-System

Vollständiges SDK (`@opencode/plugin`) mit Hook-Architektur. Dynamisches Laden von npm-Paketen oder dem Dateisystem. Integrierte Plugins für Codex, GitHub Copilot, GitLab und Poe-Authentifizierung.

---

## Häufige Missverständnisse

Um Verwirrung durch KI-generierte Zusammenfassungen dieses Projekts zu vermeiden:

- Das **TUI ist in TypeScript** (SolidJS + @opentui für Terminal-Rendering), nicht in Rust.
- **Tree-sitter** wird nur für TUI-Syntaxhervorhebung und Bash-Befehl-Parsing verwendet, nicht für Code-Analyse auf Agenten-Ebene.
- Es gibt **kein Docker/E2B-Sandboxing** -- Isolation wird durch git worktrees bereitgestellt.
- Es gibt **keine Vektordatenbank und kein RAG-System** -- Kontext wird über LSP-Symbolindexierung + Auto-Kompaktierung verwaltet.
- Es gibt **keinen "Watch-Modus", der automatische Korrekturen vorschlägt** -- der File-Watcher existiert nur für Infrastrukturzwecke.
- Die **Selbstkorrektur** verwendet die Standard-Agentenschleife (das LLM sieht Fehler in Tool-Ergebnissen und versucht es erneut), keinen spezialisierten Auto-Reparatur-Mechanismus.

## Fähigkeitsmatrix

| Fähigkeit | Status | Anmerkungen |
|-----------|--------|-------------|
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

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Paketmanager
npm i -g opencode-ai@latest        # oder bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS und Linux (empfohlen, immer aktuell)
brew install opencode              # macOS und Linux (offizielle Brew-Formula, seltener aktualisiert)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # jedes Betriebssystem
nix run nixpkgs#opencode           # oder github:anomalyco/opencode für den neuesten dev-Branch
```

> [!TIP]
> Entferne Versionen älter als 0.1.x vor der Installation.

### Desktop-App (BETA)

OpenCode ist auch als Desktop-Anwendung verfügbar. Lade sie direkt von der [Releases-Seite](https://github.com/anomalyco/opencode/releases) oder [opencode.ai/download](https://opencode.ai/download) herunter.

| Plattform             | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` oder AppImage          |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installationsverzeichnis

Das Installationsskript beachtet die folgende Prioritätsreihenfolge für den Installationspfad:

1. `$OPENCODE_INSTALL_DIR` - Benutzerdefiniertes Installationsverzeichnis
2. `$XDG_BIN_DIR` - XDG Base Directory Specification-konformer Pfad
3. `$HOME/bin` - Standard-Binärverzeichnis des Users (falls vorhanden oder erstellbar)
4. `$HOME/.opencode/bin` - Standard-Fallback

```bash
# Beispiele
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode enthält zwei eingebaute Agents, zwischen denen du mit der `Tab`-Taste wechseln kannst.

- **build** - Standard-Agent mit vollem Zugriff für Entwicklungsarbeit
- **plan** - Nur-Lese-Agent für Analyse und Code-Exploration
  - Verweigert Datei-Edits standardmäßig
  - Fragt vor dem Ausführen von bash-Befehlen nach
  - Ideal zum Erkunden unbekannter Codebases oder zum Planen von Änderungen

Außerdem ist ein **general**-Subagent für komplexe Suchen und mehrstufige Aufgaben enthalten.
Dieser wird intern genutzt und kann in Nachrichten mit `@general` aufgerufen werden.

Mehr dazu unter [Agents](https://opencode.ai/docs/agents).

### Dokumentation

Mehr Infos zur Konfiguration von OpenCode findest du in unseren [**Docs**](https://opencode.ai/docs).

### Beitragen

Wenn du zu OpenCode beitragen möchtest, lies bitte unsere [Contributing Docs](./CONTRIBUTING.md), bevor du einen Pull Request einreichst.

### Auf OpenCode aufbauen

Wenn du an einem Projekt arbeitest, das mit OpenCode zusammenhängt und "opencode" als Teil seines Namens verwendet (z.B. "opencode-dashboard" oder "opencode-mobile"), füge bitte einen Hinweis in deine README ein, dass es nicht vom OpenCode-Team gebaut wird und nicht in irgendeiner Weise mit uns verbunden ist.

### FAQ

#### Worin unterscheidet sich das von Claude Code?

In Bezug auf die Fähigkeiten ist es Claude Code sehr ähnlich. Hier sind die wichtigsten Unterschiede:

- 100% open source
- Nicht an einen Anbieter gekoppelt. Wir empfehlen die Modelle aus [OpenCode Zen](https://opencode.ai/zen); OpenCode kann aber auch mit Claude, OpenAI, Google oder sogar lokalen Modellen genutzt werden. Mit der Weiterentwicklung der Modelle werden die Unterschiede kleiner und die Preise sinken, deshalb ist Provider-Unabhängigkeit wichtig.
- LSP-Unterstützung direkt nach dem Start
- Fokus auf TUI. OpenCode wird von Neovim-Nutzern und den Machern von [terminal.shop](https://terminal.shop) gebaut; wir treiben die Grenzen dessen, was im Terminal möglich ist.
- Client/Server-Architektur. Das ermöglicht z.B., OpenCode auf deinem Computer laufen zu lassen, während du es von einer mobilen App aus fernsteuerst. Das TUI-Frontend ist nur einer der möglichen Clients.

---

**Tritt unserer Community bei** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
