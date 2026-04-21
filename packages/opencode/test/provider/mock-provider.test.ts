import { describe, it, expect } from "bun:test"
import { createMockProvider, MockProviderExhaustedError } from "../lib/mock-provider"

async function drain(stream: ReadableStream<any>) {
  const reader = stream.getReader()
  const out: any[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

describe("mock-provider", () => {
  it("streams static text as text-start/text-delta/text-end/finish", async () => {
    const m = createMockProvider({ responses: [{ output: "hello world" }] })
    const { stream } = await m.doStream({ prompt: [] } as any)
    const parts = await drain(stream)
    expect(parts.map((p) => p.type)).toEqual(["stream-start", "text-start", "text-delta", "text-end", "finish"])
    expect(parts.find((p) => p.type === "text-delta").delta).toBe("hello world")
  })

  it("consumes responses in FIFO order by default", async () => {
    const m = createMockProvider({ responses: [{ output: "a" }, { output: "b" }] })
    const s1 = await m.doStream({ prompt: [] } as any)
    const s2 = await m.doStream({ prompt: [] } as any)
    const t1 = (await drain(s1.stream)).find((p) => p.type === "text-delta").delta
    const t2 = (await drain(s2.stream)).find((p) => p.type === "text-delta").delta
    expect([t1, t2]).toEqual(["a", "b"])
    expect(m.pending()).toBe(0)
  })

  it("matches by input regex against JSON-stringified prompt", async () => {
    const m = createMockProvider({
      responses: [
        { output: "catch-all" },
        { input: /explore/, output: "explore-out" },
      ],
    })
    const s1 = await m.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "please explore" }] }] } as any)
    const t1 = (await drain(s1.stream)).find((p) => p.type === "text-delta").delta
    // input-matched entry wins even though it is after the catch-all
    expect(t1).toBe("explore-out")
  })

  it("rejects before first chunk on error output (handshake failure)", async () => {
    const err = Object.assign(new Error("upstream 503"), { status: 503 })
    const m = createMockProvider({ responses: [{ output: err }] })
    await expect(m.doStream({ prompt: [] } as any)).rejects.toThrow("upstream 503")
  })

  it("streams chunks from an async generator output", async () => {
    const m = createMockProvider({
      responses: [
        {
          output: async function* () {
            yield "one "
            yield "two"
          },
        },
      ],
    })
    const { stream } = await m.doStream({ prompt: [] } as any)
    const parts = await drain(stream)
    const deltas = parts.filter((p) => p.type === "text-delta").map((p) => p.delta)
    expect(deltas).toEqual(["one ", "two"])
  })

  it("emits midStreamError after static text chunk", async () => {
    const m = createMockProvider({ responses: [{ output: "partial", midStreamError: new Error("disconnect") }] })
    const { stream } = await m.doStream({ prompt: [] } as any)
    // The stream ends with an error controller — drain throws.
    await expect(drain(stream)).rejects.toThrow("disconnect")
  })

  it("throws MockProviderExhaustedError when queue runs dry", async () => {
    const m = createMockProvider({ responses: [] })
    await expect(m.doStream({ prompt: [] } as any)).rejects.toBeInstanceOf(MockProviderExhaustedError)
  })
})
