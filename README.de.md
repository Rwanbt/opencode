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
## Warum dieser Fork?

> **Kurzfassung** — der einzige Open-Source-Coding-Agent, der einen DAG-basierten Orchestrator, eine REST-Task-API, per-Agent-MCP-Scoping, eine 9-Zustands-Session-FSM, einen eingebauten Schwachstellen-Scanner *und* eine erstklassige Android-App mit On-Device-LLM-Inferenz ausliefert. Kein anderes CLI – proprietär oder offen – kombiniert all das.

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

## Fork-Funktionen

> Dies ist ein Fork von [anomalyco/opencode](https://github.com/anomalyco/opencode), gepflegt von [Rwanbt](https://github.com/Rwanbt).
> Synchron mit Upstream gehalten. Siehe [Dev-Branch](https://github.com/Rwanbt/opencode/tree/dev) für die neuesten Änderungen.

#### Local-First KI

OpenCode führt KI-Modelle lokal auf Consumer-Hardware aus (8 GB VRAM / 16 GB RAM), ohne jegliche Cloud-Abhängigkeit für 4B-7B Modelle.

**Prompt-Optimierung (94% Reduktion)**
- ~1K Token System-Prompt für lokale Modelle (vs ~16K für Cloud)
- Skelett-Tool-Schemas (1-Zeilen-Signaturen vs mehre KB Prosa)
- 7-Tool-Whitelist (bash, read, edit, write, glob, grep, question)
- Keine Skills-Sektion, minimale Umgebungsinformationen

**Inferenz-Engine (llama.cpp b8731)**
- Vulkan GPU-Backend, automatisch heruntergeladen beim ersten Modell-Load
- **Adaptive Laufzeitkonfiguration** (`packages/opencode/src/local-llm-server/auto-config.ts`): `n_gpu_layers`, Threads, Batch/Ubatch-Größe, KV-Cache-Quantisierung und Kontextgröße werden aus erkannter VRAM, freiem RAM, big.LITTLE-CPU-Aufteilung, GPU-Backend (CUDA/ROCm/Vulkan/Metal/OpenCL) und Wärmezustand abgeleitet. Ersetzt das alte fest codierte `--n-gpu-layers 99` — ein 4 GB Android läuft jetzt im CPU-Fallback statt mit OOM beendet zu werden, Flaggschiff-Desktops erhalten einen abgestimmten Batch statt des Standardwerts 512.
- `--flash-attn on` — Flash Attention für Speichereffizienz
- `--cache-type-k/v` — KV-Cache mit -Rotation; adaptive Stufe (f16 / q8_0 / q4_0) je nach VRAM-Reserve
- `--fit on` — fork-exklusive sekundäre VRAM-Anpassung (opt-in via `OPENCODE_LLAMA_ENABLE_FIT=1`)
- Spekulative Dekodierung (`--model-draft`) mit VRAM-Guard (automatische Deaktivierung bei < 4 GB frei)
- Einzelner Slot (`-np 1`) zur Minimierung des Speicherbedarfs
- **Benchmark-Harness** (`bun run bench:llm`): reproduzierbare Messung von FTL / TPS / RSS-Spitze / Wandzeit pro Modell und Lauf, JSONL-Ausgabe für CI-Archivierung

**Spracherkennung (Parakeet TDT 0.6B v3 INT8)**
- NVIDIA Parakeet über ONNX Runtime — ~300ms für 5s Audio (18x Echtzeit)
- 25 europäische Sprachen (Englisch, Französisch, Deutsch, Spanisch usw.)
- Null VRAM: nur CPU (~700 MB RAM)
- Automatischer Modell-Download (~460 MB) beim ersten Mikrofondruck
- Wellenform-Animation während der Aufnahme

**Sprachsynthese (Kyutai Pocket TTS)**
- Französisch-natives TTS von Kyutai (Paris), 100M Parameter
- 8 eingebaute Stimmen: Alba, Fantine, Cosette, Eponine, Azelma, Marius, Javert, Jean
- Zero-Shot-Stimmklonierung: WAV hochladen oder vom Mikrofon aufnehmen
- Nur CPU, ~6x Echtzeit, HTTP-Server auf Port 14100
- Fallback: Kokoro TTS ONNX-Engine (54 Stimmen, 9 Sprachen, CMUDict G2P)

**Modellverwaltung**
- HuggingFace-Suche mit VRAM/RAM-Kompatibilitätsbadges pro Modell
- GGUF-Modelle über die Oberfläche herunterladen, laden, entladen, löschen
- Vorkuratierter Katalog: Gemma 3 4B, Qwen3 4B/1.7B/0.6B
- Dynamische Ausgabe-Tokens basierend auf Modellgröße
- Automatische Draft-Modell-Erkennung (0.5B-0.8B) für spekulative Dekodierung

**Konfiguration**
- Voreinstellungen: Fast / Quality / Eco / Long Context (Ein-Klick-Optimierung)
- VRAM-Überwachungs-Widget mit farbcodiertem Nutzungsbalken (grün / gelb / rot)
- KV-Cache-Typ: auto / q8_0 / q4_0 / f16
- GPU-Auslagerung: auto / gpu-max / balanced
- Memory Mapping: auto / on / off
- Web-Suche-Umschalter (Globus-Symbol in der Prompt-Leiste)

**Agenten-Zuverlässigkeit (lokale Modelle)**
- Pre-Flight-Guards (Code-Ebene, 0 Tokens): Datei-Existenzprüfung vor Bearbeitung, old_string-Inhaltsverifikation, Lesen-vor-Bearbeiten-Erzwingung, Schreiben-auf-Existierende-Prävention
- Automatischer Endlosschleifen-Abbruch: 2x identische Tool-Aufrufe → Fehler eingefügt (Code-Ebene-Guard, nicht nur im Prompt)
- Tool-Telemetrie: Erfolgs-/Fehlerrate pro Sitzung mit Aufschlüsselung pro Tool, automatisch protokolliert

**Plattformübergreifend**: Windows (Vulkan), Linux, macOS, Android

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
| Memory conflict resolution | Dead code | `rag/conflict.ts` is unit-tested but not invoked in production; treat as unimplemented |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

### Lokale KI (Desktop + Mobile)
| Fähigkeit | Status | Anmerkungen |
|-----------|--------|-------------|
| Local LLM (llama.cpp b8731) | Implemented | Vulkan GPU, auto-download runtime, `--fit` auto-VRAM |
| **Adaptive Laufzeitkonfiguration** | Implemented | `auto-config.ts`: n_gpu_layers / Threads / Batch / KV-Quantisierung aus erkannter VRAM, RAM, big.LITTLE, GPU-Backend, Wärmezustand abgeleitet |
| **Benchmark-Harness** | Implemented | `bun run bench:llm` misst FTL, TPS, RSS-Spitze, Wandzeit pro Modell; JSONL-Ausgabe |
| Flash Attention | Implemented | `--flash-attn on` on desktop and mobile |
| KV cache quantization | Implemented | q4_0 / q8_0 / f16 adaptive with standard llama.cpp quantization (~50% KV memory savings at q4_0) |
| Exact tokenizer (OpenAI) | Implemented | `js-tiktoken` für gpt-*/o1/o3/o4; empirisch 3.5 Zeichen/Token für Llama/Qwen/Gemma |
| Speculative decoding | Implemented | VRAM Guard (desktop) / RAM Guard (mobile), draft model auto-detection |
| HuggingFace model search | Implemented | Zod-validierte Antwort, VRAM-Badges, Download-Manager, 9 vorkuratierte Modelle |
| **Fortsetzbare GGUF-Downloads** | Implemented | HTTP `Range`-Header — eine 4G-Unterbrechung startet keinen 4 GB-Transfer bei Null neu |
| Tool telemetry | Implemented | Per-session success/error rate logging with per-tool breakdown |
| Circuit-Breaker-Neustart | Implemented | `ensureCorrectModel` bricht nach 3 Neustarts in 120 s ab, um Burn-Cycle-Schleifen zu vermeiden |

### Sicherheit und Governance
| Fähigkeit | Status | Anmerkungen |
|-----------|--------|-------------|
| **Strenge CSP (Desktop + Mobile)** | Implemented | `connect-src` beschränkt auf loopback + HuggingFace + HTTPS-Anbieter; kein `unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'` |
| **Android-Release-Härtung** | Implemented | `isDebuggable=false`, `allowBackup=false`, `isShrinkResources=true`, `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` |
| **Desktop-Release-Härtung** | Implemented | Devtools werden nicht länger erzwungen aktiviert — der Tauri-2-Standardwert (nur im Debug) wurde wiederhergestellt, damit ein XSS-Brückenkopf sich in Produktion nicht an `__TAURI__` anheften kann |
| **Tauri-Befehlseingabevalidierung** | Implemented | `download_model` / `load_llm_model` / `delete_model`-Guards: Dateinamen-Charset, HTTPS-Allowlist auf `huggingface.co` / `hf.co` |
| **Rust-Logging-Kette** | Implemented | `log` + `android_logger` auf Mobile; kein `eprintln!` in Release → keine Pfad/URL-Lecks in logcat |
| **Security-Audit-Tracker** | Implemented | [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — alle Befunde als S1/S2/S3 klassifiziert mit `path:line`, Status und Begründung für verschobene Korrekturen |

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

OpenCode ist auch als Desktop-Anwendung verfügbar. Lade sie direkt von der [Releases-Seite](https://github.com/Rwanbt/opencode/releases) oder [opencode.ai/download](https://opencode.ai/download) herunter.

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
