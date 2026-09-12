import { describe, expect, test } from "bun:test"
import { restoreTerminalMouseTracking, TERMINAL_MOUSE_TRACKING_RESET } from "../../src/cli/cmd/tui/util/terminal-cleanup"

describe("restoreTerminalMouseTracking", () => {
  test("disables every mouse tracking mode for an interactive terminal", () => {
    let output = ""
    restoreTerminalMouseTracking({ isTTY: true, write: (chunk) => (output += chunk) })
    expect(output).toBe(TERMINAL_MOUSE_TRACKING_RESET)
  })

  test("does not write to a non-interactive stream", () => {
    let writes = 0
    restoreTerminalMouseTracking({ isTTY: false, write: () => writes++ })
    expect(writes).toBe(0)
  })
})