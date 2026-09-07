<!-- SPDX-License-Identifier: MIT -->
# Sovereign Knowledge Core V1 — Permissions and Egress

> Single source of truth for what the Sovereign Knowledge Core
> V1 is allowed to read, write, and emit, and to whom.
> See also: ADR-KNOW-0006 (egress: default deny), ADR-KNOW-0007
> (native port), ADR-KNOW-0004 (Class C: local only, never Git).

## 1. Default posture

**Default deny.** Every egress path is closed by default. Opening
one requires a typed `DeclassificationGrant` bound to a hash, a
destination, and a TTL. No global "send everything" mode exists.

The runtime cannot read or write outside the workspace root (`<workspace>`)
without an explicit `mount` declaration recorded in the Class C control store.
Containment is decided on resolved real paths, not on the spelling of a
locator: a junction or symbolic link inside the vault that points outside it
is not followed, and a link cycle terminates rather than recursing.

## 2. Capability surface (V1)

The Sovereign Knowledge Core V1 exposes exactly these capabilities
to the rest of Unifia. They are exhaustively listed in
`packages/contracts/src/knowledge/mcp.ts` (`MCP_KNOWLEDGE_METHODS`):

| Capability | Direction | Default | Notes |
|---|---|---|---|
| `knowledge_search` | read | allow (in-workspace) | bounded by ADR-KNOW-0007 |
| `knowledge_get` | read | allow (in-workspace) | id-based |
| `knowledge_backlinks` | read | allow (in-workspace) | id-based |
| `knowledge_trace` | read | allow (in-workspace) | provenance chain |
| `knowledge_status` | read | allow | always local, no payload |
| `knowledge_propose` | write (Class A) | allow with provenance | requires intent |

Any capability not in this list is not implemented and must not be
invoked. There is no `knowledge_*_admin` or `knowledge_*_raw` in V1.

## 3. Egress destinations

A `destination` is one of:

| Destination kind | Examples | Default | Override |
|---|---|---|---|
| `provider:<id>` | local llama.cpp, local ONNX | allow | allow |
| `provider:<id>:remote` | OpenAI, Anthropic, any cloud LLM | **deny** | declassification grant required (per hash + TTL) |
| `git_remote:github` | push to GitHub | **deny** for `git_remote: deny` items | grant |
| `git_local` | local `.git/` | allow (outgoing range is scanned) | n/a |
| `mcp:remote` | remote MCP server | **deny** | grant |
| `mcp:local` | local MCP server (loopback) | allow | n/a |
| `file:outside_workspace` | any path outside `<workspace>` | **deny** | grant |
| `file:inside_workspace` | any path inside `<workspace>` | allow | n/a |

## 4. Restrictions per source

A note may carry a `unifia_restrictions` block in its frontmatter. This is the
single canonical spelling; see the 2026-08-29 amendment to ADR-KNOW-0006,
which retired the competing `portable_restrictions` name this document used
before V1.

```yaml
unifia_id: "0190d2c0-7b00-7000-8000-000000000001"
unifia_type: "constraint"
unifia_lifecycle: "active"
unifia_project_ref: "unifia"

unifia_restrictions:
  remote_model: deny        # never go to a remote LLM
  local_model: allow        # may go to local llama.cpp / ONNX
  embeddable: allow         # may enter the FTS / vector index
  exportable: deny          # may not be handed to an exporter
```

Every field is optional. An absent block is UNCLASSIFIED and resolves to
`remote_model: deny`, `local_model: allow`, `embeddable: allow`,
`exportable: deny`, so adding a note never widens what may leave. A malformed
block is refused rather than read as unrestricted.

The `ContextRouter` enforces these restrictions **before** hydrating a
`ContextPack`: it matches `local_model` against a destination declared
`local` and `remote_model` against everything else, since a plan that does
not declare itself local is treated as remote. Denied items are dropped and
counted in `ContextDiagnostics.candidatesDroppedByRestriction`, with the
per-item reason in `ContextDiagnostics.excludedReasons`.

`git_remote`, `external_editor` and `mcp` appeared only in this document and
were never implemented. They are out of V1: the outgoing-range scan covers
Git (Phase 8) and the MCP token allowlist covers MCP.

## 5. Tokens and quotas

Each MCP session receives a token with:

- a workspace scope (single workspace), compared in constant time;
- a TTL, defaulting to 1 hour and refused above 24 hours — a token is never
  perpetual;
- a method allowlist, defaulting to the five read-only methods, so
  `knowledge_propose` is opt-in;
- an id from a 32-byte CSPRNG, not derived from the clock.

Rate limit, request bytes and response bytes are enforced by the server from
its `McpKnowledgeConfig` (all UTF-8 byte counts, not string lengths), and
apply to every method including `knowledge_status`.

A revoked or expired token is rejected immediately, even mid-session. There is
no anonymous MCP access in V1: every method requires a token, and unknown,
revoked, expired, wrong-workspace and out-of-scope all produce the same
undifferentiated refusal.

**V1 limitation**: the registry lives in the memory of the server that
honours it. `composeMcpServer()` binds a workspace, its policy, the service,
the registry and the server together and is the only supported way to obtain
a usable token — but V1 ships no MCP daemon, so a token does not outlive the
process that issued it. `unifia knowledge mcp-token session <workspace>`
exercises the real lifecycle in one process; `issue`, `check` and `revoke`
refuse across invocations rather than returning a misleading answer.

An MCP client sits behind a transport, so it is composed as a **remote**
destination: the workspace policy decides what may reach it, and a note
carrying `remote_model: deny` is withheld from every capability — search,
get, backlinks and trace alike.

## 6. Audit trail

Every cross-class mutation, every egress decision, and every
admin task emits a record to the Class C control store. The
control store is **local only** and never pushed to a remote.

## 7. What V1 does not do

- It does not call any remote LLM unless the user has explicitly
  granted a `DeclassificationGrant` for the relevant hash.
- It does not push to any Git remote. `autoPush` defaults to
  `false` (see `GitProvider`).
- It does not sync to any cloud. There is no Unifia cloud in V1.
- It does not phone home. This is structural, not a policy: there is no
  network code in the subsystem — no `fetch`, no HTTP client, and the Rust
  crate depends only on thiserror, serde, camino, sha2, blake3 and optional
  rusqlite. The `sovereignty` command *records* whether the operator asserts
  `internet=off` and `cloud=off`; it does not measure them, and says so.
- It does not embed any third-party tracking, analytics, or
  telemetry.

## 8. Operator-facing commands

| Command | Purpose |
|---|---|
| `unifia knowledge sovereignty` | run the 5 sovereignty checks — 2 measured (vault readable, derived DB deletable) and 3 recorded from operator assertions (internet off, cloud off, device isolated) |
| `unifia knowledge disaster-recovery` | plan the recovery procedure |
| `unifia knowledge migrate --dry-run` | preview a migration |
| `unifia knowledge migrate --rollback` | preview the rollback plan |
| `unifia knowledge precommit install <ws>` | install the secret-scan hook |
| `unifia knowledge precommit scan <files...>` | run the scan manually |

## 9. How to change this document

`PERMISSIONS.md` is part of the V1 contract. Any change must:

1. be preceded by an ADR in `docs/knowledge/adr/` updating the
   relevant knowledge ADR (KNOW-0006, KNOW-0007, KNOW-0009);
2. be reviewed by the operator and recorded in `DECISIONS.md`;
3. not relax the default-deny posture without an explicit
   migration step and operator approval.

No automatic edit of this document by an AI agent is allowed.
