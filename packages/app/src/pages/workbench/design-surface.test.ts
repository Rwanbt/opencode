/* SPDX-License-Identifier: MIT */
/**
 * What is left of the Design surface's own contract, once the approval
 * machine moved out.
 *
 * `design-surface.tsx` imports Solid's client-only runtime (`use` from
 * `solid-js/web`, absent from the SSR build), so Bun's test loader cannot
 * evaluate it. Everything this file can do is read the module as text.
 *
 * That limitation used to cover the *whole* approval flow, and it is why a
 * broken one shipped: a regex confirms a string is present, not that the
 * expired branch renders a reachable button or that a pending request was
 * withdrawn. The machine and its four broker operations now live in
 * `design-approval.ts`, which is plain TypeScript, and
 * `design-approval.test.ts` drives them against a fake broker.
 *
 * What remains here is genuinely a property of the markup: the modal's
 * stable selectors, and the fact that every branch of it — including the
 * expired one — offers the user something to click. See `docs/adr/0003-design-approval-extraction.md`.
 */

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

const SURFACE_TSX = resolve(import.meta.dir, "./design-surface.tsx")
const surface = readFileSync(SURFACE_TSX, "utf-8")

describe("the approval machine is not re-declared in the surface", () => {
  test("the surface imports it rather than owning a second copy", () => {
    // Two reducers is two behaviours; the extraction only pays off while
    // there is exactly one.
    expect(surface).toMatch(/from "@\/pages\/workbench\/design-approval"/)
    expect(surface).not.toMatch(/export function reduceApprovalState/)
  })

  test("the surface routes the modal through the injected operations", () => {
    const block = surface.match(/<ApprovalModal[\s\S]+?\/>/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/onAllow=\{\(\) => void approvalOps\.resolve\("allow"\)\}/)
    expect(block![0]).toMatch(/onDeny=\{\(\) => void approvalOps\.resolve\("deny"\)\}/)
    expect(block![0]).toMatch(/onCancel=\{\(\) => void approvalOps\.cancel\(\)\}/)
    expect(block![0]).toMatch(/onRerequest=\{\(\) => void approvalOps\.rerequest\(\)\}/)
  })

  test("unmounting goes through `detach`, which withdraws a pending approval", () => {
    const block = surface.match(/onCleanup\(\(\) => \{[\s\S]+?approvalOps\.detach\(\)[\s\S]*?\}\)/)
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/exportAbort\.abort\(\)/)
  })
})

describe("the modal's markup contract", () => {
  test("announces its state and the expired flag", () => {
    expect(surface).toMatch(/data-design-approval-modal=\{props\.state\.kind\}/)
    expect(surface).toMatch(/data-design-approval-expired=/)
  })

  test("exposes allow, deny and cancel with stable selectors", () => {
    expect(surface).toMatch(/data-design-approval-action="allow"/)
    expect(surface).toMatch(/data-design-approval-action="deny"/)
    expect(surface).toMatch(/data-design-approval-action="cancel"/)
  })

  test("the expired branch renders actions, not just a warning", () => {
    // The defect this pins: every control sat behind `!expired`, so an
    // expiry left a full-screen overlay with a message and nothing to
    // click, while the broker still held the request.
    const expiredBranch = surface.match(
      /<Show when=\{props\.state\.kind === "approval-required" && props\.state\.expired\}>[\s\S]+?<\/Show>/,
    )
    expect(expiredBranch).not.toBeNull()
    expect(expiredBranch![0]).toMatch(/data-design-approval-action="rerequest"/)
    expect(expiredBranch![0]).toMatch(/data-design-approval-action="cancel"/)
  })

  test("still warns that the approval expired", () => {
    expect(surface).toMatch(/data-design-approval-expired-warning/)
  })
})

describe("the export flow's own guards", () => {
  test("a second click is refused by `canStartApproval`", () => {
    const block = surface.match(
      /async function runExportFlow\([\s\S]+?const signal = exportAbort\.signal/,
    )
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/if \(!canStartApproval\(approvalState\(\)\)\) return/)
  })

  test("the retry path routes through `retry-start` and re-issues the same request", () => {
    const block = surface.match(
      /async function runExportFlow\([\s\S]+?throw new Error\("export returned an unrecognised envelope"\)/,
    )
    expect(block).not.toBeNull()
    expect(block![0]).toMatch(/setApprovalState\(\{ type: "retry-start" \}\)/)
    expect(block![0]).toMatch(/setApprovalState\(\{ type: "request-start" \}\)/)
  })
})
