import { Ripgrep } from "../file/ripgrep"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"
import path from "path"
import os from "os"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"
import PROMPT_SUMMARIZE from "./prompt/summarize.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import { Project } from "../project/project"
import { Instance } from "../project/instance"

export namespace SystemPrompt {
  export function header(providerID: string) {
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }
  export function provider(modelID: string) {
    if (modelID.includes("gpt-") || modelID.includes("o1") || modelID.includes("o3")) return [PROMPT_BEAST]
    if (modelID.includes("gemini-")) return [PROMPT_GEMINI]
    if (modelID.includes("claude")) return [PROMPT_ANTHROPIC]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  export async function environment() {
    const project = Project.use()
    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<project>`,
        `  ${
          project.vcs === "git"
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 200,
              })
            : ""
        }`,
        `</project>`,
      ].join("\n"),
    ]
  }

  const CUSTOM_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    "CONTEXT.md", // deprecated
  ]

  export async function custom() {
    const config = await Config.get()
    const paths = new Set<string>()

    for (const item of CUSTOM_FILES) {
      const matches = await Filesystem.findUp(item, Instance.directory, Instance.worktree)
      matches.forEach((path) => paths.add(path))
    }

    paths.add(path.join(Global.Path.config, "AGENTS.md"))
    paths.add(path.join(os.homedir(), ".claude", "CLAUDE.md"))

    if (config.instructions) {
      for (const instruction of config.instructions) {
        const matches = await Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
        matches.forEach((path) => paths.add(path))
      }
    }

    const found = Array.from(paths).map((p) =>
      Bun.file(p)
        .text()
        .catch(() => ""),
    )
    return Promise.all(found).then((result) => result.filter(Boolean))
  }

  export function summarize(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_SUMMARIZE]
      default:
        return [PROMPT_SUMMARIZE]
    }
  }

  export function title(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_TITLE]
      default:
        return [PROMPT_TITLE]
    }
  }
}
