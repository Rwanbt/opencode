import { describe, expect, test } from "bun:test"
import {
  appendPage,
  classifyFailure,
  EMPTY_PAGE,
  fetchPage,
  isStale,
  LIFECYCLE_UNAVAILABLE_REASON,
  resolveSelection,
  selectionKey,
  teamCapabilities,
  type Page,
  type Selection,
} from "./team"

// Unit coverage for TEAM-M01's state decisions.
//
// The three acceptance criteria are what these assert against: that offline is
// a state and not an empty list, that a session override is a separate thing
// from the saved default, and that none of it is trusted without a test.

const key = (item: { id: string }) => item.id
const page = <T,>(items: readonly T[], nextCursor: string | null = null): Page<T> => ({ items, nextCursor })

describe("classifyFailure — offline is not an error", () => {
  test("a fetch that never reached a server is offline, not error", () => {
    // A rejected fetch has no status: the client is what failed, and the right
    // thing to show is "you are offline", not "the server is broken".
    expect(classifyFailure(new TypeError("Failed to fetch"))).toBe("offline")
  })

  test("503 is unavailable, so the client retries instead of giving up", () => {
    // The registry loads on demand and answers 503 until it has. Folding that
    // into `error` tells a client to stop asking about something that fixes
    // itself seconds later.
    expect(classifyFailure({ status: 503 })).toBe("unavailable")
  })

  test("any other status is an error", () => {
    expect(classifyFailure({ status: 500 })).toBe("error")
    expect(classifyFailure({ status: 400 })).toBe("error")
  })

  test("something that is not an error object at all is still classified", () => {
    expect(classifyFailure(undefined)).toBe("error")
    expect(classifyFailure("boom")).toBe("error")
  })
})

describe("appendPage — a cursor is not a snapshot", () => {
  test("appends and carries the new cursor", () => {
    const result = appendPage(page([{ id: "a" }]), page([{ id: "b" }], "c2"), key)

    expect(result.items.map(key)).toEqual(["a", "b"])
    expect(result.nextCursor).toBe("c2")
  })

  test("a row that arrives twice is kept once", () => {
    // Rows written between two requests shift a keyset window, so the same row
    // can legitimately come back. Keeping both would show a duplicate and make
    // every count wrong.
    const result = appendPage(page([{ id: "a" }, { id: "b" }]), page([{ id: "b" }, { id: "c" }]), key)

    expect(result.items.map(key)).toEqual(["a", "b", "c"])
  })

  test("order is append order, not sorted", () => {
    const result = appendPage(page([{ id: "z" }]), page([{ id: "a" }]), key)

    expect(result.items.map(key)).toEqual(["z", "a"])
  })

  test("the last page clears the cursor", () => {
    const result = appendPage(page([{ id: "a" }], "c1"), page([{ id: "b" }], null), key)

    expect(result.nextCursor).toBeNull()
  })
})

describe("fetchPage — a failure never empties the list", () => {
  test("a successful page is folded in", async () => {
    const result = await fetchPage({
      current: page([{ id: "a" }]),
      load: async () => page([{ id: "b" }], "c2"),
      idOf: key,
      cursor: null,
    })

    expect(result.reachability).toBe("ok")
    expect(result.page.items.map(key)).toEqual(["a", "b"])
  })

  test("a failure keeps what was already held", async () => {
    // This is the whole point: clearing on error turns a dropped connection
    // into an empty screen that reads as "there are no runs".
    const result = await fetchPage({
      current: page([{ id: "a" }], "c1"),
      load: async () => {
        throw new TypeError("Failed to fetch")
      },
      idOf: key,
      cursor: "c1",
    })

    expect(result.reachability).toBe("offline")
    expect(result.page.items.map(key)).toEqual(["a"])
    expect(result.page.nextCursor).toBe("c1")
  })

  test("the cursor it was given is the one passed to the loader", async () => {
    let seen: string | null | undefined
    await fetchPage({
      current: EMPTY_PAGE as Page<{ id: string }>,
      load: async (cursor) => {
        seen = cursor
        return page([])
      },
      idOf: key,
      cursor: "c7",
    })

    expect(seen).toBe("c7")
  })
})

describe("isStale — held data is labelled, not hidden", () => {
  test("data held while unreachable is stale", () => {
    expect(isStale("offline", 3)).toBe(true)
    expect(isStale("unavailable", 1)).toBe(true)
  })

  test("nothing held is not stale, it is unreachable", () => {
    // With no rows there is nothing to label as old; the surface shows the
    // unreachable state instead, which is a different message.
    expect(isStale("offline", 0)).toBe(false)
  })

  test("a good read is never stale", () => {
    expect(isStale("ok", 5)).toBe(false)
  })
})

