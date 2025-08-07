import { z } from "zod"
import { Tool } from "./tool"
import path from "path"
import { LSP } from "../lsp"
import DESCRIPTION from "./lsp-hover.txt"
import { Paths } from "../project/path"

export const LspHoverTool = Tool.define("lsp_hover", {
  description: DESCRIPTION,
  parameters: z.object({
    file: z.string().describe("The path to the file to get diagnostics."),
    line: z.number().describe("The line number to get diagnostics."),
    character: z.number().describe("The character number to get diagnostics."),
  }),
  execute: async (args) => {
    const file = path.isAbsolute(args.file) ? args.file : path.join(Paths.directory, args.file)
    await LSP.touchFile(file, true)
    const result = await LSP.hover({
      ...args,
      file,
    })

    return {
      title: path.relative(Paths.worktree, file) + ":" + args.line + ":" + args.character,
      metadata: {
        result,
      },
      output: JSON.stringify(result, null, 2),
    }
  },
})
