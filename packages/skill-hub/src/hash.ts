/* SPDX-License-Identifier: MIT */

/**
 * Node-only SHA-256 helper for the skill registry.
 *
 * WHY a separate file: the `InMemorySkillRegistry.publish` method
 * computes a digest of the skill artifact using `node:crypto.createHash`.
 * Pulling `node:crypto` through the main `@unifia/skill-hub` entry would
 * make the package fail to bundle in the web UI (Vite externalizes
 * `node:crypto` and the stub does not export `createHash`).
 *
 * Consumers in a Node context import the helper through
 * `@unifia/skill-hub/node`, which keeps the browser entry small and
 * side-effect-free.
 */
import { createHash } from "node:crypto"

export const hashBytes = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex")
