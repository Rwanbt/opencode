<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="شعار OpenCode">
    </picture>
  </a>
</p>
<p align="center">وكيل برمجة بالذكاء الاصطناعي مفتوح المصدر.</p>
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

## ميزات الفورك

> هذا فورك من [anomalyco/opencode](https://github.com/anomalyco/opencode) يديره [Rwanbt](https://github.com/Rwanbt).
> يتم الحفاظ على المزامنة مع المستودع الأصلي. راجع [فرع dev](https://github.com/Rwanbt/opencode/tree/dev) لآخر التغييرات.

#### المهام الخلفية

فوّض العمل إلى وكلاء فرعيين يعملون بشكل غير متزامن. اضبط `mode: "background"` على أداة task وستُرجع `task_id` فوراً بينما يعمل الوكيل في الخلفية. يتم نشر أحداث الناقل (`TaskCreated`، `TaskCompleted`، `TaskFailed`) لتتبع دورة الحياة.

#### فرق الوكلاء

نسّق وكلاء متعددين بالتوازي باستخدام أداة `team`. حدد المهام الفرعية مع حواف التبعية؛ تبني `computeWaves()` رسم DAG وتنفذ المهام المستقلة بشكل متزامن (حتى 5 وكلاء متوازيين). التحكم في الميزانية عبر `max_cost` (بالدولار) و`max_agents`. يتم تمرير السياق من المهام المكتملة تلقائياً إلى المهام التابعة.

#### عزل Git worktree

تحصل كل مهمة خلفية تلقائياً على git worktree خاص بها. يرتبط مساحة العمل بالجلسة في قاعدة البيانات. إذا لم تُنتج المهمة أي تغييرات في الملفات، يتم تنظيف worktree تلقائياً. يوفر هذا عزلاً على مستوى git دون الحاجة إلى حاويات.

#### API لإدارة المهام

REST API كامل لإدارة دورة حياة المهام:

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

#### لوحة مهام TUI

إضافة شريط جانبي تعرض المهام الخلفية النشطة مع أيقونات الحالة في الوقت الفعلي:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

نافذة حوار مع إجراءات: فتح جلسة المهمة، إلغاء، استئناف، إرسال متابعة، التحقق من الحالة.

#### تحديد نطاق وكيل MCP

قوائم سماح/منع لخوادم MCP لكل وكيل. يتم الإعداد في `opencode.json` تحت حقل `mcp` لكل وكيل. تقوم دالة `toolsForAgent()` بتصفية أدوات MCP المتاحة بناءً على نطاق الوكيل المستدعي.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### دورة حياة الجلسة ذات 9 حالات

تتبع الجلسات إحدى 9 حالات، محفوظة في قاعدة البيانات:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

الحالات الدائمة (`queued`، `blocked`، `awaiting_input`، `completed`، `failed`، `cancelled`) تبقى بعد إعادة تشغيل قاعدة البيانات. الحالات المؤقتة في الذاكرة (`idle`، `busy`، `retry`) تُعاد تهيئتها عند إعادة التشغيل.

#### وكيل التنسيق

وكيل تنسيق للقراءة فقط (50 خطوة كحد أقصى). لديه صلاحية الوصول إلى أدوات `task` و`team` لكن جميع أدوات التحرير محظورة. يفوّض التنفيذ إلى وكلاء البناء/العامين ويجمّع النتائج.

---

## البنية التقنية

### دعم مزودين متعددين

أكثر من 21 مزوداً جاهزاً: Anthropic، OpenAI، Google Gemini، Azure، AWS Bedrock، Vertex AI، OpenRouter، GitHub Copilot، XAI، Mistral، Groq، DeepInfra، Cerebras، Cohere، TogetherAI، Perplexity، Vercel، Venice، GitLab، Gateway، بالإضافة إلى أي endpoint متوافق مع OpenAI. الأسعار مأخوذة من [models.dev](https://models.dev).

### نظام الوكلاء

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | Default development agent |
| **plan** | primary | read-only | Analysis and code exploration |
| **general** | subagent | full (no todowrite) | Complex multi-step tasks |
| **explore** | subagent | read-only | Fast codebase search |
| **orchestrator** | subagent | read-only + task/team | Multi-agent coordinator (50 steps) |
| **critic** | subagent | read-only + bash + LSP | Code review: bugs, security, performance |
| **tester** | subagent | full (no todowrite) | Write and run tests, verify coverage |
| **documenter** | subagent | full (no todowrite) | JSDoc, README, inline documentation |
| compaction | hidden | none | AI-driven context summarization |
| title | hidden | none | Session title generation |
| summary | hidden | none | Session summarization |

### تكامل LSP

دعم كامل لبروتوكول خادم اللغة مع فهرسة الرموز والتشخيصات ودعم لغات متعددة (TypeScript، Deno، Vue، وقابل للتوسيع). يتنقل الوكيل في الكود عبر رموز LSP بدلاً من البحث النصي، مما يتيح go-to-definition دقيق وfind-references واكتشاف أخطاء الأنواع في الوقت الفعلي.

### دعم MCP

عميل وخادم Model Context Protocol. يدعم نقل stdio وHTTP/SSE وStreamableHTTP. تدفق مصادقة OAuth للخوادم البعيدة. إمكانيات الأدوات والمطالبات والموارد. تحديد النطاق لكل وكيل عبر قوائم السماح/المنع.

### بنية العميل/الخادم

REST API مبني على Hono مع مسارات مُنَمَّطة وتوليد مواصفات OpenAPI. دعم WebSocket لـ PTY (الطرفية الزائفة). SSE لبث الأحداث في الوقت الفعلي. مصادقة أساسية، CORS، ضغط gzip. واجهة TUI هي واحدة من الواجهات الأمامية؛ يمكن التحكم بالخادم من أي عميل HTTP أو واجهة الويب أو تطبيق الجوال.

### إدارة السياق

ضغط تلقائي مع تلخيص مدفوع بالذكاء الاصطناعي عندما يقترب استخدام الرموز من حد سياق النموذج. تقليم واعٍ بالرموز مع عتبات قابلة للتكوين (`PRUNE_MINIMUM` 20KB، `PRUNE_PROTECT` 40KB). مخرجات أداة Skill محمية من التقليم.

### محرك التحرير

ترقيع unified diff مع التحقق من الأجزاء. يطبق أجزاء مستهدفة على مناطق محددة من الملف بدلاً من إعادة كتابة الملف بالكامل. أداة multi-edit للعمليات المجمعة عبر الملفات.

### نظام الصلاحيات

صلاحيات من 3 حالات (`allow` / `deny` / `ask`) مع مطابقة أنماط wildcard. أكثر من 100 تعريف لعدد معاملات أوامر bash للتحكم الدقيق. فرض حدود المشروع يمنع الوصول إلى الملفات خارج مساحة العمل.

### التراجع المدعوم بـ Git

نظام لقطات يسجل حالة الملف قبل كل تنفيذ أداة. يدعم `revert` و`unrevert` مع حساب الفروقات. يمكن التراجع عن التغييرات لكل رسالة أو لكل جلسة.

### تتبع التكاليف

تكلفة لكل رسالة مع تفصيل كامل للرموز (input، output، reasoning، cache read، cache write). حدود ميزانية لكل فريق (`max_cost`). أمر `stats` مع تجميع لكل نموذج ولكل يوم. تكلفة الجلسة في الوقت الفعلي معروضة في TUI. بيانات الأسعار مأخوذة من models.dev.

### نظام الإضافات

SDK كامل (`@opencode/plugin`) مع بنية hooks. تحميل ديناميكي من حزم npm أو نظام الملفات. إضافات مدمجة لمصادقة Codex وGitHub Copilot وGitLab وPoe.

---

## المفاهيم الخاطئة الشائعة

لمنع الالتباس من الملخصات المولّدة بالذكاء الاصطناعي لهذا المشروع:

- **واجهة TUI مكتوبة بـ TypeScript** (SolidJS + @opentui لعرض الطرفية)، وليس Rust.
- **Tree-sitter** يُستخدم فقط لتلوين بناء الجملة في TUI وتحليل أوامر bash، وليس لتحليل الكود على مستوى الوكيل.
- **لا يوجد Docker/E2B sandboxing** -- العزل يتم عبر git worktrees.
- **لا توجد قاعدة بيانات متجهية أو نظام RAG** -- يُدار السياق عبر فهرسة رموز LSP + الضغط التلقائي.
- **لا يوجد "وضع مراقبة" يقترح إصلاحات تلقائية** -- مراقب الملفات موجود لأغراض البنية التحتية فقط.
- **التصحيح الذاتي** يستخدم حلقة الوكيل القياسية (يرى LLM الأخطاء في نتائج الأدوات ويعيد المحاولة)، وليس آلية إصلاح تلقائي متخصصة.

## مصفوفة القدرات

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

### التثبيت

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# مديري الحزم
npm i -g opencode-ai@latest        # او bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS و Linux (موصى به، دائما محدث)
brew install opencode              # macOS و Linux (صيغة brew الرسمية، تحديث اقل)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # اي نظام
nix run nixpkgs#opencode           # او github:anomalyco/opencode لاحدث فرع dev
```

> [!TIP]
> احذف الاصدارات الاقدم من 0.1.x قبل التثبيت.

### تطبيق سطح المكتب (BETA)

يتوفر OpenCode ايضا كتطبيق سطح مكتب. قم بالتنزيل مباشرة من [صفحة الاصدارات](https://github.com/anomalyco/opencode/releases) او من [opencode.ai/download](https://opencode.ai/download).

| المنصة                | التنزيل                               |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb` او `.rpm` او AppImage          |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### مجلد التثبيت

يحترم سكربت التثبيت ترتيب الاولوية التالي لمسار التثبيت:

1. `$OPENCODE_INSTALL_DIR` - مجلد تثبيت مخصص
2. `$XDG_BIN_DIR` - مسار متوافق مع مواصفات XDG Base Directory
3. `$HOME/bin` - مجلد الثنائيات القياسي للمستخدم (ان وجد او امكن انشاؤه)
4. `$HOME/.opencode/bin` - المسار الافتراضي الاحتياطي

```bash
# امثلة
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

يتضمن OpenCode وكيليْن (Agents) مدمجين يمكنك التبديل بينهما باستخدام زر `Tab`.

- **build** - الافتراضي، وكيل بصلاحيات كاملة لاعمال التطوير
- **plan** - وكيل للقراءة فقط للتحليل واستكشاف الكود
  - يرفض تعديل الملفات افتراضيا
  - يطلب الاذن قبل تشغيل اوامر bash
  - مثالي لاستكشاف قواعد كود غير مألوفة او لتخطيط التغييرات

بالاضافة الى ذلك يوجد وكيل فرعي **general** للبحث المعقد والمهام متعددة الخطوات.
يستخدم داخليا ويمكن استدعاؤه بكتابة `@general` في الرسائل.

تعرف على المزيد حول [agents](https://opencode.ai/docs/agents).

### التوثيق

لمزيد من المعلومات حول كيفية ضبط OpenCode، [**راجع التوثيق**](https://opencode.ai/docs).

### المساهمة

اذا كنت مهتما بالمساهمة في OpenCode، يرجى قراءة [contributing docs](./CONTRIBUTING.md) قبل ارسال pull request.

### البناء فوق OpenCode

اذا كنت تعمل على مشروع مرتبط بـ OpenCode ويستخدم "opencode" كجزء من اسمه (مثل "opencode-dashboard" او "opencode-mobile")، يرجى اضافة ملاحظة في README توضح انه ليس مبنيا بواسطة فريق OpenCode ولا يرتبط بنا بأي شكل.

### FAQ

#### ما الفرق عن Claude Code؟

هو مشابه جدا لـ Claude Code من حيث القدرات. هذه هي الفروقات الاساسية:

- 100% مفتوح المصدر
- غير مقترن بمزود معين. نوصي بالنماذج التي نوفرها عبر [OpenCode Zen](https://opencode.ai/zen)؛ لكن يمكن استخدام OpenCode مع Claude او OpenAI او Google او حتى نماذج محلية. مع تطور النماذج ستتقلص الفجوات وستنخفض الاسعار، لذا من المهم ان يكون مستقلا عن المزود.
- دعم LSP جاهز للاستخدام
- تركيز على TUI. تم بناء OpenCode بواسطة مستخدمي neovim ومنشئي [terminal.shop](https://terminal.shop)؛ وسندفع حدود ما هو ممكن داخل الطرفية.
- معمارية عميل/خادم. على سبيل المثال، يمكن تشغيل OpenCode على جهازك بينما تقوده عن بعد من تطبيق جوال. هذا يعني ان واجهة TUI هي واحدة فقط من العملاء الممكنين.

---

**انضم الى مجتمعنا** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