describe("resolveSelection — a session override is not the saved default", () => {
  const saved: Selection = { providerID: "anthropic", modelID: "claude-opus-5" }
  const override: Selection = { providerID: "openai", modelID: "gpt-5.2" }
  const known = new Set([selectionKey(saved), selectionKey(override)])

  test("the override wins while it is set", () => {
    const result = resolveSelection({ saved, override, known })

    expect(result.selection).toEqual(override)
    expect(result.source).toBe("override")
    expect(result.rejected).toBeUndefined()
  })

  test("clearing the override falls back to the saved default", () => {
    // "Use this for now" must not have quietly answered "use this from now on".
    const result = resolveSelection({ saved, override: undefined, known })

    expect(result.selection).toEqual(saved)
    expect(result.source).toBe("saved")
  })

  test("nothing set resolves to nothing, and says so", () => {
    const result = resolveSelection({ saved: undefined, override: undefined, known })

    expect(result.selection).toBeUndefined()
    expect(result.source).toBe("none")
    expect(result.rejected).toBeUndefined()
  })
})

describe("resolveSelection — validation reports, it does not silently substitute", () => {
  const saved: Selection = { providerID: "anthropic", modelID: "claude-opus-5" }
  const retired: Selection = { providerID: "openai", modelID: "gpt-4-retired" }

  test("an override naming a model the registry lost falls back AND is reported", () => {
    // Both halves matter. Only falling back leaves the user working against a
    // different model with nothing saying so; only reporting leaves them with
    // no usable selection when a perfectly good default exists.
    const result = resolveSelection({ saved, override: retired, known: new Set([selectionKey(saved)]) })

    expect(result.selection).toEqual(saved)
    expect(result.source).toBe("saved")
    expect(result.rejected).toEqual(retired)
  })

  test("a saved default that no longer exists is reported too", () => {
    const result = resolveSelection({ saved: retired, override: undefined, known: new Set(["x/y"]) })

    expect(result.selection).toBeUndefined()
    expect(result.source).toBe("none")
    expect(result.rejected).toEqual(retired)
  })

  test("with both missing, the override is the one reported", () => {
    // It is what the user just did, so it is the one they are waiting on an
    // answer about.
    const override: Selection = { providerID: "openai", modelID: "gone" }
    const result = resolveSelection({ saved: retired, override, known: new Set(["x/y"]) })

    expect(result.selection).toBeUndefined()
    expect(result.rejected).toEqual(override)
  })

  test("an empty registry skips validation rather than rejecting everything", () => {
    // An empty set means the registry has not loaded. Treating it as "no model
    // is valid" would blank the selection on every cold start.
    const result = resolveSelection({ saved, override: undefined, known: new Set() })

    expect(result.selection).toEqual(saved)
    expect(result.source).toBe("saved")
    expect(result.rejected).toBeUndefined()
  })
})

describe("teamCapabilities — lifecycle follows server reachability", () => {
  test("reads are possible only when the last read worked", () => {
    expect(teamCapabilities("ok").canRead).toBe(true)
    expect(teamCapabilities("offline").canRead).toBe(false)
    expect(teamCapabilities("unavailable").canRead).toBe(false)
  })

  test("start, pause and cancel are available only with a reachable server", () => {
    expect(teamCapabilities("ok")).toMatchObject({ canStart: true, canPause: true, canCancel: true })
    for (const reach of ["offline", "unavailable", "error"] as const) {
      const capabilities = teamCapabilities(reach)
      expect(capabilities.canStart).toBe(false)
      expect(capabilities.canPause).toBe(false)
      expect(capabilities.canCancel).toBe(false)
    }
  })

  test("the reason is carried only when lifecycle control is unavailable", () => {
    expect(teamCapabilities("ok").lifecycleReason).toBe("")
    expect(teamCapabilities("offline").lifecycleReason).toBe(LIFECYCLE_UNAVAILABLE_REASON)
  })
})
describe("selectionKey", () => {
  test("is stable and distinguishes provider from model", () => {
    expect(selectionKey({ providerID: "a", modelID: "b" })).toBe("a/b")
    expect(selectionKey({ providerID: "a", modelID: "b" })).not.toBe(selectionKey({ providerID: "b", modelID: "a" }))
  })
})
