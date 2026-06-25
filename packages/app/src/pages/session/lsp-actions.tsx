// LSP action glue extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 4.1).
//
// WHY extracted: the rename (F2) and code-action (Ctrl+.) flows are
// self-contained UI controllers — they own their own signals (rename state,
// loading, code-actions list) and their handlers. The handlers call the
// server with `fetch` directly today; Phase 4.3 will swap the four fetch
// calls for the typed SDK client once the OpenAPI routes are regenerated.
//
// Decoupled from createLspCallbacks (in lsp-handlers.ts) which only defines
// the read-only LSP operations consumed by CodeMirror. The actions here are
// the WRITE side of LSP — they trigger `prepareRename` / `triggerCodeAction`
// via the callbacks registered by the parent, then drive rename-dialog and
// code-actions-panel state.
//
// Direct fetch kept verbatim from Phase 2.5 so behavior is preserved 1:1
// during the mechanical extraction. Phase 4.3 replaces these calls.

import { createSignal } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import type { CodeMirrorHandle } from "@opencode-ai/ui/code-mirror"
import type { LspCodeAction, LspWorkspaceEdit } from "@opencode-ai/ui/code-mirror-lsp"
import { applyTextEdits, editsForFile } from "@/pages/session/lsp-handlers"
import type { RenameState } from "@/pages/session/rename-dialog"
import type { CodeActionPos } from "@/pages/session/code-actions-panel"

interface LspSdk {
  url: string
}

interface LspActionsInput {
  sdk: LspSdk
  path: () => string | undefined
  editorHandle: () => CodeMirrorHandle | undefined
}

export interface LspActionsHandle {
  renameState: () => RenameState | null
  renameInput: () => string
  renameLoading: () => boolean
  setRenameInput: (value: string) => void
  handlePrepareRename: (word: string, line: number, character: number) => void
  confirmRename: () => Promise<void>
  cancelRename: () => void

  codeActions: () => LspCodeAction[]
  codeActionsLoading: () => boolean
  codeActionPos: () => CodeActionPos | null
  handleTriggerCodeAction: (line: number, character: number, endLine: number, endCharacter: number) => Promise<void>
  applyCodeAction: (action: LspCodeAction) => Promise<void>
  closeCodeActions: () => void
}

export function createLspActions(input: LspActionsInput): LspActionsHandle {
  const [renameState, setRenameState] = createSignal<RenameState | null>(null)
  const [renameInput, setRenameInput] = createSignal("")
  const [renameLoading, setRenameLoading] = createSignal(false)

  const handlePrepareRename = (word: string, line: number, character: number) => {
    setRenameState({ word, line, character })
    setRenameInput(word)
  }

  const cancelRename = () => {
    setRenameState(null)
  }

  async function confirmRename() {
    const state = renameState()
    const newName = renameInput().trim()
    const p = input.path()
    if (!state || !newName || !p || newName === state.word) {
      setRenameState(null)
      return
    }
    setRenameLoading(true)
    try {
      const url = input.sdk.url
      const body = JSON.stringify({ file: p, line: state.line, character: state.character, newName })
      const res = await fetch(`${url}/lsp/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
      if (!res.ok) throw new Error(`${res.status}`)
      const edit = (await res.json()) as LspWorkspaceEdit
      const changes = edit.changes ?? {}

      const currentEdits = editsForFile(edit, p)
      const handle = input.editorHandle()
      if (currentEdits?.length && handle) {
        const updated = applyTextEdits(handle.getContent(), currentEdits)
        handle.setContent(updated)
      }

      const fileCount = Object.keys(changes).length
      showToast({
        variant: "success",
        title: `Renommé en "${newName}"`,
        description: fileCount > 1 ? `${fileCount} fichiers modifiés` : "Fichier courant mis à jour",
      })
    } catch (e) {
      showToast({ variant: "error", title: "Rename échoué", description: String(e) })
    } finally {
      setRenameLoading(false)
      setRenameState(null)
    }
  }

  const [codeActions, setCodeActions] = createSignal<LspCodeAction[]>([])
  const [codeActionsLoading, setCodeActionsLoading] = createSignal(false)
  const [codeActionPos, setCodeActionPos] = createSignal<CodeActionPos | null>(null)

  const closeCodeActions = () => {
    setCodeActions([])
  }

  const handleTriggerCodeAction = async (
    line: number,
    character: number,
    endLine: number,
    endCharacter: number,
  ) => {
    const p = input.path()
    if (!p) return
    setCodeActionPos({ line, character, endLine, endCharacter })
    setCodeActionsLoading(true)
    setCodeActions([])
    try {
      const url = input.sdk.url
      const body = JSON.stringify({ file: p, line, character, endLine, endCharacter })
      const res = await fetch(`${url}/lsp/code-action`, { method: "POST", headers: { "Content-Type": "application/json" }, body })
      if (!res.ok) return
      const actions = (await res.json()) as LspCodeAction[]
      setCodeActions(actions)
    } catch {
      // silent — no actions is valid
    } finally {
      setCodeActionsLoading(false)
    }
  }

  async function applyCodeAction(action: LspCodeAction) {
    const p = input.path()
    const pos = codeActionPos()
    if (!p || !pos) return

    setCodeActions([])

    if (action.edit?.changes) {
      const currentEdits = editsForFile(action.edit, p)
      const handle = input.editorHandle()
      if (currentEdits?.length && handle) {
        handle.setContent(applyTextEdits(handle.getContent(), currentEdits))
      }
      const fileCount = Object.keys(action.edit.changes).length
      if (fileCount > 1) {
        showToast({ variant: "success", title: action.title, description: `${fileCount} fichiers modifiés` })
      }
    }

    if (action.command?.command) {
      const url = input.sdk.url
      const body = JSON.stringify({
        file: p,
        line: pos.line,
        character: pos.character,
        command: action.command.command,
        commandArgs: action.command.arguments ?? [],
      })
      await fetch(`${url}/lsp/execute-command`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => null)
    }
  }

  return {
    renameState,
    renameInput,
    renameLoading,
    setRenameInput,
    handlePrepareRename,
    confirmRename,
    cancelRename,

    codeActions,
    codeActionsLoading,
    codeActionPos,
    handleTriggerCodeAction,
    applyCodeAction,
    closeCodeActions,
  }
}