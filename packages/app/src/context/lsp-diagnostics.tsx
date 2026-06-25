// LSP diagnostics store (PLAN-EDITEUR-IDE-DEFINITIF Phase 5.5).
//
// WHY: `lsp.diagnostics` is the SDK's per-file diagnostic map (errors, warnings,
// hints). The bus emits `lsp.updated` whenever the LSP server re-publishes —
// we re-fetch the full map on each event so the status popover badge and the
// per-file counts stay in sync without per-file subscriptions.
//
// The store is directory-scoped (created via `createSimpleContext` inside the
// same `SDKProvider` as `useSync()`) so each open project gets its own
// diagnostic cache and the listener auto-tears-down on directory change.

import { createSimpleContext } from "@opencode-ai/ui/context"
import { onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useSDK } from "./sdk"

// LSP § Diagnostics severity constants.
export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const

export type Diagnostic = {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  severity?: number
  code?: string | number
  source?: string
  message: string
}

type DiagnosticMap = Record<string, Diagnostic[]>

export const { use: useLspDiagnostics, provider: LspDiagnosticsProvider } = createSimpleContext({
  name: "LspDiagnostics",
  init: () => {
    const sdk = useSDK()
    const [store, setStore] = createStore<{ file: DiagnosticMap }>({ file: {} })

    let inflight: Promise<void> | undefined
    const refresh = () => {
      if (inflight) return inflight
      const promise = (async () => {
        const result = await sdk.client.lsp.diagnostics()
        const next = (result.data ?? {}) as DiagnosticMap
        setStore("file", reconcile(next))
      })().finally(() => {
        inflight = undefined
      })
      inflight = promise
      return promise
    }

    // `lsp.updated` is the SDK event the server emits after re-publishing
    // diagnostics. Coalesced upstream by `global-sdk.tsx` (same key per
    // directory), so a flurry of publishes triggers exactly one re-fetch.
    const stop = sdk.event.listen((event) => {
      if (event.type === "lsp.updated") void refresh()
    })
    onCleanup(stop)

    const count = (file: string) => store.file[file]?.length ?? 0
    const errors = (file: string) =>
      (store.file[file] ?? []).filter((d) => d.severity === DiagnosticSeverity.Error).length
    const warnings = (file: string) =>
      (store.file[file] ?? []).filter((d) => d.severity === DiagnosticSeverity.Warning).length
    const total = () => Object.values(store.file).reduce((acc, list) => acc + list.length, 0)

    return {
      refresh,
      count,
      errors,
      warnings,
      total,
      for: (file: string) => store.file[file] ?? [],
      files: () => Object.keys(store.file),
    }
  },
})