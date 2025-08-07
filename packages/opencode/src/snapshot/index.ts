import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import { z } from "zod"
import { Config } from "../config/config"
import { Project } from "../project/project"
import { Paths } from "../project/path"

export namespace Snapshot {
  const log = Log.create({ service: "snapshot" })

  export function init() {
    Array.fromAsync(
      new Bun.Glob("**/snapshot").scan({
        absolute: true,
        onlyFiles: false,
        cwd: Global.Path.data,
      }),
    ).then((files) => {
      for (const file of files) {
        fs.rmdir(file, { recursive: true })
      }
    })
  }

  export async function track() {
    const project = Project.use()
    if (project.vcs !== "git") return
    const cfg = await Config.get()
    if (cfg.snapshot === false) return
    const git = gitdir()
    if (await fs.mkdir(git, { recursive: true })) {
      await $`git init`
        .env({
          ...process.env,
          GIT_DIR: git,
          GIT_WORK_TREE: Paths.worktree,
        })
        .quiet()
        .nothrow()
      log.info("initialized")
    }
    await $`git --git-dir ${git} add .`.quiet().cwd(Paths.directory).nothrow()
    const hash = await $`git --git-dir ${git} write-tree`.quiet().cwd(Paths.directory).nothrow().text()
    return hash.trim()
  }

  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export async function patch(hash: string): Promise<Patch> {
    const git = gitdir()
    await $`git --git-dir ${git} add .`.quiet().cwd(Paths.directory).nothrow()
    const files = await $`git --git-dir ${git} diff --name-only ${hash} -- .`.cwd(Paths.directory).text()
    return {
      hash,
      files: files
        .trim()
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => path.join(Paths.directory, x)),
    }
  }

  export async function restore(snapshot: string) {
    log.info("restore", { commit: snapshot })
    const git = gitdir()
    await $`git --git-dir=${git} read-tree ${snapshot} && git --git-dir=${git} checkout-index -a -f`
      .quiet()
      .cwd(Paths.worktree)
  }

  export async function revert(patches: Patch[]) {
    const files = new Set<string>()
    const git = gitdir()
    for (const item of patches) {
      for (const file of item.files) {
        if (files.has(file)) continue
        log.info("reverting", { file, hash: item.hash })
        const result = await $`git --git-dir=${git} checkout ${item.hash} -- ${file}`
          .quiet()
          .cwd(Paths.worktree)
          .nothrow()
        if (result.exitCode !== 0) {
          log.info("file not found in history, deleting", { file })
          await fs.unlink(file).catch(() => {})
        }
        files.add(file)
      }
    }
  }

  export async function diff(hash: string) {
    const git = gitdir()
    const result = await $`git --git-dir=${git} diff ${hash} -- .`.quiet().cwd(Paths.worktree).text()
    return result.trim()
  }

  function gitdir() {
    const project = Project.use()
    return path.join(Global.Path.data, "snapshot", project.id)
  }
}
