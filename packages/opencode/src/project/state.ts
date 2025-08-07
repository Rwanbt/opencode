export namespace State {
  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  const entries = new Map<string, Entry>()

  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
    return () => {
      const key = root()
      const exists = entries.get(key)
      if (exists) return exists.state as S
      const state = init()
      entries.set(key, {
        state,
        dispose,
      })
      return state
    }
  }

  export async function dispose() {
    for (const [_, entry] of entries.entries()) {
      if (!entry.dispose) continue
      await entry.dispose(await entry.state)
    }
  }
}
