import { createEffect, createMemo, For, Match, Show, Switch, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useRouteData } from "./context/route"
import { useSync } from "./context/sync"
import { SplitBorder } from "./component/border"
import { Theme } from "./context/theme"
import { hastToStyledText, RGBA, ScrollBoxRenderable, SyntaxStyle } from "@opentui/core"
import { Prompt } from "./component/prompt"
import type { AssistantMessage, Part, ToolPart, UserMessage } from "@opencode-ai/sdk"
import type { TextPart } from "ai"
import { useLocal } from "./context/local"
import { Locale } from "../../../util/locale"
import type { Tool } from "../../../tool/tool"
import { highlightHast, Language } from "tree-sitter-highlight"
import type { ReadTool } from "../../../tool/read"
import type { WriteTool } from "../../../tool/write"
import { BashTool } from "../../../tool/bash"
import type { GlobTool } from "../../../tool/glob"
import { Instance } from "../../../project/instance"
import { TodoWriteTool } from "../../../tool/todo"
import type { GrepTool } from "../../../tool/grep"
import type { ListTool } from "../../../tool/ls"
import type { EditTool } from "../../../tool/edit"
import type { PatchTool } from "../../../tool/patch"
import type { WebFetchTool } from "../../../tool/webfetch"
import type { TaskTool } from "../../../tool/task"
import { useKeyboard, type JSX } from "@opentui/solid"

export function Session() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[route.sessionID] ?? [])
  let scroll: ScrollBoxRenderable

  createEffect(() => sync.session.sync(route.sessionID))

  useKeyboard((evt) => {
    if (evt.name === "pageup") scroll.scrollBy(-scroll.height)
    if (evt.name === "pagedown") scroll.scrollBy(scroll.height)
  })

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexGrow={1} maxHeight="100%">
      <Show when={session()}>
        <box paddingLeft={1} paddingRight={1} {...SplitBorder} borderColor={Theme.backgroundElement}>
          <text>
            <span style={{ bold: true, fg: Theme.accent }}>#</span>{" "}
            <span style={{ bold: true }}>{session().title}</span>
          </text>
          <box flexDirection="row">
            <Switch>
              <Match when={session().share?.url}>
                <text fg={Theme.textMuted}>{session().share!.url}</text>
              </Match>
              <Match when={true}>
                <text>
                  /share <span style={{ fg: Theme.textMuted }}>to create a shareable link</span>
                </text>
              </Match>
            </Switch>
          </box>
        </box>
        <scrollbox
          ref={(r: any) => (scroll = r)}
          scrollbarOptions={{ visible: false }}
          stickyScroll={true}
          stickyStart="bottom"
          paddingTop={1}
          paddingBottom={1}
          contentOptions={{
            gap: 1,
          }}
        >
          <For each={messages()}>
            {(message) => (
              <Switch>
                <Match when={message.role === "user"}>
                  <UserMessage message={message as UserMessage} parts={sync.data.part[message.id] ?? []} />
                </Match>
                <Match when={message.role === "assistant"}>
                  <AssistantMessage message={message as AssistantMessage} parts={sync.data.part[message.id] ?? []} />
                </Match>
              </Switch>
            )}
          </For>
        </scrollbox>
        <Show when={todo().length > 0}>
          <box paddingBottom={1}>
            <For each={todo()}>
              {(todo) => (
                <text style={{ fg: todo.status === "in_progress" ? Theme.success : Theme.textMuted }}>
                  [{todo.status === "completed" ? "✓" : " "}] {todo.content}
                </text>
              )}
            </For>
          </box>
        </Show>
        <box flexShrink={0}>
          <Prompt sessionID={route.sessionID} />
        </box>
      </Show>
    </box>
  )
}

