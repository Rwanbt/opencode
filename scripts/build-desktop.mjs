#!/usr/bin/env node
/* SPDX-License-Identifier: MIT */
/**
 * Desktop build launcher with a memory preflight (R-0020).
 *
 * `rustc` is killed while compiling `unifia_lib` on machines whose *commit*
 * headroom is too small: `0xc000012d` (STATUS_COMMITMENT_LIMIT), then
 * `0xc0000409` with `rustc-LLVM ERROR: out of memory`. The truncated `.rlib`
 * files a killed rustc leaves behind then produce "only metadata stub found
 * for `alloc`" on the next run, which reads like a broken toolchain and is
 * not one.
 *
 * The failure only shows up well into a cold build, so this checks the one
 * number that predicts it *before* spawning cargo. It only measures and
 * reports: it never kills a process and never changes a system setting —
 * freeing memory is the operator's call, not a build script's.
 *
 * The metric is available *commit*, not free RAM. STATUS_COMMITMENT_LIMIT is
 * raised when the system-wide commit charge reaches the commit limit
 * (physical + page file), which happens while physical memory still looks
 * fine.
 *
 * Usage:
 *
 *   node scripts/build-desktop.mjs              # check, then build with jobs=1
 *   node scripts/build-desktop.mjs --check-only # check and exit
 *   node scripts/build-desktop.mjs --jobs 4     # check against a 4-job budget
 *   node scripts/build-desktop.mjs --force      # report, build anyway
 */

import { spawnSync } from "node:child_process"
import os from "node:os"
import { readFileSync } from "node:fs"

const BYTES_PER_GB = 1024 ** 3

/**
 * Commit headroom a cold `unifia_lib` build needs, per parallel cargo job.
 *
 * A heuristic, not a measured success boundary: the 2026-08-30 failures were
 * observed at roughly 4.7 GB free commit with `CARGO_BUILD_JOBS=1`, and the
 * three retries that eventually produced `Unifia Dev_1.3.15_x64-setup.exe`
 * succeeded as third-party applications released memory. The floor sits above
 * the observed failure point, not at it.
 */
const GB_PER_JOB = 6

/** Below this, no job count helps — the link step alone will not fit. */
const GB_FLOOR = 6

function parseArgs(argv) {
  const args = { jobs: 1, checkOnly: false, force: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--check-only") args.checkOnly = true
    else if (arg === "--force") args.force = true
    else if (arg === "--jobs") {
      const raw = argv[++i]
      const value = Number(raw)
      if (!Number.isInteger(value) || value < 1) {
        console.error(`build-desktop: --jobs expects a positive integer, got "${raw}"`)
        process.exit(2)
      }
      args.jobs = value
    } else {
      console.error(`build-desktop: unknown argument "${arg}"`)
      process.exit(2)
    }
  }
  return args
}

/**
 * Windows memory figures, in bytes.
 *
 * `Win32_OperatingSystem` reports the commit limit as `TotalVirtualMemorySize`
 * and the commit headroom as `FreeVirtualMemory`, both in kibibytes. Those are
 * the two numbers STATUS_COMMITMENT_LIMIT is raised against.
 */
function readWindowsMemory() {
  const script = [
    "$os = Get-CimInstance Win32_OperatingSystem",
    "Write-Output ($os.TotalVisibleMemorySize, $os.FreePhysicalMemory, $os.TotalVirtualMemorySize, $os.FreeVirtualMemory -join ' ')",
  ].join("; ")
  for (const shell of ["pwsh", "powershell"]) {
    const run = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
    })
    if (run.status !== 0 || typeof run.stdout !== "string") continue
    const parts = run.stdout.trim().split(/\s+/).map(Number)
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) continue
    const [totalPhysKb, freePhysKb, commitLimitKb, freeCommitKb] = parts
    return {
      totalPhysical: totalPhysKb * 1024,
      freePhysical: freePhysKb * 1024,
      commitLimit: commitLimitKb * 1024,
      freeCommit: freeCommitKb * 1024,
    }
  }
  return null
}

/**
 * Linux equivalent: `CommitLimit` and `Committed_AS` from `/proc/meminfo`,
 * with `MemAvailable` as the physical figure. Absent on macOS, which has no
 * fixed commit limit — there `freeCommit` stays null and the check degrades
 * to a physical-memory warning.
 */
