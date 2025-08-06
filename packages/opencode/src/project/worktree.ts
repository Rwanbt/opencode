import { Context } from "../util/context"

export namespace Worktree {
  const context = Context.create<string>("worktree")
  export const use = context.use
  export const provide = context.provide
}
