import { z } from "zod"
import { Bus } from "../bus"
import { $ } from "bun"
import { createPatch } from "diff"
import path from "path"
import * as git from "isomorphic-git"
import fs from "fs"
import { Log } from "../util/log"
import { Paths } from "../project/path"
import { Project } from "../project/project"

export namespace File {
  const log = Log.create({ service: "file" })

  export const Info = z
    .object({
      path: z.string(),
      added: z.number().int(),
      removed: z.number().int(),
      status: z.enum(["added", "deleted", "modified"]),
    })
    .openapi({
      ref: "File",
    })

  export type Info = z.infer<typeof Info>

  export const Event = {
    Edited: Bus.event(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  export async function status() {
    const project = Project.use()
    if (project.vcs !== "git") return []

    const diffOutput = await $`git diff --numstat HEAD`.cwd(Paths.directory).quiet().nothrow().text()

    const changedFiles: Info[] = []

    if (diffOutput.trim()) {
      const lines = diffOutput.trim().split("\n")
      for (const line of lines) {
        const [added, removed, filepath] = line.split("\t")
        changedFiles.push({
          path: filepath,
          added: added === "-" ? 0 : parseInt(added, 10),
          removed: removed === "-" ? 0 : parseInt(removed, 10),
          status: "modified",
        })
      }
    }

    const untrackedOutput = await $`git ls-files --others --exclude-standard`
      .cwd(Paths.directory)
      .quiet()
      .nothrow()
      .text()

    if (untrackedOutput.trim()) {
      const untrackedFiles = untrackedOutput.trim().split("\n")
      for (const filepath of untrackedFiles) {
        try {
          const content = await Bun.file(path.join(Paths.worktree, filepath)).text()
          const lines = content.split("\n").length
          changedFiles.push({
            path: filepath,
            added: lines,
            removed: 0,
            status: "added",
          })
        } catch {
          continue
        }
      }
    }

    // Get deleted files
    const deletedOutput = await $`git diff --name-only --diff-filter=D HEAD`
      .cwd(Paths.directory)
      .quiet()
      .nothrow()
      .text()

    if (deletedOutput.trim()) {
      const deletedFiles = deletedOutput.trim().split("\n")
      for (const filepath of deletedFiles) {
        changedFiles.push({
          path: filepath,
          added: 0,
          removed: 0, // Could get original line count but would require another git command
          status: "deleted",
        })
      }
    }

    return changedFiles.map((x) => ({
      ...x,
      path: path.relative(Paths.directory, path.join(Paths.worktree, x.path)),
    }))
  }

  export async function read(file: string) {
    using _ = log.time("read", { file })
    const project = Project.use()
    const full = path.join(Paths.directory, file)
    const content = await Bun.file(full)
      .text()
      .catch(() => "")
      .then((x) => x.trim())
    if (project.vcs === "git") {
      const rel = path.relative(Paths.worktree, full)
      const diff = await git.status({
        fs,
        dir: Paths.worktree,
        filepath: rel,
      })
      if (diff !== "unmodified") {
        const original = await $`git show HEAD:${rel}`.cwd(Paths.worktree).quiet().nothrow().text()
        const patch = createPatch(file, original, content, "old", "new", {
          context: Infinity,
        })
        return { type: "patch", content: patch }
      }
    }
    return { type: "raw", content }
  }
}
