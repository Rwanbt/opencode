/* SPDX-License-Identifier: MIT */

import { createMobileNavigationModel } from "../src/mobile-navigation.js"
import { test } from "bun:test"

test('mobile-navigation.test', async () => {

const drawer = createMobileNavigationModel({ viewportWidth: 390, documents: 3, designPreviews: 3, active: "documents" })
if (drawer.layout !== "drawer" || drawer.workCount !== 3 || drawer.designPreviewCount !== 3) throw new Error("mobile drawer model lost surface counts")
if (drawer.entries.find((entry) => entry.operation === "documents")?.selected !== true) throw new Error("mobile model lost active route")
const rail = createMobileNavigationModel({ viewportWidth: 1024, documents: -1.8, designPreviews: 1.9, active: "capability-picker" })
if (rail.layout !== "rail" || rail.workCount !== 0 || rail.designPreviewCount !== 1) throw new Error("wide mobile model did not use the rail")
if (rail.entries.length !== 11 || rail.entries.some((entry) => !entry.route.startsWith("/v1/"))) throw new Error("mobile model diverged from route registry")
console.log("MobileNavigation: 4/4 passed")
})
