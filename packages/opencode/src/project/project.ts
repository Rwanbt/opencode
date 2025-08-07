import z from "zod"
import { lazy } from "../util/lazy"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { $ } from "bun"
import { StorageNext } from "../storage/storage-next"
import { Context } from "../util/context"

export namespace Project {
  export const Info = z.object({
    id: z.string(),
    worktree: z.string(),
    vcs: z.literal("git").optional(),
    time: z.object({
      created: z.number(),
      initialized: z.number().optional(),
    }),
  })
  export type Info = z.infer<typeof Info>

  const context = Context.create<Info>("project")

  export const use = context.use
  export const provide = context.provide

  const init = lazy(async () => {
    const cwd = process.cwd()
    const matches = Filesystem.up({ targets: [".git"], start: cwd })
    const git = await matches.next().then((x) => x.value)
    await matches.return()
    if (!git) {
      await StorageNext.write<Info>(["project", "global"], {
        id: "global",
        worktree: "/",
        time: {
          created: Date.now(),
        },
      })
      return
    }
    let worktree = path.dirname(git)
    const [id] = await $`git rev-list --max-parents=0 --all`
      .quiet()
      .nothrow()
      .cwd(worktree)
      .text()
      .then((x) =>
        x
          .split("\n")
          .filter(Boolean)
          .map((x) => x.trim())
          .toSorted(),
      )
    worktree = path.dirname(
      await $`git rev-parse --path-format=absolute --git-common-dir`
        .quiet()
        .nothrow()
        .cwd(worktree)
        .text()
        .then((x) => x.trim()),
    )
    await StorageNext.write<Info>(["project", id], {
      id,
      worktree,
      vcs: "git",
      time: {
        created: Date.now(),
      },
    })
  })

  export async function setInitialized() {
    const project = use()
    await StorageNext.update<Info>(["project", project.id], (draft) => {
      draft.time.initialized = Date.now()
    })
  }

  export async function list() {
    await init()
    const keys = await StorageNext.list(["project"])
    return await Promise.all(keys.map((x) => StorageNext.read<Info>(x)))
  }
}
