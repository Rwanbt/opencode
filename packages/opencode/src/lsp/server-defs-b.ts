import path from "node:path"
import os from "node:os"
import fs from "node:fs/promises"
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
import { type Info, NearestRoot, run, output, log, pathExists } from "./server-shared"

export const CSharp: Info = {
  id: "csharp",
  root: NearestRoot([".slnx", ".sln", ".csproj", "global.json"]),
  extensions: [".cs"],
  async spawn(root) {
    let bin = which("csharp-ls")
    if (!bin) {
      if (!which("dotnet")) {
        log.error(".NET SDK is required to install csharp-ls")
        return
      }

      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("installing csharp-ls via dotnet tool")
      const proc = Process.spawn(["dotnet", "tool", "install", "csharp-ls", "--tool-path", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install csharp-ls")
        return
      }

      bin = path.join(Global.Path.bin, "csharp-ls" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed csharp-ls`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const FSharp: Info = {
  id: "fsharp",
  root: NearestRoot([".slnx", ".sln", ".fsproj", "global.json"]),
  extensions: [".fs", ".fsi", ".fsx", ".fsscript"],
  async spawn(root) {
    let bin = which("fsautocomplete")
    if (!bin) {
      if (!which("dotnet")) {
        log.error(".NET SDK is required to install fsautocomplete")
        return
      }

      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("installing fsautocomplete via dotnet tool")
      const proc = Process.spawn(["dotnet", "tool", "install", "fsautocomplete", "--tool-path", Global.Path.bin], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        log.error("Failed to install fsautocomplete")
        return
      }

      bin = path.join(Global.Path.bin, "fsautocomplete" + (process.platform === "win32" ? ".exe" : ""))
      log.info(`installed fsautocomplete`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const SourceKit: Info = {
  id: "sourcekit-lsp",
  extensions: [".swift", ".objc", "objcpp"],
  root: NearestRoot(["Package.swift", "*.xcodeproj", "*.xcworkspace"]),
  async spawn(root) {
    // Check if sourcekit-lsp is available in the PATH
    // This is installed with the Swift toolchain
    const sourcekit = which("sourcekit-lsp")
    if (sourcekit) {
      return {
        process: spawn(sourcekit, {
          cwd: root,
        }),
      }
    }

    // If sourcekit-lsp not found, check if xcrun is available
    // This is specific to macOS where sourcekit-lsp is typically installed with Xcode
    if (!which("xcrun")) return

    const lspLoc = await output(["xcrun", "--find", "sourcekit-lsp"])

    if (lspLoc.code !== 0) return

    const bin = lspLoc.text.trim()

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const RustAnalyzer: Info = {
  id: "rust",
  root: async (root) => {
    const crateRoot = await NearestRoot(["Cargo.toml", "Cargo.lock"])(root)
    if (crateRoot === undefined) {
      return undefined
    }
    let currentDir = crateRoot

    while (currentDir !== path.dirname(currentDir)) {
      // Stop at filesystem root
      const cargoTomlPath = path.join(currentDir, "Cargo.toml")
      try {
        const cargoTomlContent = await Filesystem.readText(cargoTomlPath)
        if (cargoTomlContent.includes("[workspace]")) {
          return currentDir
        }
      } catch (_err) {
        // File doesn't exist or can't be read, continue searching up
      }

      const parentDir = path.dirname(currentDir)
      if (parentDir === currentDir) break // Reached filesystem root
      currentDir = parentDir

      // Stop if we've gone above the app root
      if (!currentDir.startsWith(Instance.worktree)) break
    }

    return crateRoot
  },
  extensions: [".rs"],
  async spawn(root) {
    const bin = which("rust-analyzer")
    if (!bin) {
      log.info("rust-analyzer not found in path, please install it")
      return
    }
    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const Clangd: Info = {
  id: "clangd",
  root: NearestRoot(["compile_commands.json", "compile_flags.txt", ".clangd", "CMakeLists.txt", "Makefile"]),
  extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
  async spawn(root) {
    const args = ["--background-index", "--clang-tidy"]
    const fromPath = which("clangd")
    if (fromPath) {
      return {
        process: spawn(fromPath, args, {
          cwd: root,
        }),
      }
    }

    const ext = process.platform === "win32" ? ".exe" : ""
    const direct = path.join(Global.Path.bin, "clangd" + ext)
    if (await Filesystem.exists(direct)) {
      return {
        process: spawn(direct, args, {
          cwd: root,
        }),
      }
    }

    const entries = await fs.readdir(Global.Path.bin, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith("clangd_")) continue
      const candidate = path.join(Global.Path.bin, entry.name, "bin", "clangd" + ext)
      if (await Filesystem.exists(candidate)) {
        return {
          process: spawn(candidate, args, {
            cwd: root,
          }),
        }
      }
    }

    if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
    log.info("downloading clangd from GitHub releases")

    const releaseResponse = await fetch("https://api.github.com/repos/clangd/clangd/releases/latest")
    if (!releaseResponse.ok) {
      log.error("Failed to fetch clangd release info")
      return
    }

    const release: {
      tag_name?: string
      assets?: { name?: string; browser_download_url?: string }[]
    } = await releaseResponse.json()

    const tag = release.tag_name
    if (!tag) {
      log.error("clangd release did not include a tag name")
      return
    }
    const platform = process.platform
    const tokens: Record<string, string> = {
      darwin: "mac",
      linux: "linux",
      win32: "windows",
    }
    const token = tokens[platform]
    if (!token) {
      log.error(`Platform ${platform} is not supported by clangd auto-download`)
      return
    }

    const assets = release.assets ?? []
    const valid = (item: { name?: string; browser_download_url?: string }) => {
      if (!item.name) return false
      if (!item.browser_download_url) return false
      if (!item.name.includes(token)) return false
      return item.name.includes(tag)
    }

    const asset =
      assets.find((item) => valid(item) && item.name?.endsWith(".zip")) ??
      assets.find((item) => valid(item) && item.name?.endsWith(".tar.xz")) ??
      assets.find((item) => valid(item))
    if (!asset?.name || !asset.browser_download_url) {
      log.error("clangd could not match release asset", { tag, platform })
      return
    }

    const name = asset.name
    const downloadResponse = await fetch(asset.browser_download_url)
    if (!downloadResponse.ok) {
      log.error("Failed to download clangd")
      return
    }

    const archive = path.join(Global.Path.bin, name)
    const buf = await downloadResponse.arrayBuffer()
    if (buf.byteLength === 0) {
      log.error("Failed to write clangd archive")
      return
    }
    await Filesystem.write(archive, Buffer.from(buf))

    const zip = name.endsWith(".zip")
    const tar = name.endsWith(".tar.xz")
    if (!zip && !tar) {
      log.error("clangd encountered unsupported asset", { asset: name })
      return
    }

    if (zip) {
      const ok = await Archive.extractZip(archive, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract clangd archive", { error })
          return false
        })
      if (!ok) return
    }
    if (tar) {
      await run(["tar", "-xf", archive], { cwd: Global.Path.bin })
    }
    await fs.rm(archive, { force: true })

    const bin = path.join(Global.Path.bin, "clangd_" + tag, "bin", "clangd" + ext)
    if (!(await Filesystem.exists(bin))) {
      log.error("Failed to extract clangd binary")
      return
    }

    if (platform !== "win32") {
      await fs.chmod(bin, 0o755).catch(() => {})
    }

    await fs.unlink(path.join(Global.Path.bin, "clangd")).catch(() => {})
    await fs.symlink(bin, path.join(Global.Path.bin, "clangd")).catch(() => {})

    log.info(`installed clangd`, { bin })

    return {
      process: spawn(bin, args, {
        cwd: root,
      }),
    }
  },
}

export const Svelte: Info = {
  id: "svelte",
  extensions: [".svelte"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("svelteserver")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("svelte-language-server")
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
      initialization: {},
    }
  },
}

export const Astro: Info = {
  id: "astro",
  extensions: [".astro"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    const tsserver = Module.resolve("typescript/lib/tsserver.js", Instance.directory)
    if (!tsserver) {
      log.info("typescript not found, required for Astro language server")
      return
    }
    const tsdk = path.dirname(tsserver)

    let binary = which("astro-ls")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("@astrojs/language-server")
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
        typescript: {
          tsdk,
        },
      },
    }
  },
}

export const JDTLS: Info = {
  id: "jdtls",
  root: async (file) => {
    // Without exclusions, NearestRoot defaults to instance directory so we can't
    // distinguish between a) no project found and b) project found at instance dir.
    // So we can't choose the root from (potential) monorepo markers first.
    // Look for potential subproject markers first while excluding potential monorepo markers.
    const settingsMarkers = ["settings.gradle", "settings.gradle.kts"]
    const gradleMarkers = ["gradlew", "gradlew.bat"]
    const exclusionsForMonorepos = gradleMarkers.concat(settingsMarkers)

    const [projectRoot, wrapperRoot, settingsRoot] = await Promise.all([
      NearestRoot(
        ["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"],
        exclusionsForMonorepos,
      )(file),
      NearestRoot(gradleMarkers, settingsMarkers)(file),
      NearestRoot(settingsMarkers)(file),
    ])

    // If projectRoot is undefined we know we are in a monorepo or no project at all.
    // So can safely fall through to the other roots
    if (projectRoot) return projectRoot
    if (wrapperRoot) return wrapperRoot
    if (settingsRoot) return settingsRoot
  },
  extensions: [".java"],
  async spawn(root) {
    const java = which("java")
    if (!java) {
      log.error("Java 21 or newer is required to run the JDTLS. Please install it first.")
      return
    }
    const javaMajorVersion = await run(["java", "-version"]).then((result) => {
      const m = /"(\d+)\.\d+\.\d+"/.exec(result.stderr.toString())
      return !m ? undefined : parseInt(m[1])
    })
    if (javaMajorVersion == null || javaMajorVersion < 21) {
      log.error("JDTLS requires at least Java 21.")
      return
    }
    const distPath = path.join(Global.Path.bin, "jdtls")
    const launcherDir = path.join(distPath, "plugins")
    const installed = await pathExists(launcherDir)
    if (!installed) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading JDTLS LSP server.")
      await fs.mkdir(distPath, { recursive: true })
      const releaseURL =
        "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz"
      const archiveName = "release.tar.gz"

      log.info("Downloading JDTLS archive", { url: releaseURL, dest: distPath })
      const download = await fetch(releaseURL)
      if (!download.ok || !download.body) {
        log.error("Failed to download JDTLS", { status: download.status, statusText: download.statusText })
        return
      }
      await Filesystem.writeStream(path.join(distPath, archiveName), download.body)

      log.info("Extracting JDTLS archive")
      const tarResult = await run(["tar", "-xzf", archiveName], { cwd: distPath })
      if (tarResult.code !== 0) {
        log.error("Failed to extract JDTLS", { exitCode: tarResult.code, stderr: tarResult.stderr.toString() })
        return
      }

      await fs.rm(path.join(distPath, archiveName), { force: true })
      log.info("JDTLS download and extraction completed")
    }
    const jarFileName =
      (await fs.readdir(launcherDir).catch(() => []))
        .find((item) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(item))
        ?.trim() ?? ""
    const launcherJar = path.join(launcherDir, jarFileName)
    if (!(await pathExists(launcherJar))) {
      log.error(`Failed to locate the JDTLS launcher module in the installed directory: ${distPath}.`)
      return
    }
    const configFile = path.join(
      distPath,
      (() => {
        switch (process.platform) {
          case "darwin":
            return "config_mac"
          case "linux":
            return "config_linux"
          case "win32":
            return "config_win"
          default:
            return "config_linux"
        }
      })(),
    )
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-jdtls-data"))
    return {
      process: spawn(
        java,
        [
          "-jar",
          launcherJar,
          "-configuration",
          configFile,
          "-data",
          dataDir,
          "-Declipse.application=org.eclipse.jdt.ls.core.id1",
          "-Dosgi.bundles.defaultStartLevel=4",
          "-Declipse.product=org.eclipse.jdt.ls.core.product",
          "-Dlog.level=ALL",
          "--add-modules=ALL-SYSTEM",
          "--add-opens java.base/java.util=ALL-UNNAMED",
          "--add-opens java.base/java.lang=ALL-UNNAMED",
        ],
        {
          cwd: root,
        },
      ),
    }
  },
}

export const KotlinLS: Info = {
  id: "kotlin-ls",
  extensions: [".kt", ".kts"],
  root: async (file) => {
    // 1) Nearest Gradle root (multi-project or included build)
    const settingsRoot = await NearestRoot(["settings.gradle.kts", "settings.gradle"])(file)
    if (settingsRoot) return settingsRoot
    // 2) Gradle wrapper (strong root signal)
    const wrapperRoot = await NearestRoot(["gradlew", "gradlew.bat"])(file)
    if (wrapperRoot) return wrapperRoot
    // 3) Single-project or module-level build
    const buildRoot = await NearestRoot(["build.gradle.kts", "build.gradle"])(file)
    if (buildRoot) return buildRoot
    // 4) Maven fallback
    return NearestRoot(["pom.xml"])(file)
  },
  async spawn(root) {
    const distPath = path.join(Global.Path.bin, "kotlin-ls")
    const launcherScript =
      process.platform === "win32" ? path.join(distPath, "kotlin-lsp.cmd") : path.join(distPath, "kotlin-lsp.sh")
    const installed = await Filesystem.exists(launcherScript)
    if (!installed) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading Kotlin Language Server from GitHub.")

      const releaseResponse = await fetch("https://api.github.com/repos/Kotlin/kotlin-lsp/releases/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch kotlin-lsp release info")
        return
      }

      const release = await releaseResponse.json()
      const version = release.name?.replace(/^v/, "")

      if (!version) {
        log.error("Could not determine Kotlin LSP version from release")
        return
      }

      const platform = process.platform
      const arch = process.arch

      let kotlinArch: string = arch
      if (arch === "arm64") kotlinArch = "aarch64"
      else if (arch === "x64") kotlinArch = "x64"

      let kotlinPlatform: string = platform
      if (platform === "darwin") kotlinPlatform = "mac"
      else if (platform === "linux") kotlinPlatform = "linux"
      else if (platform === "win32") kotlinPlatform = "win"

      const supportedCombos = ["mac-x64", "mac-aarch64", "linux-x64", "linux-aarch64", "win-x64", "win-aarch64"]

      const combo = `${kotlinPlatform}-${kotlinArch}`

      if (!supportedCombos.includes(combo)) {
        log.error(`Platform ${platform}/${arch} is not supported by Kotlin LSP`)
        return
      }

      const assetName = `kotlin-lsp-${version}-${kotlinPlatform}-${kotlinArch}.zip`
      const releaseURL = `https://download-cdn.jetbrains.com/kotlin-lsp/${version}/${assetName}`

      await fs.mkdir(distPath, { recursive: true })
      const archivePath = path.join(distPath, "kotlin-ls.zip")
      const download = await fetch(releaseURL)
      if (!download.ok || !download.body) {
        log.error("Failed to download Kotlin Language Server", {
          status: download.status,
          statusText: download.statusText,
        })
        return
      }
      await Filesystem.writeStream(archivePath, download.body)
      const ok = await Archive.extractZip(archivePath, distPath)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract Kotlin LS archive", { error })
          return false
        })
      if (!ok) return
      await fs.rm(archivePath, { force: true })
      if (process.platform !== "win32") {
        await fs.chmod(launcherScript, 0o755).catch(() => {})
      }
      log.info("Installed Kotlin Language Server", { path: launcherScript })
    }
    if (!(await Filesystem.exists(launcherScript))) {
      log.error(`Failed to locate the Kotlin LS launcher script in the installed directory: ${distPath}.`)
      return
    }
    return {
      process: spawn(launcherScript, ["--stdio"], {
        cwd: root,
      }),
    }
  },
}

