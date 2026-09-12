/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { startParentWatchdog } from "../../src/util/parent-watchdog"

// The desktop wraps the sidecar in a Windows Job Object with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and it does NOT reap it: measured
// 2026-08-24, a host killed with TerminateProcess left the sidecar running and
// growing to 1 885 MB. Each leak costs the next launch that much memory.
//
// The first attempt at a backstop polled the parent pid and never fired,
// because a terminated Windows process whose handle is still held stays
// openable — OpenProcess succeeded with exitCode 4294967295 while Get-Process
// and WMI both reported it gone. End-of-stdin is the signal that has no such
// hole, and these tests pin it.

function fakeStdin(): EventEmitter & { resume: () => void; pause: () => void; off: EventEmitter["off"] } {
  const stream = new EventEmitter() as EventEmitter & { resume: () => void; pause: () => void }
  stream.resume = () => {}
  stream.pause = () => {}
  return stream as never
}

function withStdin<T>(stream: unknown, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, "stdin")
  Object.defineProperty(process, "stdin", { value: stream, configurable: true })
  try {
    return run()
  } finally {
    if (original) Object.defineProperty(process, "stdin", original)
  }
}

describe("startParentWatchdog", () => {
  test("exits when stdin ends — the host closed its side of the pipe", () => {
    const stdin = fakeStdin()
    let code: number | undefined
    withStdin(stdin, () => startParentWatchdog((c) => { code = c }))
    stdin.emit("end")
    expect(code).toBe(0)
  })

  test("exits when stdin closes", () => {
    const stdin = fakeStdin()
    let code: number | undefined
    withStdin(stdin, () => startParentWatchdog((c) => { code = c }))
    stdin.emit("close")
    expect(code).toBe(0)
  })

  // A broken pipe is the same event as a clean end: the host went away either
  // way. Left unhandled, 'error' would take the process down with a stack
  // trace instead of a reason.
  test("treats a stdin error as the host being gone", () => {
    const stdin = fakeStdin()
    let code: number | undefined
    withStdin(stdin, () => startParentWatchdog((c) => { code = c }))
    stdin.emit("error", new Error("EPIPE"))
    expect(code).toBe(0)
  })

  test("does not exit while stdin stays open", () => {
    const stdin = fakeStdin()
    let exited = false
    withStdin(stdin, () => startParentWatchdog(() => { exited = true }))
    stdin.emit("data", Buffer.from("noise"))
    expect(exited).toBe(false)
  })

  test("stopping the watchdog detaches it — a later end must not exit", () => {
    const stdin = fakeStdin()
    let exited = false
    const stop = withStdin(stdin, () => startParentWatchdog(() => { exited = true }))
    stop()
    stdin.emit("end")
    expect(exited).toBe(false)
  })

  // Standalone CLI runs and the test suite itself must not be killed by this.
  test("no-ops when there is no usable stdin", () => {
    let exited = false
    const stop = withStdin(undefined, () => startParentWatchdog(() => { exited = true }))
    stop()
    expect(exited).toBe(false)
  })
})
