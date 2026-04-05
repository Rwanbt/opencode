<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo do OpenCode">
    </picture>
  </a>
</p>
<p align="center">O agente de programação com IA de código aberto.</p>
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

## Funcionalidades do fork

> Este é um fork de [anomalyco/opencode](https://github.com/anomalyco/opencode) mantido por [Rwanbt](https://github.com/Rwanbt).
> Mantido em sincronia com o upstream. Veja a [branch dev](https://github.com/Rwanbt/opencode/tree/dev) para as últimas alterações.

#### Tarefas em segundo plano

Delegue trabalho a subagentes que executam de forma assíncrona. Defina `mode: "background"` na ferramenta task e ela retorna um `task_id` imediatamente enquanto o agente trabalha em segundo plano. Eventos de barramento (`TaskCreated`, `TaskCompleted`, `TaskFailed`) são publicados para rastreamento do ciclo de vida.

#### Equipes de agentes

Orquestre múltiplos agentes em paralelo usando a ferramenta `team`. Defina subtarefas com arestas de dependência; `computeWaves()` constrói um DAG e executa tarefas independentes simultaneamente (até 5 agentes paralelos). Controle de orçamento via `max_cost` (dólares) e `max_agents`. O contexto de tarefas concluídas é automaticamente passado para as dependentes.

#### Isolamento com Git worktree

Cada tarefa em segundo plano recebe automaticamente seu próprio git worktree. O espaço de trabalho é vinculado à sessão no banco de dados. Se uma tarefa não produz alterações em arquivos, o worktree é limpo automaticamente. Isso fornece isolamento em nível git sem contêineres.

#### API de gerenciamento de tarefas

REST API completa para gerenciamento do ciclo de vida de tarefas:

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

#### Painel de tarefas TUI

Plugin de barra lateral mostrando tarefas em segundo plano ativas com ícones de status em tempo real:

| Icon | Status |
|------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Diálogo com ações: abrir sessão da tarefa, cancelar, retomar, enviar acompanhamento, verificar status.

#### Escopo de agente MCP

Listas de permissão/negação de servidores MCP por agente. Configure em `opencode.json` no campo `mcp` de cada agente. A função `toolsForAgent()` filtra as ferramentas MCP disponíveis com base no escopo do agente chamador.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### Ciclo de vida de sessão com 9 estados

As sessões rastreiam um dos 9 estados, persistidos no banco de dados:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Estados persistentes (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) sobrevivem a reinicializações do banco de dados. Estados em memória (`idle`, `busy`, `retry`) são redefinidos ao reiniciar.

#### Agente orquestrador

Agente coordenador somente leitura (máximo 50 passos). Tem acesso às ferramentas `task` e `team`, mas todas as ferramentas de edição são negadas. Delega a implementação a agentes de build/gerais e sintetiza os resultados.

---

## Arquitetura Tecnica

### Suporte a multiplos provedores

21+ provedores inclusos: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, alem de qualquer endpoint compativel com OpenAI. Precos obtidos de [models.dev](https://models.dev).

### Sistema de agentes

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

### Integracao LSP

Suporte completo ao Language Server Protocol com indexacao de simbolos, diagnosticos e suporte a multiplas linguagens (TypeScript, Deno, Vue, e extensivel). O agente navega pelo codigo via simbolos LSP em vez de busca textual, permitindo go-to-definition preciso, find-references e deteccao de erros de tipo em tempo real.

### Suporte MCP

Cliente e servidor Model Context Protocol. Suporta transportes stdio, HTTP/SSE e StreamableHTTP. Fluxo de autenticacao OAuth para servidores remotos. Capacidades de ferramentas, prompts e recursos. Escopo por agente via listas de permissao/negacao.

### Arquitetura cliente/servidor

REST API baseada em Hono com rotas tipadas e geracao de especificacao OpenAPI. Suporte a WebSocket para PTY (pseudo-terminal). SSE para streaming de eventos em tempo real. Basic auth, CORS, compressao gzip. A TUI e um frontend; o servidor pode ser controlado por qualquer cliente HTTP, pela interface web ou por um aplicativo mobile.

### Gerenciamento de contexto

Compactacao automatica com sumarizacao orientada por IA quando o uso de tokens se aproxima do limite de contexto do modelo. Poda consciente de tokens com limiares configuraveis (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Saidas da ferramenta Skill sao protegidas contra poda.

### Motor de edicao

Patching de unified diff com verificacao de hunks. Aplica hunks direcionados a regioes especificas do arquivo em vez de reescrever o arquivo inteiro. Ferramenta multi-edit para operacoes em lote entre arquivos.

### Sistema de permissoes

Permissoes de 3 estados (`allow` / `deny` / `ask`) com correspondencia de padroes wildcard. 100+ definicoes de aridade de comandos bash para controle granular. Aplicacao de limites do projeto impede acesso a arquivos fora do espaco de trabalho.

### Reversao com suporte Git

Sistema de snapshots que registra o estado do arquivo antes de cada execucao de ferramenta. Suporta `revert` e `unrevert` com calculo de diff. Alteracoes podem ser revertidas por mensagem ou por sessao.

### Rastreamento de custos

Custo por mensagem com detalhamento completo de tokens (input, output, reasoning, cache read, cache write). Limites de orcamento por equipe (`max_cost`). Comando `stats` com agregacao por modelo e por dia. Custo da sessao em tempo real exibido na TUI. Dados de precos obtidos de models.dev.

### Sistema de plugins

SDK completo (`@opencode/plugin`) com arquitetura de hooks. Carregamento dinamico a partir de pacotes npm ou sistema de arquivos. Plugins integrados para autenticacao Codex, GitHub Copilot, GitLab e Poe.

---

## Conceitos equivocados comuns

Para evitar confusao a partir de resumos gerados por IA deste projeto:

- A **TUI e TypeScript** (SolidJS + @opentui para renderizacao de terminal), nao Rust.
- **Tree-sitter** e usado apenas para destaque de sintaxe na TUI e parsing de comandos bash, nao para analise de codigo no nivel do agente.
- **Nao ha Docker/E2B sandboxing** -- o isolamento e fornecido por git worktrees.
- **Nao ha banco de dados vetorial ou sistema RAG** -- o contexto e gerenciado via indexacao de simbolos LSP + auto-compact.
- **Nao ha "watch mode" que propoe correcoes automaticas** -- o file watcher existe apenas para fins de infraestrutura.
- A **autocorrecao** usa o loop padrao do agente (o LLM ve erros nos resultados das ferramentas e tenta novamente), nao um mecanismo especializado de reparo automatico.

## Matriz de capacidades

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
| Vector DB / RAG | Not implemented | LSP + auto-compact covers needs |
| Dry run / command preview | Not implemented | Permission system validates pre-exec |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

---

### Instalação

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Gerenciadores de pacotes
npm i -g opencode-ai@latest        # ou bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS e Linux (recomendado, sempre atualizado)
brew install opencode              # macOS e Linux (fórmula oficial do brew, atualiza menos)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # qualquer sistema
nix run nixpkgs#opencode           # ou github:anomalyco/opencode para a branch dev mais recente
```

> [!TIP]
> Remova versões anteriores a 0.1.x antes de instalar.

### App desktop (BETA)

O OpenCode também está disponível como aplicativo desktop. Baixe diretamente pela [página de releases](https://github.com/anomalyco/opencode/releases) ou em [opencode.ai/download](https://opencode.ai/download).

| Plataforma            | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` ou AppImage            |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Diretório de instalação

O script de instalação respeita a seguinte ordem de prioridade para o caminho de instalação:

1. `$OPENCODE_INSTALL_DIR` - Diretório de instalação personalizado
2. `$XDG_BIN_DIR` - Caminho compatível com a especificação XDG Base Directory
3. `$HOME/bin` - Diretório binário padrão do usuário (se existir ou puder ser criado)
4. `$HOME/.opencode/bin` - Fallback padrão

```bash
# Exemplos
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

O OpenCode inclui dois agents integrados, que você pode alternar com a tecla `Tab`.

- **build** - Padrão, agent com acesso total para trabalho de desenvolvimento
- **plan** - Agent somente leitura para análise e exploração de código
  - Nega edições de arquivos por padrão
  - Pede permissão antes de executar comandos bash
  - Ideal para explorar codebases desconhecidas ou planejar mudanças

Também há um subagent **general** para buscas complexas e tarefas em várias etapas.
Ele é usado internamente e pode ser invocado com `@general` nas mensagens.

Saiba mais sobre [agents](https://opencode.ai/docs/agents).

### Documentação

Para mais informações sobre como configurar o OpenCode, [**veja nossa documentação**](https://opencode.ai/docs).

### Contribuir

Se você tem interesse em contribuir com o OpenCode, leia os [contributing docs](./CONTRIBUTING.md) antes de enviar um pull request.

### Construindo com OpenCode

Se você estiver trabalhando em um projeto relacionado ao OpenCode e estiver usando "opencode" como parte do nome (por exemplo, "opencode-dashboard" ou "opencode-mobile"), adicione uma nota no README para deixar claro que não foi construído pela equipe do OpenCode e não é afiliado a nós de nenhuma forma.

### FAQ

#### Como isso é diferente do Claude Code?

É muito parecido com o Claude Code em termos de capacidade. Aqui estão as principais diferenças:

- 100% open source
- Não está acoplado a nenhum provedor. Embora recomendemos os modelos que oferecemos pelo [OpenCode Zen](https://opencode.ai/zen); o OpenCode pode ser usado com Claude, OpenAI, Google ou até modelos locais. À medida que os modelos evoluem, as diferenças diminuem e os preços caem, então ser provider-agnostic é importante.
- Suporte a LSP pronto para uso
- Foco em TUI. O OpenCode é construído por usuários de neovim e pelos criadores do [terminal.shop](https://terminal.shop); vamos levar ao limite o que é possível no terminal.
- Arquitetura cliente/servidor. Isso, por exemplo, permite executar o OpenCode no seu computador enquanto você o controla remotamente por um aplicativo mobile. Isso significa que o frontend TUI é apenas um dos possíveis clientes.

---

**Junte-se à nossa comunidade** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
