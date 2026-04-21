@D:\Documents\Obsidian\IA Dev\OpenCode\CLAUDE.md

# Rules

- ALWAYS fix ALL errors, including pre-existing ones. Never dismiss an error as "pre-existing" or "not related to our changes". If you encounter it, you fix it.
- GPU acceleration is mandatory. Never suggest CPU-only as a solution.
- Android builds take 5+ minutes. Never compile without thorough code verification first.

## Anti-loop rules

- After 3 failed attempts on the same problem, STOP. Write the full diagnosis and propose 2-3 alternative approaches BEFORE coding anything.
- Before any fix, write in 2 lines: the root cause and why this approach solves it. If you can't, you don't understand the problem.
- Never use sed/regex on source code. Use str_replace with textual anchors or refactor cleanly.
- When a test fails: diagnose first (1 message), propose the plan (1 message), implement after. No trial-and-error loops.

## Performance debugging

- When measured performance is far from vendor specs (>3x gap), look for integration bugs FIRST (wrong parameter, wrong endpoint, wrong format) before optimizing infrastructure.
- Read the actual API documentation/source before building optimization layers on top.

## Fix verification

- After any fix, grep the corrected pattern across the ENTIRE project to find other occurrences of the same bug. Never fix just the first occurrence found.

## Deployment

- Build: `cd packages/desktop && bun tauri build`
- Deploy: copy the built exe to `C:/Users/barat/AppData/Local/OpenCode/OpenCode.exe`
- NEVER touch Antigravity (the IDE). NEVER kill processes that aren't ours.
