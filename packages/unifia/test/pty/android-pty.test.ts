import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { createServer, type Server, type Socket as NetSocket } from "node:net"
import { setTimeout as sleep } from "node:timers/promises"

/**
 * Unit tests for android-pty.ts
 *
 * These tests spin up a mock TCP server that emulates pty_server's protocol,
 * then verify that AndroidTerminal correctly:
 *   - Sends spawn JSON and parses the response
 *   - Relays data bidirectionally
 *   - Handles resize/kill via control connections
 *   - Detects exit when server closes the socket
 *   - Handles error cases (connection refused, malformed JSON, etc.)
 */

// We need to set UNIFIA_PTY_PORT before importing android-pty
/**
 * Polls until `condition` holds, instead of sleeping a fixed amount.
 *
 * Every wait in this file used to be a bare `sleep()` covering a TCP connect,
 * a JSON handshake and a response parse. 200 ms is generous on an idle machine
 * and not enough on a loaded Windows runner, which is why `unit (windows)`
 * alternated pass and fail across commits that could not have affected it.
 * Polling keeps the fast path fast and stops the slow path from lying.
 *
 * Deliberately returns rather than throwing on timeout: the assertion that
 * follows each call produces a far better diagnostic than a generic timeout.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5000, intervalMs = 10) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await sleep(intervalMs)
  }
  // Deliberately silent on timeout: every call site asserts the same condition
  // on the next line, so the expect produces the real message ("expected 42,
  // got undefined") instead of a generic timeout. No test can pass vacuously.
}

/** Create a mock PTY server that speaks the pty_server protocol. */
function createMockPtyServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ server, port })
    })
  })
}

