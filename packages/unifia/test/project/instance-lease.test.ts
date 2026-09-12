/* SPDX-License-Identifier: MIT */

import { test, expect, beforeEach, afterEach } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let tmpPath: string
let disposeCount = 0
let originalDisposeDirectory: (input: string) => Promise<void>

beforeEach(async () => {
  const tmp = await tmpdir()
  tmpPath = tmp.path
  disposeCount = 0
  // Spy on disposeDirectory to count invocations. Bound to avoid `this`-typing.
  originalDisposeDirectory = Instance.disposeDirectory.bind(Instance) as (
    input: string,
  ) => Promise<void>
  Instance.disposeDirectory = (async (input: string) => {
    disposeCount++
    await originalDisposeDirectory(input)
  }) as typeof Instance.disposeDirectory
})

afterEach(async () => {
  // Restore original. Cast back through unknown to bypass the structural
  // mismatch (the spy has a different bound-this than the original).
  ;(Instance as unknown as { disposeDirectory: typeof Instance.disposeDirectory }).disposeDirectory =
    originalDisposeDirectory as unknown as typeof Instance.disposeDirectory
  await Instance.disposeAll()
})

test("two leases on the same directory: only the last release disposes (C12)", async () => {
  // Acquire the first lease — the instance is created.
  const lease1 = Instance.lease(tmpPath)
  // Acquire the second lease — same instance, refcount=2.
  const lease2 = Instance.lease(tmpPath)
  expect(disposeCount).toBe(0)

  // First release — refcount goes to 1, no dispose.
  await lease1.release()
  expect(disposeCount).toBe(0)
  // The instance must still be alive (the cache is not empty).
  await Instance.provide({
    directory: tmpPath,
    fn: () => Instance.directory,
  })

  // Second release — refcount goes to 0, dispose is called exactly once.
  await lease2.release()
  expect(disposeCount).toBe(1)
})

test("single lease: release disposes once (C12)", async () => {
  const lease = Instance.lease(tmpPath)
  await lease.release()
  expect(disposeCount).toBe(1)
  // Idempotent: a second release on a stale handle does NOT re-dispose.
  await lease.release()
  expect(disposeCount).toBe(1)
})

test("leases on different directories are independent (C12)", async () => {
  const a = Instance.lease(tmpPath)
  const other = await tmpdir()
  const b = Instance.lease(other.path)
  // Releasing `a` must not affect the refcount of `b`.
  await a.release()
  expect(disposeCount).toBe(1)
  // The other directory's instance is still alive.
  await Instance.provide({
    directory: other.path,
    fn: () => Instance.directory,
  })
  await b.release()
  expect(disposeCount).toBe(2)
})
