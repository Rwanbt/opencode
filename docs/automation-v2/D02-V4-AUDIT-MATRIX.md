<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# D-02 V4 — Mechanical audit matrix (contract gate)

> Generated 2026-09-04 from source commit `1591cd4d68` + D-02 V4 hardening batch.
> Requirement sources: master plan D-02 sections 6-20, ADR-0007 V3 (frozen),
> ADR-001 digest machinery, ADR-008 authoritative clock.
> Level: **CONTRACT gate** on the authority facade. The **production durable
> gate** (real substrate fencing/restart/power-loss) stays separate and cannot
> close before ADR-000 (master plan section 20).

Status legend: `PASS` = implemented + mechanically tested at contract level ·
`PARTIAL` = implemented, test gap noted · `OPEN` = requires substrate (durable gate).

## Requirement → implementation → test

| # | Requirement (source) | Implementation | Test (bun, packages/workflow-runtime) | Status |
|---|---|---|---|---|
| 1 | One WorkflowRun = one durable authority; broker is facade only (§6, ADR-0007 §"facade") | `ApprovalBrokerV4` holds zero durable state; all reads/writes via injected `ApprovalAuthority` (approval-v4.ts:81,114-118) | full V4 suite runs through authority double; no facade-owned store | PASS |
| 2 | Static gate: production cannot import legacy V2 broker (§6) | barrel re-export removed (src/index.ts); scan test walks every `packages/*/src` | `approval-v2-quarantine.test.ts` "no production source module imports…" | PASS |
| 3 | Runtime gate: production cannot instantiate legacy broker (§6) | `assertQuarantineGateOpen()` in all three legacy constructors; opt-in `UNIFIA_ALLOW_LEGACY_APPROVAL_V2=1` (approval-v2.ts:22-34,110,124,156) | `approval-v2-quarantine.test.ts` "runtime guard blocks…" | PASS |
| 4 | Authority token `{workflowRunId, generation, authorityOwnerId}` required for request/resolve/cancel (§7) | `assertToken(token)` at each mutating entry (approval-v4.ts:88,112,135); fencing delegated to `authority.transact` | "rejects missing or malformed authority tokens…"; "fences every mutating operation…" | PASS |
| 5 | Token run vs request run vs record run consistency (§7) | `AUTHORITY_RUN_MISMATCH` guard in request (token↔input) and resolve/cancel (token↔record) | "rejects run mismatches between token and request or record" | PASS |
| 6 | Stale-owner fencing: A(gen1) mutations REJECT, B(gen2) resolve ACCEPT (§8) | facade delegates to authority fencing; contract test simulates takeover via authority state bump | "stale owner loses every mutation; takeover owner resolves" | PASS (contract) / OPEN (durable: FC-14/FC-25 model) |
| 7 | Security binding: full frozen field set (§9) | `ApprovalBinding` carries all 10 frozen fields; `requestGeneration` + `ordinal` on record | "requires complete binding equality…"; digest equality tests | PASS |
| 8 | Canonical ApprovalBindingDigest via ADR-001 machinery (§10) | `digest(canonical(binding), "approval-effect")` through `@unifia/digest-runtime` (JCS-v1 RFC 8785 + SHA-256, domain-separated) | every binding-equality test exercises the digest; scope-reorder test | PASS |
| 9 | Individual binding fields remain auditable (§10) | record stores raw fields; digest only used for equality/derivation | inspect returns full record | PASS |
| 10 | ApprovalId derived, not caller-chosen; restart-stable; requestGeneration change → new id; no id reuse (§11) | `approvalId = approval-v4-<digest(binding, ordinal)>`; ordinal is per-family max+1 | "derives a stable id…"; "new request generation gets a distinct approval id"; "unrelated approvals do not disturb deterministic identity"; restart test | PASS |
| 11 | Requester ≠ approver; self-approval REJECT (§12) | `SELF_APPROVAL_REJECTED` before any state check (approval-v4.ts:116) | "rejects self approval…" | PASS |
| 12 | Requester cancels own PENDING → CANCELLED; unrelated → REJECT (§13) | requester-identity path in `cancel` | "rejects self approval and allows requester cancellation only" | PASS |
| 13 | System cancellation requires `isTrustedSystemActor` proof; forged system cancel cannot bypass (§13/§19) | trusted-proof path only for cancelling OTHERS' requests; unproven system actor falls to requester check and fails | "requires authority proof for system cancellation" | PASS |
| 14 | Expiry fail-closed at `now >= expiresAt`; boundaries -1/ =/+1; injected clock, no `Date.now()` (§14, ADR-008) | `authority.now() >= expiresAt → EXPIRED`; clock supplied by authority | "uses the equality expiry boundary on both sides" (199/200/201) | PASS |
| 15 | No PENDING zombie: past-expiry duplicate is expired, fresh request issued (§14) | expire-inside-transaction then new ordinal in `request` | "expires a past-expiry duplicate and issues a fresh request" | PASS |
| 16 | Idempotent resolve: same decision+actor+binding → same durable result, journaled `REPLAYED_RESOLVE`; conflicting decision → `APPROVAL_ALREADY_RESOLVED` (§15, ADR-0007 inv.2-3) | terminal branch checks decision+actor+binding; replay appends event only | "supports idempotent replay but rejects a conflicting terminal decision" | PASS |
| 17 | Terminal record immutable: binding mismatch on APPROVED/DENIED/… must NOT re-transition to STALE (§15; fix of B1) | terminal check precedes STALE; STALE is PENDING-only | "never re-transitions a terminal record on binding mismatch" | PASS |
| 18 | History: durable total order by `eventSequence`; one event per transition; ADR-0007 taxonomy incl. `STALE_PLAN_CHANGED` vs `STALE_DIGEST_MISMATCH`, `previousState` (§16) | `eventFor` derives sequence from authority state; kinds per ADR-0007 V3 | "history is a dense, ordered, per-transition journal"; STALE kind tests | PASS |
| 19 | Atomic transaction: fence + binding + transition + history (§17) | single `authority.transact` per mutation; facade builds full next-state, substrate commits or nothing | "substrate failure leaves no torn state or partial history" (contract) | PASS (contract) / OPEN (durable: substrate transaction) |
| 20 | Pending survives real restart; same id/binding/history/state (§18) | facade stateless; rehydration test reconstructs authority from serialized snapshot | "pending approval survives authority rehydration with identical identity" | PASS (contract) / OPEN (durable: real substrate restart) |
| 21 | Runtime validation: missing/null/empty actor, invalid kind, missing/stale token, malformed binding, forged cancel — all fail before durable mutation (§19) | entry guards (`assertToken`, `assertHuman`, `ACTOR_REQUIRED`) throw before `transact`; binding failures inside transaction only mutate per frozen STALE semantics | "rejects invalid runtime inputs before durable mutation"; "rejects missing or malformed authority tokens…" | PASS |
| 22 | Two gates kept separate: CONTRACT vs PRODUCTION DURABLE (§20) | this matrix = contract gate; durable gate tracks ADR-000 + M1 wiring | ledger rows below | PASS |

