<!-- SPDX-License-Identifier: MIT -->
# Building the desktop app

Two things make a desktop build fail in ways that do not look like what they
are: the machine runs out of *commit* rather than RAM, and the sidecar that
carries the whole TypeScript product can be stale or missing while the build
still reports success. Both are covered here.

Related: [R-0020](knowledge/execution/RISKS.md) (memory),
[R-0019](knowledge/execution/RISKS.md) (the sidecar that shipped without the
knowledge core).

---

## The procedure

```bash
bun run preflight:build
```

Reports free physical memory and free commit, and exits non-zero when the
commit headroom is below what a cold `unifia_lib` build needs. Nothing is
killed and no setting is changed — what to close is the operator's call.

```bash
cd packages/unifia && bun run build --single --baseline
```

Builds the CLI sidecar. **This is the step that puts the product in the
binary.** `packages/desktop/scripts/copy-sidecar.ts:35` warns and exits `0`
when it finds no fresh sidecar, so skipping this step does not fail the
build — it ships whatever was staged before, which may be an older binary or
one built from another branch.

`--baseline` is what `CLAUDE.md` prescribes; `resolveSidecarBinaryPath`
(`packages/desktop/scripts/utils.ts:41`) falls back to the plain directory
when the baseline variant was not produced, so both forms resolve.

```bash
bun run build:desktop
```

Runs the preflight again and then `tauri build` with `CARGO_BUILD_JOBS=1` in
the child environment. `--jobs N` raises the job count and checks against the
larger budget; `--force` builds against the preflight's advice.

```bash
strings "packages/desktop/src-tauri/target/release/unifia-cli.exe" | grep -c memory_search
```

Verifies the artifact rather than the tree. A green test suite proves the code
compiles; only the built binary proves the entrypoint reaches it. Expected:
non-zero. It was `0` for the entire life of the `feat/sovereign-knowledge-core`
branch while 883 tests passed (R-0019, R-0022).

---

## Why the memory check exists

`rustc` is killed while compiling `unifia_lib`: `0xc000012d`
(STATUS_COMMITMENT_LIMIT) first, then `0xc0000409` with `rustc-LLVM ERROR: out
of memory`.

The number that predicts this is **available commit**, not free RAM.
STATUS_COMMITMENT_LIMIT is raised when the system-wide commit charge reaches
the commit limit — physical memory plus page file — which happens while the
physical figure still looks comfortable. On the development machine, measured
2026-08-31:

| Figure | Value |
|---|---|
| Physical | 15.71 GB total, 2.04 GB free |
| Commit limit | 31.71 GB |
| Commit free | 5.59 GB |

The page file is 16 GB on a `C:` with about 8 GB free, so it cannot grow to
absorb a spike. `cargo` already uses the default `codegen-units = 16`; the
only remaining knob is `opt-level`, which would change the shipped binary and
is therefore not a build-time workaround.

`CARGO_BUILD_JOBS=1` is what makes the build pass, **intermittently** — three
attempts were needed to produce `Unifia Dev_1.3.15_x64-setup.exe` on
2026-08-30, and the ones that succeeded did so as third-party applications
released memory.

### Reading the preflight's verdict

The thresholds in `scripts/build-desktop.mjs` (6 GB of commit per job, with a
6 GB floor) are a **heuristic anchored on the observed failure**, not a
measured success boundary. Failures were seen around 4.7 GB of free commit at
one job; the floor sits above that, not at it. A clear preflight means the
build is not obviously doomed — it is not a guarantee.

### After a killed build

Delete `packages/desktop/src-tauri/target/release/deps` before retrying. A
killed `rustc` leaves truncated `.rlib` files, and the next run reports
"only metadata stub found for `alloc` / `compiler_builtins`". That message
describes the debris, not a corrupt toolchain: reinstalling the toolchain
fixes nothing and costs half an hour.

---

## What the build does

`packages/desktop/src-tauri/tauri.conf.json:10` sets
`beforeBuildCommand` to `bun run build && bun run precopy:sidecar`, so the
frontend and the sidecar staging happen inside `tauri build`. The sidecar
*source* is not built there — `copy-sidecar.ts` only copies, from, in order:

1. `../unifia/dist/<sidecar>/bin/unifia-cli`
2. the same path with `-baseline` stripped
3. `src-tauri/sidecars/unifia-cli-<target>` — the already-staged copy

Candidate 3 exists so that a packaging run which did not rebuild the CLI still
produces a bundle. It is also how a stale binary ships silently, which is why
building the sidecar explicitly is a step of this procedure and not an
implementation detail.
