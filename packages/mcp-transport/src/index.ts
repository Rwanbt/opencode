/* SPDX-License-Identifier: MIT */

/**
 * @unifia/mcp-transport — JSON-RPC 2.0 codec, stdio framing and a client with
 * deadlines, cancellation, rate limiting and per-method authorisation.
 *
 * Plan V3 §3.2 "MCP transports — comparer, ne garder qu'une implémentation
 * canonique": this package is that single implementation. It connects to no
 * external MCP provider; wiring one is a separate provenance decision.
 */
export * from "./jsonrpc.js"
export * from "./stdio.js"
export * from "./client.js"
export * from "./design-tools.js"