describe("android-pty", () => {
  let server: Server
  let port: number
  let connections: NetSocket[] = []

  beforeEach(async () => {
    const result = await createMockPtyServer()
    server = result.server
    port = result.port
    connections = []

    // Set env var BEFORE importing android-pty
    process.env.UNIFIA_PTY_PORT = String(port)
  })

  afterEach(async () => {
    delete process.env.UNIFIA_PTY_PORT
    for (const conn of connections) {
      conn.destroy()
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  test("spawn sends correct JSON and parses response", async () => {
    let receivedData = ""

    server.on("connection", (socket) => {
      connections.push(socket)
      socket.on("data", (data) => {
        receivedData += data.toString()
        // Check if we got a complete line
        if (receivedData.includes("\n")) {
          const json = JSON.parse(receivedData.split("\n")[0])
          expect(json.spawn).toBe(true)
          expect(json.cmdline).toBe("bash -l")
          expect(json.cwd).toBe("/tmp")
          expect(json.cols).toBe(80)
          expect(json.rows).toBe(24)
          // Send response
          socket.write('{"pid":1234,"handle":0}\n')
        }
      })
    })

    // Dynamic import to pick up the env var
    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("bash", ["-l"], {
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      env: { TERM: "xterm-256color" },
    })

    await waitFor(() => term.pid !== -1)
    expect(term.pid).toBe(1234)
    expect(term.cols).toBe(80)
    expect(term.rows).toBe(24)

    term.kill()
  })

  test("onData fires when server sends PTY output", async () => {
    server.on("connection", (socket) => {
      connections.push(socket)
      let handshakeDone = false
      socket.on("data", () => {
        if (!handshakeDone) {
          handshakeDone = true
          socket.write('{"pid":5678,"handle":1}\n')
          // Send PTY output after handshake
          setTimeout(() => {
            socket.write("hello from pty\r\n")
          }, 50)
        }
      })
    })

    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("sh", [], { cwd: "/tmp" })

    const output: string[] = []
    term.onData((data) => output.push(data))

    await waitFor(() => output.join("").includes("hello from pty"))
    expect(output.length).toBeGreaterThan(0)
    expect(output.join("")).toContain("hello from pty")

    term.kill()
  })

  test("write sends data to server after handshake", async () => {
    let receivedAfterHandshake = ""

    server.on("connection", (socket) => {
      connections.push(socket)
      let handshakeDone = false
      socket.on("data", (data) => {
        const str = data.toString()
        if (!handshakeDone && str.includes("\n")) {
          handshakeDone = true
          socket.write('{"pid":9999,"handle":2}\n')
        } else if (handshakeDone) {
          receivedAfterHandshake += str
        }
      })
    })

    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("bash", [], { cwd: "/tmp" })

    await waitFor(() => term.pid !== -1)
    term.write("ls -la\r")

    await waitFor(() => receivedAfterHandshake.includes("ls -la"))
    expect(receivedAfterHandshake).toContain("ls -la")

    term.kill()
  })

  test("onExit fires when server closes connection", async () => {
    // Set up mock: spawn connection closes, status query returns exitCode=42
    let statusConnection = false

    server.on("connection", (socket) => {
      connections.push(socket)
      let buf = ""
      socket.on("data", (data) => {
        buf += data.toString()
        if (!buf.includes("\n")) return
        const line = buf.split("\n")[0]
        const json = JSON.parse(line)

        if (json.spawn) {
          socket.write('{"pid":1111,"handle":3}\n')
          // Close after a short delay to simulate PTY exit
          setTimeout(() => socket.end(), 100)
        } else if (json.status !== undefined) {
          statusConnection = true
          socket.write('{"exited":true,"exitCode":42}\n')
          socket.end()
        }
      })
    })

    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("bash", [], { cwd: "/tmp" })

    let exitCode = -1
    term.onExit((evt) => {
      exitCode = evt.exitCode
    })

    await waitFor(() => exitCode === 42 && statusConnection)
    expect(exitCode).toBe(42)
    expect(statusConnection).toBe(true)
  })

  test("resize sends control command to server", async () => {
    let resizeReceived = false
    let resizeHandle = -1
    let resizeCols = -1
    let resizeRows = -1

    server.on("connection", (socket) => {
      connections.push(socket)
      let buf = ""
      socket.on("data", (data) => {
        buf += data.toString()
        if (!buf.includes("\n")) return
        const line = buf.split("\n")[0]
        buf = buf.slice(line.length + 1)
        const json = JSON.parse(line)

        if (json.spawn) {
          socket.write('{"pid":2222,"handle":4}\n')
        } else if (json.resize !== undefined) {
          resizeReceived = true
          resizeHandle = json.resize
          resizeCols = json.cols
          resizeRows = json.rows
          socket.write('{"ok":true}\n')
          socket.end()
        }
      })
    })

    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("bash", [], { cwd: "/tmp" })

    await waitFor(() => term.pid !== -1)
    term.resize(120, 40)

    await waitFor(() => resizeReceived)
    expect(resizeReceived).toBe(true)
    expect(resizeHandle).toBe(4)
    expect(resizeCols).toBe(120)
    expect(resizeRows).toBe(40)
    expect(term.cols).toBe(120)
    expect(term.rows).toBe(40)

    term.kill()
  })

  test("handles spawn error from server", async () => {
    server.on("connection", (socket) => {
      connections.push(socket)
      socket.on("data", () => {
        socket.write('{"error":"forkpty: ENOMEM"}\n')
        socket.end()
      })
    })

    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("bash", [], { cwd: "/tmp" })

    let exitCode = -1
    term.onExit((evt) => {
      exitCode = evt.exitCode
    })

    await waitFor(() => exitCode === 127)
    expect(exitCode).toBe(127) // error exit code
  })

  test("handles connection refused gracefully", async () => {
    // Close the server to simulate connection refused
    await new Promise<void>((resolve) => server.close(() => resolve()))

    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("bash", [], { cwd: "/tmp" })

    let exitCode = -1
    term.onExit((evt) => {
      exitCode = evt.exitCode
    })

    await waitFor(() => exitCode === 1)
    expect(exitCode).toBe(1) // error exit code

    // Recreate server for afterEach cleanup
    const result = await createMockPtyServer()
    server = result.server
  })

  test("env variables are serialized as newline-separated pairs", async () => {
    let receivedEnv = ""

    server.on("connection", (socket) => {
      connections.push(socket)
      socket.on("data", (data) => {
        const str = data.toString()
        if (str.includes("\n")) {
          const json = JSON.parse(str.split("\n")[0])
          if (json.spawn) {
            receivedEnv = json.env
            socket.write('{"pid":3333,"handle":5}\n')
          }
        }
      })
    })

    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("bash", [], {
      cwd: "/tmp",
      env: { TERM: "xterm-256color", HOME: "/data/home", PATH: "/usr/bin" },
    })

    await waitFor(() => receivedEnv !== "")
    expect(receivedEnv).toContain("TERM=xterm-256color")
    expect(receivedEnv).toContain("HOME=/data/home")
    expect(receivedEnv).toContain("PATH=/usr/bin")
    // Verify newline separation
    const lines = receivedEnv.split("\n").filter(Boolean)
    expect(lines.length).toBe(3)

    term.kill()
  })

  test("kill sends control command and fires onExit", async () => {
    let killReceived = false

    server.on("connection", (socket) => {
      connections.push(socket)
      let buf = ""
      socket.on("data", (data) => {
        buf += data.toString()
        if (!buf.includes("\n")) return
        const line = buf.split("\n")[0]
        buf = buf.slice(line.length + 1)
        const json = JSON.parse(line)

        if (json.spawn) {
          socket.write('{"pid":4444,"handle":6}\n')
        } else if (json.kill !== undefined) {
          killReceived = true
          socket.write('{"ok":true}\n')
          socket.end()
        }
      })
    })

    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("bash", [], { cwd: "/tmp" })

    await waitFor(() => term.pid !== -1)

    let exitFired = false
    term.onExit(() => {
      exitFired = true
    })

    term.kill()

    await waitFor(() => killReceived && exitFired)
    expect(killReceived).toBe(true)
    expect(exitFired).toBe(true)
  })

  test("process property returns 'shell'", async () => {
    server.on("connection", (socket) => {
      connections.push(socket)
      socket.on("data", () => {
        socket.write('{"pid":5555,"handle":7}\n')
      })
    })

    const { AndroidTerminal } = await import("../../src/pty/android-pty")
    const term = new AndroidTerminal("bash", [], { cwd: "/tmp" })

    expect(term.process).toBe("shell")
    term.kill()
  })
})
