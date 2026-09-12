import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/src/pages/workbench/design-surface")) return "workbench-design"
          if (id.includes("/src/pages/workbench/automate-surface")) return "workbench-automate"
          if (id.includes("/src/pages/workbench/work-surface")) return "workbench-work"
          return undefined
        },
      },
    },
  },
})
