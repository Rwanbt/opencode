// FORK: LSP extensions for CodeMirror 6 (Phase 2 — ADR-0005 roadmap).
// Wires diagnostics, hover tooltips and go-to-definition into the editor
// without coupling packages/ui to the SDK or app context.  The parent
// (file-tabs.tsx) owns the API calls and passes them in via LspCallbacks;
// this module only deals with CM internals.
import { linter, lintGutter } from "@codemirror/lint"
import type { Diagnostic as CMDiagnostic } from "@codemirror/lint"
import { hoverTooltip, keymap } from "@codemirror/view"
import type { Extension, Text } from "@codemirror/state"

// ─── Public types (consumed by code-mirror.tsx props) ────────────────────────

export interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export interface LspLocation {
  uri: string
  range: LspRange
}

export interface LspDiagnosticEntry {
  range: LspRange
  /** 1=Error 2=Warning 3=Information 4=Hint */
  severity?: number
  message: string
  source?: string
  code?: string | number
}

export interface LspHoverResult {
  contents?: unknown
  range?: LspRange
}

/** Callbacks injected by the parent; each returns a Promise so the CM
 *  extensions can stay async without coupling to a specific HTTP client. */
export interface LspCallbacks {
  getDiagnostics(file: string): Promise<LspDiagnosticEntry[]>
  hover(file: string, line: number, character: number): Promise<LspHoverResult | null>
  definition(file: string, line: number, character: number): Promise<LspLocation[]>
  references(file: string, line: number, character: number): Promise<LspLocation[]>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a zero-based LSP position to a CM doc offset. */
function lspPosToOffset(doc: Text, line: number, character: number): number {
  // CM lines are 1-indexed; clamp to avoid out-of-range panics.
  const l = Math.min(line + 1, doc.lines)
  const lineObj = doc.line(l)
  return Math.min(lineObj.from + character, lineObj.to)
}

function lspSeverityToCM(severity?: number): CMDiagnostic["severity"] {
  if (severity === 1) return "error"
  if (severity === 2) return "warning"
  return "info"
}

/** Extract plain text from a hover result's `contents` field.
 *  The LSP protocol allows: string | MarkupContent | MarkedString[]. */
function extractHoverText(contents: unknown): string {
  if (typeof contents === "string") return contents
  if (Array.isArray(contents)) {
    return (contents as unknown[])
      .map((c) => (typeof c === "string" ? c : (c as { value?: string }).value ?? ""))
      .filter(Boolean)
      .join("\n\n")
  }
  if (contents && typeof contents === "object") {
    return (contents as { value?: string }).value ?? ""
  }
  return ""
}

/** Convert a `file://` URI to a local path (Windows-aware). */
function uriToPath(uri: string): string {
  if (!uri.startsWith("file://")) return uri
  // file:///C:/foo → C:/foo  |  file:///home/... → /home/...
  return decodeURIComponent(uri.slice(7).replace(/^\/([A-Z]:)/, "$1"))
}

// ─── Extension builder ───────────────────────────────────────────────────────

/**
 * Build CM6 extensions for LSP features:
 *  - Diagnostics gutter + squiggles (750 ms debounce)
 *  - Hover tooltip (300 ms delay)
 *  - F12 → go-to-definition (calls `onNavigate` when found)
 */
export function buildLspExtensions(
  path: string,
  callbacks: LspCallbacks,
  onNavigate?: (file: string, line: number, character: number) => void,
): Extension[] {
  const extensions: Extension[] = []

  // ── Diagnostics ──────────────────────────────────────────────────────────
  extensions.push(
    lintGutter(),
    linter(
      async (view) => {
        let diags: LspDiagnosticEntry[]
        try {
          diags = await callbacks.getDiagnostics(path)
        } catch {
          return []
        }
        return diags.flatMap((d): CMDiagnostic[] => {
          try {
            const from = lspPosToOffset(view.state.doc, d.range.start.line, d.range.start.character)
            const to = lspPosToOffset(view.state.doc, d.range.end.line, d.range.end.character)
            return [
              {
                from,
                // CM requires to >= from even for zero-width positions.
                to: Math.max(to, from + 1),
                severity: lspSeverityToCM(d.severity),
                message: d.source ? `[${d.source}] ${d.message}` : d.message,
              },
            ]
          } catch {
            return []
          }
        })
      },
      { delay: 750 },
    ),
  )

  // ── Hover tooltip ─────────────────────────────────────────────────────────
  extensions.push(
    hoverTooltip(
      async (view, pos) => {
        const line = view.state.doc.lineAt(pos)
        const lspLine = line.number - 1 // CM 1-indexed → LSP 0-indexed
        const lspChar = pos - line.from
        let result: LspHoverResult | null
        try {
          result = await callbacks.hover(path, lspLine, lspChar)
        } catch {
          return null
        }
        if (!result?.contents) return null
        const text = extractHoverText(result.contents)
        if (!text) return null
        return {
          pos,
          create() {
            const dom = document.createElement("div")
            dom.className = "cm-lsp-tooltip"
            // Simple pre-formatted display; markdown rendering is deferred.
            const pre = document.createElement("pre")
            pre.textContent = text
            dom.appendChild(pre)
            return { dom }
          },
        }
      },
      { hideOnChange: true, hoverTime: 300 },
    ),
  )

  // ── Go-to-definition (F12) ───────────────────────────────────────────────
  if (onNavigate) {
    extensions.push(
      keymap.of([
        {
          key: "F12",
          run: (view) => {
            const pos = view.state.selection.main.head
            const line = view.state.doc.lineAt(pos)
            const lspLine = line.number - 1
            const lspChar = pos - line.from
            void callbacks
              .definition(path, lspLine, lspChar)
              .then((locs) => {
                if (locs.length === 0) return
                const loc = locs[0]
                onNavigate(uriToPath(loc.uri), loc.range.start.line, loc.range.start.character)
              })
              .catch(() => {})
            return true
          },
        },
      ]),
    )
  }

  return extensions
}
