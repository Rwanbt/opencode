# OpenCode — Système complet de prompts (Cloud vs Local)

> Ce fichier contient l'INTÉGRALITÉ des prompts système, descriptions d'outils, et mécanismes d'optimisation.
> Objectif : permettre à d'autres IA d'analyser et proposer des optimisations.

---

## SOMMAIRE

1. [Bilan chiffré](#1-bilan-chiffré)
2. [Architecture du routing](#2-architecture-du-routing)
3. [Prompts système par provider](#3-prompts-système-par-provider)
4. [Descriptions d'outils (cloud vs local)](#4-descriptions-doutils)
5. [Environnement système](#5-environnement-système)
6. [Skills](#6-skills)
7. [Mécanismes de fiabilité (code-level)](#7-mécanismes-de-fiabilité)
8. [Fichiers sources](#8-fichiers-sources)

---

## 1. Bilan chiffré

| Composant | Cloud (default) | Local | Économie |
|-----------|----------------|-------|----------|
| Prompt système | ~2,192 tokens | ~150 tokens | **-93%** |
| Descriptions outils (prose) | ~9,557 tokens (19 fichiers) | ~175 tokens (7 skeletons) | **-98%** |
| Schémas JSON outils | ~2,900 tokens (19 outils) | ~700 tokens (7 outils) | **-76%** |
| Environnement | ~215 tokens | ~15 tokens | **-93%** |
| Skills | ~800 tokens | 0 tokens | **-100%** |
| Pre-flight guards | 0 tokens | 0 tokens | code-level, no token cost |
| **Total envoyé au LLM** | **~15,664 tokens** | **~1,040 tokens** | **-93%** |

Tous les prompts cloud par provider :

| Fichier | Provider | Octets | Tokens (~) |
|---------|----------|--------|-----------|
| `gemini.txt` | Google Gemini | 15,527 | 3,882 |
| `copilot-gpt-5.txt` | GPT-5 Copilot | 14,383 | 3,596 |
| `beast.txt` | GPT-4/o1/o3 | 11,227 | 2,807 |
| `gpt.txt` | GPT (other) | 9,391 | 2,348 |
| `kimi.txt` | Kimi | 8,790 | 2,198 |
| `default.txt` | Fallback | 8,766 | 2,192 |
| `anthropic.txt` | Claude | 8,317 | 2,079 |
| `trinity.txt` | Trinity | 7,845 | 1,961 |
| `codex.txt` | Codex/Copilot | 7,469 | 1,867 |
| **`local.txt`** | **local-llm** | **~600** | **~150** |

Descriptions d'outils cloud (top consommateurs) :

| Outil | Octets | Tokens (~) | Inclus en local ? |
|-------|--------|-----------|-------------------|
| `bash.txt` | 9,405 | 2,351 | Oui (skeleton 63 chars) |
| `todowrite.txt` | 9,012 | 2,253 | Non (supprimé) |
| `task.txt` | 4,951 | 1,238 | Non (supprimé) |
| `multiedit.txt` | 2,447 | 612 | Non (supprimé) |
| `edit.txt` | 1,379 | 345 | Oui (skeleton 104 chars) |
| `read.txt` | 1,172 | 293 | Oui (skeleton 86 chars) |
| `apply_patch.txt` | 1,131 | 283 | Non (supprimé) |
| `lsp.txt` | 1,059 | 265 | Non (supprimé) |
| `batch.txt` | 1,025 | 256 | Non (supprimé) |
| `write.txt` | 941 | 235 | Oui (skeleton 78 chars) |
| `glob.txt` | 828 | 207 | Oui (skeleton 64 chars) |
| `grep.txt` | 817 | 204 | Oui (skeleton 68 chars) |
| `webfetch.txt` | 780 | 195 | Non (supprimé) |
| `websearch.txt` | 651 | 163 | Non (supprimé) |
| `question.txt` | 622 | 156 | Oui (skeleton 60 chars) |
| `codesearch.txt` | 508 | 127 | Non (supprimé) |
| `ls.txt` | 482 | 121 | Non (supprimé) |
| `plan-enter.txt` | 377 | 94 | Non (supprimé) |
| `plan-exit.txt` | 291 | 73 | Non (supprimé) |
| **Total** | **38,228** | **~9,557** | **7 sur 19** |

---

## 2. Architecture du routing

### Fichier : `packages/opencode/src/session/system.ts`

```typescript
import PROMPT_LOCAL from "./prompt/local.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"

export namespace SystemPrompt {
  // PROMPT ROUTING — chaque provider a son prompt optimisé
  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]        // 11,227 octets
    if (model.api.id.includes("gpt")) {
      if (model.api.id.includes("codex")) return [PROMPT_CODEX]  // 7,469 octets
      return [PROMPT_GPT]          // 9,391 octets
    }
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]  // 15,527 octets
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC] // 8,317 octets
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY] // 7,845 octets
    if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI] // 8,790 octets
    if (model.providerID === "local-llm") return [PROMPT_LOCAL]    // 831 octets ← OPTIMISÉ
    return [PROMPT_DEFAULT]        // 8,766 octets
  }

  // ENVIRONNEMENT — minimal pour local, complet pour cloud
  export async function environment(model: Provider.Model) {
    if (model.providerID === "local-llm") {
      return [`Working directory: ${Instance.directory}, Platform: ${process.platform}`]
      // ~15 tokens
    }
    // Cloud : ~215 tokens
    return [[
      `You are powered by the model named ${model.api.id}.`,
      `<env>`,
      `  Working directory: ${Instance.directory}`,
      `  Workspace root folder: ${Instance.worktree}`,
      `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      `  Today's date: ${new Date().toDateString()}`,
      `</env>`,
      `<directories>...</directories>`,
    ].join("\n")]
  }

  // SKILLS — skip total pour local
  export async function skills(agent: Agent.Info, model?: Provider.Model) {
    if (model?.providerID === "local-llm") return  // 0 tokens
    // Cloud : ~800 tokens de descriptions de skills
    const list = await Skill.available(agent)
    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      Skill.fmt(list, { verbose: true }),
    ].join("\n")
  }
}
```

### Fichier : `packages/opencode/src/tool/registry.ts` (filtrage outils)

```typescript
// 7 outils au lieu de 19 pour local-llm
const LOCAL_TOOLS = new Set(["bash", "read", "edit", "write", "glob", "grep", "question"])

// Descriptions skeleton (1 ligne au lieu de fichiers .txt de 1-9KB)
const LOCAL_SKELETONS: Record<string, string> = {
  bash: "Execute shell command. Args: {command: string}. Returns stdout.",
  read: "Read file content. Args: {file_path: string, offset?: number, limit?: number}. Returns file text.",
  edit: "Replace exact text in file. Args: {file_path: string, old_string: string, new_string: string}. old_string must be copied EXACTLY from file (whitespace matters). Read file first.",
  write: "Create or overwrite file. Args: {file_path: string, content: string}. Use edit for partial changes.",
  glob: "Find files by glob pattern. Args: {pattern: string, path?: string}. Returns matching paths.",
  grep: "Search file contents with regex. Args: {pattern: string, path?: string}. Returns matching lines.",
  question: "Ask user a question. Args: {question: string}. Use when you need clarification.",
}

const isLocal = model.providerID === ("local-llm" as ProviderID)

// Filtrage : seuls 7 outils passent pour local
if (isLocal) return LOCAL_TOOLS.has(tool.id)

// Description : skeleton au lieu de prose complète
const description = isLocal
  ? (LOCAL_SKELETONS[tool.id] ?? next.description.split("\n")[0].slice(0, 100))
  : next.description
```

---

## 3. Prompts système par provider

### LOCAL — `local.txt` (~600 octets, ~150 tokens)

```
You are opencode, a coding CLI tool. Be concise and direct.

Rules:
- Run tools to complete tasks, don't just explain
- Break multi-step tasks into tool calls executed sequentially
- No comments in code unless asked
- Always read before edit
- Prefer edit over write for existing files
- IMPORTANT: minimize output tokens. Be brief.
```

> Note: Les règles "Tool safety" ont été retirées du prompt et sont désormais enforced par des pre-flight guards code-level (voir section 7).

---

### DEFAULT — `default.txt` (8,766 octets, ~2,192 tokens)

```
You are opencode, an interactive CLI tool that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.

If the user asks for help or wants to give feedback inform them of the following:
- /help: Get help with using opencode
- To give feedback, users should report the issue at https://github.com/anomalyco/opencode/issues

When the user directly asks about opencode (eg 'can opencode do...', 'does opencode have...') or asks in second person (eg 'are you able...', 'can you do...'), first use the WebFetch tool to gather information to answer the question from opencode docs at https://opencode.ai

# Tone and style
You should be concise, direct, and to the point. When you run a non-trivial bash command, you should explain what the command does and why you are running it, to make sure the user understands what you are doing (this is especially important when you are running a command that will make changes to the user's system).
Remember that your output will be displayed on a command line interface. Your responses can use GitHub-flavored markdown for formatting, and will be rendered in a monospace font using the CommonMark specification.
Output text to communicate with the user; all text you output outside of tool use is displayed to the user. Only use tools to complete tasks. Never use tools like Bash or code comments as means to communicate with the user during the session.
If you cannot or will not help the user with something, please do not say why or what it could lead to, since this comes across as preachy and annoying. Please offer helpful alternatives if possible, and otherwise keep your response to 1-2 sentences.
Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.
IMPORTANT: You should minimize output tokens as much as possible while maintaining helpfulness, quality, and accuracy. Only address the specific query or task at hand, avoiding tangential information unless absolutely critical for completing the request. If you can answer in 1-3 sentences or a short paragraph, please do.
IMPORTANT: You should NOT answer with unnecessary preamble or postamble (such as explaining your code or summarizing your action), unless the user asks you to.
IMPORTANT: Keep your responses short, since they will be displayed on a command line interface. You MUST answer concisely with fewer than 4 lines (not including tool use or code generation), unless user asks for detail. Answer the user's question directly, without elaboration, explanation, or details. One word answers are best. Avoid introductions, conclusions, and explanations. You MUST avoid text before/after your response, such as "The answer is <answer>.", "Here is the content of the file..." or "Based on the information provided, the answer is..." or "Here is what I will do next...". Here are some examples to demonstrate appropriate verbosity:
<example>
user: 2 + 2
assistant: 4
</example>
<example>
user: what is 2+2?
assistant: 4
</example>
<example>
user: is 11 a prime number?
assistant: Yes
</example>
<example>
user: what command should I run to list files in the current directory?
assistant: ls
</example>
<example>
user: what command should I run to watch files in the current directory?
assistant: [use the ls tool to list the files in the current directory, then read docs/commands in the relevant file to find out how to watch files]
npm run dev
</example>
<example>
user: How many golf balls fit inside a jetta?
assistant: 150000
</example>
<example>
user: what files are in the directory src/?
assistant: [runs ls and sees foo.c, bar.c, baz.c]
user: which file contains the implementation of foo?
assistant: src/foo.c
</example>
<example>
user: write tests for new feature
assistant: [uses grep and glob search tools to find where similar tests are defined, uses concurrent read file tool use blocks in one tool call to read relevant files at the same time, uses edit file tool to write new tests]
</example>

# Proactiveness
You are allowed to be proactive, but only when the user asks you to do something. You should strive to strike a balance between:
1. Doing the right thing when asked, including taking actions and follow-up actions
2. Not surprising the user with actions you take without asking
For example, if the user asks you how to approach something, you should do your best to answer their question first, and not immediately jump into taking actions.
3. Do not add additional code explanation summary unless requested by the user. After working on a file, just stop, rather than providing an explanation of what you did.

# Following conventions
When making changes to files, first understand the file's code conventions. Mimic code style, use existing libraries and utilities, and follow existing patterns.
- NEVER assume that a given library is available, even if it is well known. Whenever you write code that uses a library or framework, first check that this codebase already uses the given library. For example, you might look at neighboring files, or check the package.json (or cargo.toml, and so on depending on the language).
- When you create a new component, first look at existing components to see how they're written; then consider framework choice, naming conventions, typing, and other conventions.
- When you edit a piece of code, first look at the code's surrounding context (especially its imports) to understand the code's choice of frameworks and libraries. Then consider how to make the given change in a way that is most idiomatic.
- Always follow security best practices. Never introduce code that exposes or logs secrets and keys. Never commit secrets or keys to the repository.

# Code style
- IMPORTANT: DO NOT ADD ***ANY*** COMMENTS unless asked

# Doing tasks
The user will primarily request you perform software engineering tasks. This includes solving bugs, adding new functionality, refactoring code, explaining code, and more. For these tasks the following steps are recommended:
- Use the available search tools to understand the codebase and the user's query. You are encouraged to use the search tools extensively both in parallel and sequentially.
- Implement the solution using all tools available to you
- Verify the solution if possible with tests. NEVER assume specific test framework or test script. Check the README or search codebase to determine the testing approach.
- VERY IMPORTANT: When you have completed a task, you MUST run the lint and typecheck commands (e.g. npm run lint, npm run typecheck, ruff, etc.) with Bash if they were provided to you to ensure your code is correct. If you are unable to find the correct command, ask the user for the command to run and if they supply it, proactively suggest writing it to AGENTS.md so that you will know to run it next time.
NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive.

- Tool results and user messages may include <system-reminder> tags. <system-reminder> tags contain useful information and reminders. They are NOT part of the user's provided input or the tool result.

# Tool usage policy
- When doing file search, prefer to use the Task tool in order to reduce context usage.
- You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance. When making multiple bash tool calls, you MUST send a single message with multiple tools calls to run the calls in parallel. For example, if you need to run "git status" and "git diff", send a single message with two tool calls to run the calls in parallel.

You MUST answer concisely with fewer than 4 lines of text (not including tool use or code generation), unless user asks for detail.

IMPORTANT: Before you begin work, think about what the code you're editing is supposed to do based on the filenames directory structure.

# Code References
When referencing specific functions or pieces of code include the pattern `file_path:line_number` to allow the user to easily navigate to the source code location.
```

---

### ANTHROPIC — `anthropic.txt` (8,317 octets, ~2,079 tokens)

Identique à default.txt sauf :
- Ajout "You are OpenCode, the best coding agent on the planet."
- Ajout "Professional objectivity" section
- Ajout "Task Management" avec TodoWrite obligatoire + exemples détaillés
- Tool usage : "proactively use the Task tool with specialized agents"

---

### GEMINI — `gemini.txt` (15,527 octets, ~3,882 tokens) — LE PLUS LONG

Contient :
- Core Mandates (conventions, libraries, style, idiomatic changes, comments, proactiveness)
- Primary Workflows : Software Engineering Tasks (understand → plan → implement → verify tests → verify standards)
- Primary Workflows : New Applications (understand → propose → approve → implement → verify → solicit feedback)
- Operational Guidelines (tone, security, tool usage)
- 10+ exemples détaillés (refactor, delete, tests, research, file search)
- "Final Reminder" section

---

### BEAST — `beast.txt` (11,227 octets, ~2,807 tokens) — GPT-4/o1/o3

Contient :
- "You MUST iterate and keep going until the problem is solved"
- Internet research OBLIGATOIRE via webfetch + Google search
- Structured Workflow (fetch URLs → understand → investigate → research → plan → implement → debug → test → reflect)
- Communication Guidelines (casual, friendly, professional)
- Memory file (.github/instructions/memory.instruction.md)
- Reading Files optimization (avoid re-reads)
- Git rules

---

### GPT — `gpt.txt` (9,391 octets, ~2,348 tokens)

Contient :
- Autonomy and persistence ("persist until task is fully handled end-to-end")
- Editing approach ("smallest correct changes", "keep things in one function")
- Editing constraints (ASCII default, no unnecessary comments, apply_patch)
- Git and workspace hygiene (dirty worktree, never revert)
- Frontend tasks (avoid "AI slop", expressive fonts)
- Response channels (commentary vs final)
- Formatting rules (no nested bullets, no em dashes, no emojis)

---

### KIMI — `kimi.txt` (8,790 octets, ~2,198 tokens)

Contient :
- Prompt and Tool Use ("when request could be interpreted as question or task, treat as task")
- General Guidelines for Coding (from scratch + existing codebase)
- General Guidelines for Research and Data Processing
- Working Environment (OS, working directory)
- Project Information (AGENTS.md)
- "ALWAYS, keep it stupidly simple"

---

### TRINITY — `trinity.txt` (7,845 octets, ~1,961 tokens)

Identique à default.txt sauf :
- Tool usage : "Use exactly one tool per assistant message. After each tool call, wait for the result before continuing."
- "When the user's request is vague, use the question tool to clarify"

---

### CODEX — `codex.txt` (7,469 octets, ~1,867 tokens)

Contient :
- Editing constraints (ASCII, apply_patch preferred)
- Tool usage (specialized tools over shell)
- Git hygiene (same as GPT)
- Frontend tasks (same as GPT)
- Detailed final answer structure (headers, bullets, monospace, code blocks, tone)
- File References formatting

---

### COPILOT-GPT-5 — `copilot-gpt-5.txt` (14,383 octets, ~3,596 tokens)

Contient :
- gptAgentInstructions (autonomous, iterate, test rigorously)
- structuredWorkflow (understand → investigate → plan → implement → debug → test → iterate → reflect)
- communicationGuidelines (warm, friendly, professional)
- codeSearchInstructions (semantic_search, grep_search, workspace symbols)
- toolUseInstructions (parallel calls, absolute paths, no tool names to user)
- outputFormatting (Markdown, KaTeX, headings, file references)

---

## 4. Descriptions d'outils

### CLOUD — Fichiers .txt complets

#### `bash.txt` (9,405 octets — le plus gros outil)

```
Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

Be aware: OS: ${os}, Shell: ${shell}

All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns - use `workdir` instead.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:

1. Directory Verification:
   - If the command will create new directories or files, first use `ls` to verify the parent directory exists and is the correct location

2. Command Execution:
   - Always quote file paths that contain spaces with double quotes
   - After ensuring proper quoting, execute the command.
   - Capture the output of the command.

Usage notes:
  - The command argument is required.
  - You can specify an optional timeout in milliseconds (default 120000ms / 2 minutes).
  - Write a clear, concise description of what this command does in 5-10 words.
  - If output exceeds ${maxLines} lines or ${maxBytes} bytes, it will be truncated and the full output written to a file.
  - Avoid using Bash with find, grep, cat, head, tail, sed, awk, echo commands. Use dedicated tools instead:
    - File search: Use Glob (NOT find or ls)
    - Content search: Use Grep (NOT grep or rg)
    - Read files: Use Read (NOT cat/head/tail)
    - Edit files: Use Edit (NOT sed/awk)
    - Write files: Use Write (NOT echo >/cat <<EOF)
  - When issuing multiple commands: parallel tool calls for independent, ';' for sequential don't-care, '&&' for sequential must-succeed
  - AVOID using `cd <directory> && <command>`. Use workdir parameter instead.

# Committing changes with git
[... 60 lines of git commit/PR instructions ...]
```

#### `edit.txt` (1,379 octets)

```
Performs exact string replacements in files.

Usage:
- You must use your `Read` tool at least once in the conversation before editing.
- When editing text from Read tool output, preserve exact indentation after the line number prefix.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- The edit will FAIL if `oldString` is not found in the file.
- The edit will FAIL if `oldString` is found multiple times — provide more context to make it unique or use `replaceAll`.
- Use `replaceAll` for replacing and renaming strings across the file.
```

#### `read.txt` (1,172 octets)

```
Read a file or directory from the local filesystem.

Usage:
- The filePath parameter should be an absolute path.
- By default, returns up to 2000 lines from the start of the file.
- The offset parameter is the line number to start from (1-indexed).
- Use grep tool to find specific content in large files.
- Use glob tool to look up filenames by pattern.
- Contents are returned with line numbers as `<line>: <content>`.
- Any line longer than 2000 characters is truncated.
- Call this tool in parallel when reading multiple files.
- Avoid tiny repeated slices (30 line chunks).
- Can read image files and PDFs.
```

#### `write.txt` (941 octets)

```
Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use Read tool first.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files.
```

#### `glob.txt` (828 octets)

```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When doing open-ended search, use Task tool instead
- Speculatively perform multiple searches as a batch.
```

#### `grep.txt` (817 octets)

```
- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\s+\w+")
- Filter files by pattern with include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers sorted by modification time
- To count matches within files, use Bash with `rg` directly. Do NOT use `grep`.
- When doing open-ended search, use Task tool instead
```

#### `question.txt` (622 octets)

```
Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices
4. Offer choices to the user about what direction to take.

Usage notes:
- When `custom` is enabled (default), a "Type your own answer" option is added automatically
- Answers returned as arrays of labels; set `multiple: true` for multi-select
- If you recommend a specific option, make that first and add "(Recommended)"
```

### LOCAL — Skeletons inline (7 lignes, ~700 octets total)

```typescript
bash:     "Execute shell command. Args: {command: string}. Returns stdout."
read:     "Read file content. Args: {file_path: string, offset?: number, limit?: number}. Returns file text."
edit:     "Replace exact text in file. Args: {file_path: string, old_string: string, new_string: string}. old_string must match exactly."
write:    "Create or overwrite file. Args: {file_path: string, content: string}. Use edit for partial changes."
glob:     "Find files by glob pattern. Args: {pattern: string, path?: string}. Returns matching paths."
grep:     "Search file contents with regex. Args: {pattern: string, path?: string}. Returns matching lines."
question: "Ask user a question. Args: {question: string}. Use when you need clarification."
```

Outils supprimés pour local (12) : todowrite, task, multiedit, batch, apply_patch, ls, lsp, webfetch, websearch, codesearch, plan-enter, plan-exit

---

## 5. Environnement système

### Cloud (~215 tokens)

```
You are powered by the model named claude-sonnet-4-20250514. The exact model ID is anthropic/claude-sonnet-4-20250514
Here is some useful information about the environment you are running in:
<env>
  Working directory: /home/user/project
  Workspace root folder: /home/user/project
  Is directory a git repo: yes
  Platform: linux
  Today's date: Thu Apr 10 2026
</env>
<directories>
  src/
  tests/
  package.json
  ...
</directories>
```

### Local (~15 tokens)

```
Working directory: /home/user/project, Platform: linux
```

---

## 6. Skills

### Cloud (~800 tokens)

```
Skills provide specialized instructions and workflows for specific tasks.
Use the skill tool to load a skill when a task matches its description.

- /commit — Create a git commit with a descriptive message
- /review-pr — Review a pull request for bugs, security, and quality
- /init — Initialize a new project with best practices
...
```

### Local

```
(skip — 0 tokens)
```

---

## 7. Mécanismes de fiabilité (code-level, pas prompt)

### Prompt profiler (`packages/opencode/src/session/llm.ts`)

```typescript
if (input.model.providerID === "local-llm") {
  const estimateTokens = (text: string) => Math.ceil(text.length / 4)
  const systemTokens = estimateTokens(system.join("\n"))
  log.info("prompt profile", { systemTokens, model: input.model.api.id })
}
```

### Pre-flight guards (`packages/opencode/src/session/prompt.ts`)

```typescript
function preflightCheck(toolId, args, model, messages): string | undefined {
  if (model.providerID !== "local-llm") return

  // Guard 4 (PRIORITÉ) — old_string doit exister dans le fichier
  if (toolId === "edit" && args.old_string) {
    const content = fs.readFileSync(args.file_path, "utf-8")
    if (!content.includes(args.old_string))
      return "old_string not found in file. Read the file and copy exact text."
  }

  // Guard 1 — read avant edit (vérifie dans l'historique des messages)
  if (toolId === "edit" && args.file_path) {
    const hasRead = messages.some(m => m.parts.some(p =>
      p.type === "tool" && p.tool === "read" && p.state?.input?.file_path === args.file_path
    ))
    if (!hasRead) return "You must read this file before editing it: " + args.file_path
  }

  // Guard 2 — write sur fichier existant
  if (toolId === "write" && fs.existsSync(args.file_path))
    return "File already exists. Use edit instead."

  // Guard 3 — old_string vide
  if (toolId === "edit" && (!args.old_string || !args.old_string.trim()))
    return "old_string cannot be empty."
}

// Intégré avant tool.execute.before dans le dispatch des outils
const pfError = preflightCheck(item.id, args, input.model, input.messages)
if (pfError) throw new Error(pfError)
```

### Doom loop auto-break (`packages/opencode/src/session/processor.ts`)

```typescript
const DOOM_LOOP_THRESHOLD = 2  // 4B models spiral after 2 identical calls

// Détecte N appels identiques (même tool + mêmes args)
// Cloud : demande permission à l'utilisateur
// Local : injecte une erreur automatiquement
if (ctx.model.providerID === "local-llm") {
  ctx.toolcalls[value.toolCallId] = yield* session.updatePart({
    ...match,
    state: {
      status: "error",
      error: `STOP: You called ${value.toolName} twice with identical args. Change your parameters or use a different tool.`,
    },
  })
  return
}
// Cloud : yield* permission.ask({ permission: "doom_loop", ... })
```

### Tool telemetry (`packages/opencode/src/session/processor.ts`)

```typescript
interface ToolTelemetry {
  calls: number
  success: number
  errors: number
  byTool: Record<string, { calls: number; errors: number }>
}

// Incrémenté sur chaque tool-result (success) et tool-error
// Loggé en fin de session pour local-llm :
if (ctx.telemetry.calls > 0 && ctx.model.providerID === "local-llm") {
  const rate = Math.round((ctx.telemetry.success / ctx.telemetry.calls) * 100)
  log.info("tool telemetry", {
    calls: ctx.telemetry.calls,
    success: ctx.telemetry.success,
    errors: ctx.telemetry.errors,
    successRate: `${rate}%`,
    byTool: ctx.telemetry.byTool,
  })
}
// Objectif : >85% tool success rate sur 50+ runs
```

---

## 8. Fichiers sources

| Fichier | Rôle |
|---------|------|
| `packages/opencode/src/session/prompt/local.txt` | Prompt local (~150 tokens) |
| `packages/opencode/src/session/prompt/default.txt` | Prompt cloud fallback (~2,192 tokens) |
| `packages/opencode/src/session/prompt/anthropic.txt` | Prompt Claude (~2,079 tokens) |
| `packages/opencode/src/session/prompt/gemini.txt` | Prompt Gemini (~3,882 tokens) |
| `packages/opencode/src/session/prompt/beast.txt` | Prompt GPT-4/o1/o3 (~2,807 tokens) |
| `packages/opencode/src/session/prompt/gpt.txt` | Prompt GPT (~2,348 tokens) |
| `packages/opencode/src/session/prompt/kimi.txt` | Prompt Kimi (~2,198 tokens) |
| `packages/opencode/src/session/prompt/trinity.txt` | Prompt Trinity (~1,961 tokens) |
| `packages/opencode/src/session/prompt/codex.txt` | Prompt Codex (~1,867 tokens) |
| `packages/opencode/src/session/prompt/copilot-gpt-5.txt` | Prompt Copilot GPT-5 (~3,596 tokens) |
| `packages/opencode/src/session/system.ts` | Router prompt + env + skills |
| `packages/opencode/src/tool/registry.ts` | Filtrage outils + skeletons |
| `packages/opencode/src/session/llm.ts` | Prompt profiler |
| `packages/opencode/src/session/processor.ts` | Doom loop (threshold=2) + telemetry |
| `packages/opencode/src/session/prompt.ts` | Pre-flight guards (4 guards code-level) |
| `packages/opencode/src/tool/bash.txt` | Description bash (9,405 octets) |
| `packages/opencode/src/tool/edit.txt` | Description edit (1,379 octets) |
| `packages/opencode/src/tool/read.txt` | Description read (1,172 octets) |
| `packages/opencode/src/tool/write.txt` | Description write (941 octets) |
| `packages/opencode/src/tool/glob.txt` | Description glob (828 octets) |
| `packages/opencode/src/tool/grep.txt` | Description grep (817 octets) |
| `packages/opencode/src/tool/question.txt` | Description question (622 octets) |

---

## Questions pour les autres IA

> Les questions 1, 4, 6 ont été résolues suite au consensus multi-IA (Qwen/ChatGPT/Opus/Gemini).

1. ~~Le prompt local peut-il être encore réduit ?~~ → **Résolu** : réduit de ~208 à ~150 tokens. Les règles safety sont enforced par pre-flight guards (code-level, 0 tokens).
2. Les skeletons sont-ils suffisants ou faut-il ajouter des contraintes supplémentaires (exemples, formats de sortie) ? → Skeleton `edit` enrichi avec "whitespace matters, Read file first".
3. La détection d'intention par regex (dans le plan initial) est-elle plus fiable que la whitelist statique actuelle ? → **Consensus** : whitelist statique est supérieure.
4. ~~Quels garde-fous code-level manquent pour >85% ?~~ → **Résolu** : 4 pre-flight guards implémentés (old_string verification, read-before-edit, write-on-existing, empty old_string).
5. Les prompts cloud sont-ils eux aussi optimisables (certains font 15K tokens) ? → P2, ROI faible (cloud models ont 128K+ contexte).
6. ~~Le doom loop threshold de 3 est-il optimal pour un 4B ?~~ → **Résolu** : abaissé à 2 (consensus : les 4B spiralent après 2 appels identiques).

### Prochaines questions ouvertes

7. Quel est le taux de succès réel des pre-flight guards sur 20+ sessions ? (données à collecter)
8. Le guard "old_string in file" a-t-il des faux positifs sur des edits multi-fichiers ?
9. Faut-il un guard supplémentaire pour détecter les edits qui cassent la syntaxe (AST validation) ?
