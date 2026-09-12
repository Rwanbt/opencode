/* SPDX-License-Identifier: MIT */

/**
 * Render-mode arbitration for the artifact preview iframe.
 *
 * The P11 component can either inline the artifact body through `srcDoc`
 * (which gives the iframe a synthetic, isolated document) or load it
 * through a URL (which gives the iframe a real origin against the host
 * server). Each option has trade-offs:
 *
 *  - `srcDoc` is safer (no external network, no origin to attack, the
 *    host can inject the storage shim and the focus guard before any
 *    user script runs) but blocks external `<script src=…>`.
 *  - URL loading is needed for artifacts that depend on external
 *    bundles (CDN, design system tokens fetched at runtime, etc.) but
 *    the host cannot pre-inject bridges, and the artifact can issue
 *    cross-origin requests.
 *
 * The decision is centralised here as a pure function so the heuristics
 * can be unit-tested and so the spec wording (a single set of rules
 * for both `needsBridge` and `forceInline`) cannot drift between
 * callers. See Runbook P12 for the spec.
 */

/**
 * What the host is asking the iframe to do.
 *
 *  - `mode: "preview"` — render the artifact as it would appear to a
 *    final user (live, interactive). Default heuristic; URL is fine.
 *  - `mode: "source"` — show the source code of the artifact, not its
 *    rendered form. URL is never the right answer for source view
 *    because the bridge layer is not present.
 *  - `needsBridge: true` — the host must inject a script (storage shim
 *    or focus guard) into the iframe before any user code runs. URL
 *    loading makes injection impossible, so the only safe choice is
 *    `srcDoc`.
 *  - `forceInline: true` — the user explicitly asked for inline render
 *    (for example to preserve the bridge layer during a snapshot). URL
 *    is suppressed regardless of the other heuristics.
 */
export type RenderDecision = {
  mode: "preview" | "source"
  /** A host bridge must be injected (storage shim, focus guard, etc.). */
  needsBridge: boolean
  /** The user opted in to inline rendering for this artifact. */
  forceInline: boolean
}

/**
 * Returns `true` when the iframe can fetch the artifact through a URL
 * (i.e. `src` attribute on the iframe). Returns `false` when the host
 * must inline the artifact as `srcDoc`.
 *
 * `false` is the safe default — every option here is a positive
 * reason to inline. An unrecognised decision is treated as
 * `forceInline: true` to keep the failure mode safe.
 */
export function shouldUrlLoad(decision: RenderDecision): boolean {
  if (decision.mode !== "preview") return false
  if (decision.needsBridge) return false
  if (decision.forceInline) return false
  return true
}

// Match `<script … src=…>` (the attribute may be quoted with ' or " or
// unquoted, and may sit anywhere in the tag). Used by both heuristics:
// an external script cannot be inspected, so the host cannot know
// whether it touches storage or focus, and the safe move is to assume
// it does. Case-insensitive to match HTML's tag-name rules.
const EXTERNAL_SCRIPT_REGEX = /<script\b[^>]*\ssrc\s*=/i

// Match `<script … type="text/babel">` (or `type='text/babel'` or
// type=text/babel). Babel-typed scripts are an in-page JSX / TS
// preprocessor; they depend on `localStorage` or `sessionStorage` for
// caching the compiled output, so the shim must be on. The match is
// intentionally loose on whitespace and quote style because Babel
// transpilers emit every flavour.
const BABEL_SCRIPT_REGEX = /<script\b[^>]*\stype\s*=\s*["']?text\/babel["']?/i

// Match the `autofocus` attribute on any tag (with or without value).
// HTML allows `autofocus` to appear without a value (e.g. `<input
// autofocus>`), so we only require the attribute name. Whitespace
// boundaries are required to avoid matching `data-autofocus` or
// similar.
const AUTOFOCUS_REGEX = /\bautofocus\b/i

// Match a `.focus(` method call (any receiver). JavaScript syntax
// requires the open paren; we don't match `focus:` or `focus;` which
// are method references, not invocations. The dot is required so
// `onfocus=` (HTML attribute) does not match.
const FOCUS_CALL_REGEX = /\.focus\s*\(/

/**
 * Returns `true` when the host must inject the localStorage /
 * sessionStorage shim into the iframe before the user code runs.
 *
 * The heuristic is intentionally broad: a false positive costs one
 * shim script (~600 bytes) and a slightly slower `srcDoc` render; a
 * false negative crashes the artifact with a `SecurityError` on the
 * first `localStorage` call (the iframe is in an opaque origin).
 *
 * `localStorage` and `sessionStorage` are matched as **prefixes**,
 * not as whole words. The spec (P12 §« Tests exigés ») explicitly
 * requires that the string `localStorageManager` in a comment
 * triggers the shim — that is a deliberate false positive, not a
 * bug. Removing the trailing word-boundary is the documented way to
 * opt into this lenient behaviour.
 */
export function htmlNeedsStorageShim(source: string): boolean {
  if (EXTERNAL_SCRIPT_REGEX.test(source)) return true
  if (BABEL_SCRIPT_REGEX.test(source)) return true
  if (/\blocalStorage/.test(source)) return true
  if (/\bsessionStorage/.test(source)) return true
  return false
}

/**
 * Returns `true` when the host must inject the focus-guard bridge.
 *
 * The guard re-focuses `<input autofocus>` elements after the
 * `srcDoc` is set, because the browser's autofocus does not fire
 * when the document is constructed synchronously. The heuristic
 * matches any code that programmatically calls `.focus(` so that
 * user code that defers focus to a click handler is also covered.
 */
export function htmlNeedsFocusGuard(source: string): boolean {
  if (EXTERNAL_SCRIPT_REGEX.test(source)) return true
  if (AUTOFOCUS_REGEX.test(source)) return true
  if (FOCUS_CALL_REGEX.test(source)) return true
  return false
}
