export const TERMINAL_MOUSE_TRACKING_RESET = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l"

type TerminalOutput = {
  isTTY?: boolean
  write: (chunk: string) => unknown
}

export function restoreTerminalMouseTracking(output: TerminalOutput = process.stdout) {
  if (!output.isTTY) return
  try {
    output.write(TERMINAL_MOUSE_TRACKING_RESET)
  } catch {
    // The stream may already be closed while the process is shutting down.
  }
}