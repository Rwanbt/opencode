# Work/Design decisions

This file records decisions that apply across cards. Once recorded, they are not re-debated inside a later card.

## D1 — Product identity

- User-facing product name: **Unifia**.
- New implementation work must use Unifia naming.
- Historical identifiers are not introduced into new code, documentation, scripts, or generated configuration.

## D2 — Runtime authority

- Unifia Core remains the sole authority for sessions, providers, tools, permissions, secrets, memory, and audit.
- Work and Design are adapters and surfaces; they do not create a competing agent runtime.

## D3 — Branch and publication boundary

- Integration branch: `work-design`.
- No direct work on `main` or `dev`.
- No merge, push, publication, signing, or store action is performed by the implementation agent.

## D4 — Scope discipline

- One card at a time.
- Each card must declare its allowed files before editing.
- Existing user-owned changes outside this worktree are preserved.
- A scope expansion or unresolved license/contract ambiguity is a stop condition.

## Open decisions

## M3 — Wire contract

- Authority: `@unifia/contracts/workbench-wire`, exported as a contracts subpath.
- Runtime validation is implemented by parse functions over `unknown`; the returned types are the typed contract consumed by later cards.
- The protocol fixes reconciliation rules, monotonic sequence IDs, opaque cursors, UUID v7 idempotency, explicit handshake refusal, token rotation state, binary references, backpressure budgets, and SSE connection limits.

## M1c — Security implementation boundary

- Server-side Origin policy allows only `https://tauri.localhost` and `http://ipc.localhost`; requests without Origin remain valid for local non-browser callers.
- Preflight is explicit and credentials are never combined with wildcard CORS.
- Existing native bridge remains the integration point; no competing runtime or browser token storage was introduced.
- Human gate remains open: prove short-lived native token injection/rotation and inert SVG rendering in the packaged Android WebView before M4.

## M1a — Gate decisions

The following decisions are adopted from the reviewed Unifia Work/Design plan. They are the constraints for the implementation cards; later cards must stop rather than reinterpret them.

| Gate | Decision |
|---|---|
| G1 | A Work session is implicit for the directory, with an explicit `?session=` override. Directory registration to `workspaceId` is idempotent and server-owned. |
| G2 | Workspace identity follows worktree lifecycle events; deletion, reset, and recreation cannot silently inherit prior artifacts or trace. |
| G3 | Work and Code share an explicit single-writer boundary; the kill switch scope is operation, workspace, or server and must be visible in the audit contract. |
| G4 | The workbench server runs as a minimal local service with one instance identity, an allocated/discoverable loopback port, and single-writer persistence. |
| G5 | Design v0 renders deterministic inert SVG and previews it through an image element; no scripts, external resources, or `foreignObject`. |
| G6 | The spec format and design-system catalog source must be explicit before their implementation cards; the workspace authority is `.unifia/workspace.json`, JSON manifest version `1`, with multiple catalogs and no global/bundle fallback. |
| G7 | User vocabulary distinguishes the existing git worktree meaning of “workspace” from the workbench workspace concept through labels and help text. |
| G8 | Mobile integration uses the existing embedded JavaScript runtime and native bridge; it does not introduce a competing runtime. |
| G9 | Audit and artifact retention, rotation, compaction, eviction, and persistence-failure behavior are explicit before production-facing storage work. |

## M1a evidence

- Source: `D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\Plan-Work-Design-Integration-2026-08-12.md`, section 13.
- Scope: documentation only; no runtime or generated file changed.
- Operator instruction: continue sequentially after M0b on `work-design`.
