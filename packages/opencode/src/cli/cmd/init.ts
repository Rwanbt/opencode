import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import * as prompts from "@clack/prompts"
import fs from "fs/promises"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "../../lsp/language"
import { Filesystem } from "../../util/filesystem"

const PROVIDER_PRESETS: Record<string, { env: string; label: string }> = {
  anthropic: { env: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)" },
  openai: { env: "OPENAI_API_KEY", label: "OpenAI (GPT)" },
  google: { env: "GOOGLE_API_KEY", label: "Google (Gemini)" },
  ollama: { env: "", label: "Ollama (Local)" },
  lmstudio: { env: "", label: "LM Studio (Local)" },
}

const LANGUAGE_LSP_MAP: Record<string, string> = {
  typescript: "typescript",
  javascript: "typescript",
  javascriptreact: "typescript",
  typescriptreact: "typescript",
  python: "pyright",
  go: "gopls",
  rust: "rust-analyzer",
  ruby: "rubocop",
  c: "clangd",
  cpp: "clangd",
  csharp: "csharp",
  fsharp: "fsharp",
  java: "jdtls",
  kotlin: "kotlin",
  lua: "lua-language-server",
  zig: "zls",
  elixir: "elixir-ls",
  vue: "vue",
}

async function scanLanguages(dir: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  async function walk(d: string, depth: number) {
    if (depth > 4) return
    let entries: Awaited<ReturnType<typeof fs.readdir>>
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "vendor" || entry.name === "__pycache__" || entry.name === "target" || entry.name === "build" || entry.name === "dist") continue
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
      } else {
        const ext = path.extname(entry.name)
        const lang = LANGUAGE_EXTENSIONS[ext]
        if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
      }
    }
  }

  await walk(dir, 0)
  return counts
}

async function detectLocalRuntime(): Promise<{ type: "ollama" | "lmstudio" | null; url?: string }> {
  // Check Ollama
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) })
    if (res.ok) return { type: "ollama", url: "http://localhost:11434/v1" }
  } catch {}

  // Check LM Studio
  try {
    const res = await fetch("http://localhost:1234/v1/models", { signal: AbortSignal.timeout(2000) })
    if (res.ok) return { type: "lmstudio", url: "http://localhost:1234/v1" }
  } catch {}

  return { type: null }
}

