import { describe, expect, test } from "bun:test"
import type { ConfigInvalidError, ProviderModelNotFoundError } from "./server-errors"
import { formatServerError, parseReadableConfigInvalidError } from "./server-errors"

function fill(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text
  return text.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => {
    const value = vars[key]
    if (value === undefined) return ""
    return String(value)
  })
}

function useLanguageMock() {
  const dict: Record<string, string> = {
    "error.chain.unknown": "Erro desconhecido",
    "error.chain.configInvalid": "Arquivo de config em {{path}} invalido",
    "error.chain.configInvalidWithMessage": "Arquivo de config em {{path}} invalido: {{message}}",
    "error.chain.modelNotFound": "Modelo nao encontrado: {{provider}}/{{model}}",
    "error.chain.didYouMean": "Voce quis dizer: {{suggestions}}",
    "error.chain.checkConfig": "Revise provider/model no config",
  }
  return {
    t(key: string, vars?: Record<string, string | number>) {
      const text = dict[key]
      if (!text) return key
      return fill(text, vars)
    },
  }
}

const language = useLanguageMock()

describe("parseReadableConfigInvalidError", () => {
  test("formats issues with file path", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "unifia.config.ts",
        issues: [
          { path: ["settings", "host"], message: "Required" },
          { path: ["mode"], message: "Invalid" },
        ],
      },
    } satisfies ConfigInvalidError

    const result = parseReadableConfigInvalidError(error, language.t)

    expect(result).toBe(
      ["Arquivo de config em unifia.config.ts invalido: settings.host: Required", "mode: Invalid"].join("\n"),
    )
  })

  test("uses trimmed message when issues are missing", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        path: "config",
        message: "  Bad value  ",
      },
    } satisfies ConfigInvalidError

    const result = parseReadableConfigInvalidError(error, language.t)

    expect(result).toBe("Arquivo de config em config invalido: Bad value")
  })
})

describe("formatServerError", () => {
  test("formats config invalid errors", () => {
    const error = {
      name: "ConfigInvalidError",
      data: {
        message: "Missing host",
      },
    } satisfies ConfigInvalidError

    const result = formatServerError(error, language.t)

    expect(result).toBe("Arquivo de config em config invalido: Missing host")
  })

  test("returns error messages", () => {
    expect(formatServerError(new Error("Request failed with status 503"), language.t)).toBe(
      "Request failed with status 503",
    )
  })

  test("returns provided string errors", () => {
    expect(formatServerError("Failed to connect to server", language.t)).toBe("Failed to connect to server")
  })

  test("uses translated unknown fallback", () => {
    expect(formatServerError(0, language.t)).toBe("Erro desconhecido")
  })

  // Previously asserted "Erro desconhecido" here. An error object carrying a
  // usable name was being flattened into a message that teaches the user
  // nothing, which is how a failed bootstrap ended up reporting only that
  // something had failed. Naming the type is strictly more actionable; the
  // untyped `data` payload is still not surfaced, since it can hold anything.
  test("names an unrecognised error type instead of hiding it", () => {
    expect(formatServerError({ name: "ServerTimeoutError", data: { seconds: 30 } }, language.t)).toBe(
      "ServerTimeoutError",
    )
  })

  test("formats provider model errors using provider/model", () => {
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "openai",
        modelID: "gpt-4.1",
      },
    } satisfies ProviderModelNotFoundError

    expect(formatServerError(error, language.t)).toBe(
      ["Modelo nao encontrado: openai/gpt-4.1", "Revise provider/model no config"].join("\n"),
    )
  })

  test("formats provider model suggestions", () => {
    const error = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "x",
        modelID: "y",
        suggestions: ["x/y2", "x/y3"],
      },
    } satisfies ProviderModelNotFoundError

    expect(formatServerError(error, language.t)).toBe(
      ["Modelo nao encontrado: x/y", "Voce quis dizer: x/y2, x/y3", "Revise provider/model no config"].join("\n"),
    )
  })
})

// A failed bootstrap raises a toast whose description comes from
// formatServerError. Rejected SDK calls hand back a plain response object, not
// an Error, so every one of them fell through to "Unknown error" — the user was
// told something failed and nothing else, and the cause existed nowhere they
// could reach. These pin that the formatter reports what it knows.
describe("formatServerError on error-shaped objects (not Error instances)", () => {
  test("reports a plain object's message", () => {
    expect(formatServerError({ message: "workspace is not registered" })).toBe("workspace is not registered")
  })

  test("unwraps the SDK's nested error envelope", () => {
    expect(formatServerError({ data: undefined, error: { message: "session not found" } })).toBe("session not found")
  })

  test("names the error type alongside the message", () => {
    expect(formatServerError({ name: "ProviderInitError", message: "no api key" })).toBe("ProviderInitError — no api key")
  })

  test("surfaces an HTTP status when that is all there is", () => {
    expect(formatServerError({ status: 503, statusText: "Service Unavailable" })).toBe("HTTP 503 Service Unavailable")
  })

  test("omits the redundant name 'Error'", () => {
    expect(formatServerError({ name: "Error", message: "boom" })).toBe("boom")
  })

  test("truncates a runaway message instead of flooding the toast", () => {
    const out = formatServerError({ message: "x".repeat(500) })
    expect(out.length).toBeLessThanOrEqual(300)
    expect(out.endsWith("…")).toBe(true)
  })

  // Only named diagnostic fields are read: a response body can hold a token or
  // a prompt, and a toast is the wrong place to discover that.
  test("does not dump unknown fields", () => {
    expect(formatServerError({ apiKey: "sk-secret", prompt: "private" })).toBe("Unknown error")
  })

  test("still falls back when there is genuinely nothing to say", () => {
    expect(formatServerError({})).toBe("Unknown error")
    expect(formatServerError(null)).toBe("Unknown error")
  })
})
