import path from "node:path"
import os from "node:os"
import z from "zod"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import { NamedError } from "@unifia/util/error"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"

export namespace ConfigPaths {
  /**
   * Project-level config directory, holding skills, themes, agents, commands
   * and plugins.
   *
   * `.opencode` is the pre-rebrand name and stays readable: renaming without
   * reading the old name would make every existing project's customisations
   * vanish at the first launch. It is deliberately never written to — the same
   * directory belongs to the separately-installed OpenCode this product
   * coexists with, and `installDependencies` was dropping a package.json, a
   * .gitignore and a node_modules tree into it.
   *
   * Order is load-bearing: Filesystem.up emits `targets` in order at each level
   * and callers merge in the order returned, so the current brand comes last to
   * win where both exist — the rule projectFiles() already applies to filenames.
   */
  export const PROJECT_DIRECTORY = ".unifia"
  export const LEGACY_PROJECT_DIRECTORY = ".opencode"
  const PROJECT_DIRECTORIES = [LEGACY_PROJECT_DIRECTORY, PROJECT_DIRECTORY]

  /** A directory config is read from: either brand, or the explicit override. */
  export function isConfigDirectory(dir: string) {
    return PROJECT_DIRECTORIES.some((name) => dir.endsWith(name)) || dir === Flag.UNIFIA_CONFIG_DIR
  }

  /** Read-only by contract — see PROJECT_DIRECTORY. */
  export function isLegacyDirectory(dir: string) {
    return dir.endsWith(LEGACY_PROJECT_DIRECTORY)
  }

  /**
   * Upward-traversal boundary for config discovery. Git projects stop at the
   * worktree root. Non-git projects set worktree === directory (see
   * Project.fromDirectory — the mobile file-ops boundary must stay writable),
   * but config discovery keeps the upstream semantics of walking every
   * ancestor directory, so parent-dir unifia.json files still merge.
   */
  export function searchStop(input: { worktree: string; vcs?: "git" }): string | undefined {
    return input.vcs === "git" ? input.worktree : undefined
  }

  /**
   * Config files for `name`, nearest-last so callers can merge in order.
   *
   * `legacy` names the pre-rebrand basename. It is searched first on purpose:
   * `findUp` emits targets in the order given and the caller merges them in
   * that order, so the current brand has to come last to win where both exist.
   * MIGRATION-PLAN.md 4.2 asks for exactly this — accept `unifia.*` with
   * priority and `opencode.*` as legacy — but only the current name was
   * implemented, so every existing `opencode.json` silently stopped being read.
   */
  export async function projectFiles(name: string, directory: string, stop: string | undefined, legacy?: string) {
    const targets = legacy
      ? [`${legacy}.json`, `${legacy}.jsonc`, `${name}.json`, `${name}.jsonc`]
      : [`${name}.json`, `${name}.jsonc`]
    return Filesystem.findUp(targets, directory, stop, { rootFirst: true })
  }

  export async function directories(directory: string, stop: string | undefined) {
    return [
      Global.Path.config,
      ...(!Flag.UNIFIA_DISABLE_PROJECT_CONFIG
        ? await Array.fromAsync(
            Filesystem.up({
              targets: PROJECT_DIRECTORIES,
              start: directory,
              stop,
            }),
          )
        : []),
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: PROJECT_DIRECTORIES,
          start: Global.Path.home,
          stop: Global.Path.home,
        }),
      )),
      ...(Flag.UNIFIA_CONFIG_DIR ? [Flag.UNIFIA_CONFIG_DIR] : []),
    ]
  }

  export function fileInDirectory(dir: string, name: string) {
    return [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)]
  }

  export const JsonError = NamedError.create(
    "ConfigJsonError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
    }),
  )

  export const InvalidError = NamedError.create(
    "ConfigInvalidError",
    z.object({
      path: z.string(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
      message: z.string().optional(),
    }),
  )

  /** Read a config file, returning undefined for missing files and throwing JsonError for other failures. */
  export async function readFile(filepath: string) {
    return Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return
      throw new JsonError({ path: filepath }, { cause: err })
    })
  }

  type ParseSource = string | { source: string; dir: string }

  function source(input: ParseSource) {
    return typeof input === "string" ? input : input.source
  }

  function dir(input: ParseSource) {
    return typeof input === "string" ? path.dirname(input) : input.dir
  }

  /** Apply {env:VAR} and {file:path} substitutions to config text. */
  async function substitute(text: string, input: ParseSource, missing: "error" | "empty" = "error") {
    text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || ""
    })

    const fileMatches = Array.from(text.matchAll(/\{file:[^}]+\}/g))
    if (!fileMatches.length) return text

    const configDir = dir(input)
    const configSource = source(input)
    let out = ""
    let cursor = 0

    for (const match of fileMatches) {
      const token = match[0]
      const index = match.index!
      out += text.slice(cursor, index)

      const lineStart = text.lastIndexOf("\n", index - 1) + 1
      const prefix = text.slice(lineStart, index).trimStart()
      if (prefix.startsWith("//")) {
        out += token
        cursor = index + token.length
        continue
      }

      let filePath = token.replace(/^\{file:/, "").replace(/\}$/, "")
      if (filePath.startsWith("~/")) {
        filePath = path.join(os.homedir(), filePath.slice(2))
      }

      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)
      const fileContent = (
        await Filesystem.readText(resolvedPath).catch((error: NodeJS.ErrnoException) => {
          if (missing === "empty") return ""

          const errMsg = `bad file reference: "${token}"`
          if (error.code === "ENOENT") {
            throw new InvalidError(
              {
                path: configSource,
                message: errMsg + ` ${resolvedPath} does not exist`,
              },
              { cause: error },
            )
          }
          throw new InvalidError({ path: configSource, message: errMsg }, { cause: error })
        })
      ).trim()

      out += JSON.stringify(fileContent).slice(1, -1)
      cursor = index + token.length
    }

    out += text.slice(cursor)
    return out
  }

  /** Substitute and parse JSONC text, throwing JsonError on syntax errors. */
  export async function parseText(text: string, input: ParseSource, missing: "error" | "empty" = "error") {
    const configSource = source(input)
    text = await substitute(text, input, missing)

    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
        .map((e) => {
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      throw new JsonError({
        path: configSource,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    return data
  }
}
