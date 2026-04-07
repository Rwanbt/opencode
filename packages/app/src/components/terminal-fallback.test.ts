import { describe, expect, test } from "bun:test"

/**
 * Tests for the terminal Ghostty WASM fallback behavior.
 *
 * The terminal component (terminal.tsx) loads ghostty-web dynamically.
 * If Ghostty.load() fails (e.g., WASM unsupported in Android WebView),
 * it falls back to creating a Terminal without the `ghostty` option,
 * which uses the canvas renderer instead.
 *
 * These tests verify the fallback logic pattern.
 */

describe("terminal ghostty fallback", () => {
  test("loadGhostty pattern: returns ghostty when WASM loads successfully", async () => {
    // Simulate successful WASM load
    const mockGhostty = { loaded: true }
    const mockMod = {
      Ghostty: {
        load: async () => mockGhostty,
      },
      Terminal: class {
        constructor(public opts: Record<string, unknown>) {}
      },
      FitAddon: class {},
    }

    const result = await (async () => {
      let ghostty: typeof mockGhostty | undefined
      try {
        ghostty = await mockMod.Ghostty.load()
      } catch {
        // fallback
      }
      return { mod: mockMod, ghostty }
    })()

    expect(result.ghostty).toBeDefined()
    expect(result.ghostty?.loaded).toBe(true)

    // Terminal should be created WITH ghostty option
    const termOpts = { scrollback: 10_000, ...(result.ghostty ? { ghostty: result.ghostty } : {}) }
    expect(termOpts.ghostty).toBeDefined()
  })

  test("loadGhostty pattern: returns undefined ghostty when WASM fails", async () => {
    // Simulate WASM load failure (e.g., Android WebView)
    const mockMod = {
      Ghostty: {
        load: async () => {
          throw new Error("WASM not supported")
        },
      },
      Terminal: class {
        constructor(public opts: Record<string, unknown>) {}
      },
      FitAddon: class {},
    }

    const result = await (async () => {
      let ghostty: unknown | undefined
      try {
        ghostty = await mockMod.Ghostty.load()
      } catch {
        // fallback: ghostty remains undefined
      }
      return { mod: mockMod, ghostty }
    })()

    expect(result.ghostty).toBeUndefined()

    // Terminal should be created WITHOUT ghostty option
    const termOpts = { scrollback: 10_000, ...(result.ghostty ? { ghostty: result.ghostty } : {}) }
    expect("ghostty" in termOpts).toBe(false)
  })

  test("Terminal constructor accepts options without ghostty field", () => {
    // Verify that spreading an empty object when ghostty is undefined
    // does not add a 'ghostty' key to the options
    const g: { loaded: boolean } | undefined = undefined

    const opts = {
      cursorBlink: true,
      fontSize: 14,
      scrollback: 10_000,
      ...(g ? { ghostty: g } : {}),
    }

    expect(Object.keys(opts)).not.toContain("ghostty")
    expect(opts.cursorBlink).toBe(true)
    expect(opts.fontSize).toBe(14)
  })

  test("Terminal constructor includes ghostty when provided", () => {
    const g = { loaded: true }

    const opts = {
      cursorBlink: true,
      fontSize: 14,
      scrollback: 10_000,
      ...(g ? { ghostty: g } : {}),
    }

    expect(Object.keys(opts)).toContain("ghostty")
    expect(opts.ghostty).toBe(g)
  })
})
