<!-- SPDX-License-Identifier: MIT -->

# @unifia/plugin

Types and helpers for writing [Unifia](https://github.com/Rwanbt/unifia) plugins and
custom tools.

A plugin is a module Unifia loads at startup. It receives a typed SDK client and
returns a set of lifecycle hooks; a custom tool is a description, an argument
schema and an `execute` function that the agent can call.

## Install

```bash
npm install @unifia/plugin
```

Unifia also injects this package into the `package.json` of every config
directory it manages, pinned to the running CLI version — so a tool authored
there is already typed without an explicit install.

## A custom tool

```ts
import { tool } from "@unifia/plugin"

export default tool({
  description: "Count the lines of a file",
  args: {
    path: tool.schema.string().describe("Path to the file, relative to the project"),
  },
  async execute(args, context) {
    const file = Bun.file(`${context.directory}/${args.path}`)
    const text = await file.text()
    return `${text.split("\n").length} lines`
  },
})
```

`tool.schema` is the bundled [Zod](https://zod.dev) instance — use it rather than
your own, so the argument schema matches the one the agent is shown.

## A plugin

```ts
import type { Plugin } from "@unifia/plugin"

export const Notify: Plugin = async ({ worktree, $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await $`notify-send "Unifia" "Session finished in ${worktree}"`
      }
    },
  }
}
```

## Entry points

| Import | Contents |
| --- | --- |
| `@unifia/plugin` | `Plugin`, `PluginInput`, `Hooks`, `Config`, and everything from `./tool` |
| `@unifia/plugin/tool` | `tool()`, `ToolContext`, `ToolDefinition` |
| `@unifia/plugin/tui` | Types for extending the terminal UI |

`@unifia/plugin/tui` needs `@opentui/core` and `@opentui/solid`. They are declared
as optional peer dependencies: install them only if you extend the TUI.

The declarations for `$` (the shell handed to a plugin) refer to `Buffer` and
`BufferEncoding`, so a project typechecking with `skipLibCheck: false` needs
`@types/node` — also an optional peer dependency, and already present in any Bun
or Node project.

## License

MIT
