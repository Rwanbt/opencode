<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# FC-13 Methodology Generation 1 — VALID (negative control 20/20)

> Local evidence — NOT REMOTELY PUBLISHED.
> Source commit at loop start: `4c1c748dad` (worktree had FC-13 tooling staged;
> the loop binary/digests were recorded per iteration host-side).

## Environment freeze (frozen for ALL FC-13 iterations, both finalists)

| Parameter | Value |
|---|---|
| QEMU | 11.1.0 (user-space install, SHA512 verified) |
| machine | pc (i440FX) |
| accel | tcg, tb-size=128 |
| cpu | max,-tsc-deadline |
| kernel | Alpine 3.22.2 virt 6.12.51-0-virt |
| initramfs | official initramfs-virt, /init byte-spliced (same-size patch) |
| guest fs | busybox + Alpine userland (login path proven) |
| tested disk | 64MB raw virtio, cache=directsync |
| store fs | ext4 (mke2fs in-guest per iteration, fresh clean state) |
| payload disk | VVFAT (fat:rw), read-only delivery, NOT the tested store |
| READY channel | serial console (stdout), plan §9 — never the store |
| power cut | host SIGKILL of QEMU process after READY (0ms latency measured) |
| iterations | 20 per candidate, fresh disk per iteration (plan §16) |

## FC-13-CTRL result (negative control — methodology gate, frozen §12)

```text
iterations 1-20: CONTROL_LOST_WRITE = 20, CONTROL_SURVIVED = 0,
                  INVALID_ITERATION = 0, HARNESS_ERROR = 0
verdict per iteration: acknowledged unsafe write (journal_mode=OFF,
synchronous=OFF) was LOST after the hard cut in every iteration.
```

**FC-13 METHODOLOGY = VALID.** The frozen requirement (the harness must
detect a loss) is empirically satisfied: the control never survives.

## Per-iteration evidence

Host-side JSON per iteration in this directory (`ctrl-iter-NN.json`):
iteration id, payload SHA-256 digests, readyObserved, READY/kill
timestamps, READY→kill latency, boot duration, READY line, RESULT line,
verdict. The iteration disk image is retained (`ctrl-iter-NN-disk.raw`).

## Next (frozen plan)

UNIFIA_NATIVE ×20 then DBOS_GO_SQLITE ×20 under this exact environment,
then M0 regeneration and ADR-000 per frozen §21/§92.
