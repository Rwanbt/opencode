export namespace Rpc {
  type Definition = {
    [method: string]: (input: any) => any
  }

  export function listen(rpc: Definition) {
    onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.request") {
        const result = await rpc[parsed.method](parsed.input)
        postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
      }
    }
  }

  export function emit(event: string, data: unknown) {
    postMessage(JSON.stringify({ type: "rpc.event", event, data }))
  }

  // S2.V1: per-request timeout. 30s covers most worker calls (embedding,
  // parsing, bm25 indexing) — a worker stuck past that is already broken.
  const RPC_TIMEOUT_MS = 30_000

  type Pending = {
    resolve: (result: any) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }

  export function client<T extends Definition>(target: {
    postMessage: (data: string) => void | null
    onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
  }) {
    const pending = new Map<string, Pending>()
    const listeners = new Map<string, Set<(data: any) => void>>()
    target.onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.result") {
        const entry = pending.get(parsed.id)
        if (entry) {
          // Delete-before-resolve: if the resolver synchronously dispatches
          // another call that allocates the same ID (impossible with UUIDs
          // but keeps the invariant robust), it sees a fresh slot.
          pending.delete(parsed.id)
          clearTimeout(entry.timer)
          entry.resolve(parsed.result)
        }
      }
      if (parsed.type === "rpc.event") {
        const handlers = listeners.get(parsed.event)
        if (handlers) {
          for (const handler of handlers) {
            handler(parsed.data)
          }
        }
      }
    }
    return {
      call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
        // crypto.randomUUID() gives collision-free IDs without a counter
        // that could roll around 2^53 (S2.V1 finding).
        const requestId = crypto.randomUUID()
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(requestId)
            reject(new Error(`rpc: call ${String(method)} timed out after ${RPC_TIMEOUT_MS}ms`))
          }, RPC_TIMEOUT_MS)
          pending.set(requestId, { resolve, reject, timer })
          target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
        })
      },
      on<Data>(event: string, handler: (data: Data) => void) {
        let handlers = listeners.get(event)
        if (!handlers) {
          handlers = new Set()
          listeners.set(event, handlers)
        }
        handlers.add(handler)
        return () => {
          handlers!.delete(handler)
        }
      },
    }
  }
}
