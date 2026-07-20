import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { repairViewerTokenStyles, watchViewerTokenStyles } from "./file-runtime"

// FORK (PLAN-READONLY-VIEWER-REACTIVITY Phase 5 / C8): watchViewerTokenStyles
// used to re-scan the entire Shadow DOM (`querySelectorAll("[data-line]
// span[style]")`) on every single mutation callback. These tests pin the
// fix: the full scan runs once at installation, and every mutation after
// that only repairs the specific nodes it added — proven by corrupting an
// untouched span's style after the initial scan and confirming an unrelated
// mutation does NOT "accidentally" fix it via a hidden full re-scan.
//
// Minimal fake DOM: this environment has no real DOM (see file-runtime.test.ts's
// note on HTMLElement), and the module only ever uses one selector
// ("[data-line] span[style]") — a tiny fake tree that understands exactly
// that selector is more trustworthy here than a generic CSS engine stand-in.

class FakeElement {
  tagName: string
  attrs = new Map<string, string>()
  children: FakeElement[] = []
  parent: FakeElement | undefined
  style = { cssText: "" }

  constructor(tagName: string, attrs: Record<string, string> = {}) {
    this.tagName = tagName
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v)
  }

  appendChild(child: FakeElement) {
    child.parent = this
    this.children.push(child)
    return child
  }

  getAttribute(name: string) {
    return this.attrs.get(name)
  }

  hasDataLineAncestor(): boolean {
    let p = this.parent
    while (p) {
      if (p.attrs.has("data-line")) return true
      p = p.parent
    }
    return false
  }

  // The only selector this module ever queries.
  matches(selector: string): boolean {
    if (selector !== "[data-line] span[style]") throw new Error(`unsupported selector in fake: ${selector}`)
    return this.tagName === "span" && this.attrs.has("style") && this.hasDataLineAncestor()
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = []
    const walk = (node: FakeElement) => {
      for (const child of node.children) {
        if (child.matches(selector)) results.push(child)
        walk(child)
      }
    }
    walk(this)
    return results
  }
}

function fakeLine(styledSpanStyle = "color: red;"): { line: FakeElement; span: FakeElement } {
  const line = new FakeElement("div", { "data-line": "" })
  const span = new FakeElement("span", { style: styledSpanStyle })
  line.appendChild(span)
  return { line, span }
}

let originalElement: unknown

beforeEach(() => {
  // repairTokenStylesIn does `node instanceof Element` — stub a minimal
  // Element global and make FakeElement's prototype chain satisfy it by
  // aliasing Element to FakeElement itself (same trick as the HTMLElement
  // stub in file-runtime.test.ts).
  originalElement = (globalThis as { Element?: unknown }).Element
  ;(globalThis as { Element?: unknown }).Element = FakeElement
})

afterEach(() => {
  if (originalElement !== undefined) (globalThis as { Element?: unknown }).Element = originalElement
  else delete (globalThis as { Element?: unknown }).Element
})

describe("repairViewerTokenStyles (full scan)", () => {
  test("reapplies the raw style attribute when cssText has drifted", () => {
    const { line, span } = fakeLine("color: red;")
    span.style.cssText = "" // simulates the drift this function exists to fix
    const root = { querySelectorAll: (sel: string) => line.querySelectorAll(sel) } as unknown as ShadowRoot

    repairViewerTokenStyles(root)

    expect(span.style.cssText).toBe("color: red;")
  })

  test("leaves an already-correct span untouched (cheap no-op)", () => {
    const { span } = fakeLine("color: blue;")
    span.style.cssText = "color: blue;"
    const root = { querySelectorAll: (sel: string) => span.parent!.querySelectorAll(sel) } as unknown as ShadowRoot

    repairViewerTokenStyles(root)

    expect(span.style.cssText).toBe("color: blue;")
  })

  test("undefined root is a safe no-op", () => {
    expect(() => repairViewerTokenStyles(undefined)).not.toThrow()
  })
})

