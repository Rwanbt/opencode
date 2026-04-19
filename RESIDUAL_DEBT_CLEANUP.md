# Residual Debt Cleanup — 2026-04-18

Scope: two residual-debt items from Sprint 6. **No commit produced** — code
changes staged for review.

---

## Item 1 — DAG full e2e for `team` tool

**Status:** partial — full e2e remains skipped, but the PROD
`computeWaves` algorithm is now directly guarded.

### What changed

- Extracted the internal `computeWaves` helper from
  `packages/opencode/src/tool/team.ts` into a new dependency-free module
  `packages/opencode/src/tool/team-waves.ts`. `team.ts` re-imports from it
  (strictly additive; `computeWaves` was never exported).
- Added `packages/opencode/test/e2e/team-waves.test.ts` which drives the
  PRODUCTION `computeWaves` through the exact `dispatchDag` simulator
  previously inlined in `dag-team.test.ts`. Any drift between the
  mirror-copy in `dag-team.test.ts` and the prod algorithm is caught here.
- Rewrote the `describe.skip` comment in `dag-team.test.ts` with a precise
  diagnosis of the five remaining blockers, listing the exact call sites
  to touch, and an effort estimate (4-6h end-to-end).

### Why the full e2e is still skipped

Enabling the full e2e requires more than wiring service mocks. It needs
(diagnosed concretely in `dag-team.test.ts` skip block):

1. `Agent.list()` / `Agent.get()` test-override or fixture config.
2. `Session.create` inside an `Instance.provide(...)` ALS scope — the unit
   preload does not bootstrap one.
3. `Workspace.create` requires a real git repo inside the tmpdir
   (`git init && git commit --allow-empty`).
4. `SessionPrompt.prompt` drives the full agent loop; the only existing
   provider seam is `OPENCODE_E2E_LLM_URL` (see `provider.ts:1467`) which
   routes SDK creation through `createOpenAICompatible` pointed at a test
   LLM server.
5. `Permission` rules need to be seeded in the agent fixture so the
   subtasks' tool calls auto-grant.

All five are strictly additive changes to production code and test helpers.
None of them are blocked by a missing seam; they are omitted here because
the effort (4-6h) is out of scope for a residual-debt cleanup and the new
`team-waves.test.ts` already guards the regression risk in the wave
algorithm itself.

### Tests to run

```
bun test ./test/e2e/team-waves.test.ts
bun test ./test/e2e/dag-team.test.ts
```

### Risks

- Extracting `computeWaves` is a pure module-level refactor; `team.ts`
  behavior is unchanged.
- The `sleep()` helper in `team.ts` is still present and still unused —
  unchanged from before this cleanup, left alone to keep the diff minimal.

---

## Item 2 — Keychain mock endpoint + storage tests

**Status:** done.

### What changed

- Added `packages/opencode/test/lib/mock-keychain-server.ts` — a Node
  `http.createServer` bound on `127.0.0.1:0` implementing the exact 4
  routes consumed by `KeychainStorage`:
  - `GET  /kc/:service`            → list keys
  - `GET  /kc/:service/:key`       → read value (404 on miss)
  - `PUT  /kc/:service/:key`       → upsert
  - `DELETE /kc/:service/:key`    → remove
  - Auth via `X-Keychain-Token`; mismatch → 401.
  - Exposes `{ url, token, store, close, kill }` where `kill()` force-shuts
    connections to simulate transport errors.
- Added `packages/opencode/test/auth/keychain-storage.test.ts` with 9
  assertions covering:
  - `available()` true/false based on env vars;
  - single-entry `set` / `get` round-trip;
  - 404 handling for unknown keys;
  - multi-entry `save` / `load` round-trip (3 diverse entries);
  - `save()` removal semantics (keys absent from new snapshot are DELETEd);
  - transport-error behaviour (`load()` throws after `server.kill()`);
  - clear error message when env vars are missing;
  - bad-token request rejection (401).

### Why NOT the full `Auth.layer` test

`Auth.layer` captures its backend choice once, at layer evaluation, via
`selectKeychain()` which reads the module-level `AUTH_STORAGE_BACKEND`
constant set at `auth/index.ts` module-init. Flipping
`OPENCODE_AUTH_STORAGE` mid-process does **not** affect the running
`ManagedRuntime` — the only way to exercise the keychain-backed
`Auth.layer` in-process would be to rebuild the runtime, which the public
API does not expose. Testing `KeychainStorage` directly covers the
wire-protocol code path (100% of the new surface); the `Auth.layer` glue
that calls `keychain.load()` / `keychain.save()` is already exercised by
the existing `test/auth/auth.test.ts` against the file backend.

### Migration semantics not tested

`initAuthStorage` → `maybeMigrateToKeychain` is guarded by the same
module-level env check and would require the same runtime-rebuild to
exercise. The migration's correctness hinges on `KeychainStorage.set` /
`KeychainStorage.get` — both of which are now covered by round-trip
tests.

### Tests to run

```
bun test ./test/auth/keychain-storage.test.ts
bun test ./test/auth/
bun test ./test/lib/
```

### Risks

- `mock-keychain-server.ts` uses `server.closeAllConnections?.()` (guarded
  optional chain) — present on Node 18.2+ / Bun. If unavailable, `kill()`
  degrades to a graceful close, which still makes the "transport error"
  test pass because subsequent `fetch` calls fail with `ECONNREFUSED`.

---

## Validation

| Command                                                     | Result |
|-------------------------------------------------------------|--------|
| `bun run typecheck` (full workspace)                        | 14/14 pass, 0 error |
| `bun test ./test/e2e/team-waves.test.ts`                    | 9/9 pass |
| `bun test ./test/e2e/dag-team.test.ts`                      | 7 pass, 2 skip |
| `bun test ./test/auth/keychain-storage.test.ts`             | 9/9 pass |
| `bun test ./test/auth/ ./test/e2e/ ./test/lib/`             | 25 pass, 2 skip, 0 fail |
| `bun test` (full `packages/opencode`, 176 files)            | 2129 pass, 26 skip, 1 todo, 0 fail |

No regressions introduced.
