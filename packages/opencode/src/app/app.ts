import "zod-openapi/extend"
import { Log } from "../util/log"
import { Context } from "../util/context"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import path from "path"
import os from "os"
import { z } from "zod"
import { Project } from "../project/project"
import { Instance } from "../project/instance"

export namespace App {
  const log = Log.create({ service: "app" })

  export const Info = z
    .object({
      hostname: z.string(),
      git: z.boolean(),
      path: z.object({
        config: z.string(),
        data: z.string(),
        root: z.string(),
        cwd: z.string(),
        state: z.string(),
      }),
      time: z.object({
        initialized: z.number().optional(),
      }),
    })
    .openapi({
      ref: "App",
    })
  export type Info = z.infer<typeof Info>

  const ctx = Context.create<{
    info: Info
    services: Map<any, { state: any; shutdown?: (input: any) => Promise<void> }>
  }>("app")

  export const use = ctx.use

  const APP_JSON = "app.json"

  export type Input = {
    cwd: string
  }

  export const provideExisting = ctx.provide
  export async function provide<T>(input: Input, cb: (app: App.Info) => Promise<T>) {
    log.info("creating", {
      cwd: input.cwd,
    })
    const git = await Filesystem.findUp(".git", input.cwd).then(([x]) => (x ? path.dirname(x) : undefined))
    log.info("git", { git })

    const data = path.join(Global.Path.data, "project", git ? directory(git) : "global")
    const stateFile = Bun.file(path.join(data, APP_JSON))
    const state = (await stateFile.json().catch(() => ({}))) as {
      initialized: number
    }
    await stateFile.write(JSON.stringify(state))

    const services = new Map<
      any,
      {
        state: any
        shutdown?: (input: any) => Promise<void>
      }
    >()

    const root = git ?? input.cwd

    const info: Info = {
      hostname: os.hostname(),
      time: {
        initialized: state.initialized,
      },
      git: git !== undefined,
      path: {
        config: Global.Path.config,
        state: Global.Path.state,
        data,
        root,
        cwd: input.cwd,
      },
    }
    const app = {
      services,
      info,
    }

    const projects = await Project.list()
    const project = projects
      .toSorted((a, b) => a.worktree.length - b.worktree.length)
      .find((x) => Filesystem.contains(x.worktree, input.cwd))

    if (!project) {
      throw new Error("No project found")
    }

    return ctx.provide(app, async () => {
      return Project.provide(project, async () => {
        const result = await Instance.provide(
          {
            worktree: app.info.path.root,
            directory: app.info.path.cwd,
          },
          async () => {
            try {
              const result = await cb(app.info)
              return result
            } finally {
              for (const [key, entry] of app.services.entries()) {
                if (!entry.shutdown) continue
                log.info("shutdown", { name: key })
                await entry.shutdown?.(await entry.state)
              }
              await Instance.dispose()
            }
          },
        )
        return result
      })
    })
  }

  export function info() {
    return ctx.use().info
  }

  export async function initialize() {
    const { info } = ctx.use()
    info.time.initialized = Date.now()
    await Bun.write(
      path.join(info.path.data, APP_JSON),
      JSON.stringify({
        initialized: Date.now(),
      }),
    )
  }

  function directory(input: string): string {
    return input
      .split(path.sep)
      .filter(Boolean)
      .join("-")
      .replace(/[^A-Za-z0-9_]/g, "-")
  }
}
