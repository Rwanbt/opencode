/* SPDX-License-Identifier: MIT */

import { defineConfig } from "vite"
export default defineConfig({ build: { outDir: "dist", emptyOutDir: true, target: "es2020" } })
