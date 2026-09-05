<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# FC-13 Real Power-Loss Qualification - Generation 1 - COMPLETE

> Local evidence - NOT REMOTELY PUBLISHED. Source commit at loop start:
> `134968545a` (fix commit: native provider init, dbos HTTP client via bun).

## Environment freeze (identical for ALL 60 iterations)

| Parameter | Value |
|---|---|
| QEMU | 11.1.0 user-space, pc (i440FX), SHA512 verified |
| accel / cpu | tcg, tb-size=128 / max,-tsc-deadline |
| guest kernel | Alpine 3.22.2 virt 6.12.51-0-virt |
| initramfs | official Alpine initramfs-virt, /init data byte-spliced |
| tested disk | 64MB raw virtio, cache=directsync, ext4 (mke2fs in-guest, fresh per iteration) |
| payload disk | VVFAT delivery (bun, writer bundles, DBOS Go binary, mke2fs+libs) |
| READY channel | serial console stdout (plan section 9) |
| power cut | host SIGKILL of QEMU after READY (0ms latency) |
| iterations | 20 per scenario, fresh disk each (plan section 16) |

## Results - complete matrix

| Scenario | Acknowledged transition | Verdict x20 | Distribution |
|---|---|---|---|
| FC-13-CTRL | journal_mode=OFF, synchronous=OFF write | CONTROL_LOST_WRITE | lost=20 survived=0 invalid=0 harness=0 |
| UNIFIA_NATIVE | NativeSqliteCandidate attempt->provider_committed | DURABLE_SURVIVED | lost=0 survived=20 pending=0 invalid=0 harness=0 |
| DBOS_GO_SQLITE | StartRunWorkflow durable step commit (runId issued) | DURABLE_SURVIVED | lost=0 survived=20 pending=0 invalid=0 harness=0 |

## Frozen classification (plan sections 11-13)

1. **FC-13 METHODOLOGY = VALID.** The negative control never survives:
   20/20 acknowledged unsafe writes are LOST after the hard cut. The
   harness demonstrably detects a loss - the requirement is satisfied
   empirically, not by design.
2. **UNIFIA_NATIVE FC-13 = PASS.** The acknowledged durable attempt
   transition survives the claimed failure model 20/20.
3. **DBOS_GO_SQLITE FC-13 = PASS.** The acknowledged durable
   StartRunWorkflow step commit survives 20/20 (run record readable
   after restart on the same tested disk).

**No asymmetry is created by FC-13: both finalists pass.** Per frozen
ADR-000 section 92, the last unsatisfied ratification criterion (valid
power-loss proof) is now satisfied for BOTH candidates; the decision
remains 8-8 symmetric -> TRUE OWNER DECISION REQUIRED (frozen section
16): the owner chooses between two fully-qualified finalists using
only the frozen dimensions.

## Per-iteration evidence (host-side, plan section 17)

JSON per iteration in `evidence-fc13/`: candidate, iteration id,
source commit, SHA-256 payload digests (bun, writer bundles, DBOS
binary, mke2fs), readyObserved, READY/kill epoch timestamps,
READY->kill latency, boot duration, READY line (incl. dbos runId),
RESULT line, frozen verdict. Disk images were regenerated per
iteration and are not retained in-repo (JSON + digests are the
authoritative evidence; disks are reproducible per-iteration only).

## Harness notes (for regeneration)

- Guest init: PATH export + busybox applet symlinks (grep/head/sleep/
  wget), lo 127.0.0.1 up (FailedToOpenSocket without it), mke2fs ext4
  on the tested disk per write iteration.
- DBOS HTTP client runs via bun fetch (fc13-dbos-post.js): busybox
  nc/wget proved unreliable in this initramfs.
- Loop: 384MB guest RAM, one clean write-boot retry (disk re-created;
  fresh-state guarantee preserved).
