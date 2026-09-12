import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)

// Kept in this file rather than imported from ./scripts/utils.ts: electron-builder
// loads this config under Node, and that module reads the CLI manifest through
// Bun's API at import time. The literal is the same one `extraResources` filters
// on a few lines below, and the same one src/main/cli.ts resolves at runtime.
const SIDECAR_BASENAME = `unifia-cli${process.platform === "win32" ? ".exe" : ""}`
const sidecarStagingPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "resources", SIDECAR_BASENAME)

// A package with no sidecar builds, signs and installs without a single
// warning, and only fails at runtime as "cannot reach the local server" — the
// `extraResources` filter below simply matches zero files. Fail the build
// instead: shipping the shell without its backend is never the intent.
function assertSidecarStaged() {
  if (existsSync(sidecarStagingPath)) return
  throw new Error(
    `Sidecar missing at ${sidecarStagingPath}. Run "bun ./scripts/stage-sidecar.ts" in packages/desktop-electron first.`,
  )
}
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.UNIFIA_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const getBase = (): Configuration => ({
  artifactName: "unifia-electron-${os}-${arch}.${ext}",
  beforePack: async () => {
    assertSidecarStaged()
  },
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // The sidecar is excluded here because `extraResources` below already ships
  // it, unpacked, at the path getSidecarPath() resolves. Without the negation
  // it is *also* packed into app.asar, where nothing ever reads it — 184 MB of
  // dead weight that lands in the installer twice.
  files: ["out/**/*", "resources/**/*", `!resources/${SIDECAR_BASENAME}`],
  extraResources: [
    {
      from: "resources/",
      to: "",
      filter: ["unifia-cli*"],
    },
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  // No `protocols` entry: packaging one registers unifia:// with the OS on
  // macOS and Linux, and decision A5 reserves the scheme for the stable Tauri
  // desktop. Per-channel overrides below must not reintroduce it either.
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: "ai.unifia.desktop.preview.dev",
        productName: "Unifia Preview Dev",
        rpm: { packageName: "unifia-preview-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: "ai.unifia.desktop.preview.beta",
        productName: "Unifia Preview Beta",
        publish: { provider: "github", owner: "Rwanbt", repo: "unifia-preview-beta", channel: "latest" },
        rpm: { packageName: "unifia-preview-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: "ai.unifia.desktop.preview",
        productName: "Unifia Preview",
        publish: { provider: "github", owner: "Rwanbt", repo: "unifia-preview", channel: "latest" },
        rpm: { packageName: "unifia-preview" },
      }
    }
  }
}

export default getConfig()
