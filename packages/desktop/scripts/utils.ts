import { $ } from "bun"

/**
 * Name of the CLI package, read from its manifest rather than repeated here.
 *
 * WHY: the sidecar's dist directory is `<package name>-<os>-<arch>[-baseline]`,
 * composed by packages/unifia/script/build.ts from the package name. This file
 * used to hardcode the whole directory name, so the two drifted the moment the
 * rebrand touched one and not the other: the build wrote `opencode-windows-x64`
 * while this side looked for `unifia-windows-x64`, and every desktop build
 * failed with "resource path sidecars\... doesn't exist". Deriving it keeps one
 * authoritative source for the name.
 */
export const cliPackageName: string = ((await Bun.file(new URL("../../unifia/package.json", import.meta.url)).json()) as { name: string }).name

export const SIDECAR_BINARIES: Array<{ rustTarget: string; platform: string; assetExt: string }> = [
  { rustTarget: "aarch64-apple-darwin", platform: "darwin-arm64", assetExt: "zip" },
  { rustTarget: "x86_64-apple-darwin", platform: "darwin-x64-baseline", assetExt: "zip" },
  { rustTarget: "aarch64-pc-windows-msvc", platform: "windows-arm64", assetExt: "zip" },
  { rustTarget: "x86_64-pc-windows-msvc", platform: "windows-x64-baseline", assetExt: "zip" },
  { rustTarget: "x86_64-unknown-linux-gnu", platform: "linux-x64-baseline", assetExt: "tar.gz" },
  { rustTarget: "aarch64-unknown-linux-gnu", platform: "linux-arm64", assetExt: "tar.gz" },
]

export const RUST_TARGET = Bun.env.RUST_TARGET

export function getCurrentSidecar(target = RUST_TARGET) {
  if (!target && !RUST_TARGET) throw new Error("RUST_TARGET not set")

  const binaryConfig = SIDECAR_BINARIES.find((b) => b.rustTarget === target)
  if (!binaryConfig) throw new Error(`Sidecar configuration not available for Rust target '${RUST_TARGET}'`)

  return { ...binaryConfig, ocBinary: `${cliPackageName}-${binaryConfig.platform}` }
}

// The official release matrix cross-compiles a "-baseline" CLI variant
// (older CPU instruction sets) for x64 targets. Pipelines that only build
// the host's native target (e.g. release.yml) never produce that
// directory, so fall back to the plain binary — same resilience already
// used by copy-sidecar.ts's candidate list.
export async function resolveSidecarBinaryPath(dir: string, ocBinary: string) {
  // `bin/<package name>`, not `bin/opencode`: script/build.ts names the compiled
  // binary after the CLI package, so the rebrand moved it to `bin/unifia` while
  // this side kept looking for the old name. Both candidates then missed, and
  // the callers that have a fallback silently reused a stale sidecar instead of
  // the one just built.
  const candidates = [
    windowsify(`${dir}/${ocBinary}/bin/${cliPackageName}`),
    windowsify(`${dir}/${ocBinary.replace("-baseline", "")}/bin/${cliPackageName}`),
  ]
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  throw new Error(`No CLI binary found, tried: ${candidates.join(", ")}`)
}

export async function copyBinaryToSidecarFolder(source: string, target = RUST_TARGET) {
  await $`mkdir -p src-tauri/sidecars`
  const dest = windowsify(`src-tauri/sidecars/unifia-cli-${target}`)
  await $`cp ${source} ${dest}`
  if (process.platform === "win32" && process.env.GITHUB_ACTIONS === "true") {
    await $`pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File ../../script/sign-windows.ps1 ${dest}`
  }

  console.log(`Copied ${source} to ${dest}`)
}

export function windowsify(path: string) {
  if (path.endsWith(".exe")) return path
  return `${path}${process.platform === "win32" ? ".exe" : ""}`
}
