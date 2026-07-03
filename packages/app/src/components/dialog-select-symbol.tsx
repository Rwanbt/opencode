// Go-to-symbol palette (PLAN-EDITEUR-IDE-DEFINITIF Phase 5.4).
//
// Modal Quick Open variant scoped to the active file. Calls
// `sdk.client.lsp.documentSymbol({file})`, flattens the response into
// (name, kind, line) tuples, then displays them with the existing
// `<List>` fuzzy picker. Selecting a symbol opens the file (no-op if
// already active) and sets the viewer's `selectedLines` so pierre
// auto-scrolls to the symbol's selection range start.
//
// WHY a new modal (not reusing DialogSelectFile): the file dialog is
// project-scoped and backed by `find.files`; symbols are file-scoped and
// backed by LSP. Mixing them would tangle the search backend and the
// auto-close-then-jump UX.

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { createMemo, createResource, Show, type JSXElement } from "solid-js"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

// LSP SymbolKind numeric constants (LSP spec § SymbolKind).
// We only list the kinds we render — unknown kinds fall back to a generic
// dot icon. Numbers come straight from the spec; keep them in sync.
const SYMBOL_KIND_LABEL: Record<number, string> = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
}

type SymbolEntry = {
  id: string
  name: string
  kind: number
  kindLabel: string
  line: number
  detail?: string
}

type LspDocumentSymbol = {
  name: string
  kind: number
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } }
  detail?: string
  children?: LspDocumentSymbol[]
}

const flatten = (items: LspDocumentSymbol[], out: SymbolEntry[] = []) => {
  for (const item of items) {
    out.push({
      id: `${item.name}-${item.selectionRange.start.line}-${item.selectionRange.start.character}`,
      name: item.name,
      kind: item.kind,
      kindLabel: SYMBOL_KIND_LABEL[item.kind] ?? `Kind ${item.kind}`,
      line: item.selectionRange.start.line,
      detail: item.detail,
    })
    if (item.children?.length) flatten(item.children, out)
  }
  return out
}

// FileProvider and the directory-scoped SDKProvider are session-route-scoped
// while dialogs render through <DialogOutlet /> at RouterRoot. Openers on the
// session route must inject both — the context fallbacks would resolve to a
// missing FileProvider (throw) and the empty-directory fallback SDK (wrong
// LSP root) respectively.
export function DialogSelectSymbol(props: { sdk?: ReturnType<typeof useSDK>; file?: ReturnType<typeof useFile> }) {
  const sdk = props.sdk ?? useSDK()
  const file = props.file ?? useFile()
  const language = useLanguage()
  const dialog = useDialog()
  const { tabs, view } = useSessionLayout()

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  })
  const activeFile = createMemo(() => {
    const tab = tabState.activeFileTab()
    if (!tab) return undefined
    return file.pathFromTab(tab)
  })

  const [entries] = createResource(activeFile, async (p) => {
    if (!p) return [] as SymbolEntry[]
    const res = await sdk.client.lsp.documentSymbol({ file: p })
    const data = (res.data ?? []) as LspDocumentSymbol[]
    return flatten(data)
  })

  const items = (query: string) => {
    const list = entries() ?? []
    if (!query.trim()) return list
    const needle = query.toLowerCase()
    return list.filter((entry) => entry.name.toLowerCase().includes(needle))
  }

  const handleSelect = (item: SymbolEntry | undefined) => {
    if (!item) return
    const p = activeFile()
    if (!p) return
    dialog.close()

    // Open + activate the file (no-op when already active).
    const tab = file.tab(p)
    tabs().open(tab)
    file.load(p)
    tabs().setActive(tab)
    if (!view().reviewPanel.opened()) view().reviewPanel.open()

    // Set selection range to the symbol's start line. pierre auto-scrolls via
    // its file-find bridge when `selectedLines` changes (see pierre/file-find.ts).
    file.setSelectedLines(p, { start: item.line + 1, end: item.line + 1 })
  }

  return (
    <Dialog class="pt-3 pb-0 !max-h-[480px]" transition>
      <List
        search={{
          placeholder: language.t("palette.symbols.placeholder"),
          autofocus: true,
          hideIcon: true,
        }}
        emptyMessage={language.t("palette.symbols.empty")}
        loadingMessage={language.t("common.loading")}
        items={items}
        key={(item: SymbolEntry) => item.id}
        filterKeys={["name", "kindLabel"]}
        onSelect={handleSelect}
      >
        {(item: SymbolEntry): JSXElement => (
          <div class="w-full flex items-center justify-between gap-3 pl-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-12-regular text-text-weak shrink-0 w-20 truncate">
                {item.kindLabel}
              </span>
              <span class="text-14-regular text-text-strong truncate">{item.name}</span>
            </div>
            <Show when={item.detail}>
              <span class="text-12-regular text-text-weak truncate">{item.detail}</span>
            </Show>
            <span class="text-12-regular text-text-weak shrink-0 ml-auto">
              L{item.line + 1}
            </span>
          </div>
        )}
      </List>
    </Dialog>
  )
}