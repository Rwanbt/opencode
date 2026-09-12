// Unit coverage for the framework-agnostic control flow behind the TUI's
// Alt+R "refresh models catalog" action. See
// src/cli/cmd/tui/util/model-catalog-refresh.ts for why this is split out of
// context/local.tsx: it is the one piece of that flow worth testing without
// standing up a full SolidJS context tree (sync/sdk/toast providers).
import { describe, expect, test } from "bun:test"
import { performModelCatalogRefresh, type ModelCatalogRefreshResult } from "../../../src/cli/cmd/tui/util/model-catalog-refresh"

function harness(overrides?: { refreshResult?: () => Promise<ModelCatalogRefreshResult>; refetch?: () => Promise<void> }) {
  let refreshing = false
  const calls = {
    refresh: 0,
    refetch: 0,
    notifyError: [] as string[],
    notifySuccess: 0,
  }
  const deps = {
    isRefreshing: () => refreshing,
    setRefreshing: (value: boolean) => {
      refreshing = value
    },
    refresh: async () => {
      calls.refresh++
      return overrides?.refreshResult ? overrides.refreshResult() : { ok: true }
    },
    refetch: async () => {
      calls.refetch++
      if (overrides?.refetch) return overrides.refetch()
    },
    notifyError: (message: string) => {
      calls.notifyError.push(message)
    },
    notifySuccess: () => {
      calls.notifySuccess++
    },
  }
  return { deps, calls, isRefreshing: () => refreshing }
}

describe("performModelCatalogRefresh", () => {
  test("success: refetches then notifies success, and clears the in-flight flag", async () => {
    const { deps, calls, isRefreshing } = harness({ refreshResult: async () => ({ ok: true }) })

    await performModelCatalogRefresh(deps)

    expect(calls.refresh).toBe(1)
    expect(calls.refetch).toBe(1)
    expect(calls.notifySuccess).toBe(1)
    expect(calls.notifyError).toEqual([])
    expect(isRefreshing()).toBe(false)
  })

  test("failure result (ok:false): notifies the error message, does not refetch, clears the flag", async () => {
    const { deps, calls, isRefreshing } = harness({
      refreshResult: async () => ({ ok: false, error: "models.dev fetch failed (HTTP 503)" }),
    })

    await performModelCatalogRefresh(deps)

    expect(calls.refetch).toBe(0)
    expect(calls.notifySuccess).toBe(0)
    expect(calls.notifyError).toEqual(["models.dev fetch failed (HTTP 503)"])
    expect(isRefreshing()).toBe(false)
  })

  test("failure result without an error message falls back to a generic message", async () => {
    const { deps, calls } = harness({ refreshResult: async () => ({ ok: false }) })

    await performModelCatalogRefresh(deps)

    expect(calls.notifyError).toEqual(["Unknown error"])
  })

  test("refresh() throwing does not crash — surfaced via notifyError, flag still cleared", async () => {
    const { deps, calls, isRefreshing } = harness({
      refreshResult: async () => {
        throw new Error("network unreachable")
      },
    })

    await expect(performModelCatalogRefresh(deps)).resolves.toBeUndefined()

    expect(calls.notifyError).toEqual(["network unreachable"])
    expect(calls.notifySuccess).toBe(0)
    expect(isRefreshing()).toBe(false)
  })

  test("refetch() throwing after a successful refresh is also surfaced via notifyError, not left uncaught", async () => {
    const { deps, calls, isRefreshing } = harness({
      refreshResult: async () => ({ ok: true }),
      refetch: async () => {
        throw new Error("failed to reload provider list")
      },
    })

    await expect(performModelCatalogRefresh(deps)).resolves.toBeUndefined()

    expect(calls.notifyError).toEqual(["failed to reload provider list"])
    expect(calls.notifySuccess).toBe(0)
    expect(isRefreshing()).toBe(false)
  })

  test("a concurrent second call while one is in flight is ignored (single-flight)", async () => {
    let resolveFirst: (() => void) | undefined
    const { deps, calls, isRefreshing } = harness({
      refreshResult: () =>
        new Promise<ModelCatalogRefreshResult>((resolve) => {
          resolveFirst = () => resolve({ ok: true })
        }),
    })

    const first = performModelCatalogRefresh(deps)
    // The in-flight flag must already be set synchronously before the first
    // await point inside performModelCatalogRefresh resolves, so a trigger
    // arriving "right after" the first is reliably ignored.
    expect(isRefreshing()).toBe(true)

    const second = performModelCatalogRefresh(deps)

    expect(calls.refresh).toBe(1)

    resolveFirst?.()
    await Promise.all([first, second])

    expect(calls.refresh).toBe(1)
    expect(calls.refetch).toBe(1)
    expect(calls.notifySuccess).toBe(1)
    expect(isRefreshing()).toBe(false)
  })
})
