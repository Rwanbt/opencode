import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import os from "os"
import fs from "fs/promises"
import path from "path"
import { Process } from "../../util/process"
import { Filesystem } from "../../util/filesystem"
import { LANGUAGE_EXTENSIONS } from "../../lsp/language"

const CHECK = UI.Style.TEXT_SUCCESS + "  [PASS]" + UI.Style.TEXT_NORMAL
const FAIL = UI.Style.TEXT_DANGER + "  [FAIL]" + UI.Style.TEXT_NORMAL
const WARN = UI.Style.TEXT_WARNING + "  [WARN]" + UI.Style.TEXT_NORMAL
const INFO = UI.Style.TEXT_INFO + "  [INFO]" + UI.Style.TEXT_NORMAL

const KNOWN_LSPS: Record<string, { binary: string; label: string; extensions: string[] }> = {
  typescript: { binary: "typescript-language-server", label: "TypeScript", extensions: [".ts", ".tsx", ".js", ".jsx"] },
  gopls: { binary: "gopls", label: "Go", extensions: [".go"] },
  "rust-analyzer": { binary: "rust-analyzer", label: "Rust", extensions: [".rs"] },
  pyright: { binary: "pyright", label: "Python (pyright)", extensions: [".py"] },
  clangd: { binary: "clangd", label: "C/C++", extensions: [".c", ".cpp", ".cxx", ".h", ".hpp"] },
  rubocop: { binary: "rubocop", label: "Ruby", extensions: [".rb"] },
  zls: { binary: "zls", label: "Zig", extensions: [".zig"] },
  "lua-language-server": { binary: "lua-language-server", label: "Lua", extensions: [".lua"] },
}

async function which(binary: string): Promise<boolean> {
  try {
    const cmd = process.platform === "win32" ? ["where", binary] : ["which", binary]
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
    const code = await proc.exited
    return code === 0
  } catch {
    return false
  }
}

async function checkBunVersion(): Promise<void> {
  try {
    const proc = Bun.spawn(["bun", "--version"], { stdout: "pipe", stderr: "pipe" })
    const text = await new Response(proc.stdout).text()
    const version = text.trim()
    const [major, minor] = version.split(".").map(Number)
    if (major >= 1 && minor >= 3) {
      UI.println(CHECK + `  Bun ${version}`)
    } else {
      UI.println(WARN + `  Bun ${version} (recommended >= 1.3)`)
    }
  } catch {
    UI.println(FAIL + "  Bun not found")
  }
}

async function checkGit(): Promise<void> {
  try {
    const proc = Bun.spawn(["git", "--version"], { stdout: "pipe", stderr: "pipe" })
    const text = await new Response(proc.stdout).text()
    UI.println(CHECK + `  ${text.trim()}`)
  } catch {
    UI.println(FAIL + "  Git not found")
  }
}

async function checkConfig(dir: string): Promise<void> {
  const paths = [
    path.join(dir, ".opencode", "opencode.jsonc"),
    path.join(dir, ".opencode", "opencode.json"),
    path.join(dir, "opencode.json"),
  ]

  for (const p of paths) {
    if (await Filesystem.exists(p)) {
      try {
        const content = await fs.readFile(p, "utf-8")
        // Basic JSON/JSONC parse check
        const cleaned = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
        JSON.parse(cleaned)
        UI.println(CHECK + `  Config: ${path.relative(dir, p)}`)
        return
      } catch (err) {
        UI.println(FAIL + `  Config parse error: ${path.relative(dir, p)}`)
        return
      }
    }
  }
  UI.println(INFO + "  No project config found (using defaults)")
  UI.println("       Run " + UI.Style.TEXT_HIGHLIGHT + "opencode init" + UI.Style.TEXT_NORMAL + " to create one.")
}

