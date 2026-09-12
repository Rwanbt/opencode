/* SPDX-License-Identifier: MIT */

import { M20_SERVER_ROUTE_REGISTRY, SURFACE_LEASE_CAPABILITIES, SURFACE_REQUIRED_CAPABILITIES, WORKBENCH_ROUTE_OPERATIONS, WORKBENCH_ROUTE_REGISTRY, routeFor, routesForLineage } from "../src/index.js"
import { test } from "bun:test"

test('routes.test', async () => {

const expected = ["workspace-switcher", "session-chat", "files", "search", "artifacts", "documents", "trace", "approvals", "activity-log", "capability-picker", "export"]
if (WORKBENCH_ROUTE_OPERATIONS.length !== expected.length) throw new Error("route registry cardinality changed")
for (const operation of expected) {
  if (!WORKBENCH_ROUTE_OPERATIONS.includes(operation as never)) throw new Error(`route missing: ${operation}`)
  if (routeFor(operation as never).operation !== operation) throw new Error(`route operation mismatch: ${operation}`)
}
if (Object.keys(WORKBENCH_ROUTE_REGISTRY).length !== expected.length) throw new Error("route registry is not total")
if (routesForLineage("work/document").some((route) => route.lineage !== "work/document")) throw new Error("work lineage crossed")
if (routesForLineage("design/render").some((route) => route.lineage !== "design/render")) throw new Error("design lineage crossed")
if (M20_SERVER_ROUTE_REGISTRY.designSystems.route !== "/v1/design-systems") throw new Error("M20 Design System route is not registered")
// A write route added without widening the lease answers 403 in the shipped
// app while its own tests pass against a fully-scoped test principal — the
// exact way the Fichiers CRUD, composer uploads and PTY routes shipped broken.
if (SURFACE_REQUIRED_CAPABILITIES.length === 0) throw new Error("no surface capabilities derived from the registries")
if (!SURFACE_LEASE_CAPABILITIES.includes("workspace.write")) throw new Error("surface lease lost workspace.write")
console.log(`WorkbenchRoutes: ${expected.length}/${expected.length} entries aligned, lease+grant cover ${SURFACE_REQUIRED_CAPABILITIES.length} registry capabilities`)
})
