<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">오픈 소스 AI 코딩 에이전트.</p>
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

## 포크 기능

> 이것은 [anomalyco/opencode](https://github.com/anomalyco/opencode)의 포크로, [Rwanbt](https://github.com/Rwanbt)가 관리합니다.
> 업스트림과 동기화 유지. 최신 변경 사항은 [dev 브랜치](https://github.com/Rwanbt/opencode/tree/dev)를 참조하세요.

#### 백그라운드 작업

서브에이전트에 비동기 작업을 위임합니다. task 도구에서 `mode: "background"`를 설정하면 에이전트가 백그라운드에서 작업하는 동안 `task_id`가 즉시 반환됩니다. 수명 주기 추적을 위해 버스 이벤트(`TaskCreated`, `TaskCompleted`, `TaskFailed`)가 발행됩니다.

#### 에이전트 팀

`team` 도구를 사용하여 여러 에이전트를 병렬로 오케스트레이션합니다. 의존성 엣지를 가진 하위 작업을 정의하면 `computeWaves()`가 DAG를 구축하고 독립적인 작업을 동시에 실행합니다(최대 5개 병렬 에이전트). `max_cost`(달러)와 `max_agents`를 통한 예산 제어. 완료된 작업의 컨텍스트가 의존 작업에 자동으로 전달됩니다.

#### Git Worktree 격리

각 백그라운드 작업은 자동으로 자체 git worktree를 할당받습니다. 워크스페이스는 데이터베이스의 세션에 연결됩니다. 작업이 파일 변경을 생성하지 않으면 worktree가 자동으로 정리됩니다. 컨테이너 없이 git 수준의 격리를 제공합니다.

#### 작업 관리 API

작업 수명 주기 관리를 위한 완전한 REST API:

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

#### TUI 작업 대시보드

실시간 상태 아이콘으로 활성 백그라운드 작업을 표시하는 사이드바 플러그인:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

액션이 포함된 다이얼로그: 작업 세션 열기, 취소, 재개, 후속 메시지 전송, 상태 확인.

#### MCP 에이전트 스코핑

에이전트별 MCP 서버 허용/거부 목록. `opencode.json`의 각 에이전트 `mcp` 필드에서 설정합니다. `toolsForAgent()` 함수가 호출 에이전트의 스코프에 따라 사용 가능한 MCP 도구를 필터링합니다.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9단계 세션 수명 주기

세션은 9가지 상태 중 하나를 추적하며 데이터베이스에 영속화됩니다:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

영속 상태(`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`)는 데이터베이스 재시작 후에도 유지됩니다. 인메모리 상태(`idle`, `busy`, `retry`)는 재시작 시 초기화됩니다.

#### 오케스트레이터 에이전트

읽기 전용 코디네이터 에이전트(최대 50단계). `task`와 `team` 도구에 접근할 수 있지만 모든 편집 도구는 거부됩니다. 구현을 빌드/범용 에이전트에 위임하고 결과를 종합합니다.

---

## 기술 아키텍처

### 다중 프로바이더 지원

21개 이상의 프로바이더를 기본 지원: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, 그리고 모든 OpenAI 호환 엔드포인트. 가격 정보는 [models.dev](https://models.dev)에서 제공.

### 에이전트 시스템

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | 기본 개발 에이전트 |
| **plan** | primary | read-only | 분석 및 코드 탐색 |
| **general** | subagent | full (no todowrite) | 복잡한 다단계 작업 |
| **explore** | subagent | read-only | 빠른 코드베이스 검색 |
| **orchestrator** | subagent | read-only + task/team | 다중 에이전트 코디네이터 (50단계) |
| **critic** | subagent | read-only + bash + LSP | 코드 리뷰: 버그, 보안, 성능 |
| **tester** | subagent | full (no todowrite) | 테스트 작성 및 실행, 커버리지 확인 |
| **documenter** | subagent | full (no todowrite) | JSDoc, README, 인라인 문서화 |
| compaction | hidden | none | AI 기반 컨텍스트 요약 |
| title | hidden | none | 세션 제목 생성 |
| summary | hidden | none | 세션 요약 |

### LSP 통합

완전한 Language Server Protocol 지원(심볼 인덱싱, 진단, 다중 언어 지원: TypeScript, Deno, Vue 등 확장 가능). 에이전트는 텍스트 검색 대신 LSP 심볼을 통해 코드를 탐색하여 정확한 go-to-definition, find-references, 실시간 타입 오류 감지를 수행합니다.

### MCP 지원

Model Context Protocol 클라이언트 및 서버. stdio, HTTP/SSE, StreamableHTTP 전송 지원. 원격 서버용 OAuth 인증 흐름. 도구, 프롬프트, 리소스 기능. 에이전트별 허용/거부 목록을 통한 스코핑.

### 클라이언트/서버 아키텍처

Hono 기반 REST API(타입 라우트 및 OpenAPI 사양 생성). PTY(의사 터미널)용 WebSocket 지원. 실시간 이벤트 스트리밍용 SSE. Basic 인증, CORS, gzip 압축. TUI는 하나의 프런트엔드이며, 서버는 모든 HTTP 클라이언트, 웹 UI, 모바일 앱에서 구동 가능합니다.

### 컨텍스트 관리

토큰 사용량이 모델의 컨텍스트 한도에 도달하면 AI 기반 요약을 통한 자동 압축. 설정 가능한 임계값(`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB)으로 토큰 인식 프루닝. skill 도구 출력은 프루닝에서 보호됩니다.

### 편집 엔진

hunk 검증이 포함된 unified diff 패치. 파일 전체 덮어쓰기가 아닌 특정 파일 영역에 타겟 hunk 적용. 여러 파일에 걸친 일괄 작업을 위한 multi-edit 도구.

### 권한 시스템

와일드카드 패턴 매칭을 지원하는 3단계 권한(`allow` / `deny` / `ask`). 세밀한 제어를 위한 100개 이상의 bash 명령어 arity 정의. 워크스페이스 외부의 파일 접근을 차단하는 프로젝트 경계 적용.

### Git 기반 롤백

각 도구 실행 전 파일 상태를 기록하는 스냅샷 시스템. diff 계산과 함께 `revert` 및 `unrevert` 지원. 메시지 단위 또는 세션 단위로 변경 사항을 롤백할 수 있습니다.

### 비용 추적

메시지별 비용과 전체 토큰 분석(input, output, reasoning, cache read, cache write). 팀별 예산 한도(`max_cost`). 모델별, 일별 집계가 가능한 `stats` 명령어. TUI에서 세션 비용 실시간 표시. 가격 데이터는 models.dev에서 제공.

### 플러그인 시스템

훅 아키텍처를 갖춘 완전한 SDK(`@opencode/plugin`). npm 패키지 또는 파일 시스템에서 동적 로딩. Codex, GitHub Copilot, GitLab, Poe 인증을 위한 내장 플러그인.

---

## 흔한 오해

본 프로젝트에 대한 AI 생성 요약으로 인한 혼란을 방지하기 위해:

- **TUI는 TypeScript**로 작성되었습니다(SolidJS + @opentui 터미널 렌더링). Rust가 아닙니다.
- **Tree-sitter**는 TUI 구문 강조 및 bash 명령어 파싱에만 사용되며, 에이전트 수준의 코드 분석에는 사용되지 않습니다.
- **Docker/E2B 샌드박싱은 없습니다** -- 격리는 git worktree로 제공됩니다.
- **벡터 데이터베이스나 RAG 시스템은 없습니다** -- 컨텍스트는 LSP 심볼 인덱싱 + 자동 압축으로 관리됩니다.
- **자동 수정을 제안하는 "워치 모드"는 없습니다** -- 파일 워처는 인프라 목적으로만 존재합니다.
- **자기 수정**은 표준 에이전트 루프(LLM이 도구 결과의 오류를 확인하고 재시도)를 사용하며, 전문화된 자동 복구 메커니즘이 아닙니다.

## 기능 매트릭스

| 기능 | Status | Notes |
|------|--------|-------|
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

### 설치

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# 패키지 매니저
npm i -g opencode-ai@latest        # bun/pnpm/yarn 도 가능
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS 및 Linux (권장, 항상 최신)
brew install opencode              # macOS 및 Linux (공식 brew formula, 업데이트 빈도 낮음)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # 어떤 OS든
nix run nixpkgs#opencode           # 또는 github:anomalyco/opencode 로 최신 dev 브랜치
```

> [!TIP]
> 설치 전에 0.1.x 보다 오래된 버전을 제거하세요.

### 데스크톱 앱 (BETA)

OpenCode 는 데스크톱 앱으로도 제공됩니다. [releases page](https://github.com/anomalyco/opencode/releases) 에서 직접 다운로드하거나 [opencode.ai/download](https://opencode.ai/download) 를 이용하세요.

| 플랫폼                | 다운로드                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, 또는 AppImage         |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### 설치 디렉터리

설치 스크립트는 설치 경로를 다음 우선순위로 결정합니다.

1. `$OPENCODE_INSTALL_DIR` - 사용자 지정 설치 디렉터리
2. `$XDG_BIN_DIR` - XDG Base Directory Specification 준수 경로
3. `$HOME/bin` - 표준 사용자 바이너리 디렉터리 (존재하거나 생성 가능할 경우)
4. `$HOME/.opencode/bin` - 기본 폴백

```bash
# 예시
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode 에는 내장 에이전트 2개가 있으며 `Tab` 키로 전환할 수 있습니다.

- **build** - 기본값, 개발 작업을 위한 전체 권한 에이전트
- **plan** - 분석 및 코드 탐색을 위한 읽기 전용 에이전트
  - 기본적으로 파일 편집을 거부
  - bash 명령 실행 전에 권한을 요청
  - 낯선 코드베이스를 탐색하거나 변경을 계획할 때 적합

또한 복잡한 검색과 여러 단계 작업을 위한 **general** 서브 에이전트가 포함되어 있습니다.
내부적으로 사용되며, 메시지에서 `@general` 로 호출할 수 있습니다.

[agents](https://opencode.ai/docs/agents) 에 대해 더 알아보세요.

### 문서

OpenCode 설정에 대한 자세한 내용은 [**문서**](https://opencode.ai/docs) 를 참고하세요.

### 기여하기

OpenCode 에 기여하고 싶다면, Pull Request 를 제출하기 전에 [contributing docs](./CONTRIBUTING.md) 를 읽어주세요.

### OpenCode 기반으로 만들기

OpenCode 와 관련된 프로젝트를 진행하면서 이름에 "opencode"(예: "opencode-dashboard" 또는 "opencode-mobile") 를 포함한다면, README 에 해당 프로젝트가 OpenCode 팀이 만든 것이 아니며 어떤 방식으로도 우리와 제휴되어 있지 않다는 점을 명시해 주세요.

### FAQ

#### Claude Code 와는 무엇이 다른가요?

기능 면에서는 Claude Code 와 매우 유사합니다. 주요 차이점은 다음과 같습니다.

- 100% 오픈 소스
- 특정 제공자에 묶여 있지 않습니다. [OpenCode Zen](https://opencode.ai/zen) 을 통해 제공하는 모델을 권장하지만, OpenCode 는 Claude, OpenAI, Google 또는 로컬 모델과도 사용할 수 있습니다. 모델이 발전하면서 격차는 줄고 가격은 내려가므로 provider-agnostic 인 것이 중요합니다.
- 기본으로 제공되는 LSP 지원
- TUI 에 집중. OpenCode 는 neovim 사용자와 [terminal.shop](https://terminal.shop) 제작자가 만들었으며, 터미널에서 가능한 것의 한계를 밀어붙입니다.
- 클라이언트/서버 아키텍처. 예를 들어 OpenCode 를 내 컴퓨터에서 실행하면서 모바일 앱으로 원격 조작할 수 있습니다. 즉, TUI 프런트엔드는 가능한 여러 클라이언트 중 하나일 뿐입니다.

---

**커뮤니티에 참여하기** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
