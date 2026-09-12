# AGENTS.md — Unifia Workbench

> **Unifia Workbench** is the rebranded continuation of [OpenCode](https://github.com/anomalyco/opencode) (via the [Rwanbt/unifia](https://github.com/Rwanbt/unifia) fork). All conventions below apply to the Unifia codebase.
>
> **Repository:** `Rwanbt/unifia`.
> **Brand identity:** Unifia (logo, color tokens, typography defined in `brand/unifia/`).
> **Conventions:** derived from upstream OpenCode, adapted to Unifia naming.

This document is read by **every** AI coding agent working on this repo (Hermes, Claude Code, Codex, Cursor, etc.). Follow it strictly.

## Branches

- This repository's **GitHub default branch is `main`** — verified with
  `gh api repos/Rwanbt/unifia --jq .default_branch`. The previous claim that it
  was `dev` (and that a local `main` ref might not exist) was inherited from
  upstream and is wrong here: both branches exist and have diverged.
- `dev` is the **integration branch**: feature work targets it, and it is where
  the rebrand lands before `main`.
- Rebrand work stacks on `feat/unifia-*` branches merged into
  `feat/unifia-rebrand-complete`, which is what opens a PR against `dev`.
- Diff against whichever of `origin/dev` or `origin/main` your change targets;
  they are not interchangeable.

## Project Layout

- `packages/unifia/` — CLI core (binary: `unifia`)
- `packages/app/` — Web app (SolidJS)
- `packages/desktop/` — Tauri 2 desktop (identifier: `ai.unifia.workbench.dev`)
- `packages/mobile/` — Tauri 2 mobile
- `packages/console/` — Web console (5 sub-packages)
- `packages/sdk/` — JavaScript SDK
- `packages/ui/`, `packages/util/`, `packages/storybook/` — shared libraries
- `brand/unifia/` — **Unifia brand kit** (logos, tokens, theme)
- `docs/autonomy/` — Hermes governance documents (this rebrand pack)
- `.hermes/`, `agent/*` branches — Unifia Workbench integration layer

## Required Tools

- **Bun** ≥ 1.3 (`packageManager: bun@1.3.11`)
- **Node** 22+ (for tooling)
- **Rust + Cargo** (for Tauri desktop/mobile)
- **shellcheck** (optional, for `.sh` files)
- **Docker** (optional, for sandbox backends)

## Workflow

- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.


## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/unifia`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/unifia`), never `tsc` directly.
