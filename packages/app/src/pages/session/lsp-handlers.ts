// LSP handlers extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 2.5).
//
// WHY extracted: file-tabs.tsx is a 972-LOC monolith mixing editor, viewer,
// scroll-sync, comments, keybindings, and LSP wiring. The five LSP API
// wrappers plus the applyTextEdits helper are stateless and reusable — they
// only depend on the SDK client and two indirect callbacks (prepareRename,
// triggerCodeAction) provided by the caller.
//
// Indirect closures: `prepareRename` and `triggerCodeAction` are passed in via
// `extras` instead of being read off a closure. This keeps the LSP layer
// decoupled from the rename/code-action UI state, which lives in
// rename-dialog.tsx and code-actions-panel.tsx respectively.

import type {
  LspCallbacks,
  LspCodeAction,
  LspDiagnosticEntry,
  LspHoverResult,
  LspLocation,
  LspTextEdit,
  LspWorkspaceEdit,
} from "@opencode-ai/ui/code-mirror-lsp"

export interface LspHandlerExtras {
  prepareRename: (word: string, line: number, character: number) => void
  triggerCodeAction: (line: number, character: number, endLine: number, endCharacter: number) => void
}

/** Minimal SDK surface needed by the LSP wrappers. */
export interface LspSdk {
  url: string
  client: {
    lsp: {
      diagnostics: (input: { file: string }) => Promise<{ data?: unknown }>
      hover: (input: { file: string; line: number; character: number }) => Promise<{ data?: unknown }>
      definition: (input: { file: string; line: number; character: number }) => Promise<{ data?: unknown }>
      references: (input: { file: string; line: number; character: number }) => Promise<{ data?: unknown }>
    }
  }
}

export function createLspCallbacks(sdk: LspSdk, extras: LspHandlerExtras): LspCallbacks {
  return {
    getDiagnostics: async (file: string) => {
      const res = await sdk.client.lsp.diagnostics({ file })
      const map = (res.data ?? {}) as unknown as Record<string, LspDiagnosticEntry[]>
      return map[file] ?? []
    },
    hover: async (file: string, line: number, character: number) => {
      const res = await sdk.client.lsp.hover({ file, line, character })
      return (res.data ?? null) as LspHoverResult | null
    },
    definition: async (file: string, line: number, character: number) => {
      const res = await sdk.client.lsp.definition({ file, line, character })
      return (res.data ?? []) as LspLocation[]
    },
    references: async (file: string, line: number, character: number) => {
      const res = await sdk.client.lsp.references({ file, line, character })
      return (res.data ?? []) as LspLocation[]
    },
    complete: async (file: string, line: number, character: number, triggerChar?: string) => {
      // WHY direct fetch: /lsp/completion is not yet in the generated SDK.
      // Tracked in PLAN-EDITEUR-IDE-DEFINITIF §2 (R-code&conv, fetch → SDK migration).
      const url = sdk.url
      const body = JSON.stringify({
        file,
        line,
        character,
        ...(triggerChar ? { triggerCharacter: triggerChar } : {}),
      })
      const res = await fetch(`${url}/lsp/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      if (!res.ok) return []
      return res.json() as Promise<import("@opencode-ai/ui/code-mirror-lsp").LspCompletionItem[]>
    },
    prepareRename: (word, line, character) => extras.prepareRename(word, line, character),
    triggerCodeAction: (line, character, endLine, endCharacter) =>
      void extras.triggerCodeAction(line, character, endLine, endCharacter),
  }
}

/**
 * Apply a list of LSP text edits to a string. Edits are sorted bottom-up so
 * earlier ranges stay valid as we mutate the line array.
 */
export function applyTextEdits(content: string, edits: LspTextEdit[]): string {
  const lines = content.split("\n")
  const sorted = [...edits].sort((a, b) => {
    const ld = b.range.start.line - a.range.start.line
    return ld !== 0 ? ld : b.range.start.character - a.range.start.character
  })
  for (const edit of sorted) {
    const { start, end } = edit.range
    if (start.line === end.line) {
      const l = lines[start.line] ?? ""
      lines[start.line] = l.slice(0, start.character) + edit.newText + l.slice(end.character)
    } else {
      const first = lines[start.line] ?? ""
      const last = lines[end.line] ?? ""
      const replacement = (first.slice(0, start.character) + edit.newText + last.slice(end.character)).split("\n")
      lines.splice(start.line, end.line - start.line + 1, ...replacement)
    }
  }
  return lines.join("\n")
}

/** Pick the edits targeting the current file out of a WorkspaceEdit, by either URI or raw path key. */
export function editsForFile(edit: LspWorkspaceEdit | undefined, currentPath: string): LspTextEdit[] | undefined {
  if (!edit?.changes) return undefined
  const uri = `file://${currentPath.replace(/\\/g, "/")}`
  return edit.changes[uri] ?? edit.changes[currentPath]
}

/** Type re-exports for convenience — consumers should import from this module rather than reaching into the LSP types. */
export type { LspCodeAction, LspLocation, LspTextEdit, LspWorkspaceEdit }