<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">AI-агент для програмування з відкритим кодом.</p>
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

## Можливості форку

> Це форк [anomalyco/opencode](https://github.com/anomalyco/opencode), який підтримується [Rwanbt](https://github.com/Rwanbt).
> Синхронізується з upstream. Дивіться [гілку dev](https://github.com/Rwanbt/opencode/tree/dev) для останніх змін.

#### Фонові завдання

Делегуйте роботу підагентам, що працюють асинхронно. Встановіть `mode: "background"` на інструменті task, і він одразу поверне `task_id`, поки агент працює у фоновому режимі. Bus-події (`TaskCreated`, `TaskCompleted`, `TaskFailed`) публікуються для відстеження життєвого циклу.

#### Команди агентів

Оркеструйте кілька агентів паралельно за допомогою інструменту `team`. Визначте підзавдання з ребрами залежностей; `computeWaves()` будує DAG і виконує незалежні завдання одночасно (до 5 паралельних агентів). Контроль бюджету через `max_cost` (долари) та `max_agents`. Контекст з виконаних завдань автоматично передається залежним.

#### Ізоляція Git Worktree

Кожне фонове завдання автоматично отримує власний git worktree. Робочий простір прив'язується до сесії в базі даних. Якщо завдання не створює змін у файлах, worktree автоматично очищується. Це забезпечує ізоляцію на рівні git без контейнерів.

#### API керування завданнями

Повний REST API для керування життєвим циклом завдань:

| Method | Path | Опис |
|--------|------|------|
| GET | `/task/` | Список завдань (фільтр за parent, status) |
| GET | `/task/:id` | Деталі завдання + status + інформація про worktree |
| GET | `/task/:id/messages` | Отримати повідомлення сесії завдання |
| POST | `/task/:id/cancel` | Скасувати запущене або завдання в черзі |
| POST | `/task/:id/resume` | Відновити завершене/невдале/заблоковане завдання |
| POST | `/task/:id/followup` | Надіслати подальше повідомлення неактивному завданню |
| POST | `/task/:id/promote` | Підвищити фонове завдання до переднього плану |
| GET | `/task/:id/team` | Зведений вигляд команди (витрати, diff по учасниках) |

#### Панель завдань TUI

Плагін бічної панелі, що показує активні фонові завдання з іконками статусу в реальному часі:

| Іконка | Статус |
|--------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Діалог з діями: відкрити сесію завдання, скасувати, відновити, надіслати подальше повідомлення, перевірити статус.

#### Обмеження агентів MCP

Списки дозволу/заборони для серверів MCP на рівні кожного агента. Налаштовується в `opencode.json` у полі `mcp` кожного агента. Функція `toolsForAgent()` фільтрує доступні інструменти MCP на основі області дії викликаючого агента.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### Життєвий цикл сесії з 9 станів

Сесії відстежують один з 9 станів, що зберігаються в базі даних:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Постійні стани (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) зберігаються після перезапуску бази даних. Стани в пам'яті (`idle`, `busy`, `retry`) скидаються при перезапуску.

#### Агент-оркестратор

Координуючий агент лише для читання (максимум 50 кроків). Має доступ до інструментів `task` та `team`, але всі інструменти редагування заборонені. Делегує реалізацію агентам build/general та синтезує результати.

## Технічна архітектура

### Підтримка кількох провайдерів

21+ провайдерів одразу: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, а також будь-який OpenAI-сумісний endpoint. Ціни з [models.dev](https://models.dev).

### Система агентів

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

### Інтеграція LSP

Повна підтримка Language Server Protocol з індексуванням символів, діагностикою та підтримкою кількох мов (TypeScript, Deno, Vue та розширювана). Агент навігує по коду через символи LSP замість текстового пошуку, забезпечуючи точний go-to-definition, find-references та виявлення помилок типів у реальному часі.

### Підтримка MCP

Model Context Protocol клієнт і сервер. Підтримує stdio, HTTP/SSE та StreamableHTTP транспорти. Потік автентифікації OAuth для віддалених серверів. Можливості tool, prompt та resource. Область дії для кожного агента через allow/deny списки.

### Архітектура клієнт/сервер

REST API на базі Hono з типізованими маршрутами та генерацією OpenAPI spec. Підтримка WebSocket для PTY (pseudo-terminal). SSE для потокової передачі подій у реальному часі. Basic auth, CORS, gzip стиснення. TUI -- це один frontend; сервером можна керувати з будь-якого HTTP-клієнта, web UI або мобільного додатку.

### Керування контекстом

Auto-compact з AI-керованим підсумовуванням, коли використання токенів наближається до ліміту контексту моделі. Обрізка з урахуванням токенів із налаштовуваними порогами (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Виходи Skill tool захищені від обрізки.

### Двигун редагування

Unified diff патчинг з перевіркою hunk. Застосовує цільові hunk до конкретних ділянок файлу замість повного перезапису. Multi-edit tool для пакетних операцій між файлами.

### Система дозволів

3-станові дозволи (`allow` / `deny` / `ask`) з відповідністю шаблонів wildcard. 100+ визначень arity команд bash для детального контролю. Примусове дотримання меж проєкту запобігає доступу до файлів за межами workspace.

### Відкат через Git

Система snapshot, що записує стан файлів перед кожним виконанням інструменту. Підтримує `revert` та `unrevert` з обчисленням diff. Зміни можна відкотити за повідомленням або за сесією.

### Відстеження витрат

Вартість за повідомлення з повною розбивкою токенів (input, output, reasoning, cache read, cache write). Бюджетні ліміти для команд (`max_cost`). Команда `stats` з агрегацією за моделлю та за день. Вартість сесії в реальному часі відображається в TUI. Дані про ціни з models.dev.

### Система плагінів

Повний SDK (`@opencode/plugin`) з архітектурою hook. Динамічне завантаження з npm-пакетів або файлової системи. Вбудовані плагіни для автентифікації Codex, GitHub Copilot, GitLab та Poe.

---

## Поширені хибні уявлення

Щоб запобігти плутанині через AI-генеровані підсумки цього проєкту:

- **TUI написаний на TypeScript** (SolidJS + @opentui для рендерингу в терміналі), не на Rust.
- **Tree-sitter** використовується лише для підсвічування синтаксису TUI та парсингу команд bash, а не для аналізу коду на рівні агента.
- **Немає Docker/E2B sandboxing** -- ізоляція забезпечується через git worktrees.
- **Немає векторної бази даних або системи RAG** -- контекст керується через LSP symbol indexing + auto-compact.
- **Немає "watch mode", що пропонує автоматичні виправлення** -- file watcher існує лише для інфраструктурних цілей.
- **Самокорекція** використовує стандартний цикл агента (LLM бачить помилки в результатах інструментів і повторює спробу), а не спеціалізований механізм авторемонту.

## Матриця можливостей

| Можливість | Status | Notes |
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
| Vector DB / RAG | Not implemented | LSP + auto-compact covers needs |
| Dry run / command preview | Not implemented | Permission system validates pre-exec |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

---

### Встановлення

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Менеджери пакетів
npm i -g opencode-ai@latest        # або bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS і Linux (рекомендовано, завжди актуально)
brew install opencode              # macOS і Linux (офіційна формула Homebrew, оновлюється рідше)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Будь-яка ОС
nix run nixpkgs#opencode           # або github:anomalyco/opencode для найновішої dev-гілки
```

> [!TIP]
> Перед встановленням видаліть версії старші за 0.1.x.

### Десктопний застосунок (BETA)

OpenCode також доступний як десктопний застосунок. Завантажуйте напряму зі [сторінки релізів](https://github.com/anomalyco/opencode/releases) або [opencode.ai/download](https://opencode.ai/download).

| Платформа             | Завантаження                          |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` або AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Каталог встановлення

Скрипт встановлення дотримується такого порядку пріоритету для шляху встановлення:

1. `$OPENCODE_INSTALL_DIR` - Користувацький каталог встановлення
2. `$XDG_BIN_DIR` - Шлях, сумісний зі специфікацією XDG Base Directory
3. `$HOME/bin` - Стандартний каталог користувацьких бінарників (якщо існує або його можна створити)
4. `$HOME/.opencode/bin` - Резервний варіант за замовчуванням

```bash
# Приклади
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Агенти

OpenCode містить два вбудовані агенти, між якими можна перемикатися клавішею `Tab`.

- **build** - Агент за замовчуванням із повним доступом для завдань розробки
- **plan** - Агент лише для читання для аналізу та дослідження коду
  - За замовчуванням забороняє редагування файлів
  - Запитує дозвіл перед запуском bash-команд
  - Ідеально підходить для дослідження незнайомих кодових баз або планування змін

Також доступний допоміжний агент **general** для складного пошуку та багатокрокових завдань.
Він використовується всередині системи й може бути викликаний у повідомленнях через `@general`.

Дізнайтеся більше про [agents](https://opencode.ai/docs/agents).

### Документація

Щоб дізнатися більше про налаштування OpenCode, [**перейдіть до нашої документації**](https://opencode.ai/docs).

### Внесок

Якщо ви хочете зробити внесок в OpenCode, будь ласка, прочитайте нашу [документацію для контриб'юторів](./CONTRIBUTING.md) перед надсиланням pull request.

### Проєкти на базі OpenCode

Якщо ви працюєте над проєктом, пов'язаним з OpenCode, і використовуєте "opencode" у назві, наприклад "opencode-dashboard" або "opencode-mobile", додайте примітку до свого README.
Уточніть, що цей проєкт не створений командою OpenCode і жодним чином не афілійований із нами.

### FAQ

#### Чим це відрізняється від Claude Code?

За можливостями це дуже схоже на Claude Code. Ось ключові відмінності:

- 100% open source
- Немає прив'язки до конкретного провайдера. Ми рекомендуємо моделі, які надаємо через [OpenCode Zen](https://opencode.ai/zen), але OpenCode також працює з Claude, OpenAI, Google і навіть локальними моделями. З розвитком моделей різниця між ними зменшуватиметься, а ціни падатимуть, тому незалежність від провайдера має значення.
- Підтримка LSP з коробки
- Фокус на TUI. OpenCode створено користувачами neovim та авторами [terminal.shop](https://terminal.shop); ми й надалі розширюватимемо межі можливого в терміналі.
- Клієнт-серверна архітектура. Наприклад, це дає змогу запускати OpenCode на вашому комп'ютері й керувати ним віддалено з мобільного застосунку, тобто TUI-фронтенд - лише один із можливих клієнтів.

---

**Приєднуйтеся до нашої спільноти** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
