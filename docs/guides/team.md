# Team mode user guide

Team runs several isolated OpenCode sessions against one dependency graph, requires independent review for every write task, and integrates only reviewed commits into a generated integration worktree. It never writes directly to `main`, `master`, `dev`, `stable`, or `opti-ui`.

## Configure models

Select at least two distinct connected models in the Team setup dialog. The runtime refuses to start without two models because an implementation cannot review itself.

## Native session usage

Choose the `team` agent and describe the objective. The agent decomposes the work and invokes the native `team` tool. Write tasks must declare an explicit `write_set`; an empty set authorizes no file.

## Headless CLI

Run a server in the target repository, then use its URL:

```powershell
opencode team dry-run --plan .\team-plan.json --models .\models.json
opencode team start --attach http://127.0.0.1:4096 --plan .\team-plan.json
opencode team list
opencode team status <run-id>
opencode team events <run-id> --all
opencode team pause <run-id> --attach http://127.0.0.1:4096
opencode team resume <run-id> --attach http://127.0.0.1:4096
opencode team cancel <run-id> --attach http://127.0.0.1:4096
opencode team export <run-id> --out .\team-export.json
```

Piped CLI output is JSON by default. Human progress is written to stderr. Missing input exits 66, invalid usage 64, unavailable server 69, unexpected failure 70, and interruption 130.

## App and TUI

- App: open the command palette and select the Team command. Choose a run to load its DAG and review gates. Pause/resume are immediate; cancel requires a second confirmation click.
- TUI: open Team, move with arrows, select with Enter, use `p`/`r`, and press `c` twice to cancel.

## Safety and failure behavior

- Each write task runs in a generated worktree, must commit, leave it clean, provide exact test commands, and stay inside `write_set`.
- Read tasks fail if they create a commit.
- A different configured model reviews the exact implementation commit with all tools denied.
- Only approved commits are cherry-picked in dependency order.
- Any integration failure resets the generated integration worktree to the exact base SHA and verifies it is clean.
- Failed, blocked, cancelled and incomplete work cannot produce a COMPLETE final report.

## Current release limits

- Cost/token limits are checked between provider calls. Budgeted runs are sequential, but one in-flight response can exceed the remaining allowance.
- Pause/resume/cancel controllers live in the server process; persisted history survives restart, automatic execution reattachment does not.
- A production release still requires a real-provider smoke run and the normal signing/SBOM/checksum gates.
