import { describe, expect, test } from "bun:test"
import { terminalTabLabel } from "./terminal-label"

// D-08: pure label resolver — uses the real (pure) terminal-title helpers and
// an injected translator `t`, so it is fully deterministic.

const t = (key: string, vars?: Record<string, string | number | boolean>) =>
  vars && "number" in vars ? `${key}#${vars.number}` : key

describe("terminalTabLabel", () => {
  test("keeps a user-chosen title verbatim", () => {
    expect(terminalTabLabel({ title: "deploy logs", titleNumber: 2, t })).toBe("deploy logs")
  })

  test("replaces a default title with the localized numbered label", () => {
    // "Terminal 2" is a default title for number 2 -> not kept verbatim.
    expect(terminalTabLabel({ title: "Terminal 2", titleNumber: 2, t })).toBe("terminal.title.numbered#2")
  })

  test("uses the numbered label when there is no title but a positive number", () => {
    expect(terminalTabLabel({ titleNumber: 5, t })).toBe("terminal.title.numbered#5")
  })

  test("falls back to the generic title with no title and no number", () => {
    expect(terminalTabLabel({ t })).toBe("terminal.title")
  })

  test("keeps a title that merely looks numbered but uses the wrong number", () => {
    // "Terminal 9" is not the default for number 2, so it is treated as custom.
    expect(terminalTabLabel({ title: "Terminal 9", titleNumber: 2, t })).toBe("Terminal 9")
  })
})
