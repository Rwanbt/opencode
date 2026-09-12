/**
 * Provider utility helpers.
 *
 * Extracted from provider.ts to keep that file under the 1500-LOC budget.
 * These are standalone functions with no dependency on Provider namespace types.
 */
import { Env } from "../env"

/**
 * Returns true when the GitHub Copilot model should use the Responses API
 * instead of the Chat API (GPT-5 and above, excluding gpt-5-mini).
 */
export function shouldUseCopilotResponsesApi(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

/**
 * Wraps a streaming SSE response so that individual chunk reads time out after
 * `ms` milliseconds. If a chunk takes too long, the AbortController is fired
 * and the underlying reader is cancelled.
 */
export function wrapSSE(res: Response, ms: number, ctl: AbortController) {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error("SSE read timed out")
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      if (part.done) {
        ctrl.close()
        return
      }

      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

/** Returns the end-to-end test LLM URL override, or undefined when not set. */
export function e2eURL() {
  const url = Env.get("OPENCODE_E2E_LLM_URL")
  if (typeof url !== "string" || url === "") return
  return url
}
