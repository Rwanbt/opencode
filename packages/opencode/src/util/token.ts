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

  // tiktoken ships OpenAI encoders only. For Llama/Qwen/Gemma/Mistral the
  // cl100k_base fallback diverges from the real BPE by ~30%; the length/3.5
  // heuristic is within ~15% and doesn't mislead callers into thinking they
  // have exact token counts. This list errs on the side of marking families
  // as OpenAI only when we're confident.
  function isOpenAIFamily(modelID?: string): boolean {
    if (!modelID) return false
    const id = modelID.toLowerCase()
    return (
      id.startsWith("gpt-") ||
      id.startsWith("o1") ||
      id.startsWith("o3") ||
      id.startsWith("o4") ||
      id.startsWith("chatgpt") ||
      id.startsWith("text-") ||
      id.startsWith("code-") ||
      id.startsWith("davinci") ||
      id.startsWith("babbage") ||
      id.startsWith("ada") ||
      id.startsWith("curie")
    )
  }

  /** Fast heuristic — use for large inputs where exactness is not critical. */
  export function estimate(input: string): number {
    const text = input ?? ""
    if (!text) return 0
    return Math.max(0, Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN))
  }

  /** Count tokens. Exact via tiktoken for OpenAI models; heuristic otherwise
   *  (Llama/Qwen/Gemma/Mistral/local-llm). Callers that need exact counts on
   *  non-OpenAI models should query the provider's /tokenize endpoint. */
  export function count(input: string, modelID?: string): number {
    const text = input ?? ""
    if (!text) return 0
    if (!isOpenAIFamily(modelID)) return estimate(text)
    try {
      return getEncoder(modelID).encode(text).length
    } catch {
      return estimate(text)
    }
  }
}
