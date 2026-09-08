import z from "zod"
import { EOL } from "node:os"
import { NamedError } from "@unifia/util/error"
import { brandColors, logo as glyphs, plainWordmark } from "./logo"

// The approved lockup states the brand in hex; terminals want decimal RGB. This
// derives one from the other, so the CLI cannot drift from
// brand/unifia/cli/unifia-cli-lockup.json the way a second copy of the values
// would. 24-bit colour only: the fallback is no colour at all, never a
// 256-colour approximation of an exact brand colour.
const truecolor = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16)
  return `\x1b[38;2;${(value >> 16) & 0xff};${(value >> 8) & 0xff};${value & 0xff}m`
}

export namespace UI {
  export const CancelledError = NamedError.create("UICancelledError", z.void())

  export const Style = {
    TEXT_HIGHLIGHT: "\x1b[96m",
    TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
    TEXT_DIM: "\x1b[90m",
    TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
    TEXT_NORMAL: "\x1b[0m",
    TEXT_NORMAL_BOLD: "\x1b[1m",
    TEXT_WARNING: "\x1b[93m",
    TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
    TEXT_DANGER: "\x1b[91m",
    TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
    TEXT_SUCCESS: "\x1b[92m",
    TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
    TEXT_INFO: "\x1b[94m",
    TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
  }

  export function println(...message: string[]) {
    print(...message)
    process.stderr.write(EOL)
  }

  export function print(...message: string[]) {
    blank = false
    process.stderr.write(message.join(" "))
  }

  let blank = false
  export function empty() {
    if (blank) return
    println("" + Style.TEXT_NORMAL)
    blank = true
  }

  export function logo(pad?: string) {
    const colorEnabled = (process.stdout.isTTY || process.stderr.isTTY) && process.env.NO_COLOR === undefined
    if (!colorEnabled) {
      const result = []
      for (const row of plainWordmark) {
        if (pad) result.push(pad)
        result.push(row)
        result.push(EOL)
      }
      return result.join("").trimEnd()
    }

    const result: string[] = []
    const reset = "\x1b[0m"
    const white = truecolor(brandColors.white)
    const ansi = {
      P: truecolor(brandColors.purple),
      B: truecolor(brandColors.blue),
      O: truecolor(brandColors.orange),
    } as const
    const drawSymbol = (text: string, colors: string) =>
      [...text]
        .map((char, index) => {
          const color = ansi[colors[index] as keyof typeof ansi]
          return color ? color + char + reset : char
        })
        .join("")

    glyphs.symbol.forEach((row, index) => {
      if (pad) result.push(pad)
      result.push(drawSymbol(row.text, row.colors), "  ", white, glyphs.wordmark[index] ?? "", reset, EOL)
    })
    return result.join("").trimEnd()
  }

  export async function input(prompt: string): Promise<string> {
    const readline = require("node:readline")
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(prompt, (answer: string) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  export function error(message: string) {
    if (message.startsWith("Error: ")) {
      message = message.slice("Error: ".length)
    }
    println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
  }

  export function markdown(text: string): string {
    return text
  }
}
