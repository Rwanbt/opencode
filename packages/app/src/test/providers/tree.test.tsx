// Regression test for Fix-GlobalSDK-Provider-Tree (Phase 1).
//
// Guards against re-introductions of the boot-time "GlobalSDK context must
// be used within a context provider" crash. Reads app.tsx as text and
// asserts the *canonical* order of providers in the AppProviders wrapper:
// ServerProvider wraps GlobalSDKProvider wraps AppBaseProviders, with an
// ErrorBoundary above GlobalSDKProvider so SDK init throws surface cleanly.
//
// The runtime smoke test (boot the bundle in happy-dom and check for
// "must be used within" errors) lives in
// `packages/app/scripts/runtime-smoke.ts` and runs separately from this
// unit test — bun test on Windows + solid-js@1.9 has a JSX-transform
// incompatibility that makes mounting the actual provider tree in-process
// unreliable. The runtime smoke is the authoritative proof the fix works
// at runtime; this test is the cheap static guard that catches reorders
// the moment they hit app.tsx.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const APP_TSX = resolve(import.meta.dir, "../../app.tsx")
const INDEX_TS = resolve(import.meta.dir, "../../index.ts")

let root: HTMLDivElement | null = null

beforeEach(() => {
  root = document.createElement("div")
  document.body.appendChild(root)
  localStorage.clear()
})

afterEach(() => {
  if (root) {
    root.remove()
    root = null
  }
})

describe("AppProviders — Fix-GlobalSDK provider tree (structural guard)", () => {
  const src = readFileSync(APP_TSX, "utf-8")

  function indexOfProviderAfter(needle: string, provider: string): number {
    const i = src.indexOf(needle)
    if (i === -1) throw new Error(`app.tsx: marker not found: ${needle}`)
    const tail = src.slice(i)
    const j = tail.indexOf(provider)
    if (j === -1) throw new Error(`app.tsx: ${provider} not found after ${needle}`)
    return i + j
  }

  test("ServerProvider is mounted before GlobalSDKProvider", () => {
    // WHY: GlobalSDKProvider.init calls useServer() (global-sdk.tsx:20).
    // If GlobalSDKProvider is above ServerProvider, useServer() throws
    // "Server context must be used within a context provider".
    const serverIdx = indexOfProviderAfter("export function AppProviders", "<ServerProvider")
    const sdkIdx = indexOfProviderAfter("export function AppProviders", "<GlobalSDKProvider")
    expect(serverIdx).toBeLessThan(sdkIdx)
  })

  test("GlobalSDKProvider is mounted before AppBaseProviders", () => {
    // WHY: FallbackSDKForDialogs (inside AppBaseProviders) renders
    // SDKProvider whose init calls useGlobalSDK() (sdk.tsx:14). If
    // GlobalSDKProvider is below AppBaseProviders, useGlobalSDK() throws
    // at boot — the original bug.
    const sdkIdx = indexOfProviderAfter("export function AppProviders", "<GlobalSDKProvider")
    const baseIdx = indexOfProviderAfter("export function AppProviders", "<AppBaseProviders")
    expect(sdkIdx).toBeLessThan(baseIdx)
  })

  test("ErrorBoundary wraps GlobalSDKProvider so init throws surface cleanly", () => {
    // WHY: an unhandled throw inside GlobalSDKProvider.init previously
    // escaped to the runtime as an opaque crash. An ErrorBoundary above
    // the provider turns it into a navigable ErrorPage instead.
    const boundaryIdx = indexOfProviderAfter("export function AppProviders", "<ErrorBoundary")
    const sdkIdx = indexOfProviderAfter("export function AppProviders", "<GlobalSDKProvider")
    expect(boundaryIdx).toBeLessThan(sdkIdx)
  })

  test("AppProviders is exported from @opencode-ai/app", () => {
    // Catches accidental rename / removal of the canonical entry helper.
    const indexSrc = readFileSync(INDEX_TS, "utf-8")
    expect(indexSrc).toMatch(/export\s*\{[^}]*\bAppProviders\b[^}]*\}\s*from\s*"\.\/app"/)
  })
})
