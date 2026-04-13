/**
 * android-pty.ts --- TCP-based PTY implementation for Android
 *
 * On Android, bun runs via musl with Seccomp: 2, which blocks fork()/clone()
 * from child processes (causing SIGSYS / exitCode=159).  Instead of using
 * bun-pty's FFI (which calls forkpty in the musl context), we connect to
 * pty_server --- a native binary spawned from the Java Foreground Service
 * (Seccomp: 0) that can freely fork+exec.
 *
 * Protocol: TCP connection to localhost:OPENCODE_PTY_PORT
 *   1. Send JSON line with spawn config
 *   2. Receive JSON line with pid/handle
 *   3. Raw bidirectional data relay
 *   4. Server closes socket when PTY exits
 *   Control (resize/kill/status) via separate short-lived connections.
 */

import { createConnection, type Socket as NetSocket } from "node:net"
import type { IPty, IExitEvent, IDisposable } from "bun-pty"

/** Read port on each use so tests can change it between runs. */
function ptyPort() {
  return parseInt(process.env.OPENCODE_PTY_PORT || "14098", 10)
}

class Emitter<T> {
  private listeners: Array<(data: T) => void> = []

  event = (listener: (data: T) => void): IDisposable => {
    this.listeners.push(listener)
    return {
      dispose: () => {
        const idx = this.listeners.indexOf(listener)
        if (idx >= 0) this.listeners.splice(idx, 1)
      },
    }
  }

  fire(data: T) {
    for (const l of this.listeners) l(data)
  }
}

/** Send a one-shot control command to pty_server and return the response. */
async function ptyControl(json: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port: ptyPort() })
    let data = ""
    sock.on("connect", () => {
      sock.write(JSON.stringify(json) + "\n")
    })
    sock.on("data", (chunk: Buffer) => {
      data += chunk.toString()
    })
    sock.on("end", () => {
      sock.destroy()
      resolve(data.trim())
    })
    sock.on("error", () => {
      sock.destroy()
      resolve("{}")
    })
  })
}

export class AndroidTerminal implements IPty {
  private _pid = -1
  private _handle = -1
  private _cols: number
  private _rows: number
  private _socket: NetSocket | null = null
  private _closing = false
  private _connected = false

  private readonly _onData = new Emitter<string>()
  private readonly _onExit = new Emitter<IExitEvent>()
  private readonly _decoder = new TextDecoder("utf-8")

  constructor(file: string, args: string[], opts: { name?: string; cwd?: string; env?: Record<string, string>; cols?: number; rows?: number }) {
    this._cols = opts.cols ?? 80
    this._rows = opts.rows ?? 24

    const cmdline = [file, ...args].join(" ")
    const cwd = opts.cwd ?? process.cwd()
    // Only pass shell-relevant env vars to pty_server.  The full process.env
    // can exceed the pty_server JSON buffer (128KB) and includes many vars
    // (OPENCODE_*, HTTP_PROXY, etc.) that are useless inside an interactive shell.
    const SHELL_ENV_KEYS = new Set([
      "HOME", "PATH", "TERM", "SHELL", "ENV", "USER", "LOGNAME",
      "LANG", "LC_ALL", "LC_CTYPE", "HOSTNAME", "PWD", "OLDPWD",
      "COLORTERM", "TERM_PROGRAM", "XDG_DATA_HOME", "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME", "XDG_STATE_HOME", "LD_LIBRARY_PATH",
      "OPENCODE_TERMINAL",
    ])
    const env = opts.env
      ? Object.entries(opts.env)
          .filter(([k]) => SHELL_ENV_KEYS.has(k))
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : ""

    this._spawn(cmdline, cwd, env)
  }