async function detectProjectLanguages(dir: string): Promise<Set<string>> {
  const exts = new Set<string>()
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue
      if (entry.isDirectory()) {
        try {
          const subEntries = await fs.readdir(path.join(dir, entry.name), { withFileTypes: true })
          for (const sub of subEntries) {
            if (!sub.isFile()) continue
            exts.add(path.extname(sub.name))
          }
        } catch {}
      } else {
        exts.add(path.extname(entry.name))
      }
    }
  } catch {}
  return exts
}

async function checkLSPs(dir: string): Promise<void> {
  const projectExts = await detectProjectLanguages(dir)

  for (const [id, info] of Object.entries(KNOWN_LSPS)) {
    const needed = info.extensions.some((ext) => projectExts.has(ext))
    if (!needed) continue

    const found = await which(info.binary)
    if (found) {
      UI.println(CHECK + `  ${info.label} LSP (${info.binary})`)
    } else {
      UI.println(WARN + `  ${info.label} LSP not found (${info.binary}) — will auto-download on first use`)
    }
  }
}

async function checkProviders(): Promise<void> {
  const checks: { name: string; env: string; url?: string }[] = [
    { name: "Anthropic", env: "ANTHROPIC_API_KEY" },
    { name: "OpenAI", env: "OPENAI_API_KEY" },
    { name: "Google", env: "GOOGLE_API_KEY" },
    { name: "GitHub Copilot", env: "GITHUB_TOKEN" },
  ]

  let anyFound = false
  for (const check of checks) {
    if (process.env[check.env]) {
      UI.println(CHECK + `  ${check.name} (${check.env} set)`)
      anyFound = true
    }
  }

  // Check local runtimes
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      const data = (await res.json()) as { models?: { name: string }[] }
      const count = data.models?.length ?? 0
      UI.println(CHECK + `  Ollama running (${count} models available)`)
      anyFound = true
    }
  } catch {}

  try {
    const res = await fetch("http://localhost:1234/v1/models", { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      UI.println(CHECK + `  LM Studio running`)
      anyFound = true
    }
  } catch {}

  if (!anyFound) {
    UI.println(WARN + "  No AI provider configured")
    UI.println("       Set an API key or start a local runtime (Ollama, LM Studio)")
  }
}

async function checkSystem(): Promise<void> {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const totalGB = (totalMem / 1024 / 1024 / 1024).toFixed(1)
  const freeGB = (freeMem / 1024 / 1024 / 1024).toFixed(1)

  if (freeMem < 1024 * 1024 * 1024) {
    UI.println(WARN + `  RAM: ${freeGB}GB free / ${totalGB}GB total (low memory)`)
  } else {
    UI.println(CHECK + `  RAM: ${freeGB}GB free / ${totalGB}GB total`)
  }

  UI.println(INFO + `  Platform: ${process.platform} ${os.arch()} (${os.cpus().length} cores)`)
}

export const DoctorCommand = cmd({
  command: "doctor",
  describe: "check opencode installation health",
  builder: (yargs) => yargs,
  async handler() {
    const dir = process.cwd()

    UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + "OpenCode Doctor" + UI.Style.TEXT_NORMAL)
    UI.empty()

    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Runtime" + UI.Style.TEXT_NORMAL)
    await checkBunVersion()
    await checkGit()
    UI.empty()

    UI.println(UI.Style.TEXT_NORMAL_BOLD + "Configuration" + UI.Style.TEXT_NORMAL)
    await checkConfig(dir)
    UI.empty()

    UI.println(UI.Style.TEXT_NORMAL_BOLD + "AI Providers" + UI.Style.TEXT_NORMAL)
    await checkProviders()
    UI.empty()

    UI.println(UI.Style.TEXT_NORMAL_BOLD + "LSP Servers" + UI.Style.TEXT_NORMAL)
    await checkLSPs(dir)
    UI.empty()

    UI.println(UI.Style.TEXT_NORMAL_BOLD + "System" + UI.Style.TEXT_NORMAL)
    await checkSystem()
    UI.empty()
  },
})