export const InitCommand = cmd({
  command: "init",
  describe: "initialize opencode for the current project",
  builder: (yargs: Argv) =>
    yargs
      .option("yes", {
        alias: "y",
        type: "boolean",
        describe: "skip prompts, use defaults",
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "overwrite existing config",
      }),
  async handler(args) {
    const dir = process.cwd()
    const configDir = path.join(dir, ".opencode")
    const configPath = path.join(configDir, "opencode.jsonc")

    UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "OpenCode Init" + UI.Style.TEXT_NORMAL)
    UI.empty()

    // Check existing config
    if (!args.force && (await Filesystem.exists(configPath))) {
      UI.println(UI.Style.TEXT_WARNING + "Config already exists at .opencode/opencode.jsonc" + UI.Style.TEXT_NORMAL)
      UI.println("Use --force to overwrite.")
      return
    }

    // Step 1: Detect languages
    UI.println(UI.Style.TEXT_DIM + "Scanning project files..." + UI.Style.TEXT_NORMAL)
    const langCounts = await scanLanguages(dir)
    const sorted = [...langCounts.entries()].sort((a, b) => b[1] - a[1])
    const topLangs = sorted.slice(0, 8)

    if (topLangs.length === 0) {
      UI.println(UI.Style.TEXT_WARNING + "No source files detected." + UI.Style.TEXT_NORMAL)
    } else {
      UI.println(UI.Style.TEXT_SUCCESS + "Detected languages:" + UI.Style.TEXT_NORMAL)
      for (const [lang, count] of topLangs) {
        UI.println(`  ${lang}: ${count} files`)
      }
      UI.empty()
    }

    // Step 2: Identify needed LSP servers
    const neededLSPs = new Set<string>()
    for (const [lang] of topLangs) {
      const lsp = LANGUAGE_LSP_MAP[lang]
      if (lsp) neededLSPs.add(lsp)
    }

    if (neededLSPs.size > 0) {
      UI.println(UI.Style.TEXT_INFO + "Recommended LSP servers:" + UI.Style.TEXT_NORMAL)
      for (const lsp of neededLSPs) {
        UI.println(`  - ${lsp}`)
      }
      UI.empty()
    }

    // Step 3: Provider selection
    let providerChoice = "anthropic"
    let localUrl = ""

    if (!args.yes) {
      const choice = await prompts.select({
        message: "Choose your AI provider",
        options: [
          { value: "anthropic", label: "Anthropic (Claude) — recommended" },
          { value: "openai", label: "OpenAI (GPT)" },
          { value: "google", label: "Google (Gemini)" },
          { value: "local", label: "Local model (Ollama / LM Studio)" },
        ],
      })

      if (prompts.isCancel(choice)) {
        UI.println(UI.Style.TEXT_DIM + "Cancelled." + UI.Style.TEXT_NORMAL)
        return
      }
      providerChoice = choice as string
    }

    // Step 4: Local model detection
    if (providerChoice === "local") {
      UI.println(UI.Style.TEXT_DIM + "Detecting local model runtime..." + UI.Style.TEXT_NORMAL)
      const runtime = await detectLocalRuntime()
      if (runtime.type) {
        UI.println(UI.Style.TEXT_SUCCESS + `Found ${runtime.type} at ${runtime.url}` + UI.Style.TEXT_NORMAL)
        providerChoice = runtime.type
        localUrl = runtime.url!
      } else {
        UI.println(UI.Style.TEXT_WARNING + "No local runtime detected." + UI.Style.TEXT_NORMAL)
        UI.println("Install Ollama: https://ollama.com/download")
        UI.println("Or run: opencode models pull <model>")
        UI.empty()
        providerChoice = "ollama"
        localUrl = "http://localhost:11434/v1"
      }
    }

    // Step 5: Generate config
    const config: Record<string, unknown> = {}

    if (providerChoice === "ollama" || providerChoice === "lmstudio") {
      config.provider = {
        [providerChoice]: {
          name: providerChoice === "ollama" ? "Ollama" : "LM Studio",
          models: {},
          options: {
            baseURL: localUrl || (providerChoice === "ollama" ? "http://localhost:11434/v1" : "http://localhost:1234/v1"),
            apiKey: providerChoice,
          },
        },
      }
    } else {
      const preset = PROVIDER_PRESETS[providerChoice]
      if (preset?.env) {
        config["$schema"] = "https://opencode.ai/config.json"
      }
    }

    // Add LSP config comments
    if (neededLSPs.size > 0) {
      // LSP servers are auto-detected, no explicit config needed
      // But we note it in comments
    }

    // Write config
    const jsonContent = [
      "{",
      `  // OpenCode configuration`,
      `  // Generated by \`opencode init\` on ${new Date().toISOString().split("T")[0]}`,
      `  // Docs: https://opencode.ai/docs/configuration`,
      "",
    ]

    if (config.provider) {
      jsonContent.push(`  "provider": ${JSON.stringify(config.provider, null, 4).split("\n").map((l, i) => i === 0 ? l : "  " + l).join("\n")},`)
    }

    jsonContent.push("")
    jsonContent.push(`  // Experimental features`)
    jsonContent.push(`  // "experimental": {`)
    jsonContent.push(`  //   "rag": { "enabled": true },`)
    jsonContent.push(`  //   "lsp_memory": { "max_concurrent": 3, "idle_timeout_minutes": 10 }`)
    jsonContent.push(`  // }`)
    jsonContent.push("}")

    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(configPath, jsonContent.join(EOL), "utf-8")

    UI.empty()
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Config written to .opencode/opencode.jsonc" + UI.Style.TEXT_NORMAL)
    UI.empty()

    if (providerChoice !== "ollama" && providerChoice !== "lmstudio") {
      const preset = PROVIDER_PRESETS[providerChoice]
      if (preset?.env) {
        UI.println(`Set your API key: export ${preset.env}=sk-...`)
      }
    } else {
      UI.println("Start your local runtime and pull a model:")
      UI.println(`  opencode models pull llama3.1`)
    }

    UI.println("")
    UI.println("Run " + UI.Style.TEXT_HIGHLIGHT + "opencode doctor" + UI.Style.TEXT_NORMAL + " to verify your setup.")
    UI.println("Run " + UI.Style.TEXT_HIGHLIGHT + "opencode" + UI.Style.TEXT_NORMAL + " to start coding.")
  },
})