  private _spawn(cmdline: string, cwd: string, env: string) {
    const port = ptyPort()
    process.stderr.write(`[AndroidPTY] connecting to 127.0.0.1:${port} cmd=${cmdline}\n`)
    const socket = createConnection({ host: "127.0.0.1", port })
    this._socket = socket

    let handshakeDone = false
    let lineBuffer = ""

    socket.on("connect", () => {
      /* Send spawn command as JSON line */
      const msg = JSON.stringify({
        spawn: true,
        cmdline,
        cwd,
        env,
        cols: this._cols,
        rows: this._rows,
      })
      process.stderr.write(`[AndroidPTY] connected, sending spawn: ${msg.slice(0, 200)}\n`)
      socket.write(msg + "\n")
    })

    socket.on("data", (data: Buffer) => {
      if (!handshakeDone) {
        /* Accumulate until we get the full JSON response line */
        lineBuffer += data.toString("utf-8")
        const nlIdx = lineBuffer.indexOf("\n")
        if (nlIdx < 0) return

        const responseLine = lineBuffer.slice(0, nlIdx)
        const remaining = lineBuffer.slice(nlIdx + 1)

        try {
          const resp = JSON.parse(responseLine)
          if (resp.error) {
            console.error("[AndroidPTY] spawn error:", resp.error)
            this._closing = true
            this._onExit.fire({ exitCode: 127 })
            socket.destroy()
            return
          }
          this._pid = resp.pid ?? -1
          this._handle = resp.handle ?? -1
          this._connected = true
          handshakeDone = true

          /* Process any data that arrived after the handshake line */
          if (remaining.length > 0) {
            const decoded = this._decoder.decode(Buffer.from(remaining, "utf-8"), { stream: true })
            if (decoded) this._onData.fire(decoded)
          }
        } catch (e) {
          console.error("[AndroidPTY] handshake parse error:", e, "raw:", responseLine)
          this._closing = true
          this._onExit.fire({ exitCode: 127 })
          socket.destroy()
        }
        return
      }

      /* Normal PTY output relay */
      const decoded = this._decoder.decode(data, { stream: true })
      if (decoded) this._onData.fire(decoded)
    })

    socket.on("close", () => {
      if (this._closing) return
      this._closing = true
      /* Server closed = PTY exited. Query exit code. */
      this._queryExitCode().then((exitCode) => {
        this._onExit.fire({ exitCode })
      })
    })

    socket.on("error", (err) => {
      process.stderr.write(`[AndroidPTY] socket error: ${err.message}\n`)
      if (!this._closing) {
        this._closing = true
        this._onExit.fire({ exitCode: 1 })
      }
    })
  }

  private async _queryExitCode(): Promise<number> {
    if (this._handle < 0) return 0
    try {
      const resp = await ptyControl({ status: this._handle })
      const parsed = JSON.parse(resp)
      return parsed.exitCode ?? 0
    } catch {
      return 0
    }
  }

  /* ── IPty interface ──────────────────────────────────────────────── */

  get pid() {
    return this._pid
  }
  get cols() {
    return this._cols
  }
  get rows() {
    return this._rows
  }
  get process() {
    return "shell"
  }
  get onData() {
    return this._onData.event
  }
  get onExit() {
    return this._onExit.event
  }

  write(data: string) {
    if (this._closing || !this._socket || !this._connected) return
    this._socket.write(data)
  }

  resize(columns: number, rows: number) {
    if (this._closing || this._handle < 0) return
    this._cols = columns
    this._rows = rows
    ptyControl({ resize: this._handle, cols: columns, rows }).catch(() => {})
  }

  kill(signal = "SIGTERM") {
    if (this._closing) return
    this._closing = true
    ptyControl({ kill: this._handle }).catch(() => {})
    this._socket?.destroy()
    this._onExit.fire({ exitCode: 0, signal })
  }
}

/**
 * Spawn function matching bun-pty's `spawn()` signature.
 * Used as a drop-in replacement on Android.
 */
export function androidSpawn(
  file: string,
  args: string[] = [],
  opts: { name?: string; cwd?: string; env?: Record<string, string>; cols?: number; rows?: number } = {},
): IPty {
  return new AndroidTerminal(file, args, opts)
}
