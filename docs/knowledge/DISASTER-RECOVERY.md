<!-- SPDX-License-Identifier: MIT -->
# Disaster Recovery Procedure — Sovereign Knowledge Core V1

> Single source of truth for the recovery procedure when the
> Unifia runtime is unavailable, the network is down, and
> only the canonical vault + portable metadata remain.
> See also: ADR-KNOW-0001 (canonical), ADR-KNOW-0003 (Class B
> portable), ADR-KNOW-0004 (Class C local), ADR-KNOW-0005
> (Class D reconstructible).

## 1. Goal

Restore the operator's working state with:

- **Class A** (canonical Markdown vault) — must remain readable
  with a stock text editor. The vault IS the source of truth.
- **Class B** (portable copy-on-write metadata) — must remain
  reachable. If a sidecar is missing but the Markdown is
  intact, the runtime rebuilds it on next open.
- **Class C** (local control state: tokens, policies, device
  grants) — reconstructible. Nothing user-visible is lost in
  Class A or Class B if Class C is missing.
- **Class D** (derived DB, FTS5 index, embeddings cache) —
  fully reconstructible from Class A. Delete and rebuild.

## 2. Pre-conditions (operator-side)

Before declaring a "disaster" event, the operator confirms:

1. The Unifia binary is unreachable OR refuses to start.
2. The machine has no working network OR the operator chooses
   to stay offline.
3. Class A (the `.md` files in the workspace) is at least
   partially readable with a text editor.

If any of these is false, the recovery procedure does not
apply: use the normal `unifia knowledge doctor` instead.

## 3. The 5-step procedure (V1)

The procedure is exhaustive and ordered. Each step has a
single success criterion. Skip no step.

### Step 1 — Verify Class A

Open the workspace root in a stock text editor (VS Code, vim,
Notepad). Confirm:

- the top-level directory listing is visible;
- at least one note file is openable;
- frontmatter is plain text (no binary blobs).

**Success**: at least one note is openable in plain text.
**Failure**: STOP. Restore Class A from the most recent
backup (Time Machine, snapshot, rsync, git reflog, etc.).

### Step 2 — Verify Class B

For each note that has a sidecar (`*.md.unifia.json`), confirm
the sidecar is present and parseable. The runtime tolerates a
missing sidecar (it rebuilds on next open) but a corrupted
sidecar is an integrity event that must be reported.

**Success**: every sidecar is either present-and-valid or
absent (missing is fine, corrupted is not).
**Failure**: STOP. Report the corrupted sidecars to the
Unifia maintainers; do not edit them by hand.

### Step 3 — Rebuild Class C (control state)

Class C lives at `<workspace>/.unifia/control.json`. If the
file is missing or corrupted:

1. Move the existing file aside (rename to
   `control.json.corrupt.<timestamp>`).
2. Start with an empty control state — no tokens, no policies,
   no device grants. The operator must re-issue tokens and
   re-grant egress on a per-call basis.
3. If a recent backup of `control.json` exists, restore it
   after step 3.1 (replacing the empty file).

**Success**: `control.json` is present, parseable, and either
empty or restored from a trusted backup.
**Failure**: STOP. Do not run the runtime with a corrupt
control store.

### Step 4 — Rebuild Class D (derived DB)

Class D lives at `<workspace>/.unifia/derived.db` (SQLite +
FTS5 + embeddings cache). To rebuild:

1. Delete the file (`rm .unifia/derived.db`). This is
   non-destructive: the canonical data is in Class A.
2. Run `unifia knowledge status` once the binary is back; the
   runtime detects the missing DB and rebuilds it from Class A.
3. Verify with `unifia knowledge doctor` that no findings
   remain (or only documented ones).

**Success**: `derived.db` is present, `unifia knowledge status`
returns 0, and the doctor returns ≤ 1 documented finding.
**Failure**: re-read the doctor output; the most common
failures are wikilinks pointing to missing notes (which is a
Class A concern, not a Class D concern).

### Step 5 — Confirm sovereignty

Run `unifia knowledge sovereignty` (when the binary is back).
The verdict must be `OK`. If it returns `FAIL`:

- `vault-readable` FAIL → re-run Step 1.
- `derived-db-deletable` FAIL → check the filesystem
  permissions on `<workspace>/.unifia/`.
- `internet-off` FAIL → the operator must explicitly state
  they accept being online; the V1 sovereignty posture is
  then downgraded but the data is still safe.
- `cloud-off` FAIL → the operator must disable the cloud
  integration; the runtime refuses to operate.
- `device-isolated` FAIL → there is an Android device
  connected; P10.2 and P10.3 must be re-run before V1 is
  declared fully sovereign on this machine.

## 4. What the procedure NEVER does

- It never reconnects to a remote to fetch missing data.
- It never modifies Class A (the canonical vault).
- It never deletes Class B (the sidecars) — only Class D.
- It never re-issues tokens automatically. The operator
  re-issues them on a per-call basis.
- It never relaxes the egress policy. The default remains
  `deny` until the operator explicitly grants one.

## 5. How the procedure is enforced

The `disaster-recovery` subcommand of the CLI is a planning
tool. It:

1. Asks the operator which classes are present.
2. Produces a `RecoveryPlan` (the ordered steps + missing
   layers).
3. Simulates the plan against a stub filesystem to verify
   that Class A stays readable and Class B stays reachable.
4. Never mutates anything.

The actual recovery is performed by the operator, in the
order produced by the plan, with each step checked off.

## 6. What V1 does not yet support

- Automatic detection of a disaster event (no heartbeat /
  watchdog in V1). The operator must invoke the procedure
  manually.
- Concurrent recovery from a replicated vault (V1 is
  single-workspace). Multi-workspace is V2.
- A graphical recovery UI. The CLI is the only surface.

## 7. References

- Runbook V2 §21 (P11) — list of hardening artefacts
- ADR-KNOW-0001 — identity and canonical state
- ADR-KNOW-0003 — Class B portable, copy-on-write
- ADR-KNOW-0004 — Class C local control state
- ADR-KNOW-0005 — Class D derived, fully reconstructible
- ADR-KNOW-0006 — egress: default deny
