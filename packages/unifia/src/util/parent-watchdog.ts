/* SPDX-License-Identifier: MIT */

import { Log } from "./log"

const log = Log.create({ service: "parent-watchdog" })

/**
 * Exits the sidecar when the process that spawned it disappears.
 *
 * WHY this exists even though the desktop wraps the sidecar in a Windows Job
 * Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: that mechanism is present
 * and configured (the `kill-on-drop` feature is enabled, the flag is set) and
 * it still does not reap the sidecar. Measured 2026-08-24: the host was killed
 * with TerminateProcess and the sidecar survived, growing to 1 885 MB. A
 * user-reported orphan from a normal launch had the same shape at 941 MB. Each
 * leak costs the next launch that much memory, which is why the app degrades
 * across successive crashes rather than merely failing once.
 *
 * WHY end-of-stdin and NOT the parent pid: checking the pid does not work on
 * Windows. A terminated process whose handle is still held by anyone remains
 * openable, so `OpenProcess` — and therefore Node's `process.kill(pid, 0)` —
 * keeps reporting it alive. Measured on the real host: after the kill,
 * `Get-Process` and WMI both reported it gone while `OpenProcess` succeeded
 * with `exitCode = 4294967295` (exited, not STILL_ACTIVE). A pid-based
 * watchdog armed correctly and never fired.
 *
 * The host hands the sidecar a stdin pipe and holds the write end. The OS
 * closes it when the host dies, whatever kills it — crash, TerminateProcess,
 * or a clean exit. There is no polling interval, no pid reuse hazard, and no
 * dependency on Windows job semantics, which is what made this failure so hard
 * to reason about in the first place.
 */
export function startParentWatchdog(exit: (code: number) => void = process.exit): () => void {
  const stdin = process.stdin
  // No stdin object at all (or a closed one) means nothing to watch: standalone
  // CLI runs and tests get a no-op rather than an immediate exit.
  if (!stdin || typeof stdin.on !== "function") {
    log.info("no stdin to watch, parent watchdog disabled")
    return () => {}
  }

  const onEnd = () => {
    log.info("stdin closed: the host is gone, exiting so the sidecar is not orphaned")
    exit(0)
  }
  // A broken pipe is the same signal as a clean end — the host went away
  // either way, and an unhandled 'error' here would take the process down
  // with a stack trace instead of a reason.
  const onError = (error: unknown) => {
    log.info("stdin errored: treating as host gone", { error: String(error) })
    exit(0)
  }

  stdin.on("end", onEnd)
  stdin.on("close", onEnd)
  stdin.on("error", onError)
  // Without resume() the stream stays paused and 'end' never fires.
  stdin.resume?.()

  return () => {
    stdin.off?.("end", onEnd)
    stdin.off?.("close", onEnd)
    stdin.off?.("error", onError)
    stdin.pause?.()
  }
}