function UserMessage(props: { message: UserMessage; parts: Part[] }) {
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const sync = useSync()
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      backgroundColor={Theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={Theme.secondary}
    >
      <text>{text()?.text}</text>
      <text>
        {sync.data.config.username ?? "You"}{" "}
        <span style={{ fg: Theme.textMuted }}>({Locale.time(props.message.time.created)})</span>
      </text>
    </box>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[] }) {
  return (
    <For each={props.parts}>
      {(part) => {
        const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
        return (
          <Show when={component()}>
            <Dynamic component={component()} part={part as any} message={props.message} />
          </Show>
        )
      }}
    </For>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
}

function TextPart(props: { part: TextPart; message: AssistantMessage }) {
  const sync = useSync()
  const agent = createMemo(() => sync.data.agent.find((x) => x.name === props.message.mode)!)
  const local = useLocal()

  return (
    <box paddingLeft={3}>
      <text>{props.part.text.trim()}</text>
      <text>
        <span style={{ fg: local.agent.color(agent().name) }}>{Locale.titlecase(agent().name)}</span>{" "}
        <span style={{ fg: Theme.textMuted }}>{props.message.providerID + "/" + props.message.modelID}</span>
      </text>
    </box>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { part: ToolPart; message: AssistantMessage }) {
  const component = createMemo(() => {
    const ready = ToolRegistry.ready(props.part.tool)
    if (!ready) return

    const metadata = props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    const input = props.part.state.input

    return (
      <Dynamic
        component={ready}
        input={input}
        metadata={metadata}
        output={props.part.state.status === "completed" ? props.part.state.output : undefined}
      />
    )
  })

  return (
    <Show when={component()}>
      <box paddingLeft={3}>{component()}</box>
    </Show>
  )
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  output?: string
}

const ToolRegistry = (() => {
  const state: Record<string, { name: string; ready?: Component<ToolProps<any>> }> = {}
  function register<T extends Tool.Info>(input: { name: string; ready?: Component<ToolProps<T>> }) {
    state[input.name] = input
    return input
  }
  return {
    register,
    ready(name: string) {
      return state[name]?.ready
    },
  }
})()

function ToolTitle(props: { fallback: string; when: any; icon: string; children: JSX.Element }) {
  return (
    <text fg={props.when ? Theme.textMuted : Theme.text}>
      <Show fallback={<>~ {props.fallback}</>} when={props.when}>
        <span style={{ bold: true }}>{props.icon}</span> {props.children}
      </Show>
    </text>
  )
}

ToolRegistry.register<typeof BashTool>({
  name: "bash",
  ready(props) {
    return (
      <>
        <ToolTitle icon="#" fallback="Writing command..." when={props.input.command}>
          {props.input.description}
        </ToolTitle>
        <Show when={props.input.command}>
          <box>
            <text fg={Theme.textMuted}>$ {props.input.command}</text>
            <box>
              <text fg={Theme.textMuted}>{props.output?.trim()}</text>
            </box>
          </box>
        </Show>
      </>
    )
  },
})

const syntax = new SyntaxStyle({
  keyword: { fg: RGBA.fromHex(Theme.syntaxKeyword), bold: true },
  string: { fg: RGBA.fromHex(Theme.syntaxString) },
  comment: { fg: RGBA.fromHex(Theme.syntaxComment), italic: true },
  number: { fg: RGBA.fromHex(Theme.syntaxNumber) },
  function: { fg: RGBA.fromHex(Theme.syntaxFunction) },
  type: { fg: RGBA.fromHex(Theme.syntaxType) },
  operator: { fg: RGBA.fromHex(Theme.syntaxOperator) },
  variable: { fg: RGBA.fromHex(Theme.syntaxVariable) },
  bracket: { fg: RGBA.fromHex(Theme.syntaxPunctuation) },
  punctuation: { fg: RGBA.fromHex(Theme.syntaxPunctuation) },
  default: { fg: RGBA.fromHex(Theme.syntaxVariable) },
})

ToolRegistry.register<typeof ReadTool>({
  name: "read",
  ready(props) {
    return (
      <>
        <ToolTitle icon="→" fallback="Reading file..." when={props.input.filePath}>
          Read {normalizePath(props.input.filePath!)}
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof WriteTool>({
  name: "write",
  ready(props) {
    const lines = createMemo(() => {
      return props.input.content?.split("\n") ?? []
    })
    const code = createMemo(() => {
      if (!props.input.content) return ""
      const text = props.input.content
      const hast = highlightHast(text, Language.TS)
      const styled = hastToStyledText(hast as any, syntax)
      return styled
    })

    const numbers = createMemo(() => {
      const pad = lines().length.toString().length
      return lines()
        .map((_, index) => index + 1)
        .map((x) => x.toString().padStart(pad, " "))
    })

    return (
      <box gap={1}>
        <ToolTitle icon="←" fallback="Preparing write..." when={props.input.filePath}>
          Wrote {props.input.filePath}
        </ToolTitle>
        <box flexDirection="row">
          <box>
            <For each={numbers()}>{(value) => <text style={{ fg: Theme.textMuted }}>{value}</text>}</For>
          </box>
          <box paddingLeft={1}>
            <text>{code()}</text>
          </box>
        </box>
      </box>
    )
  },
})

ToolRegistry.register<typeof GlobTool>({
  name: "glob",
  ready(props) {
    return (
      <>
        <ToolTitle icon="✱" fallback="Finding files..." when={props.input.pattern}>
          Glob "{props.input.pattern}" <Show when={props.metadata.count}>({props.metadata.count} matches)</Show>
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof GrepTool>({
  name: "grep",
  ready(props) {
    return (
      <>
        <ToolTitle icon="%" fallback="Searching content..." when={props.input.pattern}>
          Grep "{props.input.pattern}" <Show when={props.metadata.matches}>({props.metadata.matches} matches)</Show>
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof ListTool>({
  name: "list",
  ready(props) {
    const dir = createMemo(() => {
      if (props.input.path) {
        return normalizePath(props.input.path)
      }
      return ""
    })
    return (
      <>
        <ToolTitle icon="→" fallback="Listing directory..." when={props.input.path !== undefined}>
          List {dir()}
        </ToolTitle>
      </>
    )
  },
})

ToolRegistry.register<typeof TaskTool>({
  name: "task",
  ready(props) {
    return (
      <>
        <ToolTitle icon="%" fallback="Delegating..." when={props.input.description}>
          Task {props.input.description}
        </ToolTitle>
        <Show when={props.metadata.summary?.length}>
          <box>
            <For each={props.metadata.summary ?? []}>
              {(task) => (
                <text style={{ fg: Theme.textMuted }}>
                  ∟ {task.tool} {task.state.status === "completed" ? task.state.title : ""}
                </text>
              )}
            </For>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof WebFetchTool>({
  name: "webfetch",
  ready(props) {
    return (
      <>
        <ToolTitle icon="%" fallback="Fetching from the web..." when={(props.input as any).url}>
          WebFetch {(props.input as any).url}
        </ToolTitle>
        <Show when={props.output}>
          <box>
            <text>{props.output?.trim()}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof EditTool>({
  name: "edit",
  ready(props) {
    const code = createMemo(() => {
      if (!props.metadata.diff) return "[no diff]"
      const text = props.metadata.diff.split("\n").slice(5).join("\n")
      const hast = highlightHast(text, Language.TS)
      const styled = hastToStyledText(hast as any, syntax)
      return styled
    })
    return (
      <box gap={1}>
        <ToolTitle icon="←" fallback="Preparing edit..." when={props.input.filePath}>
          Edit {normalizePath(props.input.filePath!)}
        </ToolTitle>
        <box>
          <text>{code()}</text>
        </box>
      </box>
    )
  },
})

ToolRegistry.register<typeof PatchTool>({
  name: "patch",
  ready(props) {
    return (
      <>
        <ToolTitle icon="%" fallback="Preparing patch..." when={true}>
          Patch
        </ToolTitle>
        <Show when={props.output}>
          <box>
            <text>{props.output?.trim()}</text>
          </box>
        </Show>
      </>
    )
  },
})

ToolRegistry.register<typeof TodoWriteTool>({
  name: "todowrite",
  ready() {
    return (
      <>
        <ToolTitle icon="%" fallback="Planning..." when={true}>
          TodoWrite
        </ToolTitle>
      </>
    )
  },
})

function normalizePath(input: string) {
  if (path.isAbsolute(input)) {
    return path.relative(Instance.directory, input) || "."
  }
  return input
}
