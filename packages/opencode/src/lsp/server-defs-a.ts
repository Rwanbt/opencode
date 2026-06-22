import path from "node:path"
import fs from "node:fs/promises"
import { text } from "node:stream/consumers"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { Archive } from "../util/archive"
import { Process } from "../util/process"
import { which } from "../util/which"
import { Module } from "@opencode-ai/util/module"
import { spawn } from "./launch"
import { Npm } from "@/npm"
import { type Info, NearestRoot, run, log, } from "./server-shared"

export const Deno: Info = {
  id: "deno",
  root: async (file) => {
    const files = Filesystem.up({
      targets: ["deno.json", "deno.jsonc"],
      start: path.dirname(file),
      stop: Instance.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return undefined
    return path.dirname(first.value)
  },
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
  async spawn(root) {
    const deno = which("deno")
    if (!deno) {
      log.info("deno not found, please install deno first")
      return
    }
    return {
      process: spawn(deno, ["lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Typescript: Info = {
  id: "typescript",
  root: NearestRoot(
    ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"],
    ["deno.json", "deno.jsonc"],
  ),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  async spawn(root) {
    const tsserver = Module.resolve("typescript/lib/tsserver.js", Instance.directory)
    log.info("typescript server", { tsserver })
    if (!tsserver) return
    const bin = await Npm.which("typescript-language-server")
    if (!bin) return
    const proc = spawn(bin, ["--stdio"], {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization: {
        tsserver: {
          path: tsserver,
        },
      },
    }
  },
}

export const Vue: Info = {
  id: "vue",
  extensions: [".vue"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("vue-language-server")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("@vue/language-server")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")
    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization: {
        // Leave empty; the server will auto-detect workspace TypeScript.
      },
    }
  },
}

export const ESLint: Info = {
  id: "eslint",
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
  async spawn(root) {
    const eslint = Module.resolve("eslint", Instance.directory)
    if (!eslint) return
    log.info("spawning eslint server")
    const serverPath = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
    if (!(await Filesystem.exists(serverPath))) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading and building VS Code ESLint server")
      const response = await fetch("https://github.com/microsoft/vscode-eslint/archive/refs/heads/main.zip")
      if (!response.ok) return

      const zipPath = path.join(Global.Path.bin, "vscode-eslint.zip")
      if (response.body) await Filesystem.writeStream(zipPath, response.body)

      const ok = await Archive.extractZip(zipPath, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract vscode-eslint archive", { error })
          return false
        })
      if (!ok) return
      await fs.rm(zipPath, { force: true })

      const extractedPath = path.join(Global.Path.bin, "vscode-eslint-main")
      const finalPath = path.join(Global.Path.bin, "vscode-eslint")

      const stats = await fs.stat(finalPath).catch(() => undefined)
      if (stats) {
        log.info("removing old eslint installation", { path: finalPath })
        await fs.rm(finalPath, { force: true, recursive: true })
      }
      await fs.rename(extractedPath, finalPath)

      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
      await Process.run([npmCmd, "install"], { cwd: finalPath })
      await Process.run([npmCmd, "run", "compile"], { cwd: finalPath })

      log.info("installed VS Code ESLint server", { serverPath })
    }

    const proc = spawn("node", [serverPath, "--stdio"], {
      cwd: root,
      env: {
        ...process.env,
      },
    })

    return {
      process: proc,
    }
  },
}

export const Oxlint: Info = {
  id: "oxlint",
  root: NearestRoot([
    ".oxlintrc.json",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package.json",
  ]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".astro", ".svelte"],
  async spawn(root) {
    const ext = process.platform === "win32" ? ".cmd" : ""

    const serverTarget = path.join("node_modules", ".bin", "oxc_language_server" + ext)
    const lintTarget = path.join("node_modules", ".bin", "oxlint" + ext)

    const resolveBin = async (target: string) => {
      const localBin = path.join(root, target)
      if (await Filesystem.exists(localBin)) return localBin

      const candidates = Filesystem.up({
        targets: [target],
        start: root,
        stop: Instance.worktree,
      })
      const first = await candidates.next()
      await candidates.return()
      if (first.value) return first.value

      return undefined
    }

    let lintBin = await resolveBin(lintTarget)
    if (!lintBin) {
      const found = which("oxlint")
      if (found) lintBin = found
    }

    if (lintBin) {
      const proc = spawn(lintBin, ["--help"])
      await proc.exited
      if (proc.stdout) {
        const help = await text(proc.stdout)
        if (help.includes("--lsp")) {
          return {
            process: spawn(lintBin, ["--lsp"], {
              cwd: root,
            }),
          }
        }
      }
    }

    let serverBin = await resolveBin(serverTarget)
    if (!serverBin) {
      const found = which("oxc_language_server")
      if (found) serverBin = found
    }
    if (serverBin) {
      return {
        process: spawn(serverBin, [], {
          cwd: root,
        }),
      }
    }

    log.info("oxlint not found, please install oxlint")
    return
  },
}

export const Biome: Info = {
  id: "biome",
  root: NearestRoot([
    "biome.json",
    "biome.jsonc",
    "package-lock.json",
    "bun.lockb",
    "bun.lock",
    "pnpm-lock.yaml",
    "yarn.lock",
  ]),
  extensions: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".json",
    ".jsonc",
    ".vue",
    ".astro",
    ".svelte",
    ".css",
    ".graphql",
    ".gql",
    ".html",
  ],
  async spawn(root) {
    const localBin = path.join(root, "node_modules", ".bin", "biome")
    let bin: string | undefined
    if (await Filesystem.exists(localBin)) bin = localBin
    if (!bin) {
      const found = which("biome")
      if (found) bin = found
    }

    let args = ["lsp-proxy", "--stdio"]

    if (!bin) {
      const resolved = Module.resolve("biome", root)
      if (!resolved) return
      bin = await Npm.which("biome")
      if (!bin) return
      args = ["lsp-proxy", "--stdio"]
    }

    const proc = spawn(bin, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })

    return {
      process: proc,
    }
  },
}

export const Gopls: Info = {
  id: "gopls",
  root: async (file) => {
    const work = await NearestRoot(["go.work"])(file)
    if (work) return work
    return NearestRoot(["go.mod", "go.sum"])(file)
  },
  extensions: [".go"],
  async spawn(root) {
    let bin = which("gopls")
    if (!bin) {
      if (!which("go")) return
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return

      log.info("installing gopls")
      const proc = Process.spawn(["go", "install", "golang.org/x/tools/gopls@latest"], {
        env: { ...process.env, GOBIN: Global.Path.bin },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install gopls")
        return
      }
      bin = path.join(Global.Path.bin, "gopls" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed gopls`, {
        bin,
      })
    }
    return {
      process: spawn(bin!, {
        cwd: root,
      }),
    }
  },
}

export const Rubocop: Info = {
  id: "ruby-lsp",
  root: NearestRoot(["Gemfile"]),
  extensions: [".rb", ".rake", ".gemspec", ".ru"],
  async spawn(root) {
    let bin = which("rubocop")
    if (!bin) {
      const ruby = which("ruby")
      const gem = which("gem")
      if (!ruby || !gem) {
        log.info("Ruby not found, please install Ruby first")
        return
      }
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("installing rubocop")
      const proc = Process.spawn(["gem", "install", "rubocop", "--bindir", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install rubocop")
        return
      }
      bin = path.join(Global.Path.bin, "rubocop" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed rubocop`, {
        bin,
      })
    }
    return {
      process: spawn(bin!, ["--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Ty: Info = {
  id: "ty",
  extensions: [".py", ".pyi"],
  root: NearestRoot([
    "pyproject.toml",
    "ty.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "Pipfile",
    "pyrightconfig.json",
  ]),
  async spawn(root) {
    if (!Flag.OPENCODE_EXPERIMENTAL_LSP_TY) {
      return undefined
    }

    let binary = which("ty")

    const initialization: Record<string, string> = {}

    const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
      (p): p is string => p !== undefined,
    )
    for (const venvPath of potentialVenvPaths) {
      const isWindows = process.platform === "win32"
      const potentialPythonPath = isWindows
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python")
      if (await Filesystem.exists(potentialPythonPath)) {
        initialization["pythonPath"] = potentialPythonPath
        break
      }
    }

    if (!binary) {
      for (const venvPath of potentialVenvPaths) {
        const isWindows = process.platform === "win32"
        const potentialTyPath = isWindows
          ? path.join(venvPath, "Scripts", "ty.exe")
          : path.join(venvPath, "bin", "ty")
        if (await Filesystem.exists(potentialTyPath)) {
          binary = potentialTyPath
          break
        }
      }
    }

    if (!binary) {
      log.error("ty not found, please install ty first")
      return
    }

    const proc = spawn(binary, ["server"], {
      cwd: root,
    })

    return {
      process: proc,
      initialization,
    }
  },
}

export const Pyright: Info = {
  id: "pyright",
  extensions: [".py", ".pyi"],
  root: NearestRoot(["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]),
  async spawn(root) {
    let binary = which("pyright-langserver")
    const args = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("pyright")
      if (!resolved) return
      binary = resolved
    }
    args.push("--stdio")

    const initialization: Record<string, string> = {}

    const potentialVenvPaths = [process.env["VIRTUAL_ENV"], path.join(root, ".venv"), path.join(root, "venv")].filter(
      (p): p is string => p !== undefined,
    )
    for (const venvPath of potentialVenvPaths) {
      const isWindows = process.platform === "win32"
      const potentialPythonPath = isWindows
        ? path.join(venvPath, "Scripts", "python.exe")
        : path.join(venvPath, "bin", "python")
      if (await Filesystem.exists(potentialPythonPath)) {
        initialization["pythonPath"] = potentialPythonPath
        break
      }
    }

    const proc = spawn(binary, args, {
      cwd: root,
      env: {
        ...process.env,
      },
    })
    return {
      process: proc,
      initialization,
    }
  },
}

export const ElixirLS: Info = {
  id: "elixir-ls",
  extensions: [".ex", ".exs"],
  root: NearestRoot(["mix.exs", "mix.lock"]),
  async spawn(root) {
    let binary = which("elixir-ls")
    if (!binary) {
      const elixirLsPath = path.join(Global.Path.bin, "elixir-ls")
      binary = path.join(
        Global.Path.bin,
        "elixir-ls-master",
        "release",
        process.platform === "win32" ? "language_server.bat" : "language_server.sh",
      )

      if (!(await Filesystem.exists(binary))) {
        const elixir = which("elixir")
        if (!elixir) {
          log.error("elixir is required to run elixir-ls")
          return
        }

        if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
        log.info("downloading elixir-ls from GitHub releases")

        const response = await fetch("https://github.com/elixir-lsp/elixir-ls/archive/refs/heads/master.zip")
        if (!response.ok) return
        const zipPath = path.join(Global.Path.bin, "elixir-ls.zip")
        if (response.body) await Filesystem.writeStream(zipPath, response.body)

        const ok = await Archive.extractZip(zipPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract elixir-ls archive", { error })
            return false
          })
        if (!ok) return

        await fs.rm(zipPath, {
          force: true,
          recursive: true,
        })

        const cwd = path.join(Global.Path.bin, "elixir-ls-master")
        const env = { MIX_ENV: "prod", ...process.env }
        await Process.run(["mix", "deps.get"], { cwd, env })
        await Process.run(["mix", "compile"], { cwd, env })
        await Process.run(["mix", "elixir_ls.release2", "-o", "release"], { cwd, env })

        log.info(`installed elixir-ls`, {
          path: elixirLsPath,
        })
      }
    }

    return {
      process: spawn(binary, {
        cwd: root,
      }),
    }
  },
}

export const Zls: Info = {
  id: "zls",
  extensions: [".zig", ".zon"],
  root: NearestRoot(["build.zig"]),
  async spawn(root) {
    let bin = which("zls")

    if (!bin) {
      const zig = which("zig")
      if (!zig) {
        log.error("Zig is required to use zls. Please install Zig first.")
        return
      }

      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading zls from GitHub releases")

      const releaseResponse = await fetch("https://api.github.com/repos/zigtools/zls/releases/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch zls release info")
        return
      }

      const release = (await releaseResponse.json()) as any

      const platform = process.platform
      const arch = process.arch
      let assetName = ""

      let zlsArch: string = arch
      if (arch === "arm64") zlsArch = "aarch64"
      else if (arch === "x64") zlsArch = "x86_64"
      else if (arch === "ia32") zlsArch = "x86"

      let zlsPlatform: string = platform
      if (platform === "darwin") zlsPlatform = "macos"
      else if (platform === "win32") zlsPlatform = "windows"

      const ext = platform === "win32" ? "zip" : "tar.xz"

      assetName = `zls-${zlsArch}-${zlsPlatform}.${ext}`

      const supportedCombos = [
        "zls-x86_64-linux.tar.xz",
        "zls-x86_64-macos.tar.xz",
        "zls-x86_64-windows.zip",
        "zls-aarch64-linux.tar.xz",
        "zls-aarch64-macos.tar.xz",
        "zls-aarch64-windows.zip",
        "zls-x86-linux.tar.xz",
        "zls-x86-windows.zip",
      ]

      if (!supportedCombos.includes(assetName)) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by zls`)
        return
      }

      const asset = release.assets.find((a: any) => a.name === assetName)
      if (!asset) {
        log.error(`Could not find asset ${assetName} in latest zls release`)
        return
      }

      const downloadUrl = asset.browser_download_url
      const downloadResponse = await fetch(downloadUrl)
      if (!downloadResponse.ok) {
        log.error("Failed to download zls")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract zls archive", { error })
            return false
          })
        if (!ok) return
      } else {
        await run(["tar", "-xf", tempPath], { cwd: Global.Path.bin })
      }

      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract zls binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info(`installed zls`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

