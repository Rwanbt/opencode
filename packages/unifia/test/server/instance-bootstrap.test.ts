/* SPDX-License-Identifier: MIT */

import { test, expect, describe } from "bun:test"
import { isReadOnlyRoute } from "../../src/server/router"

describe("router.isReadOnlyRoute (C11)", () => {
  test("GET /session is read-only (light bootstrap, no warmup/watch)", () => {
    expect(isReadOnlyRoute("GET", "/session")).toBe(true)
  })

  test("non-GET /session is NOT read-only (active route)", () => {
    expect(isReadOnlyRoute("POST", "/session")).toBe(false)
    expect(isReadOnlyRoute("PUT", "/session")).toBe(false)
    expect(isReadOnlyRoute("DELETE", "/session")).toBe(false)
  })

  test("other paths are NOT read-only (active routes)", () => {
    expect(isReadOnlyRoute("GET", "/session/foo")).toBe(false)
    expect(isReadOnlyRoute("POST", "/file/open")).toBe(false)
    expect(isReadOnlyRoute("GET", "/file/read")).toBe(false)
    expect(isReadOnlyRoute("POST", "/command/exec")).toBe(false)
  })

  test("empty / root / unknown paths are not read-only", () => {
    expect(isReadOnlyRoute("GET", "/")).toBe(false)
    expect(isReadOnlyRoute("GET", "")).toBe(false)
    expect(isReadOnlyRoute("GET", "/unknown")).toBe(false)
  })
})
