/* SPDX-License-Identifier: MIT */

import { defineConfig } from "vite"

// The app embeds this standalone bundle below /design-sketch/. Keeping the
// base here makes asset URLs work both in the built desktop app and in Vite dev.
export default defineConfig({ base: "/design-sketch/", build: { outDir: "dist", emptyOutDir: true, target: "es2020" } })
