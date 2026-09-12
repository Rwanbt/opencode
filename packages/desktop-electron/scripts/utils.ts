import { $ } from "bun"

export type Channel = "dev" | "beta" | "prod"

/**
 * Name of the compiled CLI binary, read from the CLI package's own manifest.
 *
 * WHY not a literal: packages/unifia/script/build.ts writes the binary to
 * `dist/<dir>/bin/<package name>`. The rebrand moved that to `bin/unifia` while
 * every consumer here kept asking for `bin/opencode`, so the sidecar was never
 * found and the packaged app shipped with no backend at all.
 */
export const cliPackageName: string = (
  (await Bun.file(new URL("../../unifia/package.json", import.meta.url)).json()) as { name: string }
).name

export function resolveChannel(): Channel {
  const raw = Bun.env.UNIFIA_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

export const SIDECAR_BINARIES: Array<{ rustTarget: string; ocBinary: string; assetExt: string }> = [
  {
    rustTarget: "aarch64-apple-darwin",
    ocBinary: "unifia-darwin-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-apple-darwin",
    ocBinary: "unifia-darwin-x64-baseline",
    assetExt: "zip",
  },
  {
    rustTarget: "aarch64-pc-windows-msvc",
    ocBinary: "unifia-windows-arm64",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-pc-windows-msvc",
    ocBinary: "unifia-windows-x64-baseline",
    assetExt: "zip",
  },
  {
    rustTarget: "x86_64-unknown-linux-gnu",
    ocBinary: "unifia-linux-x64-baseline",
    assetExt: "tar.gz",
  },
  {
    rustTarget: "aarch64-unknown-linux-gnu",
    ocBinary: "unifia-linux-arm64",
    assetExt: "tar.gz",
  },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

function nativeTarget() {
  const { platform, arch } = process
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
  if (platform === "linux") return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  throw new Error(`Unsupported platform: ${platform}/${arch}`)
}

export function getCurrentSidecar(target = RUST_TARGET ?? nativeTarget()) {
  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === target)
  if (!binaryConfig) throw new Error(`Sidecar configuration not available for Rust target '${target}'`)

  return binaryConfig
}

// The official release matrix cross-compiles a "-baseline" CLI variant
// (older CPU instruction sets) for x64 targets. Pipelines that only build
// the host's native target never produce that directory, so fall back to
// the plain binary — same resilience as packages/desktop/scripts/utils.ts.
export async function resolveSidecarBinaryPath(dir: string, ocBinary: string) {
  const candidates = [
    windowsify(`${dir}/${ocBinary}/bin/${cliPackageName}`),
    windowsify(`${dir}/${ocBinary.replace("-baseline", "")}/bin/${cliPackageName}`),
  ]
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  throw new Error(`No CLI binary found, tried: ${candidates.join(", ")}`)
}

/**
 * Absolute path the packaged app expects the sidecar at, before packaging.
 *
 * `electron-builder.config.ts` copies `resources/unifia-cli*` into
 * `process.resourcesPath`, which is where `src/main/cli.ts`'s `getSidecarPath()`
 * looks. Keeping the name in one place is what stops those two from drifting.
 */
export const SIDECAR_STAGING_PATH = windowsify("resources/unifia-cli")

export async function copyBinaryToSidecarFolder(source: string) {
  await $`mkdir -p resources`
  const dest = SIDECAR_STAGING_PATH
  await $`cp ${source} ${dest}`
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }
  if (process.platform === "darwin") await $`codesign --force --sign - ${dest}`

  console.log(`Copied ${source} to ${dest}`)
}

/**
 * Puts the CLI sidecar where the packaged app will look for it.
 *
 * Single owner of that step, called by `prepare` (CI), `predev` and the
 * `prepackage` hook, so no entry point can package the app without a backend.
 * Outside CI it builds the CLI when no `dist/` output is there yet.
 */
export async function stageSidecar({ rebuild = false }: { rebuild?: boolean } = {}) {
  const sidecarConfig = getCurrentSidecar()
  const dir = "../unifia/dist"

  if (rebuild) {
    await (sidecarConfig.ocBinary.includes("-baseline")
      ? $`cd ../unifia && bun run build --single --baseline`
      : $`cd ../unifia && bun run build --single`)
  }

  let source: string
  try {
    source = await resolveSidecarBinaryPath(dir, sidecarConfig.ocBinary)
  } catch (error) {
    if (rebuild) throw error
    console.log("[stage-sidecar] no CLI build found, building it now")
    return await stageSidecar({ rebuild: true })
  }

  await copyBinaryToSidecarFolder(source)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
