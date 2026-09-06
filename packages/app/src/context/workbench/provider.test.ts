/* SPDX-License-Identifier: MIT */

// Structural / static tests for the V03 bridge state machine.
//
// `provider.tsx` exposes a `WorkbenchUiPhase` value and a `uiPhase`
// accessor that the banner consumes. The actual mount of the provider
// tree is unreliable on Windows + solid-js@1.9 (see
// `src/test/providers/tree.test.tsx` for the documented workaround).
// These tests read the source and assert the contracts that V03 commits
// to, in the same spirit: cheap static guards that catch a regression the
// moment a refactor drifts away from the V03 plan.

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

const PROVIDER_TSX = resolve(import.meta.dir, "./provider.tsx")
const BANNER_TSX = resolve(import.meta.dir, "../../pages/workbench/connection-banner.tsx")

const provider = readFileSync(PROVIDER_TSX, "utf-8")
const banner = readFileSync(BANNER_TSX, "utf-8")

describe("V03 — WorkbenchUiPhase (terminal + transient states)", () => {
  test("the WorkbenchUiPhase type is exported and lists the five required values", () => {
    // The order in the type is the contract: unsupported is terminal,
    // connecting and retrying are transient, ready and failed are the
    // other two terminals.
    const match = provider.match(/export type WorkbenchUiPhase = ([^;]+);/)
    expect(match).not.toBeNull()
    const union = match![1]
    expect(union).toMatch(/\"unsupported\"/)
    expect(union).toMatch(/\"connecting\"/)
    expect(union).toMatch(/\"ready\"/)
    expect(union).toMatch(/\"failed\"/)
    expect(union).toMatch(/\"retrying\"/)
  })

  test("the provider reads platform.workbench once at init and pins the result", () => {
    // WHY: the audit caught a loop because the bridge absence was
    // re-evaluated on every `ensureConnected` call. V03 fixes it by
    // reading `!platform.workbench` exactly once at init.
    const unsupportedInit = provider.match(/const bridgeUnavailable = !platform\.workbench/)
    expect(unsupportedInit).not.toBeNull()
  })

  test("ensureConnected short-circuits on the unsupported terminal state", () => {
    // The early-return block must come BEFORE any `pending` reallocation
    // and BEFORE the `lifecycle.connect` call — otherwise we still pay
    // for a useless attempt on the unsupported path.
    const block = provider.match(/if \(unsupported\(\)\) \{[\s\S]+?return Promise\.reject\(bridgeError\(\)[\s\S]+?\}/)
    expect(block).not.toBeNull()
    // Locate the function bounds by anchor strings rather than a single
    // multi-line regex; cross-line regexes with literal `\n` are fragile
    // on Windows and across JS runtimes.
    const start = provider.indexOf("const ensureConnected = (): Promise<WorkbenchConnection> => {")
    const end = provider.indexOf("\n    const retryConnection", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const body = provider.slice(start, end)
    const unsupportedIdx = body.indexOf("if (unsupported())")
    const lifecycleIdx = body.indexOf("lifecycle.connect")
    expect(unsupportedIdx).toBeGreaterThanOrEqual(0)
    expect(lifecycleIdx).toBeGreaterThan(unsupportedIdx)
  })

  test("a disposed connection attempt cannot publish a stale result", () => {
    expect(provider).toMatch(/let providerGeneration = 0/)
    expect(provider).toMatch(/const attemptGeneration = providerGeneration/)
    expect(provider).toMatch(/attemptGeneration !== providerGeneration/)
    expect(provider).toMatch(/providerGeneration \+= 1/)
  })

  test("retryConnection is idempotent for unsupported and locks on retrying", () => {
    // The body must check both states BEFORE the first side-effect
    // (eventsAbort.abort()) and set/unset `retrying` around the work.
    const start = provider.indexOf("const retryConnection = async (): Promise<void> => {")
    const end = provider.indexOf("\n    onCleanup", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const body = provider.slice(start, end)
    const guardIdx = body.indexOf("if (unsupported() || retrying()) return")
    const setStart = body.indexOf("setRetrying(true)")
    const setEnd = body.indexOf("setRetrying(false)")
    expect(guardIdx).toBeGreaterThanOrEqual(0)
    expect(setStart).toBeGreaterThan(guardIdx)
    expect(setEnd).toBeGreaterThan(setStart)
  })

  test("retryConnection starts a fresh bridge attempt after resetting the lifecycle", () => {
    // A failed DesignSurface effect will not re-run merely because the
    // connection signal is set to undefined again. The explicit retry must
    // therefore invoke ensureConnected after lifecycle.retry has reset it.
    const start = provider.indexOf("const retryConnection = async (): Promise<void> => {")
    const end = provider.indexOf("\n    onCleanup", start)
    const body = provider.slice(start, end)
    const lifecycleRetry = body.indexOf("await lifecycle.retry(props.workspacePath)")
    const freshAttempt = body.indexOf("await ensureConnected().catch(() => undefined)")
    expect(lifecycleRetry).toBeGreaterThanOrEqual(0)
    expect(freshAttempt).toBeGreaterThan(lifecycleRetry)
  })

  test("the derived uiPhase resolves the five states in the documented order", () => {
    // Order is the contract:
    //   unsupported > retrying > ready > failed > connecting
    // A reader of the banner can rely on the precedence.
    const start = provider.indexOf("const uiPhase = (): WorkbenchUiPhase => {")
    const end = provider.indexOf("\n    // `bridgeError()`", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const body = provider.slice(start, end)
    const unsupportedIdx = body.indexOf('if (unsupported()) return "unsupported"')
    const retryingIdx = body.indexOf('if (retrying()) return "retrying"')
    const readyIdx = body.indexOf('if (connection()?.instanceId) return "ready"')
    const failedIdx = body.indexOf('if (error()) return "failed"')
    const connectingIdx = body.indexOf('return "connecting"')
    expect(unsupportedIdx).toBeGreaterThanOrEqual(0)
    expect(retryingIdx).toBeGreaterThan(unsupportedIdx)
    expect(readyIdx).toBeGreaterThan(retryingIdx)
    expect(failedIdx).toBeGreaterThan(readyIdx)
    expect(connectingIdx).toBeGreaterThan(failedIdx)
  })

  test("the provider exposes uiPhase, detail and the WorkbenchUiPhase type", () => {
    // The return literal must include the three new exports so the
    // banner can reach them.
    expect(provider).toMatch(/uiPhase/)
    expect(provider).toMatch(/detail/)
    // `WorkbenchUiPhase` itself is exported.
    expect(provider).toMatch(/export type WorkbenchUiPhase/)
  })
})

describe("V03 — ConnectionBanner uses the provider's UI phase", () => {
  test("the banner does not recompute its own phase from connection/error/loading", () => {
    // The old form was a local const that inferred from three signals.
    // The V03 form delegates to `workbench.uiPhase` (provider-side
    // derivation). The old form is gone if the new accessor is wired.
    expect(banner).not.toMatch(/connection\(\)\?\.instanceId \? "connected"/)
    expect(banner).toMatch(/workbench\.uiPhase/)
  })

  test("the retry button is gated by canRetry (failed only)", () => {
    // canRetry must be defined as `() => phase() === "failed"` so the
    // button is hidden on `unsupported`, `ready`, `connecting`, and
    // `retrying`. Hiding it on `unsupported` is the V03 fix for the
    // audit's F-03 loop.
    const canRetry = banner.match(/const canRetry = \(\) => phase\(\) === "failed"/)
    expect(canRetry).not.toBeNull()
    const show = banner.match(/<Show when=\{canRetry\(\)\}>/)
    expect(show).not.toBeNull()
    // The unconditional `workbench.error()` gate is gone.
    expect(banner).not.toMatch(/<Show when=\{workbench\.error\(\)\}>/)
  })

  test("the unsupported phase renders the desktop-only message and no retry", () => {
    // The V03 plan specifies the exact sentence for the web runtime
    // without a native bridge. The text is inlined on purpose; the
    // proper translation key lands in V10 (visual contract).
    expect(banner).toMatch(/Disponible dans l'application desktop/)
    // There is no `workbench.connection.unsupported` translation yet
    // and V03 must not introduce one (scope discipline).
    expect(banner).not.toMatch(/workbench\.connection\.unsupported/)
  })

  test("the failure detail pulls from workbench.detail() and renders for any phase with a reason", () => {
    // The provider's `detail()` accessor returns the right error for
    // the current UI phase: `bridgeError` on `unsupported`, lifecycle
    // `error` on `failed`. The banner just renders it.
    expect(banner).toMatch(/workbench\.detail\(\)/)
  })
})