function readPosixMemory() {
  const figures = {
    totalPhysical: os.totalmem(),
    freePhysical: os.freemem(),
    commitLimit: null,
    freeCommit: null,
  }
  let meminfo
  try {
    meminfo = readFileSync("/proc/meminfo", "utf8")
  } catch {
    // No /proc/meminfo (macOS, or a container without it). The figures from
    // `os` still stand; only the commit check is skipped.
    return figures
  }
  const field = (name) => {
    const match = meminfo.match(new RegExp(`^${name}:\\s+(\\d+) kB$`, "m"))
    return match === null ? null : Number(match[1]) * 1024
  }
  const available = field("MemAvailable")
  const limit = field("CommitLimit")
  const committed = field("Committed_AS")
  if (available !== null) figures.freePhysical = available
  if (limit !== null && committed !== null) {
    figures.commitLimit = limit
    figures.freeCommit = Math.max(0, limit - committed)
  }
  return figures
}

function readMemory() {
  return process.platform === "win32" ? readWindowsMemory() : readPosixMemory()
}

const gb = (bytes) => (bytes / BYTES_PER_GB).toFixed(2)

function report(memory, jobs) {
  console.log("build-desktop preflight")
  console.log(`  physical      ${gb(memory.freePhysical)} GB free of ${gb(memory.totalPhysical)} GB`)
  if (memory.commitLimit !== null) {
    console.log(`  commit        ${gb(memory.freeCommit)} GB free of ${gb(memory.commitLimit)} GB`)
  } else {
    console.log("  commit        not reported on this platform — physical figures only")
  }
  console.log(`  cargo jobs    ${jobs}`)
}

function explainShortfall(availableBytes, metric, requiredGb, jobs) {
  console.error("")
  console.error(
    `build-desktop: ${gb(availableBytes)} GB of ${metric}, against ${requiredGb} GB needed for ${jobs} job(s).`,
  )
  console.error("A cold `unifia_lib` build is likely to be killed (STATUS_COMMITMENT_LIMIT).")
  console.error("")
  console.error("What actually helps, in order:")
  console.error("  1. Close the applications holding the commit charge, then re-run.")
  console.error("  2. Free space on the page file's drive so the page file can grow.")
  console.error("  3. `node scripts/build-desktop.mjs --force` to build anyway.")
  console.error("")
  console.error("If a previous build was killed, delete")
  console.error("`packages/desktop/src-tauri/target/release/deps` first: the truncated .rlib")
  console.error("files it left behind report as a corrupt toolchain and are not one.")
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const memory = readMemory()

  if (memory === null) {
    console.warn("build-desktop: could not read memory figures — skipping the preflight.")
  } else {
    report(memory, args.jobs)
  }

  // The headroom the requested job count needs, floored so that even jobs=1
  // has to clear the link step.
  const requiredGb = Math.max(GB_FLOOR, args.jobs * GB_PER_JOB)
  const availableBytes = memory === null ? null : (memory.freeCommit ?? memory.freePhysical)
  const shortfall = availableBytes !== null && availableBytes < requiredGb * BYTES_PER_GB

  if (shortfall) {
    const metric = memory.freeCommit !== null ? "commit headroom" : "free physical memory"
    explainShortfall(availableBytes, metric, requiredGb, args.jobs)
    if (!args.force) process.exit(1)
    console.error("")
    console.error("--force given: building anyway.")
  }

  if (args.checkOnly) {
    if (!shortfall) console.log("\nbuild-desktop: preflight clear.")
    return
  }

  console.log(`\nbuild-desktop: starting tauri build with CARGO_BUILD_JOBS=${args.jobs}`)
  const build = spawnSync("bun", ["--cwd", "packages/desktop", "tauri", "build"], {
    stdio: "inherit",
    env: { ...process.env, CARGO_BUILD_JOBS: String(args.jobs) },
    shell: process.platform === "win32",
  })
  if (build.error !== undefined) {
    console.error(`build-desktop: could not start the build — ${build.error.message}`)
    process.exit(1)
  }
  process.exit(build.status ?? 1)
}

main()
