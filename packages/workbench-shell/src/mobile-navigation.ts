/* SPDX-License-Identifier: MIT */

import { WORKBENCH_ROUTE_REGISTRY, WORKBENCH_ROUTE_OPERATIONS } from "./routes.js"
import type { WorkFunction } from "./modes.js"

export type MobileNavigationInput = { viewportWidth: number; documents: number; designPreviews: number; active: WorkFunction }
export type MobileNavigationModel = { layout: "rail" | "drawer"; active: WorkFunction; entries: readonly { operation: WorkFunction; route: string; selected: boolean }[]; workCount: number; designPreviewCount: number }

/** Keeps mobile navigation on the same route registry as desktop. */
export function createMobileNavigationModel(input: MobileNavigationInput): MobileNavigationModel {
  const layout = input.viewportWidth < 720 ? "drawer" : "rail"
  const entries = WORKBENCH_ROUTE_OPERATIONS.map((operation) => ({ operation, route: WORKBENCH_ROUTE_REGISTRY[operation].route, selected: operation === input.active }))
  return { layout, active: input.active, entries, workCount: Math.max(0, Math.trunc(input.documents)), designPreviewCount: Math.max(0, Math.trunc(input.designPreviews)) }
}
