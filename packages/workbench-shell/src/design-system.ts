/* SPDX-License-Identifier: MIT */

import { migrateWorkspaceManifest, parseDesignSystemCatalog, type DesignSystemCatalog, type DesignSystemTokens } from "@unifia/contracts"

export { migrateWorkspaceManifest, parseDesignSystemCatalog }
export type { DesignSystemCatalog, DesignSystemTokens }
export type DesignSystemPickerRow = { id: string; label: string; version: string; source: string; selected: boolean }

export function createDesignSystemPickerRows(catalogs: readonly DesignSystemCatalog[], selectedId?: string): readonly DesignSystemPickerRow[] {
  return [...catalogs].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version)).map((catalog) => ({ id: catalog.id, label: catalog.name, version: catalog.version, source: catalog.source, selected: catalog.id === selectedId }))
}
