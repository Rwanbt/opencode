import { encodingForModel, getEncoding, type TiktokenModel } from "js-tiktoken"

export namespace Token {
  const FALLBACK_CHARS_PER_TOKEN = 3.5

  // Cache encoders by model family to avoid re-init cost (~50ms on first call).
  const encoderCache = new Map<string, ReturnType<typeof getEncoding>>()

  function getEncoder(modelID?: string) {
    const key = modelID ?? "default"
    let enc = encoderCache.get(key)
    if (enc) return enc
    try {
      enc = modelID
        ? encodingForModel(modelID as TiktokenModel)
        : getEncoding("cl100k_base")
    } catch {
      enc = getEncoding("cl100k_base")
    }
    encoderCache.set(key, enc)
    return enc
  }

  /** Fast heuristic — use for large inputs where exactness is not critical. */
  export function estimate(input: string): number {
    const text = input ?? ""
    if (!text) return 0
    return Math.max(0, Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN))
  }

  /** Exact count via tiktoken. Use for budget decisions, prompt caching. */
  export function count(input: string, modelID?: string): number {
    const text = input ?? ""
    if (!text) return 0
    try {
      return getEncoder(modelID).encode(text).length
    } catch {
      return estimate(text)
    }
  }
}
