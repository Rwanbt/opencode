// LSP action glue extracted from file-tabs.tsx (PLAN-EDITEUR-IDE-DEFINITIF Phase 4.1).
//
// WHY extracted: the rename (F2) and code-action (Ctrl+.) flows are
// self-contained UI controllers — they own their own signals (rename state,
// loading, code-actions list) and their handlers. Phase 4.3 swapped the
// direct fetch calls for the typed SDK client (`sdk.client.lsp.rename`,
// `codeAction`, `executeCommand`) — the OpenAPI regen in
// `packages/sdk/js/script/build.ts` now exposes these routes on the
// generated Lsp client.
//
// Decoupled from createLspCallbacks (in lsp-handlers.ts) which only defines
// the read-only LSP operations consumed by CodeMirror. The actions here are
// the WRITE side of LSP — they trigger `prepareRename` / `triggerCodeAction`
// via the callbacks registered by the parent, then drive rename-dialog and
// code-actions-panel state.

import { createSignal } from "solid-js"
import { showToast } from "@opencode-ai/ui/toast"
import type { CodeMirrorHandle } from "@opencode-ai/ui/code-mirror"
import type { LspCodeAction, LspWorkspaceEdit } from "@opencode-ai/ui/code-mirror-lsp"
import { applyTextEdits, editsForFile } from "@/pages/session/lsp-handlers"
import { useLanguage } from "@/context/language"
import type { RenameState } from "@/pages/session/rename-dialog"
import type { CodeActionPos } from "@/pages/session/code-actions-panel"

/**
 * Loose structural view of the LSP client surface. The actual SDK returns a
 * generic response tagged by `ThrowOnError` whose `.data` field is either
 * the typed payload OR undefined (on non-2xx). We cast to the local
 * `LspCodeAction` / `LspWorkspaceEdit` types at the boundary — the shapes
 * match the OpenAPI Zod schemas (see `packages/opencode/src/server/routes/lsp.ts`).
 *
 * Using `any` for the response shape is intentional: the SDK generic depends
 * on a `ThrowOnError` flag we never pass, and tightening the interface here
 * would require either casting every call site or re-exporting the SDK's
 * internal response types. The cast at the call site (`as LspCodeAction[]`
 * below) is the safer boundary to maintain.
 */
interface LspSdkLike {
  client: {
    lsp: {
      rename: (input: { file: string; line: number; character: number; newName: string }) => Promise<any>
      codeAction: (input: {
        file: string
        line: number
        character: number
        endLine: number
        endCharacter: number
      }) => Promise<any>
      executeCommand: (input: {
        file: string
        line: number
        character: number
        command: string
        commandArgs?: Array<unknown>
      }) => Promise<any>
    }
  }
}

interface LspActionsInput {
  sdk: LspSdkLike
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
  const language = useLanguage()
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
      const res = await input.sdk.client.lsp.rename({
        file: p,
        line: state.line,
        character: state.character,
        newName,
      })
      // SDK default is non-throwing; data is the parsed body, response is the raw Response
      if (res.error || !res.data) throw new Error(`rename failed: ${res.response?.status ?? "no response"}`)
      const edit = res.data as LspWorkspaceEdit
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
        title: language.t("toast.lsp.rename.success.title", { name: newName }),
        description:
          fileCount > 1
            ? language.t("toast.lsp.rename.success.description.many", { count: fileCount })
            : language.t("toast.lsp.rename.success.description.one"),
      })
    } catch (e) {
      showToast({
        variant: "error",
        title: language.t("toast.lsp.rename.failed"),
        description: String(e),
      })
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
      const res = await input.sdk.client.lsp.codeAction({
        file: p,
        line,
        character,
        endLine,
        endCharacter,
      })
      // silent — empty actions list is a valid response (no quick fix available)
      setCodeActions(((res.data ?? []) as unknown) as LspCodeAction[])
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
        showToast({
          variant: "success",
          title: action.title,
          description: language.t("toast.lsp.codeAction.success.description.many", { count: fileCount }),
        })
      }
    }

    if (action.command?.command) {
      // Fire-and-forget per LSP spec: the server-side command emits its
      // own effects (open file, format, etc.) and we don't surface a result.
      await input.sdk.client.lsp
        .executeCommand({
          file: p,
          line: pos.line,
          character: pos.character,
          command: action.command.command,
          commandArgs: action.command.arguments ?? [],
        })
        .catch(() => null)
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