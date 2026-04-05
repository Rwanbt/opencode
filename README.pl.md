<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Otwartoźródłowy agent kodujący AI.</p>
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

## Funkcje Forka

> To jest fork [anomalyco/opencode](https://github.com/anomalyco/opencode) utrzymywany przez [Rwanbt](https://github.com/Rwanbt).
> Synchronizowany z upstream. Zobacz [gałąź dev](https://github.com/Rwanbt/opencode/tree/dev), aby poznać najnowsze zmiany.

#### Zadania w Tle

Deleguj pracę do subagentów działających asynchronicznie. Ustaw `mode: "background"` w narzędziu task, a natychmiast zwróci `task_id`, podczas gdy agent pracuje w tle. Zdarzenia magistrali (`TaskCreated`, `TaskCompleted`, `TaskFailed`) są publikowane do śledzenia cyklu życia.

#### Zespoły Agentów

Orkiestruj wielu agentów równolegle za pomocą narzędzia `team`. Zdefiniuj podzadania z krawędziami zależności; `computeWaves()` buduje DAG i wykonuje niezależne zadania współbieżnie (do 5 równoległych agentów). Kontrola budżetu przez `max_cost` (dolary) i `max_agents`. Kontekst z ukończonych zadań jest automatycznie przekazywany do zależnych.

#### Izolacja Git Worktree

Każde zadanie w tle automatycznie otrzymuje własne git worktree. Przestrzeń robocza jest powiązana z sesją w bazie danych. Jeśli zadanie nie produkuje zmian w plikach, worktree jest automatycznie czyszczone. Zapewnia to izolację na poziomie git bez kontenerów.

#### API Zarządzania Zadaniami

Pełne REST API do zarządzania cyklem życia zadań:

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

#### Panel Zadań TUI

Plugin paska bocznego pokazujący aktywne zadania w tle z ikonami statusu w czasie rzeczywistym:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Dialog z akcjami: otwórz sesję zadania, anuluj, wznów, wyślij kontynuację, sprawdź status.

#### Zakres MCP na Agenta

Listy zezwoleń/blokad dla serwerów MCP per agent. Konfiguruj w `opencode.json` pod polem `mcp` każdego agenta. Funkcja `toolsForAgent()` filtruje dostępne narzędzia MCP na podstawie zakresu wywołującego agenta.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9-stanowy Cykl Życia Sesji

Sesje śledzą jeden z 9 stanów, zapisywanych w bazie danych:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Stany trwałe (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) przetrwają restarty bazy danych. Stany w pamięci (`idle`, `busy`, `retry`) resetują się przy restarcie.

#### Agent Orkiestrator

Agent koordynujący tylko do odczytu (maksymalnie 50 kroków). Ma dostęp do narzędzi `task` i `team`, ale wszystkie narzędzia edycji są zablokowane. Deleguje implementację do agentów build/ogólnych i syntetyzuje wyniki.

---

## Architektura Techniczna

### Wsparcie dla Wielu Dostawców

21+ dostawców gotowych do użycia: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, plus dowolny endpoint kompatybilny z OpenAI. Ceny pochodzą z [models.dev](https://models.dev).

### System Agentów

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | Domyślny agent deweloperski |
| **plan** | primary | read-only | Analiza i eksploracja kodu |
| **general** | subagent | full (no todowrite) | Złożone zadania wieloetapowe |
| **explore** | subagent | read-only | Szybkie przeszukiwanie bazy kodu |
| **orchestrator** | subagent | read-only + task/team | Koordynator wielu agentów (50 kroków) |
| compaction | hidden | none | Podsumowanie kontekstu sterowane przez AI |
| title | hidden | none | Generowanie tytułu sesji |
| summary | hidden | none | Podsumowanie sesji |

### Integracja LSP

Pełne wsparcie dla Language Server Protocol z indeksowaniem symboli, diagnostyką i obsługą wielu języków (TypeScript, Deno, Vue i rozszerzalny). Agent nawiguje po kodzie za pomocą symboli LSP zamiast wyszukiwania tekstowego, umożliwiając precyzyjne go-to-definition, find-references i wykrywanie błędów typów w czasie rzeczywistym.

### Wsparcie MCP

Klient i serwer Model Context Protocol. Obsługuje transporty stdio, HTTP/SSE i StreamableHTTP. Przepływ uwierzytelniania OAuth dla serwerów zdalnych. Możliwości narzędzi, promptów i zasobów. Zakres per-agent za pomocą list allow/deny.

### Architektura Client/Server

API REST oparte na Hono z typowanymi trasami i generowaniem specyfikacji OpenAPI. Obsługa WebSocket dla PTY (pseudo-terminal). SSE do strumieniowania zdarzeń w czasie rzeczywistym. Basic auth, CORS, kompresja gzip. TUI jest jednym frontendem; serwer może być sterowany z dowolnego klienta HTTP, interfejsu webowego lub aplikacji mobilnej.

### Zarządzanie Kontekstem

Auto-compact z podsumowaniem sterowanym przez AI, gdy zużycie tokenów zbliża się do limitu kontekstu modelu. Przycinanie świadome tokenów z konfigurowalnymi progami (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Wyjścia narzędzia Skill są chronione przed przycinaniem.

### Silnik Edycji

Patchowanie unified diff z weryfikacją hunków. Stosuje celowane hunki do określonych regionów pliku zamiast pełnego nadpisywania pliku. Narzędzie multi-edit do operacji wsadowych na wielu plikach.

### System Uprawnień

Uprawnienia 3-stanowe (`allow` / `deny` / `ask`) z dopasowaniem wzorców z użyciem znaków wieloznacznych. 100+ definicji arności komend bash dla precyzyjnej kontroli. Egzekwowanie granic projektu zapobiega dostępowi do plików poza workspace.

### Rollback Oparty na Git

System snapshotów rejestrujący stan plików przed każdym wykonaniem narzędzia. Obsługuje `revert` i `unrevert` z obliczaniem różnic. Zmiany mogą być cofane per wiadomość lub per sesja.

### Śledzenie Kosztów

Koszt per wiadomość z pełnym rozbiciem tokenów (input, output, reasoning, cache read, cache write). Limity budżetu per-team (`max_cost`). Komenda `stats` z agregacją per-model i per-dzień. Koszt sesji w czasie rzeczywistym wyświetlany w TUI. Dane cenowe pobierane z models.dev.

### System Wtyczek

Pełne SDK (`@opencode/plugin`) z architekturą hooków. Dynamiczne ładowanie z pakietów npm lub systemu plików. Wbudowane wtyczki do uwierzytelniania Codex, GitHub Copilot, GitLab i Poe.

---

## Częste Nieporozumienia

Aby zapobiec dezinformacji z podsumowań tego projektu generowanych przez AI:

- **TUI jest w TypeScript** (SolidJS + @opentui do renderowania w terminalu), nie w Rust.
- **Tree-sitter** jest używany tylko do podświetlania składni w TUI i parsowania komend bash, nie do analizy kodu na poziomie agenta.
- **Nie ma sandboxingu Docker/E2B** -- izolacja jest zapewniana przez git worktree.
- **Nie ma bazy danych wektorowej ani systemu RAG** -- kontekst jest zarządzany przez indeksowanie symboli LSP + auto-compact.
- **Nie ma "trybu watch", który proponuje automatyczne poprawki** -- file watcher istnieje wyłącznie do celów infrastrukturalnych.
- **Autokorekta** używa standardowej pętli agenta (LLM widzi błędy w wynikach narzędzi i ponawia próbę), a nie wyspecjalizowanego mechanizmu auto-naprawy.

## Macierz Możliwości

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

### Instalacja

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Menedżery pakietów
npm i -g opencode-ai@latest        # albo bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS i Linux (polecane, zawsze aktualne)
brew install opencode              # macOS i Linux (oficjalna formuła brew, rzadziej aktualizowana)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # dowolny system
nix run nixpkgs#opencode           # lub github:anomalyco/opencode dla najnowszej gałęzi dev
```

> [!TIP]
> Przed instalacją usuń wersje starsze niż 0.1.x.

### Aplikacja desktopowa (BETA)

OpenCode jest także dostępny jako aplikacja desktopowa. Pobierz ją bezpośrednio ze strony [releases](https://github.com/anomalyco/opencode/releases) lub z [opencode.ai/download](https://opencode.ai/download).

| Platforma             | Pobieranie                            |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` lub AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Katalog instalacji

Skrypt instalacyjny stosuje następujący priorytet wyboru ścieżki instalacji:

1. `$OPENCODE_INSTALL_DIR` - Własny katalog instalacji
2. `$XDG_BIN_DIR` - Ścieżka zgodna ze specyfikacją XDG Base Directory
3. `$HOME/bin` - Standardowy katalog binarny użytkownika (jeśli istnieje lub można go utworzyć)
4. `$HOME/.opencode/bin` - Domyślny fallback

```bash
# Przykłady
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode zawiera dwóch wbudowanych agentów, między którymi możesz przełączać się klawiszem `Tab`.

- **build** - Domyślny agent z pełnym dostępem do pracy developerskiej
- **plan** - Agent tylko do odczytu do analizy i eksploracji kodu
  - Domyślnie odmawia edycji plików
  - Pyta o zgodę przed uruchomieniem komend bash
  - Idealny do poznawania nieznanych baz kodu lub planowania zmian

Dodatkowo jest subagent **general** do złożonych wyszukiwań i wieloetapowych zadań.
Jest używany wewnętrznie i można go wywołać w wiadomościach przez `@general`.

Dowiedz się więcej o [agents](https://opencode.ai/docs/agents).

### Dokumentacja

Więcej informacji o konfiguracji OpenCode znajdziesz w [**dokumentacji**](https://opencode.ai/docs).

### Współtworzenie

Jeśli chcesz współtworzyć OpenCode, przeczytaj [contributing docs](./CONTRIBUTING.md) przed wysłaniem pull requesta.

### Budowanie na OpenCode

Jeśli pracujesz nad projektem związanym z OpenCode i używasz "opencode" jako części nazwy (na przykład "opencode-dashboard" lub "opencode-mobile"), dodaj proszę notatkę do swojego README, aby wyjaśnić, że projekt nie jest tworzony przez zespół OpenCode i nie jest z nami w żaden sposób powiązany.

### FAQ

#### Czym to się różni od Claude Code?

Jest bardzo podobne do Claude Code pod względem możliwości. Oto kluczowe różnice:

- 100% open source
- Niezależne od dostawcy. Chociaż polecamy modele oferowane przez [OpenCode Zen](https://opencode.ai/zen); OpenCode może być używany z Claude, OpenAI, Google, a nawet z modelami lokalnymi. W miarę jak modele ewoluują, różnice będą się zmniejszać, a ceny spadać, więc ważna jest niezależność od dostawcy.
- Wbudowane wsparcie LSP
- Skupienie na TUI. OpenCode jest budowany przez użytkowników neovim i twórców [terminal.shop](https://terminal.shop); przesuwamy granice tego, co jest możliwe w terminalu.
- Architektura klient/serwer. Pozwala np. uruchomić OpenCode na twoim komputerze, a sterować nim zdalnie z aplikacji mobilnej. To znaczy, że frontend TUI jest tylko jednym z możliwych klientów.

---

**Dołącz do naszej społeczności** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
