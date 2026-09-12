import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "unifia-design-sketch:bundle",
    apply: "build",
    buildStart() {
      execFileSync(process.platform === "win32" ? "bun.exe" : "bun", ["run", "build"], { cwd: path.resolve(process.cwd(), "../design-sketch"), stdio: "inherit" })
    },
    generateBundle() {
      const root = path.resolve(process.cwd(), "../design-sketch/dist")
      const emit = (directory, prefix = "") => {
        for (const entry of readdirSync(directory)) {
          const absolute = path.join(directory, entry)
          const name = prefix ? `${prefix}/${entry}` : entry
          if (statSync(absolute).isDirectory()) emit(absolute, name)
          else this.emitFile({ type: "asset", fileName: `design-sketch/${name}`, source: readFileSync(absolute) })
        }
      }
      emit(root)
    },
  },
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>',
        `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  {
    // KaTeX ships its fonts as WOFF2 + WOFF + TTF for legacy browsers. Every
    // WebView we target (Tauri mobile WebView, Electron desktop) loads WOFF2
    // natively, so the ~150 KB of TTF files just bloat the APK/installer
    // without ever being fetched. Drop them from the final bundle.
    name: "opencode-desktop:drop-katex-ttf",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const key of Object.keys(bundle)) {
        const asset = bundle[key]
        if (asset.type === "asset" && /^.*KaTeX_.*\.ttf$/i.test(asset.fileName)) {
          delete bundle[key]
        }
      }
    },
  },
  tailwindcss(),
  solidPlugin(),
]
