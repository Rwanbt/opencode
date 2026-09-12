# Sprint 2 — Implementation Notes

Branch: `dev` (not committed — user commits after review).
Scope: hardening items 7–11 of the Sprint 2 plan in `PRODUCTION_REVIEW_2026-04.md`.

## Status by item

| Item | Status | Notes |
|------|--------|-------|
| W1 — cost-cap + 429 on followup | **Done** | Cap read from `experimental.task.cost_cap`; cost computed on-the-fly from assistant messages. |
| W2 — `getWorktreeInfo` typing + log | **Done** | `as any` removed, typed `WorkspaceID`, errors logged with `log.warn`. |
| W3 — `(msg.info as any).cost` | **Done** | Replaced with typed helper `getMessageCost` using discriminated narrowing (assistant role → `msg.cost: number`). |
| W4 — llama-server flags | **Done (partial per spec)** | `--mmap`, `--slots`, `--slot-save-path`, `--cache-reuse 256`, and speculative decoding via `UNIFIA_DRAFT_MODEL` / sibling drafter detection added. `--prompt-cache` intentionally skipped (server-mode API difference — backlog). |
| W6 — background semaphore | **Done** | Per-project `max_parallel` (default 4). Tasks past cap stay `queued` via existing `SessionStatus.set({type:"queued"})`; slot released via `.finally()` covering Completed/Failed/Cancelled paths. Config: `experimental.task.max_parallel`. |
| B1 — keychain migration | **Design only (committed)** | Runtime unchanged. Full design doc inlined at top of `packages/unifia/src/auth/index.ts`. Implementation deferred to Sprint 3 — scope too large for this sprint (no `keyring` crate dep, no Tauri IPC contract, no Stronghold plugin wired). |

No "ÉCART RAPPORT/CODE" flagged — every file referenced by the report matched the described code.

## Files modified

- `packages/unifia/src/server/routes/task.ts` — W1, W2, W3 (helpers + route changes).
- `packages/unifia/src/tool/task.ts` — W6 semaphore.
- `packages/unifia/src/local-llm-server/index.ts` — W4 flags + draft detection + VRAM guard.
- `packages/unifia/src/config/config.ts` — new `experimental.task.{cost_cap, max_parallel}` schema.
- `packages/unifia/src/auth/index.ts` — B1 design doc (runtime unchanged).

## Test plan (manual)

- **W1**
  1. Set `experimental.task.cost_cap: 0.01` in `unifia.json`.
  2. Start a task, spend beyond $0.01.
  3. `POST /task/:id/followup` → expect HTTP 429 with `{error:"cost_cap_exceeded", used, cap}`.
  4. `GET /task/:id` returns `costUsed` and `costCap` fields.
- **W2** Force a Workspace DB error (corrupt row / wrong id): expect a `warn` log line "getWorktreeInfo failed" with the workspaceID instead of silent undefined.
- **W3** `GET /task/:id/team` still returns a correct `cost` per member; run typecheck (tsgo) — zero errors.
- **W4**
  1. Start llama-server. Inspect args: should show `--mmap --slots --slot-save-path <tmp>/opencode-llm-14097/kv-slots --cache-reuse 256`.
  2. Drop `*-0.5B-*.gguf` next to the main model. Restart. Log should contain `speculative decoding enabled` (if VRAM headroom ≥ 4 GiB) or the `skipping speculative decoding` warning otherwise.
  3. `UNIFIA_DRAFT_MODEL=<abs>` → forces the given path; `UNIFIA_DRAFT_FORCE=1` bypasses the VRAM guard.
- **W6**
  1. With `experimental.task.max_parallel: 2`, spawn 5 background tasks via orchestrator.
  2. First two transition `queued → busy`; remaining three stay `queued`.
  3. As slots release on Completed/Failed/Cancelled, queued tasks start in FIFO order.
- **B1** None — design-only.

## Residual risks

- **W1** — Cost is computed from persisted assistant messages each request; for very long sessions this is O(messages) per followup call (acceptable, but a future cached counter in `session.summary` would remove the scan). The cap is **per-session**, not per-user/org — tenant-wide quotas remain open (backlog).
- **W4 / speculative decoding** — VRAM headroom heuristic is coarse: 4 GiB constant regardless of draft model size. A too-large drafter may still OOM llama-server on marginal hardware; mitigated by `UNIFIA_DRAFT_FORCE` opt-out pattern reversed (guard is the default). Watch stderr on first real user.
- **W4 / `--slots` + `--slot-save-path`** — writes KV-cache blobs under `%TMP%/opencode-llm-14097/kv-slots`. Disk usage is bounded by llama-server but could grow under heavy use; cleanup relies on existing BASE_DIR hygiene on shutdown (not extended in this sprint).
- **W6** — The semaphore is in-process: if the orchestrator runs in a worker different from the Tauri host, two orchestrators could each allow 4 parallel tasks simultaneously (total 8). For the current single-process sidecar this is fine; cross-process coordination is not implemented.
- **B1** — Tokens still plaintext in `auth.json`. The B1 blocker in the security review remains open until Sprint 3 ships the adapter. Users relying on cloud sync ($HOME backup) should be warned via release notes.

## Notes

- No commit performed (per instruction).
- `bun run typecheck` (tsgo --noEmit) in `packages/unifia` exits 0 after the changes.
- No runtime changes to `packages/unifia/src/auth/index.ts` — only a large design-doc comment block. Safe to rebase.
