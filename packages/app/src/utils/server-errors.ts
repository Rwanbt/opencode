export type ConfigInvalidError = {
  name: "ConfigInvalidError"
  data: {
    path?: string
    message?: string
    issues?: Array<{ message: string; path: string[] }>
  }
}

export type ProviderModelNotFoundError = {
  name: "ProviderModelNotFoundError"
  data: {
    providerID: string
    modelID: string
    suggestions?: string[]
  }
}

type Translator = (key: string, vars?: Record<string, string | number>) => string

function tr(translator: Translator | undefined, key: string, text: string, vars?: Record<string, string | number>) {
  if (!translator) return text
  const out = translator(key, vars)
  if (!out || out === key) return text
  return out
}

export function formatServerError(error: unknown, translate?: Translator, fallback?: string) {
  if (isConfigInvalidErrorLike(error)) return parseReadableConfigInvalidError(error, translate)
  if (isProviderModelNotFoundErrorLike(error)) return parseReadableProviderModelNotFoundError(error, translate)
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  // Rejected SDK calls hand back a plain response object, not an Error. Those
  // fell straight through to "Unknown error", so a failed bootstrap told the
  // user only that something had failed — the toast was structurally incapable
  // of naming the cause, and the detail existed nowhere a user could reach.
  const described = describeErrorLike(error)
  if (described) return described
  if (fallback) return fallback
  return tr(translate, "error.chain.unknown", "Unknown error")
}

/** Longest detail worth putting in a toast; enough for a message plus context. */
const MAX_DESCRIPTION = 300

/**
 * Extracts something a human can act on from an error-shaped object.
 *
 * Deliberately conservative about what it reads: named fields that carry
 * diagnostics, never a blind dump of the object. A response body can hold a
 * token or a prompt, and a toast is the wrong place to discover that.
 */
function describeErrorLike(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const source = error as Record<string, unknown>
  // The SDK nests the failure one level down; unwrap before reading.
  const inner = isRecord(source.error) ? source.error : isRecord(source.data) ? source.data : undefined
  const parts: string[] = []

  const name = firstString(source.name, inner?.name)
  const message = firstString(source.message, inner?.message)
  const status = firstNumber(source.status, source.statusCode, inner?.status)
  const statusText = firstString(source.statusText, inner?.statusText)

  if (name && name !== "Error") parts.push(name)
  if (status !== undefined) parts.push(statusText ? `HTTP ${status} ${statusText}` : `HTTP ${status}`)
  if (message) parts.push(message)

  if (parts.length === 0) return undefined
  const out = parts.join(" — ")
  return out.length > MAX_DESCRIPTION ? `${out.slice(0, MAX_DESCRIPTION - 1)}…` : out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

function isConfigInvalidErrorLike(error: unknown): error is ConfigInvalidError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ConfigInvalidError" && typeof o.data === "object" && o.data !== null
}

function isProviderModelNotFoundErrorLike(error: unknown): error is ProviderModelNotFoundError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ProviderModelNotFoundError" && typeof o.data === "object" && o.data !== null
}

export function parseReadableConfigInvalidError(errorInput: ConfigInvalidError, translator?: Translator) {
  const file = errorInput.data.path && errorInput.data.path !== "config" ? errorInput.data.path : "config"
  const detail = errorInput.data.message?.trim() ?? ""
  const issues = (errorInput.data.issues ?? [])
    .map((issue) => {
      const msg = issue.message.trim()
      if (!issue.path.length) return msg
      return `${issue.path.join(".")}: ${msg}`
    })
    .filter(Boolean)
  const msg = issues.length ? issues.join("\n") : detail
  if (!msg) return tr(translator, "error.chain.configInvalid", `Config file at ${file} is invalid`, { path: file })
  return tr(translator, "error.chain.configInvalidWithMessage", `Config file at ${file} is invalid: ${msg}`, {
    path: file,
    message: msg,
  })
}

function parseReadableProviderModelNotFoundError(errorInput: ProviderModelNotFoundError, translator?: Translator) {
  const p = errorInput.data.providerID.trim()
  const m = errorInput.data.modelID.trim()
  const list = (errorInput.data.suggestions ?? []).map((v) => v.trim()).filter(Boolean)
  const body = tr(translator, "error.chain.modelNotFound", `Model not found: ${p}/${m}`, { provider: p, model: m })
  const tail = tr(translator, "error.chain.checkConfig", "Check your config (unifia.json) provider/model names")
  if (list.length) {
    const suggestions = list.slice(0, 5).join(", ")
    return [body, tr(translator, "error.chain.didYouMean", `Did you mean: ${suggestions}`, { suggestions }), tail].join(
      "\n",
    )
  }
  return [body, tail].join("\n")
}