describe("watchViewerTokenStyles — scoped, coalesced repair (C8)", () => {
  let rafQueue: Map<number, FrameRequestCallback>
  let rafNextId: number
  let originalRaf: typeof requestAnimationFrame | undefined
  let originalCancelRaf: typeof cancelAnimationFrame | undefined
  let originalMutationObserver: typeof MutationObserver | undefined

  class FakeMutationObserver {
    static instances: FakeMutationObserver[] = []
    disconnected = false
    constructor(public callback: MutationCallback) {
      FakeMutationObserver.instances.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
    trigger(addedNodes: FakeElement[]) {
      const record = { addedNodes: addedNodes as unknown as NodeList } as MutationRecord
      this.callback([record], this as unknown as MutationObserver)
    }
  }

  function flushFrames() {
    const entries = Array.from(rafQueue.entries())
    rafQueue.clear()
    for (const [, cb] of entries) cb(0)
  }

  beforeEach(() => {
    rafQueue = new Map()
    rafNextId = 0
    originalRaf = globalThis.requestAnimationFrame
    originalCancelRaf = globalThis.cancelAnimationFrame
    originalMutationObserver = globalThis.MutationObserver

    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafNextId += 1
      rafQueue.set(rafNextId, cb)
      return rafNextId
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((id: number) => {
      rafQueue.delete(id)
    }) as typeof cancelAnimationFrame

    FakeMutationObserver.instances = []
    globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver
  })

  afterEach(() => {
    if (originalRaf) globalThis.requestAnimationFrame = originalRaf
    else delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
    if (originalCancelRaf) globalThis.cancelAnimationFrame = originalCancelRaf
    else delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame
    if (originalMutationObserver) globalThis.MutationObserver = originalMutationObserver
    else delete (globalThis as { MutationObserver?: unknown }).MutationObserver
  })

  test("installation runs one full repair immediately, synchronously", () => {
    const { line, span } = fakeLine("color: red;")
    span.style.cssText = ""
    const root = { querySelectorAll: (sel: string) => line.querySelectorAll(sel) } as unknown as ShadowRoot

    watchViewerTokenStyles(root)

    expect(span.style.cssText).toBe("color: red;")
  })

  test("a mutation's added nodes are repaired only after the coalesced frame fires, not synchronously", () => {
    const root = { querySelectorAll: () => [] } as unknown as ShadowRoot
    watchViewerTokenStyles(root)
    const observer = FakeMutationObserver.instances[0]!

    const { line: newLine, span: newSpan } = fakeLine("color: green;")
    newSpan.style.cssText = ""
    observer.trigger([newLine])

    expect(newSpan.style.cssText).toBe("") // not yet — coalesced onto a frame
    flushFrames()
    expect(newSpan.style.cssText).toBe("color: green;")
  })

  test("multiple mutations before the frame fires coalesce into one flush (no pile-up)", () => {
    const root = { querySelectorAll: () => [] } as unknown as ShadowRoot
    watchViewerTokenStyles(root)
    const observer = FakeMutationObserver.instances[0]!

    const a = fakeLine("color: red;")
    const b = fakeLine("color: blue;")
    a.span.style.cssText = ""
    b.span.style.cssText = ""

    observer.trigger([a.line])
    const sizeAfterFirst = rafQueue.size
    observer.trigger([b.line])
    expect(rafQueue.size).toBe(sizeAfterFirst) // still one pending frame, not two

    flushFrames()
    expect(a.span.style.cssText).toBe("color: red;")
    expect(b.span.style.cssText).toBe("color: blue;")
  })

  test("a mutation does NOT re-scan the whole root: an untouched span's drift is left alone", () => {
    // This is the actual regression test for C8: before this fix, EVERY
    // mutation re-ran a full querySelectorAll over the whole root, so any
    // drifted span anywhere would get silently fixed as a side effect of an
    // unrelated mutation. After the fix, only nodes the mutation itself
    // added are examined.
    const untouched = fakeLine("color: purple;")
    const root = { querySelectorAll: (sel: string) => untouched.line.querySelectorAll(sel) } as unknown as ShadowRoot

    watchViewerTokenStyles(root) // initial full scan fixes `untouched` once
    expect(untouched.span.style.cssText).toBe("color: purple;")

    // Simulate drift on the untouched span AFTER the initial scan — nothing
    // should touch it again unless it's part of an added-nodes mutation.
    untouched.span.style.cssText = ""

    const observer = FakeMutationObserver.instances[0]!
    const unrelated = fakeLine("color: orange;")
    unrelated.span.style.cssText = ""
    observer.trigger([unrelated.line]) // mutation only added `unrelated`
    flushFrames()

    expect(unrelated.span.style.cssText).toBe("color: orange;") // repaired — it was added
    expect(untouched.span.style.cssText).toBe("") // NOT repaired — no full re-scan
  })

  test("cleanup disconnects the observer and cancels a pending coalesced frame", () => {
    const root = { querySelectorAll: () => [] } as unknown as ShadowRoot
    const stop = watchViewerTokenStyles(root)
    const observer = FakeMutationObserver.instances[0]!

    const { line } = fakeLine()
    observer.trigger([line])
    expect(rafQueue.size).toBe(1)

    stop()

    expect(observer.disconnected).toBe(true)
    expect(rafQueue.size).toBe(0)
  })

  test("undefined root: returns a no-op cleanup, installs nothing", () => {
    const stop = watchViewerTokenStyles(undefined)
    expect(() => stop()).not.toThrow()
    expect(FakeMutationObserver.instances.length).toBe(0)
  })
})
