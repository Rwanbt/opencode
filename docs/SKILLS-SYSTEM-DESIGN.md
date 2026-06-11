# Skills system — design proposal

**Date:** 2026-04-28
**Inspiration:** Google AI Edge Gallery 1.0.12's `skills/` directory and
constrained-decoding tool routing.
**Constraint from the user:** "tant que l'on ne perd pas en perf et que
ça ajoute de la polyvalence" — no regression on the existing tool hot
path, polyvalence as the value-add.

## Why bother

OpenCode already has a deep tool system (Bash / Edit / Read / Grep / Web /
Agent) — far more powerful than Gallery's three skill types. The
interesting thing about Gallery's design isn't the runtime; it's the
**packaging format**. A `SKILL.md` is a single Markdown file with YAML
frontmatter that any user can drop in `/sdcard/Download/` or fetch from
a URL and the model picks it up automatically.

Adopting that format gives OpenCode:

- **Distributable agent recipes** — share a "Refactor PR cleanup" skill
  via a GitHub Pages URL, anyone can install in one click.
- **Bidirectional ecosystem** — import any skill from Gallery's
  `skills/` directory unchanged; export OpenCode tool-chains as
  SKILL.md so Gallery users can run them.
- **Zero friction custom prompts** — text-only skills are essentially
  named system-prompt fragments scoped to a tool call. Cleaner than
  asking users to edit the System Prompt field for every workflow.

## Format spec (mirroring Gallery)

```yaml
---
name: refactor-pr-cleanup
description: |
  Reviews a PR diff and removes accidentally-committed debug logs,
  console.log calls, leftover TODO markers and commented-out code.
metadata:
  homepage: https://github.com/erwan/opencode-skills/refactor-pr-cleanup
  require-secret: false
  category: text-only          # text-only | js | native
---
# Instructions for the model

You are a code reviewer focused on cleanup, not feature changes.

For each file in the diff:
1. Read the diff carefully.
2. Identify additions that are debug-only.
3. Propose `edit` calls to remove them, one per line.
4. Do NOT touch logic — only debug noise.
```

Three execution models, matching Gallery exactly:

| Type        | Runtime                                         | OpenCode mapping                                                   |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `text-only` | Instructions appended to context                | Uses the existing System Prompt slot, no new tool                  |
| `js`        | Sandbox webview executing `index.html`          | NEW tool `run_js` — Tauri sub-window or Bun worker (see below)     |
| `native`    | Android intent dispatched via `run_intent`      | NEW tool `run_intent` — mobile-only, dispatches Android Intent     |

## No-perf-loss strategy

The existing tool dispatcher (Bash / Edit / Read / Grep / Web / Agent)
is the hot path that runs on every assistant turn. Skills MUST NOT
slow it down.

- **Skills are evaluated lazily**: only when the model emits a `call:`
  to one of the new tools (`run_js`, `run_intent`) or when its prompt
  literally mentions a known skill name.
- **The skill registry lives in localStorage** keyed by skill name;
  list look-up is O(1) and cached at session start. No filesystem scan
  per tool call.
- **Discovery is opt-in**: skills must be explicitly installed (URL
  fetch, ADB push, or built-in toggle in Settings → Skills). No
  auto-discovery on startup.
- **The Bash / Edit / Read code path is not touched** — only the
  agent-side tool registry sees an additional couple of entries.

## Frontend integration

- New Settings tab: **Skills** (next to Benchmark). Lists installed
  skills with toggle on/off, "Install from URL" input, and a
  "Refresh built-in" button.
- Composer hint: when a skill is enabled, show a tiny pill in the
  prompt input ("3 skills active"). Click → quick toggle popover.

## Backend integration

### `run_js` (cross-platform)

- On desktop: spawn a hidden BrowserWindow loaded with the skill's
  `scripts/index.html` (Tauri 2 already provides webviews) and call
  `window.ai_edge_gallery_get_result(data, secret)` (keep Gallery's
  function name for direct compatibility).
- On mobile: same, using a `WebView` reusable wrapper. Scope: limited
  to fetch + Web Audio + Canvas APIs; no DOM access to the host page.
- Return shape: `{ result: ... }` or `{ error: "..." }`.

### `run_intent` (mobile only)

- Tauri command that bridges to Kotlin
  `Intent.ACTION_*` dispatch. Whitelisted intents only:
  `ACTION_SEND` (email/sms), `ACTION_VIEW` (URL), `ACTION_DIAL` (phone),
  `ACTION_CALENDAR_EVENT`, `ACTION_INSERT_OR_EDIT` (contact).
- Anything else returns `error: "intent not allowed"`.
- Desktop returns `error: "native intents are mobile-only"`.

### Constrained decoding (later)

Gallery uses LiteRT-LM constrained decoding to guarantee the model
emits a syntactically valid `call:foo{args}`. We have two options:

1. **Accept best-effort parsing** — Gemma 4's training already biases
   it toward valid JSON. Our existing tool-call parser tolerates
   minor formatting drift. Ship without constraints.
2. **Add a JSON-schema constraint** via llama.cpp's grammar mode.
   Better correctness, more startup overhead. Defer to a Phase 2.

## Built-in skills to ship

Start with three text-only ones (zero implementation cost):

1. **conventional-commits** — instructs model to format every git
   commit message as Conventional Commit.
2. **rust-strict** — adds Rust-specific rigor: no unwraps in lib code,
   prefer `?` over `match`, etc.
3. **api-doc-writer** — emits OpenAPI 3.x snippets next to every new
   route handler.

These three demonstrate the format without requiring the JS/native
infrastructure.

## Open questions

- **Skill scoring**: when multiple skills match a query (e.g.
  "refactor + commit"), how does the model pick? Gallery uses name +
  description embedding similarity. We can defer: install one skill
  at a time, no auto-selection.
- **Trust model for URL-installed skills**: a hostile SKILL.md could
  inject jailbreak instructions into the system prompt. Display the
  skill source URL prominently and disable by default until the user
  toggles "Trust this source".

## Roadmap (~1-2 weeks)

| Day | Deliverable                                                                  |
| --- | ---------------------------------------------------------------------------- |
| 1   | SKILL.md parser + skill registry localStorage schema                         |
| 2   | Settings → Skills tab UI (list, install URL, toggle, delete)                 |
| 3   | Three built-in text-only skills + smoke test                                 |
| 4-5 | `run_js` tool + Tauri webview sandbox (desktop)                              |
| 6   | `run_js` mobile equivalent + WebView Android wrapper                         |
| 7   | `run_intent` Kotlin bridge + whitelist                                       |
| 8   | Import test: pull 3 Gallery built-ins (calculate-hash, query-wikipedia,     |
|     | qr-code) and run them unchanged                                              |
| 9   | Composer pill UI + quick toggle popover                                      |
| 10  | Documentation + sample skill repo `github.com/erwan/opencode-skills`         |

## References

- Gallery skills directory: `https://github.com/google-ai-edge/gallery/tree/main/skills`
- Format manifest analysed 2026-04-28 (see plan history).
- Gemma 4 native function calling: `call:foo{args}` syntax confirmed
  in HuggingFace model card for `google/gemma-4-E4B-it`.
