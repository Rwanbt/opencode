import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { getSynchronizedGridRows } from "./file-runtime"

// FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 4 revalidation): this logic
// had zero test coverage before (confirmed by an earlier grep sweep — no
// test referenced watchViewerLineRows / fixSubgridLineRowCollapse /
// getSynchronizedGridRows anywhere in the repo). Moved here from
// components/file.tsx specifically so it's importable without pulling in
// @pierre/diffs' worker chunk (a Vite-only `?worker&url` import bun's test
// runner can't resolve) — see the move's WHY comment in file-runtime.ts.
//
// getSynchronizedGridRows is the actual row-height computation behind the
// Android subgrid-collapse workaround — the part where a wrong number
// produces a visibly wrong result (misaligned line numbers, clipped wrapped
// lines). fixSubgridLineRowCollapse/watchViewerLineRows are DOM-traversal
// plumbing around it (querySelectorAll/matches/parentElement) and are not
// covered here — this environment has no DOM (confirmed: no existing
// packages/ui test creates a real HTMLElement), and faking that traversal
// faithfully enough to be worth trusting was judged lower value than
// pinning the actual height math.

type FakeStyle = { lineHeight: string }
let computedStyles: WeakMap<object, FakeStyle>
let originalGetComputedStyle: typeof getComputedStyle | undefined

function fakeRow(scrollHeight: number, lineHeight = "24"): HTMLElement {
  const el = { scrollHeight } as unknown as HTMLElement
  computedStyles.set(el, { lineHeight })
  return el
}

function fakeContainer(children: HTMLElement[]): HTMLElement {
  return { children } as unknown as HTMLElement
}

beforeEach(() => {
  computedStyles = new WeakMap()
  originalGetComputedStyle = globalThis.getComputedStyle
  globalThis.getComputedStyle = ((el: object) => {
    return (computedStyles.get(el) ?? { lineHeight: "24" }) as CSSStyleDeclaration
  }) as typeof getComputedStyle
})

afterEach(() => {
  if (originalGetComputedStyle) globalThis.getComputedStyle = originalGetComputedStyle
  else delete (globalThis as { getComputedStyle?: unknown }).getComputedStyle
})

describe("getSynchronizedGridRows", () => {
  test("single normal line: track height matches the line height", () => {
    const gutter = fakeContainer([fakeRow(24, "24")])
    const content = fakeContainer([fakeRow(24, "24")])
    expect(getSynchronizedGridRows(gutter, content)).toBe("24px")
  })

  test("multiple lines: one track per line, space-joined in order", () => {
    const gutter = fakeContainer([fakeRow(24), fakeRow(24), fakeRow(24)])
    const content = fakeContainer([fakeRow(24), fakeRow(48), fakeRow(24)])
    // Middle line is a wrapped line — its content is taller than its gutter cell.
    expect(getSynchronizedGridRows(gutter, content)).toBe("24px 48px 24px")
  })

  test("empty file (no rows): returns undefined, not a track list", () => {
    const gutter = fakeContainer([])
    const content = fakeContainer([])
    expect(getSynchronizedGridRows(gutter, content)).toBeUndefined()
  })

  test("mismatched gutter/content row counts (mid-render/partial DOM): returns undefined", () => {
    const gutter = fakeContainer([fakeRow(24), fakeRow(24)])
    const content = fakeContainer([fakeRow(24)])
    expect(getSynchronizedGridRows(gutter, content)).toBeUndefined()
  })

  test("wrapped line: content taller than the gutter cell — the number column stretches to match", () => {
    const gutter = fakeContainer([fakeRow(24)])
    const content = fakeContainer([fakeRow(72)]) // wrapped to 3 visual lines
    expect(getSynchronizedGridRows(gutter, content)).toBe("72px")
  })

  test("gutter taller than content (rare, but the max() must protect both directions)", () => {
    const gutter = fakeContainer([fakeRow(40)])
    const content = fakeContainer([fakeRow(24)])
    expect(getSynchronizedGridRows(gutter, content)).toBe("40px")
  })

  test("zero-height / empty line: never collapses below 1px", () => {
    const gutter = fakeContainer([fakeRow(0, "0")])
    const content = fakeContainer([fakeRow(0, "0")])
    expect(getSynchronizedGridRows(gutter, content)).toBe("1px")
  })

  test("unparseable line-height (e.g. 'normal'): falls back to a 1px minimum, not NaN", () => {
    const gutter = fakeContainer([fakeRow(0, "normal")])
    const content = fakeContainer([fakeRow(0, "normal")])
    const result = getSynchronizedGridRows(gutter, content)
    expect(result).toBe("1px")
    expect(result).not.toContain("NaN")
  })

  test("fractional heights round up (ceil), never truncate content", () => {
    const gutter = fakeContainer([fakeRow(24.2)])
    const content = fakeContainer([fakeRow(24.2)])
    expect(getSynchronizedGridRows(gutter, content)).toBe("25px")
  })

  test("last line of a large file gets its own independent track", () => {
    const rows = Array.from({ length: 50 }, () => fakeRow(24))
    const gutter = fakeContainer(rows)
    const content = fakeContainer(rows.map((_, index) => (index === 49 ? fakeRow(48) : fakeRow(24))))
    const result = getSynchronizedGridRows(gutter, content)!
    const tracks = result.split(" ")
    expect(tracks.length).toBe(50)
    expect(tracks[49]).toBe("48px")
    expect(tracks[0]).toBe("24px")
  })
})
