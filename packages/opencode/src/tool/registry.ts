import { PlanExitTool } from "./plan"
import { QuestionTool } from "./question"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { ProviderID, type ModelID } from "../provider/schema"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { TeamTool } from "./team"
import { Glob } from "../util/glob"
import { pathToFileURL } from "url"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Env } from "../env"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import { Instruction } from "../session/instruction"
import { AppFileSystem } from "../filesystem"

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })

  type State = {
    custom: Tool.Info[]
  }

  export interface Interface {
    readonly ids: () => Effect.Effect<string[]>
    readonly named: {
      task: Tool.Info
      read: Tool.Info
    }
    readonly tools: (
      model: { providerID: ProviderID; modelID: ModelID },
      agent?: Agent.Info,
    ) => Effect.Effect<(Tool.Def & { id: string })[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/ToolRegistry") {}

  export const layer: Layer.Layer<
    Service,
    never,
    | Config.Service
    | Plugin.Service
    | Question.Service
    | Todo.Service
    | LSP.Service
    | FileTime.Service
    | Instruction.Service
    | AppFileSystem.Service
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const plugin = yield* Plugin.Service

      const build = <T extends Tool.Info>(tool: T | Effect.Effect<T, never, any>) =>
        Effect.isEffect(tool) ? tool : Effect.succeed(tool)

      const state = yield* InstanceState.make<State>(
        Effect.fn("ToolRegistry.state")(function* (ctx) {
          const custom: Tool.Info[] = []

          function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
            return {
              id,
              init: async (initCtx) => ({
                parameters: z.object(def.args),
                description: def.description,
                execute: async (args, toolCtx) => {
                  const pluginCtx = {
                    ...toolCtx,
                    directory: ctx.directory,
                    worktree: ctx.worktree,
                  } as unknown as PluginToolContext
                  const result = await def.execute(args as any, pluginCtx)
                  const out = await Truncate.output(result, {}, initCtx?.agent)
                  return {
                    title: "",
                    output: out.truncated ? out.content : result,
                    metadata: { truncated: out.truncated, outputPath: out.truncated ? out.outputPath : undefined },
                  }
                },
              }),
            }
          }

          const dirs = yield* config.directories()
          const matches = dirs.flatMap((dir) =>
            Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
          )
          if (matches.length) yield* config.waitForDependencies()
          for (const match of matches) {
            const namespace = path.basename(match, path.extname(match))
            const mod = yield* Effect.promise(
              () => import(process.platform === "win32" ? match : pathToFileURL(match).href),
            )
            for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
              custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
            }
          }

          const plugins = yield* plugin.list()
          for (const p of plugins) {
            for (const [id, def] of Object.entries(p.tool ?? {})) {
              custom.push(fromPlugin(id, def))
            }
          }

          return { custom }
        }),
      )

      const invalid = yield* build(InvalidTool)
      const ask = yield* build(QuestionTool)
      const bash = yield* build(BashTool)
      const read = yield* build(ReadTool)
      const glob = yield* build(GlobTool)
      const grep = yield* build(GrepTool)
      const edit = yield* build(EditTool)
      const write = yield* build(WriteTool)
      const task = yield* build(TaskTool)
      const team = yield* build(TeamTool)
      const fetch = yield* build(WebFetchTool)
      const todo = yield* build(TodoWriteTool)
      const search = yield* build(WebSearchTool)
      const code = yield* build(CodeSearchTool)
      const skill = yield* build(SkillTool)
      const patch = yield* build(ApplyPatchTool)
      const lsp = yield* build(LspTool)
      const batch = yield* build(BatchTool)
      const plan = yield* build(PlanExitTool)

      const all = Effect.fn("ToolRegistry.all")(function* (custom: Tool.Info[]) {
        const cfg = yield* config.get()
        const question = ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL

        return [
          invalid,
          ...(question ? [ask] : []),
          bash,
          read,
          glob,
          grep,
          edit,
          write,
          task,
          team,
          fetch,
          todo,
          search,
          code,
          skill,
          patch,
          ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [lsp] : []),
          ...(cfg.experimental?.batch_tool === true ? [batch] : []),
          ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE && Flag.OPENCODE_CLIENT === "cli" ? [plan] : []),
          ...custom,
        ]
      })

      const ids = Effect.fn("ToolRegistry.ids")(function* () {
        const s = yield* InstanceState.get(state)
        const tools = yield* all(s.custom)
        return tools.map((t) => t.id)
      })

      const tools = Effect.fn("ToolRegistry.tools")(function* (
        model: { providerID: ProviderID; modelID: ModelID },
        agent?: Agent.Info,
      ) {
        const s = yield* InstanceState.get(state)
        const allTools = yield* all(s.custom)
        // Local-llm: minimal tool set with skeleton descriptions (saves ~12K tokens)
        const LOCAL_TOOLS = new Set(["bash", "read", "edit", "write", "glob", "grep", "question"])
        const LOCAL_SKELETONS: Record<string, string> = {
          bash: "Execute shell command. Args: {command: string}. Returns stdout.",
          read: "Read file content. Args: {file_path: string, offset?: number, limit?: number}. Returns file text.",
          edit: "Replace exact text in file. Args: {file_path: string, old_string: string, new_string: string}. old_string must be copied EXACTLY from file (whitespace matters). Read file first.",
          write: "Create or overwrite file. Args: {file_path: string, content: string}. Use edit for partial changes.",
          glob: "Find files by glob pattern. Args: {pattern: string, path?: string}. Returns matching paths.",
          grep: "Search file contents with regex. Args: {pattern: string, path?: string}. Returns matching lines.",
          question: "Ask user a question. Args: {question: string}. Use when you need clarification.",
        }
        const isLocal = model.providerID === ("local-llm" as ProviderID)

        const filtered = allTools.filter((tool) => {
          // Local-llm: only essential tools
          if (isLocal) return LOCAL_TOOLS.has(tool.id)

          if (tool.id === "codesearch" || tool.id === "websearch") {
            return model.providerID === ProviderID.opencode || Flag.OPENCODE_ENABLE_EXA
          }

          const usePatch =
            !!Env.get("OPENCODE_E2E_LLM_URL") ||
            (model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4"))
          if (tool.id === "apply_patch") return usePatch
          if (tool.id === "edit" || tool.id === "write") return !usePatch

          return true
        })
        return yield* Effect.forEach(
          filtered,
          Effect.fnUntraced(function* (tool: Tool.Info) {
            using _ = log.time(tool.id)
            const next = yield* Effect.promise(() => tool.init({ agent }))
            // For local-llm: use skeleton descriptions instead of full prose
            const description = isLocal
              ? (LOCAL_SKELETONS[tool.id] ?? next.description.split("\n")[0].slice(0, 100))
              : next.description
            const output = {
              description,
              parameters: next.parameters,
            }
            yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
            return {
              id: tool.id,
              description: output.description,
              parameters: output.parameters,
              execute: next.execute,
              formatValidationError: next.formatValidationError,
            }
          }),
          { concurrency: "unbounded" },
        )
      })

      return Service.of({ ids, named: { task, read }, tools })
    }),
  )

  export const defaultLayer = Layer.unwrap(
    Effect.sync(() =>
      layer.pipe(
        Layer.provide(Config.defaultLayer),
        Layer.provide(Plugin.defaultLayer),
        Layer.provide(Question.defaultLayer),
        Layer.provide(Todo.defaultLayer),
        Layer.provide(LSP.defaultLayer),
        Layer.provide(FileTime.defaultLayer),
        Layer.provide(Instruction.defaultLayer),
        Layer.provide(AppFileSystem.defaultLayer),
      ),
    ),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function ids() {
    return runPromise((svc) => svc.ids())
  }

  export async function tools(
    model: {
      providerID: ProviderID
      modelID: ModelID
    },
    agent?: Agent.Info,
  ): Promise<(Tool.Def & { id: string })[]> {
    return runPromise((svc) => svc.tools(model, agent))
  }
}
