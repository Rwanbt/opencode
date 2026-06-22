import path from "node:path"
import fs from "node:fs/promises"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { Archive } from "../util/archive"
import { which } from "../util/which"
import { spawn } from "./launch"
import { Npm } from "@/npm"
import { type Info, NearestRoot, run, log, } from "./server-shared"

export const PHPIntelephense: Info = {
  id: "php intelephense",
  extensions: [".php"],
  root: NearestRoot(["composer.json", "composer.lock", ".php-version"]),
  async spawn(root) {
    let binary = which("intelephense")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("intelephense")
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
        telemetry: {
          enabled: false,
        },
      },
    }
  },
}

export const Prisma: Info = {
  id: "prisma",
  extensions: [".prisma"],
  root: NearestRoot(["schema.prisma", "prisma/schema.prisma", "prisma"], ["package.json"]),
  async spawn(root) {
    const prisma = which("prisma")
    if (!prisma) {
      log.info("prisma not found, please install prisma")
      return
    }
    return {
      process: spawn(prisma, ["language-server"], {
        cwd: root,
      }),
    }
  },
}

export const Dart: Info = {
  id: "dart",
  extensions: [".dart"],
  root: NearestRoot(["pubspec.yaml", "analysis_options.yaml"]),
  async spawn(root) {
    const dart = which("dart")
    if (!dart) {
      log.info("dart not found, please install dart first")
      return
    }
    return {
      process: spawn(dart, ["language-server", "--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Ocaml: Info = {
  id: "ocaml-lsp",
  extensions: [".ml", ".mli"],
  root: NearestRoot(["dune-project", "dune-workspace", ".merlin", "opam"]),
  async spawn(root) {
    const bin = which("ocamllsp")
    if (!bin) {
      log.info("ocamllsp not found, please install ocaml-lsp-server")
      return
    }
    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}
export const BashLS: Info = {
  id: "bash",
  extensions: [".sh", ".bash", ".zsh", ".ksh"],
  root: async () => Instance.directory,
  async spawn(root) {
    let binary = which("bash-language-server")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("bash-language-server")
      if (!resolved) return
      binary = resolved
    }
    args.push("start")
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

export const TerraformLS: Info = {
  id: "terraform",
  extensions: [".tf", ".tfvars"],
  root: NearestRoot([".terraform.lock.hcl", "terraform.tfstate", "*.tf"]),
  async spawn(root) {
    let bin = which("terraform-ls")

    if (!bin) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading terraform-ls from HashiCorp releases")

      const releaseResponse = await fetch("https://api.releases.hashicorp.com/v1/releases/terraform-ls/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch terraform-ls release info")
        return
      }

      const release = (await releaseResponse.json()) as {
        version?: string
        builds?: { arch?: string; os?: string; url?: string }[]
      }

      const platform = process.platform
      const arch = process.arch

      const tfArch = arch === "arm64" ? "arm64" : "amd64"
      const tfPlatform = platform === "win32" ? "windows" : platform

      const builds = release.builds ?? []
      const build = builds.find((b) => b.arch === tfArch && b.os === tfPlatform)
      if (!build?.url) {
        log.error(`Could not find build for ${tfPlatform}/${tfArch} terraform-ls release version ${release.version}`)
        return
      }

      const downloadResponse = await fetch(build.url)
      if (!downloadResponse.ok) {
        log.error("Failed to download terraform-ls")
        return
      }

      const tempPath = path.join(Global.Path.bin, "terraform-ls.zip")
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      const ok = await Archive.extractZip(tempPath, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract terraform-ls archive", { error })
          return false
        })
      if (!ok) return
      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "terraform-ls" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract terraform-ls binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info(`installed terraform-ls`, { bin })
    }

    return {
      process: spawn(bin, ["serve"], {
        cwd: root,
      }),
      initialization: {
        experimentalFeatures: {
          prefillRequiredFields: true,
          validateOnSave: true,
        },
      },
    }
  },
}

export const TexLab: Info = {
  id: "texlab",
  extensions: [".tex", ".bib"],
  root: NearestRoot([".latexmkrc", "latexmkrc", ".texlabroot", "texlabroot"]),
  async spawn(root) {
    let bin = which("texlab")

    if (!bin) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading texlab from GitHub releases")

      const response = await fetch("https://api.github.com/repos/latex-lsp/texlab/releases/latest")
      if (!response.ok) {
        log.error("Failed to fetch texlab release info")
        return
      }

      const release = (await response.json()) as {
        tag_name?: string
        assets?: { name?: string; browser_download_url?: string }[]
      }
      const version = release.tag_name?.replace("v", "")
      if (!version) {
        log.error("texlab release did not include a version tag")
        return
      }

      const platform = process.platform
      const arch = process.arch

      const texArch = arch === "arm64" ? "aarch64" : "x86_64"
      const texPlatform = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux"
      const ext = platform === "win32" ? "zip" : "tar.gz"
      const assetName = `texlab-${texArch}-${texPlatform}.${ext}`

      const assets = release.assets ?? []
      const asset = assets.find((a) => a.name === assetName)
      if (!asset?.browser_download_url) {
        log.error(`Could not find asset ${assetName} in texlab release`)
        return
      }

      const downloadResponse = await fetch(asset.browser_download_url)
      if (!downloadResponse.ok) {
        log.error("Failed to download texlab")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract texlab archive", { error })
            return false
          })
        if (!ok) return
      }
      if (ext === "tar.gz") {
        await run(["tar", "-xzf", tempPath], { cwd: Global.Path.bin })
      }

      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "texlab" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract texlab binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info("installed texlab", { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}

export const DockerfileLS: Info = {
  id: "dockerfile",
  extensions: [".dockerfile", "Dockerfile"],
  root: async () => Instance.directory,
  async spawn(root) {
    let binary = which("docker-langserver")
    const args: string[] = []
    if (!binary) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      const resolved = await Npm.which("dockerfile-language-server-nodejs")
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

export const Gleam: Info = {
  id: "gleam",
  extensions: [".gleam"],
  root: NearestRoot(["gleam.toml"]),
  async spawn(root) {
    const gleam = which("gleam")
    if (!gleam) {
      log.info("gleam not found, please install gleam first")
      return
    }
    return {
      process: spawn(gleam, ["lsp"], {
        cwd: root,
      }),
    }
  },
}

export const Clojure: Info = {
  id: "clojure-lsp",
  extensions: [".clj", ".cljs", ".cljc", ".edn"],
  root: NearestRoot(["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"]),
  async spawn(root) {
    let bin = which("clojure-lsp")
    if (!bin && process.platform === "win32") {
      bin = which("clojure-lsp.exe")
    }
    if (!bin) {
      log.info("clojure-lsp not found, please install clojure-lsp first")
      return
    }
    return {
      process: spawn(bin, ["listen"], {
        cwd: root,
      }),
    }
  },
}

export const Nixd: Info = {
  id: "nixd",
  extensions: [".nix"],
  root: async (file) => {
    // First, look for flake.nix - the most reliable Nix project root indicator
    const flakeRoot = await NearestRoot(["flake.nix"])(file)
    if (flakeRoot && flakeRoot !== Instance.directory) return flakeRoot

    // If no flake.nix, fall back to git repository root
    if (Instance.worktree && Instance.worktree !== Instance.directory) return Instance.worktree

    // Finally, use the instance directory as fallback
    return Instance.directory
  },
  async spawn(root) {
    const nixd = which("nixd")
    if (!nixd) {
      log.info("nixd not found, please install nixd first")
      return
    }
    return {
      process: spawn(nixd, [], {
        cwd: root,
        env: {
          ...process.env,
        },
      }),
    }
  },
}

export const Tinymist: Info = {
  id: "tinymist",
  extensions: [".typ", ".typc"],
  root: NearestRoot(["typst.toml"]),
  async spawn(root) {
    let bin = which("tinymist")

    if (!bin) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading tinymist from GitHub releases")

      const response = await fetch("https://api.github.com/repos/Myriad-Dreamin/tinymist/releases/latest")
      if (!response.ok) {
        log.error("Failed to fetch tinymist release info")
        return
      }

      const release = (await response.json()) as {
        tag_name?: string
        assets?: { name?: string; browser_download_url?: string }[]
      }

      const platform = process.platform
      const arch = process.arch

      const tinymistArch = arch === "arm64" ? "aarch64" : "x86_64"
      let tinymistPlatform: string
      let ext: string

      if (platform === "darwin") {
        tinymistPlatform = "apple-darwin"
        ext = "tar.gz"
      } else if (platform === "win32") {
        tinymistPlatform = "pc-windows-msvc"
        ext = "zip"
      } else {
        tinymistPlatform = "unknown-linux-gnu"
        ext = "tar.gz"
      }

      const assetName = `tinymist-${tinymistArch}-${tinymistPlatform}.${ext}`

      const assets = release.assets ?? []
      const asset = assets.find((a) => a.name === assetName)
      if (!asset?.browser_download_url) {
        log.error(`Could not find asset ${assetName} in tinymist release`)
        return
      }

      const downloadResponse = await fetch(asset.browser_download_url)
      if (!downloadResponse.ok) {
        log.error("Failed to download tinymist")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract tinymist archive", { error })
            return false
          })
        if (!ok) return
      } else {
        await run(["tar", "-xzf", tempPath, "--strip-components=1"], { cwd: Global.Path.bin })
      }

      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "tinymist" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract tinymist binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info("installed tinymist", { bin })
    }

    return {
      process: spawn(bin, { cwd: root }),
    }
  },
}

export const HLS: Info = {
  id: "haskell-language-server",
  extensions: [".hs", ".lhs"],
  root: NearestRoot(["stack.yaml", "cabal.project", "hie.yaml", "*.cabal"]),
  async spawn(root) {
    const bin = which("haskell-language-server-wrapper")
    if (!bin) {
      log.info("haskell-language-server-wrapper not found, please install haskell-language-server")
      return
    }
    return {
      process: spawn(bin, ["--lsp"], {
        cwd: root,
      }),
    }
  },
}

export const JuliaLS: Info = {
  id: "julials",
  extensions: [".jl"],
  root: NearestRoot(["Project.toml", "Manifest.toml", "*.jl"]),
  async spawn(root) {
    const julia = which("julia")
    if (!julia) {
      log.info("julia not found, please install julia first (https://julialang.org/downloads/)")
      return
    }
    return {
      process: spawn(julia, ["--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"], {
        cwd: root,
      }),
    }
  },
}
