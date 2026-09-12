/* SPDX-License-Identifier: MIT */

import { STORAGE_SHIM_SCRIPT } from "./bridges/storage-shim.js"
import { FOCUS_GUARD_SCRIPT } from "./bridges/focus-guard.js"
import { SNAPSHOT_BRIDGE_SCRIPT } from "./bridges/snapshot.js"
import { SELECTION_BRIDGE_SCRIPT } from "./bridges/selection.js"
import { EDIT_BRIDGE_SCRIPT } from "./bridges/edit.js"
import { annotateSelectableElements } from "./annotate.js"

// ADR-1035: the iframe runs scripts-only; the storage shim and focus
// guard exist specifically to keep artifacts usable under that policy.

export type SrcdocOptions = {
  /** Inject the localStorage/sessionStorage shim (default true). */
  storageShim?: boolean
  /** Inject the focus-guard script (default true). */
  focusGuard?: boolean
  /** Inject the snapshot bridge (default false — opt-in, consommé par P17+). */
  snapshotBridge?: boolean
  /** Inject the selection bridge (default false — opt-in, consommé par P18+). */
  selectionBridge?: boolean
  /** Inject the manual-edit bridge (default false — opt-in, Phase 9.2). */
  editBridge?: boolean
  /** Auto-annotate selectable elements with data-unifia-id (default false). */
  annotate?: boolean
  /** Optional base href to set on the document; only applied to wrapped fragments. */
  baseHref?: string
}

const DEFAULTS: Required<SrcdocOptions> = {
  storageShim: true,
  focusGuard: true,
  snapshotBridge: false,
  selectionBridge: false,
  editBridge: false,
  annotate: false,
  baseHref: "",
}

const SHELL_PREFIX = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
const SHELL_SUFFIX = "</body></html>"

/**
 * Return the index just past the `<head>` opening tag, or -1 if no head
 * is present. Case-insensitive; the spec lets authors write `<HEAD>`.
 */
function findHeadOpenEnd(html: string): number {
  const match = /<head[^>]*>/i.exec(html)
  if (!match) return -1
  return match.index + match[0].length
}

/**
 * Return the index of the first `<body` opening tag that is not inside a
 * `<script>` block. Used as a fallback when no `<head>` is present.
 *
 * Tracks script depth the same way `findHeadCloseOutsideScript` does, so
 * a literal `<body>` inside a `<script>` is ignored and the real
 * document body is found instead.
 */
function findBodyOpenOutsideScript(html: string): number {
  const re = /<script\b|<\/script>|<body\b/gi
  let scriptDepth = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const token = match[0].toLowerCase()
    if (token === "<script") {
      scriptDepth++
    } else if (token === "</script>") {
      if (scriptDepth > 0) scriptDepth--
    } else if (token === "<body") {
      if (scriptDepth === 0) {
        return match.index
      }
    }
  }
  return -1
}

/**
 * Build the document the iframe will load.
 *
 * - If `html` starts (after `trimStart`) with `<!doctype` or `<html`, it
 *   is treated as a complete document and passed through to the
 *   injection step unchanged. The shim and focus guard are still
 *   injected; only the wrapping is skipped.
 * - Otherwise the fragment is wrapped in a minimal shell
 *   `<!doctype html><html><head>…</head><body>…</body></html>`.
 *
 * The shim and focus guard, when enabled, are injected just AFTER the
 * opening `<head>` tag. This placement guarantees they are evaluated
 * before any author script (whether declared in `<head>` or later in
 * `<body>`). When no `<head>` is present, the shim is injected just
 * before the first `<body>` (also outside any script), and as a final
 * fallback at the top of the document.
 */
export function buildSrcdoc(html: string, options: SrcdocOptions = {}): string {
  const opts: Required<SrcdocOptions> = { ...DEFAULTS, ...options }
  const trimmed = html.trimStart()
  const isFullDocument = /^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)

  const document_ = isFullDocument ? html : wrapFragment(trimmed, opts.baseHref)

  // P18 — auto-annotation des éléments structurels avant injection des
  // bridges. Doit se faire sur le HTML complet (pas fragment-only) car
  // les ids sont calculés depuis l'arbre.
  const annotated = opts.annotate ? annotateSelectableElements(document_) : document_

  const insertion: string[] = []
  if (opts.storageShim) insertion.push(STORAGE_SHIM_SCRIPT)
  if (opts.focusGuard) insertion.push(FOCUS_GUARD_SCRIPT)
  if (opts.snapshotBridge) insertion.push(SNAPSHOT_BRIDGE_SCRIPT)
  if (opts.selectionBridge) insertion.push(SELECTION_BRIDGE_SCRIPT)
  if (opts.editBridge) insertion.push(EDIT_BRIDGE_SCRIPT)
  if (insertion.length === 0) return annotated

  const headOpenEnd = findHeadOpenEnd(annotated)
  if (headOpenEnd !== -1) {
    return (
      annotated.slice(0, headOpenEnd) +
      insertion.join("") +
      annotated.slice(headOpenEnd)
    )
  }

  const bodyOpen = findBodyOpenOutsideScript(annotated)
  if (bodyOpen !== -1) {
    return (
      annotated.slice(0, bodyOpen) +
      insertion.join("") +
      annotated.slice(bodyOpen)
    )
  }

  return insertion.join("") + annotated
}

function wrapFragment(fragment: string, baseHref: string): string {
  const base = baseHref ? `<base href="${escapeAttribute(baseHref)}">` : ""
  return `${SHELL_PREFIX}${base}${fragment}${SHELL_SUFFIX}`
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
