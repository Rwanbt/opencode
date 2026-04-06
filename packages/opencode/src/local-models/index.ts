import { Log } from "../util/log"
import { Ollama } from "./ollama"
import { Filesystem } from "../util/filesystem"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "local-models" })

export namespace LocalModels {
  export type Runtime = "ollama" | "lmstudio" | "vllm"

  export async function detectRuntime(): Promise<{ type: Runtime; url: string } | null> {
    // Check Ollama (port 11434)
    try {
      const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) })
      if (res.ok) return { type: "ollama", url: "http://localhost:11434" }
    } catch {}

    // Check LM Studio (port 1234)
    try {
      const res = await fetch("http://localhost:1234/v1/models", { signal: AbortSignal.timeout(2000) })
      if (res.ok) return { type: "lmstudio", url: "http://localhost:1234" }
    } catch {}

    // Check vLLM (port 8000)
    try {
      const res = await fetch("http://localhost:8000/v1/models", { signal: AbortSignal.timeout(2000) })
      if (res.ok) return { type: "vllm", url: "http://localhost:8000" }
    } catch {}

    return null
  }

  export async function installOllama(): Promise<boolean> {
    const platform = process.platform
    log.info("installing ollama", { platform })

    try {
      if (platform === "darwin") {
        const proc = Bun.spawn(["brew", "install", "ollama"], { stdout: "inherit", stderr: "inherit" })
        return (await proc.exited) === 0
      }

      if (platform === "linux") {
        const proc = Bun.spawn(["bash", "-c", "curl -fsSL https://ollama.com/install.sh | sh"], {
          stdout: "inherit",
          stderr: "inherit",
        })
        return (await proc.exited) === 0
      }

      if (platform === "win32") {
        const proc = Bun.spawn(["winget", "install", "Ollama.Ollama", "--accept-package-agreements"], {
          stdout: "inherit",
          stderr: "inherit",
        })
        return (await proc.exited) === 0
      }

      log.warn("unsupported platform for auto-install", { platform })
      return false
    } catch (err) {
      log.error("failed to install ollama", { error: err })
      return false
    }
  }

  export async function configureModel(
    modelName: string,
    opts: { baseUrl?: string; configDir?: string } = {},
  ): Promise<string> {
    const dir = opts.configDir ?? path.join(process.cwd(), ".opencode")
    const configPath = path.join(dir, "opencode.jsonc")
    const baseUrl = (opts.baseUrl ?? "http://localhost:11434") + "/v1"

    await fs.mkdir(dir, { recursive: true })

    let content: string
    if (await Filesystem.exists(configPath)) {
      content = await fs.readFile(configPath, "utf-8")
    } else {
      content = "{}"
    }

    // Parse JSONC (strip comments)
    const cleaned = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    let config: Record<string, any>
    try {
      config = JSON.parse(cleaned)
    } catch {
      config = {}
    }

    // Ensure provider.ollama section exists
    if (!config.provider) config.provider = {}
    if (!config.provider.ollama) {
      config.provider.ollama = {
        name: "Ollama",
        models: {},
        options: {
          baseURL: baseUrl,
          apiKey: "ollama",
        },
      }
    }

    // Add model
    config.provider.ollama.models[modelName] = {
      name: modelName,
    }

    // If no default model set, set this one
    if (!config.model) {
      config.model = `ollama/${modelName}`
    }

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8")
    log.info("configured model", { model: modelName, config: configPath })

    return configPath
  }
}
