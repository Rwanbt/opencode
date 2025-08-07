import { Context } from "../util/context"
import { State } from "./state"

const context = Context.create<{ directory: string; worktree: string }>("path")

export const Instance = {
  provide: context.provide,
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async dispose() {
    await State.dispose(Instance.directory)
  },
}
