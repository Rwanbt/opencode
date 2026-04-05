<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Открытый AI-агент для программирования.</p>
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

## Функции Форка

> Это форк [anomalyco/opencode](https://github.com/anomalyco/opencode), поддерживаемый [Rwanbt](https://github.com/Rwanbt).
> Синхронизируется с upstream. Смотрите [ветку dev](https://github.com/Rwanbt/opencode/tree/dev) для последних изменений.

#### Фоновые Задачи

Делегируйте работу субагентам, работающим асинхронно. Установите `mode: "background"` в инструменте task, и он немедленно вернёт `task_id`, пока агент работает в фоне. События шины (`TaskCreated`, `TaskCompleted`, `TaskFailed`) публикуются для отслеживания жизненного цикла.

#### Команды Агентов

Оркестрируйте несколько агентов параллельно с помощью инструмента `team`. Определите подзадачи с рёбрами зависимостей; `computeWaves()` строит DAG и выполняет независимые задачи одновременно (до 5 параллельных агентов). Контроль бюджета через `max_cost` (доллары) и `max_agents`. Контекст завершённых задач автоматически передаётся зависимым.

#### Изоляция Git Worktree

Каждая фоновая задача автоматически получает собственное git worktree. Рабочее пространство привязано к сессии в базе данных. Если задача не производит изменений файлов, worktree автоматически очищается. Это обеспечивает изоляцию на уровне git без контейнеров.

#### API Управления Задачами

Полный REST API для управления жизненным циклом задач:

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

#### TUI-панель Задач

Плагин боковой панели, показывающий активные фоновые задачи с иконками статуса в реальном времени:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Диалог с действиями: открыть сессию задачи, отменить, возобновить, отправить продолжение, проверить статус.

#### Область Видимости MCP по Агентам

Списки разрешений/запретов для MCP-серверов по каждому агенту. Настройте в `opencode.json` в поле `mcp` каждого агента. Функция `toolsForAgent()` фильтрует доступные инструменты MCP на основе области видимости вызывающего агента.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9-состоянийный Жизненный Цикл Сессии

Сессии отслеживают одно из 9 состояний, сохраняемых в базе данных:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Постоянные состояния (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) переживают перезапуски базы данных. Состояния в памяти (`idle`, `busy`, `retry`) сбрасываются при перезапуске.

#### Агент-оркестратор

Координирующий агент только для чтения (максимум 50 шагов). Имеет доступ к инструментам `task` и `team`, но все инструменты редактирования запрещены. Делегирует реализацию build-/общим агентам и синтезирует результаты.

---

## Техническая Архитектура

### Поддержка Множества Провайдеров

21+ провайдеров из коробки: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, плюс любой OpenAI-совместимый endpoint. Цены получены с [models.dev](https://models.dev).

### Система Агентов

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | Агент разработки по умолчанию |
| **plan** | primary | read-only | Анализ и исследование кода |
| **general** | subagent | full (no todowrite) | Сложные многоэтапные задачи |
| **explore** | subagent | read-only | Быстрый поиск по кодовой базе |
| **orchestrator** | subagent | read-only + task/team | Мульти-агентный координатор (50 шагов) |
| compaction | hidden | none | AI-управляемое сжатие контекста |
| title | hidden | none | Генерация заголовка сессии |
| summary | hidden | none | Резюмирование сессии |

### Интеграция LSP

Полная поддержка Language Server Protocol с индексацией символов, диагностикой и поддержкой нескольких языков (TypeScript, Deno, Vue и расширяемый). Агент навигирует по коду через символы LSP, а не текстовый поиск, обеспечивая точное go-to-definition, find-references и обнаружение ошибок типов в реальном времени.

### Поддержка MCP

Клиент и сервер Model Context Protocol. Поддерживает транспорты stdio, HTTP/SSE и StreamableHTTP. Поток аутентификации OAuth для удалённых серверов. Возможности инструментов, промптов и ресурсов. Область действия per-agent через списки allow/deny.

### Архитектура Client/Server

REST API на основе Hono с типизированными маршрутами и генерацией спецификации OpenAPI. Поддержка WebSocket для PTY (псевдо-терминал). SSE для потоковой передачи событий в реальном времени. Basic auth, CORS, gzip-сжатие. TUI — один из фронтендов; сервер может управляться из любого HTTP-клиента, веб-интерфейса или мобильного приложения.

### Управление Контекстом

Auto-compact с AI-управляемым резюмированием при приближении использования токенов к лимиту контекста модели. Обрезка с учётом токенов и настраиваемыми порогами (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Выходные данные инструмента Skill защищены от обрезки.

### Движок Редактирования

Unified diff-патчинг с верификацией hunks. Применяет целевые hunks к определённым участкам файла вместо полной перезаписи файла. Инструмент multi-edit для пакетных операций над файлами.

### Система Разрешений

3-уровневые разрешения (`allow` / `deny` / `ask`) с сопоставлением шаблонов с подстановочными знаками. 100+ определений арности bash-команд для детального контроля. Принудительное соблюдение границ проекта предотвращает доступ к файлам за пределами workspace.

### Откат на Основе Git

Система снимков, записывающая состояние файлов перед каждым выполнением инструмента. Поддерживает `revert` и `unrevert` с вычислением различий. Изменения могут быть отменены по сообщению или по сессии.

### Отслеживание Затрат

Стоимость за сообщение с полной разбивкой токенов (input, output, reasoning, cache read, cache write). Лимиты бюджета per-team (`max_cost`). Команда `stats` с агрегацией per-model и per-day. Стоимость сессии в реальном времени отображается в TUI. Данные о ценах получены с models.dev.

### Система Плагинов

Полный SDK (`@opencode/plugin`) с архитектурой хуков. Динамическая загрузка из npm-пакетов или файловой системы. Встроенные плагины для аутентификации Codex, GitHub Copilot, GitLab и Poe.

---

## Распространённые Заблуждения

Для предотвращения путаницы из-за AI-сгенерированных резюме этого проекта:

- **TUI написан на TypeScript** (SolidJS + @opentui для рендеринга в терминале), не на Rust.
- **Tree-sitter** используется только для подсветки синтаксиса в TUI и парсинга bash-команд, а не для анализа кода на уровне агента.
- **Нет Docker/E2B-песочницы** -- изоляция обеспечивается git worktree.
- **Нет векторной базы данных или системы RAG** -- контекст управляется через индексацию символов LSP + auto-compact.
- **Нет "режима наблюдения", предлагающего автоматические исправления** -- file watcher существует только для инфраструктурных целей.
- **Самокоррекция** использует стандартный цикл агента (LLM видит ошибки в результатах инструментов и повторяет попытку), а не специализированный механизм авто-восстановления.

## Матрица Возможностей

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

### Установка

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Менеджеры пакетов
npm i -g opencode-ai@latest        # или bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS и Linux (рекомендуем, всегда актуально)
brew install opencode              # macOS и Linux (официальная формула brew, обновляется реже)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # любая ОС
nix run nixpkgs#opencode           # или github:anomalyco/opencode для самой свежей ветки dev
```

> [!TIP]
> Перед установкой удалите версии старше 0.1.x.

### Десктопное приложение (BETA)

OpenCode также доступен как десктопное приложение. Скачайте его со [страницы релизов](https://github.com/anomalyco/opencode/releases) или с [opencode.ai/download](https://opencode.ai/download).

| Платформа             | Загрузка                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` или AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Каталог установки

Скрипт установки выбирает путь установки в следующем порядке приоритета:

1. `$OPENCODE_INSTALL_DIR` - Пользовательский каталог установки
2. `$XDG_BIN_DIR` - Путь, совместимый со спецификацией XDG Base Directory
3. `$HOME/bin` - Стандартный каталог пользовательских бинарников (если существует или можно создать)
4. `$HOME/.opencode/bin` - Fallback по умолчанию

```bash
# Примеры
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

В OpenCode есть два встроенных агента, между которыми можно переключаться клавишей `Tab`.

- **build** - По умолчанию, агент с полным доступом для разработки
- **plan** - Агент только для чтения для анализа и изучения кода
  - По умолчанию запрещает редактирование файлов
  - Запрашивает разрешение перед выполнением bash-команд
  - Идеален для изучения незнакомых кодовых баз или планирования изменений

Также включен сабагент **general** для сложных поисков и многошаговых задач.
Он используется внутренне и может быть вызван в сообщениях через `@general`.

Подробнее об [agents](https://opencode.ai/docs/agents).

### Документация

Больше информации о том, как настроить OpenCode: [**наши docs**](https://opencode.ai/docs).

### Вклад

Если вы хотите внести вклад в OpenCode, прочитайте [contributing docs](./CONTRIBUTING.md) перед тем, как отправлять pull request.

### Разработка на базе OpenCode

Если вы делаете проект, связанный с OpenCode, и используете "opencode" как часть имени (например, "opencode-dashboard" или "opencode-mobile"), добавьте примечание в README, чтобы уточнить, что проект не создан командой OpenCode и не аффилирован с нами.

### FAQ

#### Чем это отличается от Claude Code?

По возможностям это очень похоже на Claude Code. Вот ключевые отличия:

- 100% open source
- Не привязано к одному провайдеру. Мы рекомендуем модели из [OpenCode Zen](https://opencode.ai/zen); но OpenCode можно использовать с Claude, OpenAI, Google или даже локальными моделями. По мере развития моделей разрыв будет сокращаться, а цены падать, поэтому важна независимость от провайдера.
- Поддержка LSP из коробки
- Фокус на TUI. OpenCode построен пользователями neovim и создателями [terminal.shop](https://terminal.shop); мы будем раздвигать границы того, что возможно в терминале.
- Архитектура клиент/сервер. Например, это позволяет запускать OpenCode на вашем компьютере, а управлять им удаленно из мобильного приложения. Это значит, что TUI-фронтенд - лишь один из возможных клиентов.

---

**Присоединяйтесь к нашему сообществу** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
