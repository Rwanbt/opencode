/* SPDX-License-Identifier: MIT */

import { createDesignSystemPickerRows, migrateWorkspaceManifest, parseDesignSystemCatalog } from "../src/design-system.js"
import { test } from "bun:test"

test('design-system.test', async () => {

const catalog = parseDesignSystemCatalog({ id: "unifia-system", name: "Unifia", version: "1.0.0", source: "workspace://design-system", tokens: { colors: { primary: "#ffffff" }, spacing: { gutter: 24 }, typography: { body: "Inter" } } })
if (catalog.tokens.spacing.gutter !== 24 || catalog.source !== "workspace://design-system") throw new Error("design system contract lost tokens/source")
const rows = createDesignSystemPickerRows([catalog, { ...catalog, id: "alpha-system", name: "Alpha" }], "unifia-system")
if (rows[0]?.id !== "alpha-system" || rows[1]?.selected !== true) throw new Error("design system picker was not sorted/selected")
let refused = false
try { parseDesignSystemCatalog({ ...catalog, source: "" }) } catch { refused = true }
if (!refused) throw new Error("design system parser accepted a missing source")
const manifest = migrateWorkspaceManifest({ version: 1, designSystems: [catalog, { ...catalog, id: "alpha-system", name: "Alpha" }] })
if (manifest.designSystems.length !== 2 || manifest.version !== 1) throw new Error("workspace manifest did not preserve multiple catalogs")
let rejectedDuplicate = false
try { migrateWorkspaceManifest({ version: 1, designSystems: [catalog, catalog] }) } catch { rejectedDuplicate = true }
if (!rejectedDuplicate) throw new Error("workspace manifest accepted duplicate catalog ids")
let rejectedVersion = false
try { migrateWorkspaceManifest({ version: 2, designSystems: [catalog] }) } catch { rejectedVersion = true }
if (!rejectedVersion) throw new Error("workspace manifest accepted an unsupported version")
console.log("DesignSystem: 6/6 passed")
})