export const YamlLS: Info = {
  id: "yaml-ls",
  extensions: [".yaml", ".yml"],
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  async spawn(root) {
    let binary = which("yaml-language-server")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("yaml-language-server")
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
    }
  },
}

export const LuaLS: Info = {
  id: "lua-ls",
  root: NearestRoot([
    ".luarc.json",
    ".luarc.jsonc",
    ".luacheckrc",
    ".stylua.toml",
    "stylua.toml",
    "selene.toml",
    "selene.yml",
  ]),
  extensions: [".lua"],
  async spawn(root) {
    let bin = which("lua-language-server")

    if (!bin) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading lua-language-server from GitHub releases")

      const releaseResponse = await fetch("https://api.github.com/repos/LuaLS/lua-language-server/releases/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch lua-language-server release info")
        return
      }

      const release = await releaseResponse.json()

      const platform = process.platform
      const arch = process.arch
      let assetName = ""

      let lualsArch: string = arch
      if (arch === "arm64") lualsArch = "arm64"
      else if (arch === "x64") lualsArch = "x64"
      else if (arch === "ia32") lualsArch = "ia32"

      let lualsPlatform: string = platform
      if (platform === "darwin") lualsPlatform = "darwin"
      else if (platform === "linux") lualsPlatform = "linux"
      else if (platform === "win32") lualsPlatform = "win32"

      const ext = platform === "win32" ? "zip" : "tar.gz"

      assetName = `lua-language-server-${release.tag_name}-${lualsPlatform}-${lualsArch}.${ext}`

      const supportedCombos = [
        "darwin-arm64.tar.gz",
        "darwin-x64.tar.gz",
        "linux-x64.tar.gz",
        "linux-arm64.tar.gz",
        "win32-x64.zip",
        "win32-ia32.zip",
      ]

      const assetSuffix = `${lualsPlatform}-${lualsArch}.${ext}`
      if (!supportedCombos.includes(assetSuffix)) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by lua-language-server`)
        return
      }

      const asset = release.assets.find((a: any) => a.name === assetName)
      if (!asset) {
        log.error(`Could not find asset ${assetName} in latest lua-language-server release`)
        return
      }

      const downloadUrl = asset.browser_download_url
      const downloadResponse = await fetch(downloadUrl)
      if (!downloadResponse.ok) {
        log.error("Failed to download lua-language-server")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      // Unlike zls which is a single self-contained binary,
      // lua-language-server needs supporting files (meta/, locale/, etc.)
      // Extract entire archive to dedicated directory to preserve all files
      const installDir = path.join(Global.Path.bin, `lua-language-server-${lualsArch}-${lualsPlatform}`)

      // Remove old installation if exists
      const stats = await fs.stat(installDir).catch(() => undefined)
      if (stats) {
        await fs.rm(installDir, { force: true, recursive: true })
      }

      await fs.mkdir(installDir, { recursive: true })

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, installDir)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract lua-language-server archive", { error })
            return false
          })
        if (!ok) return
      } else {
        const ok = await run(["tar", "-xzf", tempPath, "-C", installDir])
          .then((result) => result.code === 0)
          .catch((error: unknown) => {
            log.error("Failed to extract lua-language-server archive", { error })
            return false
          })
        if (!ok) return
      }

      await fs.rm(tempPath, { force: true })

      // Binary is located in bin/ subdirectory within the extracted archive
      bin = path.join(installDir, "bin", "lua-language-server" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract lua-language-server binary")
        return
      }

      if (platform !== "win32") {
        const ok = await fs
          .chmod(bin, 0o755)
          .then(() => true)
          .catch((error: unknown) => {
            log.error("Failed to set executable permission for lua-language-server binary", {
              error,
            })
            return false
          })
        if (!ok) return
      }

      log.info(`installed lua-language-server`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

