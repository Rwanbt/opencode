# M1 — Behavioral Evidence

**Date**: 2026-08-03
**Branch**: `recovery/unifia-audit-correction-20260803`
**Status**: `M1_BEHAVIOR_READ_PARTIAL`

This report records behavior read directly from pinned upstream files. It does
not authorize imports.

## Verified findings

| Candidate | Exact path | Observed behavior | Effective decision |
|---|---|---|---|
| OpenWork server/runtime | OpenWork `2c558bcffb5b686148c30bbf3dd2af7ade99492a`, `apps/server/src/server.ts` | Server composes OpenCode SDK, workspace config, session routes, provider auth, permissions and workspace imports. It is an application authority, not a neutral adapter. | `ADAPT_ONLY`; Unifia Core remains authoritative |
| OpenWork skills | same snapshot, `apps/server/src/skills.ts` | Reads project/global skill directories, parses `SKILL.md`, writes and recursively deletes project skill directories. | `REVIEW_PER_COMPONENT`; never adopt as unrestricted runtime |
| OpenWork approvals | same snapshot, `apps/server/src/approvals.ts` | `mode === "auto"` returns `allowed: true`; interactive mode times out to deny. | `REWRITE_BEHIND_APPROVAL_BROKER`; no direct adoption |
| Open Cowork remote | Open Cowork `ec5bd270861fd4531bda44554766b8b5bd009242`, `src/main/remote/gateway.ts` | WebSocket gateway supports token, allowlist, pairing and open modes; open mode authorizes all messages. Authorization runs before interceptor processing and auth attempts are rate-limited. | `ADAPT_AFTER_POLICY_REVIEW`; open mode forbidden in Unifia |
| Open Cowork sandbox | same snapshot, `src/main/sandbox/path-guard.ts` | Checks session sandbox containment and resolves existing paths through `realpathSync`; also has explicit system-path exceptions and command path conversion. | `ADAPT_AFTER_SECURITY_REVIEW`; no direct import |
| Open Cowork skills | same snapshot, `src/main/skills/skills-adapter.ts` | Exposes only a `SkillsAdapter` contract in the inspected file; implementation ownership and bundled component licences must be checked separately. | `UNVERIFIED_PER_COMPONENT` |

## Security consequences

1. An upstream approval service with an auto-allow mode cannot become the Unifia
   ApprovalBroker without an explicit policy contract and safe default.
2. An upstream remote gateway with an `open` authorization mode cannot be
   adopted as-is; Unifia must reject that mode at configuration validation.
3. Sandbox containment is a useful implementation reference, but its explicit
   system exceptions and Windows command conversion require platform-specific
   tests before reuse.
4. The OpenWork skills implementation performs filesystem mutation and recursive
   deletion; it must be behind capability and workspace policy checks.

## Licence boundary

The OpenWork `/ee` tree remains excluded. Open Cowork bundled skills require
per-component attribution review; the root MIT licence is not a substitute for
reviewing nested notices.

## Gate

`M1_BEHAVIOR_READ_PARTIAL`: five candidate paths have concrete behavioral
findings; Open Cowork skill implementation and the remaining i18n source remain
unverified. No runtime import is permitted.
## Additional findings

- Open Cowork src/main/skills/plugin-runtime-service.ts resolves marketplace plugins, copies directories into source/runtime paths, persists a registry, and materializes runtime content. This is installation and code-materialization behavior, not a passive skill catalogue: REWRITE_BEHIND_CAPABILITY_AND_PROVENANCE_POLICY.
- Open Cowork contains base renderer i18n at src/renderer/i18n/ with n.json and zh.json; this does not satisfy the unavailable user-overlay source recorded in the plan: base i18n may be REVIEW, user overlay remains BLOCKED_MISSING_SOURCE.
