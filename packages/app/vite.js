import { readFileSync } from "node:fs"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

/**
 * @type {import("vite").PluginOption}
 */
export default [
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
