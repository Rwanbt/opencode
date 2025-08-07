import { Context } from "../util/context"

const context = Context.create<{ directory: string; worktree: string }>("path")

export const Paths = {
  provider: context.provide,
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
}