## Fixed in this batch (findings from the mechanical audit)

- **B1 (high)**: `resolve()` applied the binding check before the terminal-state
  check, so a mismatched binding re-transitioned an already-`APPROVED`/`DENIED`/
  `EXPIRED`/`CANCELLED` record to `STALE` (state regression + false journal
  event). Fixed: STALE is PENDING-only; terminal records are immutable.
- **B2 (medium)**: idempotent replay did not require binding equality. Fixed:
  replay requires decision + actor + binding; anything else on a terminal
  record is `APPROVAL_ALREADY_RESOLVED` without mutation.
- **G1 (high)**: no token↔run consistency check at the facade. Fixed:
  `AUTHORITY_RUN_MISMATCH` in request/resolve/cancel; `AUTHORITY_TOKEN_REQUIRED`
  for missing/malformed tokens.
- **G2 (medium)**: a past-expiry duplicate was returned as PENDING. Fixed:
  expired inside the same transaction, fresh request takes the next ordinal.
- **G3**: ad-hoc `JSON.stringify` digest replaced by ADR-001 JCS-v1 machinery
  (`@unifia/digest-runtime`, domain `approval-effect`); set-typed scope arrays
  sorted before canonicalization (reorder must not invalidate).
- **G4**: history taxonomy aligned to ADR-0007 V3 (`STALE_PLAN_CHANGED`,
  `STALE_DIGEST_MISMATCH`, `REPLAYED_RESOLVE`, `previousState`).
