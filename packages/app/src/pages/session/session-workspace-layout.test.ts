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
    expect(source).toContain('data-component="session-workspace-main" class="flex-1 min-h-0 flex flex-col shell:flex-row"')
  })

  test("overlay panels are styled by the web bundle, not Android-only CSS", async () => {
    const css = await Bun.file(new URL("../../styles/v110.css", import.meta.url)).text()
    const overlayBlock = css.slice(css.indexOf(".mobile-side-panel"))
    expect(overlayBlock).toContain("position: absolute !important")
    expect(overlayBlock).toContain("inset: 0 !important")
    expect(overlayBlock).toContain("z-index: 30 !important")
    expect(overlayBlock).toContain("height: auto !important")
    expect(overlayBlock).not.toContain("100dvh")
    expect(overlayBlock).not.toContain("--vvh")
  })

  test("inspector overlay follows the v110 viewport contract", async () => {
    const source = await Bun.file(new URL("./session-side-panel.tsx", import.meta.url)).text()
    expect(source).toContain('const isOverlay = createMemo(() => shell.kind() === "overlay")')
    expect(source).not.toContain('createMediaQuery("(min-width: 768px)")')
    expect(source).not.toContain("isMobile()")
  })

  test("session coordinator uses the same viewport contract as the inspector", async () => {
    const source = await Bun.file(new URL("../session.tsx", import.meta.url)).text()
    expect(source).toContain('const isDesktop = createMemo(() => shell.kind() !== "overlay")')
    expect(source).toContain("shell:flex-none")
    expect(source).not.toContain('createMediaQuery("(min-width: 768px)")')
  })

  test("terminal resize handle follows the platform, not a width breakpoint", async () => {
    const source = await Bun.file(new URL("./terminal-panel.tsx", import.meta.url)).text()
    expect(source).toContain("<Show when={!isMobile()}>")
    expect(source).not.toContain('class="hidden md:block" onPointerDown={() => size.start()}')
  })})
