import { describe, expect, test } from "bun:test"

describe("session workspace layout", () => {
  test("TerminalPanel is below the horizontal desktop workspace, never its third column", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    const structure =
      /data-component="session-workspace"[\s\S]*data-component="session-workspace-main"[\s\S]*<SessionSidePanel[\s\S]*?\/>\s*<\/div>\s*[\s\S]*?<TerminalPanel \/>/

    expect(source).toMatch(structure)
  })

  test("the workspace remains the positioning context for mobile overlays", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    expect(source).toContain('data-component="session-workspace" class="relative flex-1 min-h-0 flex flex-col"')
    expect(source).toContain('data-component="session-workspace-main" class="flex-1 min-h-0 flex flex-col md:flex-row"')
  })

  test("mobile overlay is bounded by the workspace instead of viewport height", async () => {
    const css = await Bun.file(new URL("../../../../mobile/src/mobile.css", import.meta.url)).text()
    // Scoped to the overlay block itself: #root legitimately falls back to
    // 100dvh/--vvh elsewhere in this file for Android keyboard avoidance
    // (see the KEYBOARD AVOIDANCE section) — that's an unrelated, documented
    // mechanism, not something this overlay-positioning test should assert on.
    const overlayBlock = css.slice(css.indexOf("MOBILE SIDE PANEL"))
    expect(overlayBlock.length).toBeGreaterThan(0)
    expect(overlayBlock).toContain("bottom: 0 !important")
    expect(overlayBlock).toContain("height: auto !important")
    expect(overlayBlock).not.toContain("100dvh")
    expect(overlayBlock).not.toContain("--vvh")
  })

  test("terminal resize handle follows the platform, not a width breakpoint", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()
    expect(source).toContain("<Show when={!isMobile()}>")
    expect(source).not.toContain('class="hidden md:block" onPointerDown={() => size.start()}')
  })})