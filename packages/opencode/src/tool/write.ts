import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { trimDiff } from "./edit"
import { assertExternalDirectory } from "./external-directory"
import * as SecurityScanner from "../security/scanner"
import { FileLock } from "../file/lock"

const MAX_DIAGNOSTICS_PER_FILE = 20
const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("The content to write to the file"),
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
    dry_run: z.boolean().optional().describe("Preview the write operation without modifying the file"),
  }),
  async execute(params, ctx) {
    const filepath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    await assertExternalDirectory(ctx, filepath)

    const exists = await Filesystem.exists(filepath)
    // Guard: local-llm must use edit for existing files
    if (exists && ctx.extra?.model?.providerID === "local-llm") {
      throw new Error("File already exists. Use edit instead of write.")
    }
    const contentOld = exists ? await Filesystem.readText(filepath) : ""
    if (exists) await FileTime.assert(ctx.sessionID, filepath)

    const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, params.content))

    // Dry-run mode: return diff without writing
    if (params.dry_run) {
      const action = exists ? "Overwrite existing file" : "Create new file"
      const lines = params.content.split("\n").length
      const output = `## Dry Run Preview (write)\n\n**File**: ${filepath}\n**Action**: ${action} (${lines} lines)\n\n\`\`\`diff\n${diff}\n\`\`\``
      return {
        title: `[dry-run] Write ${path.basename(filepath)}`,
        metadata: {
          diagnostics: {} as Record<string, any>,
          filepath,
          exists,
        },
        output,
      }
    }

    await ctx.ask({
      permission: "edit",
      patterns: [path.relative(Instance.worktree, filepath)],
      always: ["*"],
      metadata: {
        filepath,
        diff,
      },
    })

    await Filesystem.write(filepath, params.content)
    await Format.file(filepath)
    Bus.publish(File.Event.Edited, { file: filepath })
    await Bus.publish(FileWatcher.Event.Updated, {
      file: filepath,
      event: exists ? "change" : "add",
    })
    await FileTime.read(ctx.sessionID, filepath)

    let output = "Wrote file successfully."
    await LSP.touchFile(filepath, true)
    const diagnostics = await LSP.diagnostics()
    const normalizedFilepath = Filesystem.normalizePath(filepath)
    let projectDiagnosticsCount = 0
    for (const [file, issues] of Object.entries(diagnostics)) {
      const errors = issues.filter((item) => item.severity === 1)
      if (errors.length === 0) continue
      const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE)
      const suffix =
        errors.length > MAX_DIAGNOSTICS_PER_FILE ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more` : ""
      if (file === normalizedFilepath) {
        output += `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${filepath}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
        continue
      }
      if (projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
      projectDiagnosticsCount++
      output += `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${limited.map(LSP.Diagnostic.pretty).join("\n")}${suffix}\n</diagnostics>`
    }

    // File lock conflict check (collaborative mode)
    const lockConflict = FileLock.check(filepath)
    if (lockConflict) {
      output += `\n<file-lock-conflict>\nFile is being edited by ${lockConflict.heldBy.username} (session: ${lockConflict.heldBy.sessionID}). Changes saved but may conflict.\n</file-lock-conflict>\n`
    }

    // Security scan on written content
    const secFindings = SecurityScanner.scan(params.content, filepath)
    if (secFindings.length > 0) {
      output += SecurityScanner.formatFindings(secFindings, filepath)
    }

    return {
      title: path.relative(Instance.worktree, filepath),
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
      },
      output,
    }
  },
})