- **G5**: quarantine gates added (static scan + constructor runtime guard);
  legacy broker removed from the package barrel.
- **G6**: contract matrix completed — 8 → 22 tests in `approval-v4.test.ts`.

## Measured evidence (this batch)

- `packages/workflow-runtime`: **61/61** (was 47/47 + 8 V4) in 0.49s
- `packages/contracts`: 632/632 · `packages/digest-runtime`: 12/12 ·
  `packages/workflow-catalog`: 5/5 · `packages/automate-migration-tool`: 32/32 ·
  `packages/workbench-server`: 84/84 · `packages/release-hardening`: typecheck only
- Turbo typecheck: **47/47** tasks (isolated cache)
- LOCAL COMMITS ONLY — NOT REMOTELY PUBLISHED.

## Out of scope here (remains open)

- Production durable gate (sections 18/20): substrate transaction, real
  restart, real multiprocess fencing — blocked on ADR-000.
- One observed flake in `workbench-server` suite (single failure on first run,
  84/84 on two consecutive re-runs) — P2, root cause not yet identified.
## Durable gate CLOSE (2026-09-05, post-ADR-000 ratification)

ADR-000 ratified 2026-09-05: **UNIFIA_NATIVE** (owner decision, frozen
Gate D; DBOS_GO_SQLITE = qualified finalist not selected, evidence
preserved). The production durable gate required by sections 18/20 and
req.22 is now measured on the real durable authority
(`NativeApprovalAuthority` + `NativeDurableHistoryAuthority`,
`packages/workflow-runtime`, SQLite WAL + synchronous=FULL — the
FC-13-proven durable configuration, 20/20 real power-loss iterations).

Directive-8 proofs measured (`test/native-durable.test.ts`, 19 tests,
all PASS):

```text
pending approval restart          PASS (PENDING survives, resolved after reopen)
stale authority rejection         PASS (stale generation/owner -> STALE_AUTHORITY)
authority takeover                PASS (generation bump; old token dies, exactly one winner)
derived ApprovalId                PASS (identical duplicate -> same record, ordinal 1)
binding TOCTOU rejection          PASS (STALE_PLAN_CHANGED / STALE_DIGEST_MISMATCH journalled)
policy binding                    PASS (drift -> STALE, journalled)
scope binding                     PASS (list reorder tolerated)
expiry boundary                   PASS (fail-closed EXPIRED after restart on late clock)
requester cancellation            PASS
forged system cancellation        PASS (untrusted system actor -> CANCEL_REJECTED)
resolution idempotency            PASS (REPLAYED_RESOLVE)
conflicting resolution rejection  PASS (APPROVAL_ALREADY_RESOLVED)
atomic state + history            PASS (approvals + journal + authority row in ONE transaction)
durable eventSequence             PASS (monotonic across restart: [1,2] preserved)
```

Package suite after the durable wiring: **80/80** (incl. the 20-test
V4 contract matrix unchanged). The durable gate of D-02 V4 is CLOSED
for the ratified substrate; multiprocess fencing at scale remains
covered by the M0 FC-14/FC-25 real-multiprocess evidence
(`M0_RESULTS_UNIFIA_NATIVE.json`).

LOCAL COMMITS ONLY — NOT REMOTELY PUBLISHED.